import { Platform, TextStyle } from "react-native";

/**
 * Two families, the same two the web uses: Space Grotesk for everything a
 * person reads, JetBrains Mono for anything a machine produced — addresses,
 * signatures, order references.
 */
export const font = {
  display: "SpaceGrotesk_500Medium",
  displayBold: "SpaceGrotesk_700Bold",
  body: "SpaceGrotesk_400Regular",
  bodyMedium: "SpaceGrotesk_500Medium",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const;

/**
 * Tabular figures.
 *
 * The single most important type setting in the whole app, and the reason the
 * web stylesheet has a `.figure` class at all: money is read down a column of
 * digits, and proportional numerals make a changing value shift the ones beside
 * it. A balance that jitters while it animates reads as broken.
 */
export const tabular: TextStyle = {
  fontVariant: ["tabular-nums"],
  ...Platform.select({
    android: { fontFeatureSettings: "'tnum' 1" },
    default: {},
  }),
};

/**
 * The scale.
 *
 * The web clamps its display sizes against viewport width. A phone has one
 * width worth designing for, so these are the resolved values rather than a
 * formula — and the tracking gets tighter as the size grows, because large
 * numerals carry more built-in sidebearing than letters do.
 */
export const type = {
  /** The headline figure on a screen. One per screen, at most. */
  hero: {
    fontFamily: font.display,
    fontSize: 44,
    lineHeight: 44 * 0.95,
    letterSpacing: -1.4,
    ...tabular,
  } as TextStyle,

  title: {
    fontFamily: font.display,
    fontSize: 28,
    lineHeight: 30,
    letterSpacing: -0.9,
  } as TextStyle,

  heading: {
    fontFamily: font.display,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.4,
  } as TextStyle,

  /** A figure inside a stat tile. */
  stat: {
    fontFamily: font.display,
    fontSize: 24,
    lineHeight: 24,
    letterSpacing: -0.7,
    ...tabular,
  } as TextStyle,

  body: {
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.1,
  } as TextStyle,

  bodySmall: {
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: -0.05,
  } as TextStyle,

  /**
   * The quiet label that names a figure.
   *
   * 11px uppercase with wide tracking, and its colour is fixed at 60% opacity
   * rather than lower — the web learned this the hard way. Uppercase at this
   * size is the smallest text on the screen, and a lighter tint measured under
   * the 4.5:1 that small text needs. Quiet has to stop where legible ends.
   */
  label: {
    fontFamily: font.bodyMedium,
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  } as TextStyle,

  /** Machine output: addresses, signatures, references. */
  mono: {
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: -0.2,
  } as TextStyle,

  /** The text inside a button. */
  action: {
    fontFamily: font.displayBold,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  } as TextStyle,
} as const;
