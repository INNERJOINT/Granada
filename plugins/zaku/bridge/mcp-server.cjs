#!/usr/bin/env node
/**
 * Standalone SourcePilot MCP proxy for the Zaku plugin.
 *
 * This file intentionally uses only Node.js built-ins so the generated Codex
 * plugin remains self-contained after Codex copies it into the plugin cache.
 */
'use strict';

const SOURCEPILOT_URL = (process.env.SOURCEPILOT_URL || '').replace(/\/+$/, '');
const SOURCEPILOT_KEY = process.env.SOURCEPILOT_KEY || '';
const FETCH_TIMEOUT_MS = 30000;
const MAX_STDIN_BUFFER_BYTES = 16 * 1024 * 1024;
const PROTOCOL_VERSION = '2025-03-26';

let sessionId = null;
let sessionInitPromise = null;
let requestCounter = 0;
let needsInpWrapping = null;
let remoteTools = null;

function nextId() {
  requestCounter += 1;
  return requestCounter;
}

function schema(properties = {}, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: true,
  };
}

const FALLBACK_TOOLS = [
  {
    name: 'list_projects',
    description: 'List available SourcePilot AOSP projects.',
    inputSchema: schema(),
  },
  {
    name: 'list_repos',
    description: 'List repositories in a SourcePilot AOSP project.',
    inputSchema: schema({
      project: { type: 'string' },
      query: { type: 'string' },
    }),
  },
  {
    name: 'search_code',
    description: 'Search AOSP source code by keywords or natural-language intent.',
    inputSchema: schema({
      query: { type: 'string' },
      project: { type: 'string' },
      repo: { type: 'string' },
      top_k: { type: 'integer' },
    }, ['query']),
  },
  {
    name: 'search_symbol',
    description: 'Search AOSP source code for a class, method, field, or symbol.',
    inputSchema: schema({
      symbol: { type: 'string' },
      project: { type: 'string' },
      repo: { type: 'string' },
      top_k: { type: 'integer' },
    }, ['symbol']),
  },
  {
    name: 'search_file',
    description: 'Find AOSP files by filename or path fragment.',
    inputSchema: schema({
      path: { type: 'string' },
      project: { type: 'string' },
      repo: { type: 'string' },
      top_k: { type: 'integer' },
    }, ['path']),
  },
  {
    name: 'search_regex',
    description: 'Search AOSP source code with a regular expression.',
    inputSchema: schema({
      pattern: { type: 'string' },
      project: { type: 'string' },
      repo: { type: 'string' },
      lang: { type: 'string' },
      top_k: { type: 'integer' },
    }, ['pattern']),
  },
  {
    name: 'get_file_content',
    description: 'Read AOSP file content after a search has identified its repository and path.',
    inputSchema: schema({
      repo: { type: 'string' },
      filepath: { type: 'string' },
      project: { type: 'string' },
      start_line: { type: 'integer' },
      end_line: { type: 'integer' },
    }, ['repo', 'filepath']),
  },
  {
    name: 'resolve_project_by_keyword',
    description: 'Resolve a SourcePilot project from a build or product keyword.',
    inputSchema: schema({
      keyword: { type: 'string' },
    }, ['keyword']),
  },
];

function parseSseResponse(body) {
  const events = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {}
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event && typeof event === 'object' && 'id' in event && ('result' in event || 'error' in event)) {
      return event;
    }
  }
  if (events.length > 0) return events[events.length - 1];
  try {
    return JSON.parse(body);
  } catch {
    return { error: { message: `Unparseable response: ${body.slice(0, 200)}` } };
  }
}

function assertConfigured() {
  if (!SOURCEPILOT_URL) throw new Error('SOURCEPILOT_URL is not configured');
}

async function mcpPost(payload, sid) {
  assertConfigured();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (SOURCEPILOT_KEY) headers.Authorization = `Bearer ${SOURCEPILOT_KEY}`;
  if (sid) headers['Mcp-Session-Id'] = sid;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(SOURCEPILOT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return {
      body: await response.text(),
      headers: response.headers,
      status: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function initSession() {
  const response = await mcpPost({
    jsonrpc: '2.0',
    id: nextId(),
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'zaku-sourcepilot-proxy', version: '2.0.0' },
    },
  });
  if (response.status !== 200) {
    throw new Error(`SourcePilot initialize failed: ${response.status} — ${response.body}`);
  }
  const sid = response.headers.get('mcp-session-id');
  if (!sid) throw new Error('SourcePilot did not return an MCP session ID');
  await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid).catch(() => {});
  return sid;
}

