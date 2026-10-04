/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Abort helpers with fallbacks for browsers that lack `AbortSignal.timeout()`.
 *
 * A timeout must remain active even when the caller also supplied a signal;
 * assigning the caller signal directly accidentally removes the deadline.
 */
export interface AbortContext {
  signal: AbortSignal;
  /** Whether the deadline, rather than the caller, caused the abort. */
  timedOut: () => boolean;
  /** Releases the timeout and parent listener. */
  dispose: () => void;
}

export function createAbortContext(timeoutMs: number, parentSignal?: AbortSignal): AbortContext {
  const controller = new AbortController();
  let timeoutFired = false;
  const timeout = setTimeout(() => {
    timeoutFired = true;
    controller.abort(makeTimeoutError(timeoutMs));
  }, Math.max(0, timeoutMs));

  const onParentAbort = (): void => controller.abort(parentSignal?.reason ?? makeAbortError());
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  return {
    signal: controller.signal,
    timedOut: () => timeoutFired,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

/**
 * Timeout-Signale mit Altbrowser-Fallback.
 *
 * `AbortSignal.timeout()` is static and only exists in newer browsers. Next
 * transpiles syntax, not missing Web APIs, so the fallback aborts a normal
 * controller with a `TimeoutError` reason.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(makeTimeoutError(ms)), ms);
  return controller.signal;
}

function makeTimeoutError(ms: number): DOMException {
  try {
    return new DOMException(`The operation timed out after ${ms}ms`, 'TimeoutError');
  } catch {
    const error = new Error(`The operation timed out after ${ms}ms`);
    error.name = 'TimeoutError';
    return error as DOMException;
  }
}

function makeAbortError(): DOMException {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error as DOMException;
  }
}
