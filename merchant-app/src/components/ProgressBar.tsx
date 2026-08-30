import { useEffect } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withTiming
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import { ink, motion, palette } from "../theme";

/**
 * How much of a plan has been collected.
 *
 * Fills on mount rather than appearing filled, because the fill is what tells
 * you the bar is a measurement and not a decoration. Same settling curve as
 * every other transition in the app.
 */
export function ProgressBar({
  value,
  height = 6,
  tone = "lime",
  style,
}: {
  /** 0–1. */
  value: number;
  height?: number;
  tone?: "lime" | "accent";
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useSharedValue(0);
  const clamped = Math.max(0, Math.min(1, value));

  useEffect(() => {
    progress.value = withTiming(clamped, {
      duration: motion.duration.slow,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [clamped]);

  const fill = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const colors: [string, string] =
    tone === "lime"
      ? [palette.glow, palette.primary]
      : [palette.accent, palette.ring];

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }, style]}>
      <Animated.View style={[styles.fill, fill]}>
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[StyleSheet.absoluteFill, { borderRadius: height / 2 }]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: ink.hairline,
    overflow: "hidden",
    width: "100%",
  },
  fill: {
    height: "100%",
  },
});
