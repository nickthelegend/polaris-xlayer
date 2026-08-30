/**
 * The palette, carried over from the web apps.
 *
 * Those are authored in `oklch`, which React Native cannot parse, so every
 * value here is the sRGB conversion of the token in `apps/core/app/globals.css`
 * rather than an eyeballed match. The oklch triple is kept in the comment so
 * the two can be diffed when either moves.
 *
 * One deliberate discrepancy is preserved rather than smoothed over: the
 * primary *token* is `oklch(0.88 0.2 128)`, which converts to `#B1EF4A`, but
 * the stylesheet hard-codes `#A6F24A` everywhere it draws a glow, ring or
 * scrollbar. Both are here. `primary` is what buttons and text render, `glow`
 * is what the light around them is made of — the same relationship the web has.
 */

export const palette = {
  /** oklch(0.13 0.02 260) — near-black, faintly blue */
  background: "#04070F",
  /** oklch(0.98 0.01 260) */
  foreground: "#F5F9FF",
  /** oklch(0.16 0.02 260) */
  card: "#080D16",
  /** oklch(0.88 0.20 128) — the lime everything hangs off */
  primary: "#B1EF4A",
  /** the literal lime the stylesheet uses for light */
  glow: "#A6F24A",
  /** oklch(0.18 0.02 260) — dark ink on lime */
  primaryForeground: "#0C121A",
  /** oklch(0.22 0.02 260) — the deeper surface */
  secondary: "#151B24",
  muted: "#151B24",
  /** oklch(0.72 0.01 260) */
  mutedForeground: "#A1A5AB",
  /** oklch(0.72 0.08 210) — the cool counterweight to the lime */
  accent: "#64B3C0",
  accentForeground: "#04070F",
  /** oklch(0.28 0.02 260) */
  border: "#232933",
  input: "#232933",
  /** oklch(0.55 0.08 210) */
  ring: "#2C7E8B",
  /** oklch(0.577 0.245 27.325) */
  destructive: "#E7000B",
  /** The terminal plate, hard-coded in the web stylesheet. */
  terminal: "#0D1117",
} as const;

/**
 * Alpha ramps.
 *
 * The web expresses these as `color-mix(in oklab, var(--color-foreground) N%,
 * transparent)`. React Native has no such function, so the mixes that actually
 * appear are precomputed here. Keeping them named rather than inline is what
 * stops a component inventing a fourteenth shade of nearly-white.
 */
const hexAlpha = (hex: string, alpha: number) => {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `${hex}${a}`;
};

export const withAlpha = hexAlpha;

export const ink = {
  /** Body copy that is not the point of the screen. */
  soft: hexAlpha(palette.foreground, 0.62),
  /** The quiet label above a figure. 60%, not less — see the note below. */
  label: hexAlpha(palette.foreground, 0.6),
  faint: hexAlpha(palette.foreground, 0.45),
  /** Hairlines, dividers, the top edge of a raised plane. */
  hairline: hexAlpha(palette.foreground, 0.08),
  hairlineStrong: hexAlpha(palette.foreground, 0.16),
  highlight: hexAlpha(palette.foreground, 0.07),
  wash: hexAlpha(palette.foreground, 0.04),
  hatch: hexAlpha(palette.foreground, 0.14),
} as const;

export const lime = {
  edge: hexAlpha(palette.primary, 0.45),
  wash: hexAlpha(palette.primary, 0.08),
  rim: hexAlpha(palette.primary, 0.22),
  glow: hexAlpha(palette.glow, 0.3),
  glowSoft: hexAlpha(palette.glow, 0.12),
  ghost: hexAlpha(palette.glow, 0.06),
} as const;

/**
 * Semantic colours for loan and subscription state.
 *
 * Named for what they mean rather than what they look like, so a status pill
 * cannot drift from the program's own enum. These map one-to-one onto
 * `LoanStatus` and `SubStatus` in the Anchor program.
 */
export const status = {
  active: palette.primary,
  repaid: palette.accent,
  liquidated: palette.destructive,
  cancelled: palette.mutedForeground,
  lapsed: "#FFB900",
  overdue: "#FE9A00",
} as const;
