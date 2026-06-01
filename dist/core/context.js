function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function defaultLogger() {
    return { log() { } };
}
export function createHookContext(input, deps = {}, overrides = {}) {
    const safeInput = asObject(input);
    const inputEventName = typeof safeInput.hook_event_name === 'string' ? safeInput.hook_event_name : null;
    const inputToolName = typeof safeInput.tool_name === 'string' ? safeInput.tool_name : null;
    const eventName = overrides.eventName ?? inputEventName;
    const toolName = overrides.toolName ?? inputToolName;
    const cwd = typeof safeInput.cwd === 'string' && safeInput.cwd ? safeInput.cwd : deps.cwd;
    const logger = deps.logger || defaultLogger();
    const now = typeof deps.now === 'function' ? deps.now : Date.now;
    const context = {
        input: safeInput,
        eventName,
        hookEventName: eventName,
        toolName,
        matcher: toolName,
        fs: deps.fs,
        spawn: deps.spawn,
        env: deps.env || {},
        cwd,
        skillPathArg: deps.skillPathArg,
        pid: deps.pid,
        now,
        logger,
        deps: {
            ...deps,
            env: deps.env || {},
            cwd,
            now,
            logger,
        },
    };
    return context;
}
