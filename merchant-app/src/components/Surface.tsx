import { LinearGradient } from "expo-linear-gradient";
import { failed, press, succeeded, tap } from "../lib/haptics";
import {
  Pressable, StyleProp, StyleSheet, View, ViewProps, ViewStyle
} from "react-native";
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring
} from "react-native-reanimated";

import { elevation, ink, lime, motion, palette, radius } from "../theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type SurfaceVariant = "raised" | "selected" | "plate" | "terminal";

type Props = ViewProps & {
  variant?: SurfaceVariant;
  /** Makes the plane pressable, and gives it the lift-under-finger response. */
  onPress?: () => void;
  /** Softer haptic than a primary action; a card is not a commitment. */
  haptic?: boolean;
  padded?: boolean | number;
  style?: StyleProp<ViewStyle>;
};

/**
 * A raised plane.
 *
 * The web builds this from three things stacked: a downward wash over the card
 * colour, a hairline border, and an *inset* top highlight. React Native has no
 * inset shadow, so the highlight is drawn here as a one-pixel view along the
 * upper edge.
 *
 * That last part is not a detail to skip. Real cards catch light on their top
 * edge, and without it a border reads as an outline drawn on glass rather than
 * an object sitting above the screen. It is the whole difference between a
 * surface and a rectangle.
 *
 * Shadow and clipping live on different views on purpose: `overflow: "hidden"`
 * on the same view that carries an Android elevation clips the shadow away.
 */
export function Surface({
  variant = "raised",
  onPress,
  haptic = true,
  padded = false,
  style,
  children,
  ...rest
}: Props) {
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.012 }],
    // Interactive planes lift toward the light rather than changing colour.
    opacity: 1 - pressed.value * 0.06,
  }));

  const isSelected = variant === "selected";
  const isPlate = variant === "plate";
  const isTerminal = variant === "terminal";

  const padding =
    padded === true ? 18 : typeof padded === "number" ? padded : undefined;

  const body = (
    <View
      style={[
        styles.clip,
        {
          borderColor: isSelected ? lime.edge : ink.hairline,
          backgroundColor: isTerminal ? palette.terminal : palette.card,
        },
        isPlate && styles.plate,
      ]}
    >
      {/*
        The downward wash. `locations` stops it at 40% so the lower two-thirds
        of the plane stay the flat card colour — a gradient that runs the whole
        height reads as a button, not a surface.
      */}
      <LinearGradient
        colors={
          isSelected
            ? [lime.wash, "transparent"]
            : [ink.wash, "transparent"]
        }
        locations={[0, isSelected ? 0.55 : 0.4]}
        style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}
      />

      {/* The edge light. One pixel, and it does most of the work. */}
      {!isPlate && (
        <View
          style={[
            styles.edgeLight,
            { backgroundColor: isSelected ? lime.rim : ink.highlight, pointerEvents: "none" },
          ]}
        />
      )}

      <View style={padding !== undefined ? { padding } : undefined}>{children}</View>
    </View>
  );

  const shell: StyleProp<ViewStyle> = [
    styles.shell,
    isPlate ? elevation.flat : elevation.raised,
    style,
  ];

  if (!onPress) {
    return (
      <View style={shell} {...rest}>
        {body}
      </View>
    );
  }

  return (
    <AnimatedPressable
      style={[shell, animated]}
      onPressIn={() => {
        pressed.value = withSpring(1, motion.spring.press);
        if (haptic) tap();
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, motion.spring.press);
      }}
      onPress={onPress}
      {...rest}
    >
      {body}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radius.lg,
  },
  clip: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },
  plate: {
    // A hairline plate is lighter than a surface but still an object: no wash,
    // no edge light, no shadow — just the container and its rules.
    backgroundColor: "transparent",
  },
  edgeLight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
});

/**
 * A divider that organises without drawing a box.
 *
 * The web's `.rule`. Used between rows inside a `plate`, and between sections
 * that are related enough not to need separate planes.
 */
export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: ink.hairline }, style]} />;
}
