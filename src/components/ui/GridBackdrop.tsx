/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Fixed, non-interactive background stack: neon grid, corner glows, scanlines
 * and a vignette. Rendered once in the root layout, sits behind everything
 * (`-z-10`) and is pure CSS – zero image bytes.
 */
export function GridBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* base wash */}
      <div className="absolute inset-0 bg-bg" />

      {/* neon grid, drifting */}
      <div className="nc-grid absolute inset-0 animate-grid-drift bg-grid" />

      {/* corner glows */}
      <div className="absolute inset-0 bg-hero-glow" />

      {/* horizon line */}
      <div className="absolute inset-x-0 top-[38%] h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />

      {/* CRT scanlines */}
      <div className="nc-scanlines absolute inset-0" />

      {/* vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,hsl(var(--nc-bg)_/_0.85)_100%)]" />
    </div>
  );
}
