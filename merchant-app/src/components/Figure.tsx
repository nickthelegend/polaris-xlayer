import { useEffect, useRef } from "react";
import { StyleSheet, Text as RNText, TextInput, TextStyle, View } from "react-native";
import Animated, {
  useAnimatedProps, useSharedValue, withTiming, Easing
} from "react-native-reanimated";

import { motion, palette, type } from "../theme";

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * Format base units as a decimal string, on the UI thread.
 *
 * Written by hand because this runs inside a worklet, where `Intl` and
 * `toLocaleString` do not exist. It also has to be exact: this is money, and a
 * float round-trip that turns 400.000304 into 400.0003 is a bug even when it
 * looks like a rendering detail.
 */
function formatUnits(value: number, decimals: number, group: boolean): string {
  "worklet";
  const negative = value < 0;
  const v = Math.round(Math.abs(value));
  const scale = Math.pow(10, 6);
  const whole = Math.floor(v / scale);
  const frac = v % scale;

  let wholeStr = String(whole);
  if (group) {
    // Thousands separators, without Intl.
    let out = "";
    for (let i = 0; i < wholeStr.length; i++) {
      const fromEnd = wholeStr.length - i;
      out += wholeStr[i];
      if (fromEnd > 1 && fromEnd % 3 === 1) out += ",";
    }
    wholeStr = out;
  }

  if (decimals === 0) return `${negative ? "-" : ""}${wholeStr}`;

  let fracStr = String(frac).padStart(6, "0").slice(0, decimals);
  return `${negative ? "-" : ""}${wholeStr}.${fracStr}`;
}

type Props = {
  /** USDC base units — 6 decimals, the same unit the program speaks in. */
  value: number;
  decimals?: number;
  variant?: "hero" | "stat" | "body" | "bodySmall" | "heading" | "label";
  tone?: "default" | "lime" | "soft" | "accent" | "danger";
  prefix?: string;
  suffix?: string;
  group?: boolean;
  /** Skip the count-up. For a figure that is already settled when you arrive. */
  animate?: boolean;
  style?: TextStyle;
};

const tones = {
  default: palette.foreground,
  lime: palette.primary,
  soft: "#A1A5AB",
  accent: palette.accent,
  danger: palette.destructive,
};

/**
 * A figure that counts to its value.
 *
 * Driven through an `AnimatedTextInput` rather than React state, so the digits
 * are updated on the UI thread and the count never stutters against a busy JS
 * thread — which is exactly when a balance animation is most visible.
 *
 * Tabular numerals are not optional here. With proportional digits every frame
 * of the count changes the string's width, so the figure jitters horizontally
 * while it runs and shoves anything beside it around. That reads as broken
 * rather than as animated.
 */
/**
 * The decimals this figure actually needs.
 *
 * Two is right for money, until the amount is smaller than a cent — and then
 * two renders a real balance as `0.00`, which states that nothing is owed when
 * something is. Interest on a short plan is genuinely sub-cent, so the rule is:
 * never display a non-zero amount as zero. Widen until a significant digit
 * appears, and stop at the six the token actually has.
 */
function decimalsFor(value: number, preferred: number): number {
  if (value === 0) return preferred;
  // Anything large enough to show at the preferred precision stays there.
  if (Math.abs(value) >= Math.pow(10, 6 - preferred)) return preferred;
  // Below that, go to the token's full precision rather than to the first
  // significant digit. Once a figure is already in sub-cent territory the
  // reason to show it at all is exactness, and 0.00009 for 0.000091 is a
  // rounded number wearing the costume of a precise one.
  return 6;
}

export function Figure({
  value,
  decimals: preferredDecimals = 2,
  variant = "stat",
  tone = "default",
  prefix = "",
  suffix = "",
  group = true,
  animate = true,
  style,
}: Props) {
  const decimals = decimalsFor(value, preferredDecimals);

  /*
   * Starts at the real value, never at zero.
   *
   * The count-up used to begin from a shared value of 0, with the input's
   * `defaultValue` also formatted from 0. That is fine while the animation
   * runs and a lie the moment it does not: on Android these figures were seen
   * sitting at `0.00` for a settled balance, with the surrounding
   * `animate={false}` figures all correct. A balance of 200.00 rendered as
   * 0.00 is the worst failure this component has, because nothing about it
   * looks broken -- it looks like the money is gone.
   *
   * So the truth is the resting state, and the animation is layered on top of
   * it by the effect below. If the effect never runs, or the ui thread never
   * picks up the animated prop, the figure is merely static and correct.
   */
  const started = useRef(false);
  const progress = useSharedValue(value);

  useEffect(() => {
    if (!animate) {
      progress.value = value;
      return;
    }
    // Count up from nothing on the way in, and from wherever it currently sits
    // on any later change, so a live update slides rather than restarting.
    if (!started.current) {
      started.current = true;
      progress.value = 0;
    }
    progress.value = withTiming(value, {
      duration: motion.duration.figure,
      // The same settling curve as everything else that moves.
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [value, animate]);

  const animatedProps = useAnimatedProps(() => {
    return {
      text: `${prefix}${formatUnits(progress.value, decimals, group)}${suffix}`,
    } as any;
  });

  const settled = `${prefix}${formatUnits(value, decimals, group)}${suffix}`;

  /*
   * The ghost is not a decoration — it is what gives this component a width.
   *
   * A TextInput does not size to its content the way a Text does, on any
   * platform. Left alone it collapses to nothing inside a centred container
   * (the figure simply vanishes) and stretches to fill inside a flex row
   * (shoving the label next to it across the screen). Both were happening.
   *
   * So an invisible Text holding the settled value lays out the box, and the
   * input is absolutely positioned over it. Sizing to the *settled* value
   * rather than the current one also means the box does not resize on every
   * frame of the count — which is the same reason the digits are tabular.
   */
  return (
    <View style={styles.wrap}>
      <RNText
        style={[styles.reset, type[variant], styles.ghost, style]}
        // Kept out of the accessibility tree: the live value is announced by
        // the input, and a screen reader should not hear the number twice.
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {settled}
      </RNText>

      <AnimatedTextInput
        editable={false}
        underlineColorAndroid="transparent"
        scrollEnabled={false}
        animatedProps={animatedProps}
        // The settled value either way — see the shared value above.
        defaultValue={settled}
        accessible
        accessibilityLabel={settled}
        style={[
          styles.reset,
          StyleSheet.absoluteFill,
          type[variant],
          { color: tones[tone], pointerEvents: "none" },
          style,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Never stretch to fill a row. The ghost decides the width.
    alignSelf: "flex-start",
  },
  reset: {
    padding: 0,
    margin: 0,
    // A TextInput reserves vertical space for a cursor and a baseline that a
    // Text does not, and the difference shows when a figure sits in a tight row.
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  ghost: {
    opacity: 0,
  },
});
