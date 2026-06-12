import { sanitizeLogMessage } from '../shared/logger.js';
import type { HookHandler, HookObjectOutput } from '../types/hook.js';

function warningOutput(label: string, message: unknown): HookObjectOutput {
  return {
    systemMessage: `${label}: ${sanitizeLogMessage(message, 'hook failed')}`,
  };
}

export function withWarningBoundary(handler: HookHandler, options: { label?: string } = {}): HookHandler {
  const label = options.label || 'hook warning';
  return async (input, deps, context) => {
    try {
      return await handler(input, deps, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const logger = context?.logger || deps?.logger;
      if (logger && typeof logger.log === 'function') logger.log('E', sanitizeLogMessage(message));
      return warningOutput(label, message);
    }
  };
}

export function withResultNormalization(handler: HookHandler): HookHandler {
  return async (input, deps, context) => {
    const output = await handler(input, deps, context);
    if (output === null || output === undefined) return null;
    if (typeof output !== 'object' || Array.isArray(output)) {
      throw new TypeError('hook handler must return an object, null, or undefined');
    }
    return output;
  };
}

export function composeHandlers(handler: HookHandler, decorators: Array<(handler: HookHandler) => HookHandler>): HookHandler {
  return decorators.reduceRight((next, decorate) => decorate(next), handler);
}