async function getSession() {
  if (sessionId) return sessionId;
  if (!sessionInitPromise) {
    sessionInitPromise = initSession()
      .then(sid => {
        sessionId = sid;
        sessionInitPromise = null;
        return sid;
      })
      .catch(error => {
        sessionInitPromise = null;
        throw error;
      });
  }
  return sessionInitPromise;
}

async function callAospMcp(method, params) {
  const doCall = async sid => {
    const response = await mcpPost({ jsonrpc: '2.0', id: nextId(), method, params }, sid);
    if (response.status === 400 || response.status === 404) {
      sessionId = null;
      needsInpWrapping = null;
      remoteTools = null;
      const refreshedSid = await getSession();
      return mcpPost({ jsonrpc: '2.0', id: nextId(), method, params }, refreshedSid);
    }
    return response;
  };

  const response = await doCall(await getSession());
  if (response.status !== 200) {
    throw new Error(`SourcePilot request failed: ${response.status} — ${response.body}`);
  }
  const decoded = parseSseResponse(response.body);
  if (decoded.error) throw new Error(`SourcePilot error: ${decoded.error.message}`);
  return decoded.result ?? {};
}

async function getRemoteTools() {
  if (remoteTools) return remoteTools;
  const result = await callAospMcp('tools/list', {});
  const tools = Array.isArray(result.tools) ? result.tools : [];
  remoteTools = tools.length > 0 ? tools : FALLBACK_TOOLS;
  return remoteTools;
}

async function detectInpWrapping() {
  if (needsInpWrapping !== null) return needsInpWrapping;
  const tools = await getRemoteTools();
  const properties = tools[0]?.inputSchema?.properties;
  needsInpWrapping = !!(properties && Object.keys(properties).length === 1 && 'inp' in properties);
  return needsInpWrapping;
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  writeMessage({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function toolError(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

async function handleRequest(message) {
  const { id, method, params = {} } = message;
  if (method === 'initialize') {
    result(id, {
      protocolVersion: params.protocolVersion || PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'zaku-sourcepilot', version: '2.0.0' },
      instructions: 'SourcePilot AOSP search proxy. Configure SOURCEPILOT_URL and SOURCEPILOT_KEY.',
    });
    return;
  }

  if (method === 'ping') {
    result(id, {});
    return;
  }

  if (method === 'tools/list') {
    if (!SOURCEPILOT_URL) {
      result(id, { tools: FALLBACK_TOOLS });
      return;
    }
    try {
      result(id, { tools: await getRemoteTools() });
    } catch (requestError) {
      process.stderr.write(`SourcePilot tools/list fallback: ${requestError.message || String(requestError)}\n`);
      result(id, { tools: FALLBACK_TOOLS });
    }
    return;
  }

  if (method === 'tools/call') {
    const toolName = params.name;
    if (typeof toolName !== 'string' || !toolName) {
      result(id, toolError('SourcePilot tool name is required'));
      return;
    }
    try {
      const useInp = await detectInpWrapping();
      const argumentsValue = params.arguments && typeof params.arguments === 'object'
        ? params.arguments
        : {};
      const toolArguments = useInp ? { inp: argumentsValue } : argumentsValue;
      const remoteResult = await callAospMcp('tools/call', {
        name: toolName,
        arguments: toolArguments,
      });
      result(id, remoteResult && typeof remoteResult === 'object'
        ? remoteResult
        : { content: [{ type: 'text', text: JSON.stringify(remoteResult) }] });
    } catch (requestError) {
      result(id, toolError(`SourcePilot error: ${requestError.message || String(requestError)}`));
    }
    return;
  }

  error(id, -32601, `Method not found: ${method}`);
}

let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputBuffer += chunk;
  if (Buffer.byteLength(inputBuffer, 'utf8') > MAX_STDIN_BUFFER_BYTES) {
    process.stderr.write('MCP stdin buffer exceeded limit\n');
    process.exitCode = 1;
    process.stdin.pause();
    return;
  }

  while (true) {
    const newline = inputBuffer.indexOf('\n');
    if (newline < 0) break;
    const line = inputBuffer.slice(0, newline).replace(/\r$/, '');
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      error(null, -32700, 'Parse error');
      continue;
    }
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      error(message?.id ?? null, -32600, 'Invalid Request');
      continue;
    }
    if (message.id === undefined) continue;
    handleRequest(message).catch(requestError => {
      error(message.id, -32603, requestError.message || String(requestError));
    });
  }
});

process.stdin.resume();
