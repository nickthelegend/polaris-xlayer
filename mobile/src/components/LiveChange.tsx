import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import type { LiveChange as Change } from "../chain/usePolaris";
import { USDC } from "../chain/math";
import { succeeded } from "../lib/haptics";
import { ink, palette, radius, space } from "../theme";
import { Text } from "./Text";

/**
 * What just happened, when nobody asked.
 *
 * The app watches the borrower's account and re-reads when the cluster says it
 * moved — which quietly rewrites two numbers on screen. Quietly is the problem:
 * the single most interesting thing this product does is collect money while
 * the borrower is doing nothing, and a figure that changes without comment is
 * easy to miss and easier to disbelieve.
 *
 * So it announces itself, once, and leaves. It carries a haptic because the
 * event it describes had no other way of reaching you.
 */
export function LiveChange({ change }: { change: Change | null }) {
  const shown = useSharedValue(0);

  useEffect(() => {
    if (!change) {
      shown.value = withTiming(0, { duration: 220 });
      return;
    }
    succeeded();
    shown.value = withSpring(1, { damping: 18, stiffness: 180, mass: 0.7 });
  }, [change]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [
      { translateY: (1 - shown.value) * -14 },
      { scale: 0.98 + shown.value * 0.02 },
    ],
  }));

  if (!change) return null;

  return (
    <Animated.View style={[styles.wrap, style, { pointerEvents: "none" }]}>
      <View style={styles.dot} />
      <View style={{ flex: 1 }}>
        <Text variant="label" tone="lime">
          {change.title}
        </Text>
        <Text variant="bodySmall" tone="soft" style={styles.detail}>
          {change.detail}
        </Text>
      </View>
      {change.amount !== null ? (
        <Text variant="heading" tone="lime">
          {(change.amount / USDC).toFixed(2)}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md + 2,
    marginBottom: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.primary + "44",
    backgroundColor: palette.card,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.primary,
    boxShadow: `0px 0px 10px ${palette.primary}`,
  },
  detail: { marginTop: 2 },
});
