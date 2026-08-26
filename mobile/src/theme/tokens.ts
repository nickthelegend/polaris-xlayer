import { Platform, ViewStyle } from "react-native";

import { ink, lime, palette } from "./colors";

/** A 4px base, which is what the web's rem-based rhythm lands on anyway. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 44,
  "5xl": 64,
} as const;

/** `--radius: 0.625rem` and the calc() steps built off it. */
export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  "2xl": 20,
  pill: 999,
} as const;

/**
 * Elevation.
 *
 * React Native has no inset shadow, so the top highlight that sells a raised
 * plane on the web — `inset 0 1px 0 0 rgba(fg, 7%)` — cannot be a shadow here.
 * It is drawn instead: `Surface` lays a one-pixel gradient along its upper edge.
 * That is the same trick by a different mechanism, and it is the part that
 * matters. A border alone reads as an outline drawn on glass rather than an
 * object catching light.
 *
 * The offsets carry a y-component as well as a blur, so a plane sits *above*
 * the screen instead of glowing on it.
 */
export const elevation = {
  flat: {} as ViewStyle,

  raised: {
    ...Platform.select({
      android: { elevation: 6 },
      default: {},
    }),
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  } as ViewStyle,

  lifted: {
    ...Platform.select({
      android: { elevation: 12 },
      default: {},
    }),
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
  } as ViewStyle,

  /** What the lime casts. Used sparingly — it is the loudest thing available. */
  limeGlow: {
    ...Platform.select({
      android: { elevation: 10 },
      default: {},
    }),
    shadowColor: palette.glow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
  } as ViewStyle,
} as const;

/**
 * Motion.
 *
 * One easing curve for almost everything, and it is the web's:
 * `cubic-bezier(0.16, 1, 0.3, 1)` — a fast start that settles rather than
 * decelerating evenly. Anything that moves under a finger uses a spring
 * instead, because a curve with a fixed duration cannot follow a gesture.
 */
export const motion = {
  /** cubic-bezier(0.16, 1, 0.3, 1) */
  ease: [0.16, 1, 0.3, 1] as const,

  duration: {
    /** Press feedback. Below ~120ms a state change reads as instant. */
    instant: 120,
    quick: 180,
    /** The web's surface transition. */
    base: 240,
    slow: 420,
    /** A figure counting up. Long enough to read, short enough not to wait. */
    figure: 900,
  },

  /** Entrance stagger. Anything longer and the last card feels forgotten. */
  stagger: 55,

  spring: {
    press: { damping: 18, stiffness: 320, mass: 0.6 },
    settle: { damping: 20, stiffness: 180, mass: 0.9 },
    /** Overshoots a little. For something arriving, never for something leaving. */
    bounce: { damping: 12, stiffness: 220, mass: 0.8 },
  },
} as const;

/**
 * The raised plane, minus the top highlight (which `Surface` draws).
 *
 * Exported as a plain style so a screen can compose it without importing the
 * component, but prefer the component: it is the only thing that gets the edge
 * light right.
 */
export const surfaceStyle: ViewStyle = {
  backgroundColor: palette.card,
  borderWidth: 1,
  borderColor: ink.hairline,
  borderRadius: radius.lg,
  ...elevation.raised,
};

export const hairline = {
  borderColor: ink.hairline,
  borderWidth: 1,
} as const;

export { ink, lime, palette };
