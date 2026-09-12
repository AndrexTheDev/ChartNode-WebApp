/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Wave-4 alert delivery: browser notifications + an audible two-tone beep.
 * Everything is opt-in and wrapped defensively (no permission → silent log).
 */
let ctx: AudioContext | null = null;

export function notificationGranted(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  return window.Notification.permission === 'granted';
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  try {
    const result = await window.Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

export function notifyAlert(title: string, body: string): void {
  if (!notificationGranted()) return;
  try {
    new window.Notification(title, { body, tag: `nc-${title}` });
  } catch {
    /* some browsers require a service worker — fall back silently */
  }
}

/** Short two-tone beep via WebAudio (no assets, no network). */
export function beepAlert(): void {
  try {
    const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? window.webkitAudioContext) : undefined;
    if (!Ctor) return;
    ctx = ctx ?? new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.13);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.15);
    });
  } catch {
    /* audio blocked before first user gesture — ignore */
  }
}
