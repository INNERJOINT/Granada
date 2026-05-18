/**
 * Standalone MCP Server for zaku plugin
 * Provides only the sourcepilot tool (AOSP code search proxy)
 */
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const AOSP_MCP_URL = (process.env.AOSP_MCP_URL || '').replace(/\/+$/, '');
const AOSP_MCP_KEY = process.env.AOSP_MCP_KEY || '';

let sessionId = null;
let sessionInitPromise = null;
let requestCounter = 0;
let needsInpWrapping = null;

function nextId() { return ++requestCounter; }

function parseSseResponse(body) {
  const lines = body.split('\n');
  const events = [];
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data) {
        try { events.push(JSON.parse(data)); } catch {}
      }
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i];
    if (evt && typeof evt === 'object' && 'id' in evt && ('result' in evt || 'error' in evt)) {
      return evt;
    }
  }
  if (events.length > 0) return events[events.length - 1];
  try { return JSON.parse(body); } catch { return { error: { message: `Unparseable response: ${body.slice(0, 200)}` } }; }
}

const FETCH_TIMEOUT_MS = 30000;

async function mcpPost(payload, sid) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${AOSP_MCP_KEY}`,
  };
  if (sid) headers['Mcp-Session-Id'] = sid;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(AOSP_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.text();
    return { body, headers: res.headers, status: res.status };
  } finally {
    clearTimeout(timeout);
  }
}

async function initSession() {
  const initRes = await mcpPost({
    jsonrpc: '2.0', id: nextId(), method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'zaku-aosp', version: '1.0' } },
  });
  if (initRes.status !== 200) throw new Error(`AOSP MCP initialize failed: ${initRes.status} — ${initRes.body}`);
  const sid = initRes.headers.get('mcp-session-id');
  if (!sid) throw new Error('AOSP MCP server did not return a session ID');
  await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid).catch(() => {});
  return sid;
}

async function getSession() {
  if (sessionId) return sessionId;
  if (!sessionInitPromise) {
    sessionInitPromise = initSession().then((sid) => { sessionId = sid; sessionInitPromise = null; return sid; })
      .catch((err) => { sessionInitPromise = null; throw err; });
  }
  return sessionInitPromise;
}

async function detectInpWrapping() {
  if (needsInpWrapping !== null) return needsInpWrapping;
  const result = await callAospMcp('tools/list', {});
  const tools = result.tools;
  if (!tools || tools.length === 0) { needsInpWrapping = false; return false; }
  const props = tools[0].inputSchema?.properties;
  needsInpWrapping = !!(props && Object.keys(props).length === 1 && 'inp' in props);
  return needsInpWrapping;
}

async function callAospMcp(method, params) {
  let sid = await getSession();
  const doCall = async (currentSid) => {
    const res = await mcpPost({ jsonrpc: '2.0', id: nextId(), method, params }, currentSid);
    if (res.status === 400 || res.status === 404) {
      sessionId = null; needsInpWrapping = null;
      const newSid = await getSession();
      const retry = await mcpPost({ jsonrpc: '2.0', id: nextId(), method, params }, newSid);
      if (retry.status !== 200) throw new Error(`AOSP MCP request failed after session refresh: ${retry.status} — ${retry.body}`);
      return retry;
    }
    if (res.status !== 200) throw new Error(`AOSP MCP request failed: ${res.status} — ${res.body}`);
    return res;
  };
  const res = await doCall(sid);
  const json = parseSseResponse(res.body);
  if (json.error) throw new Error(`AOSP MCP error: ${json.error.message}`);
  return json.result ?? { content: [{ type: 'text', text: JSON.stringify(json) }] };
}

// MCP Server setup
const server = new Server({ name: 'zaku', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'sourcepilot',
    description: 'Search AOSP (Android Open Source Project)  via remote MCP server. Use "tool" to specify which remote tool to call (e.g. "list_projects", "search_code", "search_symbol", "search_file"), and "arguments" for tool-specific parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Remote AOSP MCP tool name (e.g. "list_projects", "search_code", "search_symbol", "search_file", "search_regex", "list_repos", "get_file_content", "list_tools")' },
        arguments: { type: 'object', description: 'Arguments to pass to the remote tool as key-value pairs', additionalProperties: true },
      },
      required: ['tool'],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== 'sourcepilot') {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    if (args.tool === 'list_tools') {
      const result = await callAospMcp('tools/list', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    const useInp = await detectInpWrapping();
    const toolArguments = useInp ? { inp: args.arguments ?? {} } : (args.arguments ?? {});
    const result = await callAospMcp('tools/call', { name: args.tool, arguments: toolArguments });
    return {
      content: result.content
        ? result.content.map(c => ({ type: 'text', text: c.text }))
        : [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return { content: [{ type: 'text', text: `AOSP MCP error: ${error.message || String(error)}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => { console.error('MCP server failed:', err); process.exit(1); });
