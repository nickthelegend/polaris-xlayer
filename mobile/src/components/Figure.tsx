import { useEffect } from "react";
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
export function Figure({
  value,
  decimals = 2,
  variant = "stat",
  tone = "default",
  prefix = "",
  suffix = "",
  group = true,
  animate = true,
  style,
}: Props) {
  const progress = useSharedValue(animate ? 0 : value);

  useEffect(() => {
    if (!animate) {
      progress.value = value;
      return;
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
        pointerEvents="none"
        animatedProps={animatedProps}
        defaultValue={animate ? `${prefix}${formatUnits(0, decimals, group)}${suffix}` : settled}
        accessible
        accessibilityLabel={settled}
        style={[
          styles.reset,
          StyleSheet.absoluteFill,
          type[variant],
          { color: tones[tone] },
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
