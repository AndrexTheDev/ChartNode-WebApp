/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Timeout-Signale mit Altbrowser-Fallback.
 *
 * `AbortSignal.timeout()` ist statisch und existiert erst ab Chrome 103 /
 * Safari 16 / Firefox 100. Next transpiliert nur *Syntax* auf die
 * Baseline (chrome 64, safari 12, …) – API-Lücken bleiben. Ohne Fallback
 * würde der Exchange-Probe bzw. der KuCoin-Token-Fetch in älteren Browsern
 * synchron werfen und die Venue fälschlich als „offline" markieren.
 *
 * Der Fallback reproduziert das native Verhalten: Abort mit
 * `TimeoutError`-Reason, damit bestehende `error.name === 'TimeoutError'`-
 * Checks (z. B. exchangeProbe) unverändert greifen.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  let reason: unknown;
  try {
    reason = new DOMException(`The operation timed out after ${ms}ms`, 'TimeoutError');
  } catch {
    reason = undefined; // uralte Browser ohne DOMException-Konstruktor → AbortError
  }
  setTimeout(() => controller.abort(reason as DOMException | undefined), ms);
  return controller.signal;
}
