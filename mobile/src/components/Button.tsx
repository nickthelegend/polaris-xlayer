import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring, withTiming
} from "react-native-reanimated";

import { elevation, ink, motion, palette, radius, space, type } from "../theme";
import { Text } from "./Text";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
};

const heights: Record<Size, number> = { sm: 38, md: 46, lg: 54 };

/**
 * The primary action.
 *
 * Presses scale down slightly rather than changing colour, which is the same
 * decision the web made for its interactive surfaces: on a lime button a colour
 * change either disappears or shouts, while a scale reads at any brightness.
 *
 * Haptics are on the press-*in*, not the press. Feedback that waits for the
 * gesture to complete arrives after the user already knows they pressed it.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  full = false,
  icon,
  style,
}: Props) {
  const pressed = useSharedValue(0);
  const inert = disabled || loading;

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.03 }],
  }));

  const glow = useAnimatedStyle(() => ({
    opacity: withTiming(inert ? 0 : 1 - pressed.value * 0.5, {
      duration: motion.duration.instant,
    }),
  }));

  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const isGhost = variant === "ghost";

  const bg = isPrimary
    ? palette.primary
    : isDanger
      ? palette.destructive
      : isGhost
        ? "transparent"
        : palette.secondary;

  const fg = isPrimary
    ? palette.primaryForeground
    : isDanger
      ? palette.foreground
      : palette.foreground;

  return (
    <Animated.View
      style={[
        full && styles.full,
        isPrimary && !inert ? elevation.limeGlow : undefined,
        animated,
        style,
      ]}
    >
      <AnimatedPressable
        disabled={inert}
        onPressIn={() => {
          pressed.value = withSpring(1, motion.spring.press);
          Haptics.impactAsync(
            isPrimary
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light,
          );
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, motion.spring.press);
        }}
        onPress={onPress}
        style={[
          styles.base,
          {
            height: heights[size],
            backgroundColor: bg,
            borderColor: isGhost ? ink.hairlineStrong : "transparent",
            borderWidth: isGhost ? 1 : 0,
            opacity: inert ? 0.45 : 1,
            paddingHorizontal: size === "sm" ? space.lg : space["2xl"],
          },
          full && styles.full,
        ]}
      >
        {/* The upper-edge sheen. Same idea as a Surface, brighter on the lime. */}
        {!isGhost && (
          <Animated.View style={[StyleSheet.absoluteFill, glow]} pointerEvents="none">
            <LinearGradient
              colors={[
                isPrimary ? "rgba(255,255,255,0.28)" : ink.highlight,
                "transparent",
              ]}
              locations={[0, 0.5]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        )}

        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          <View style={styles.row}>
            {icon}
            <Text style={[type.action, { color: fg }]}>{label}</Text>
          </View>
        )}
      </AnimatedPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  full: {
    alignSelf: "stretch",
    width: "100%",
  },
});
