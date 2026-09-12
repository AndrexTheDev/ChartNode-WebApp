/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Exponential backoff with full jitter.
 *
 *   delay = random(0 .. min(cap, base * 2^attempt))
 *
 * Jitter matters: when an exchange restarts, hundreds of clients would
 * otherwise reconnect in lockstep and hammer it in the same millisecond
 * (the "thundering herd" that gets accounts/IPs banned).
 */
export class ExponentialBackoff {
  private attempt = 0;

  constructor(
    private readonly baseMs = 800,
    private readonly capMs = 30_000,
    private readonly maxAttempts = 12,
  ) {}

  get attempts(): number {
    return this.attempt;
  }

  get exhausted(): boolean {
    return this.attempt >= this.maxAttempts;
  }

  /** Next delay in ms; increments the attempt counter. */
  next(): number {
    const exponential = Math.min(this.capMs, this.baseMs * 2 ** this.attempt);
    this.attempt += 1;
    return Math.floor(exponential / 2 + Math.random() * (exponential / 2));
  }

  /** Call after a successful connection. */
  reset(): void {
    this.attempt = 0;
  }
}
