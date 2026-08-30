import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { tap } from "../../src/lib/haptics";
import { ink, palette, space } from "../../src/theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * The same bar the borrower app uses, with two slots instead of five.
 *
 * This is a port rather than a lookalike: the indicator is one spring in slot
 * units, every glyph's colour is a function of its distance from that spring,
 * and the plate is a clipped layer under transparent tabs. Two apps that share
 * a palette but move differently do not read as one product, and motion is the
 * part people notice without being able to name.
 *
 * What is deliberately absent is the raised centre button. That is the scan
 * action, and a merchant hands codes out rather than reading them — a lifted
 * primary action with nothing behind it would be decoration.
 */
const PATHS: Record<string, string> = {
  book: "M4 5h16M4 10h16M4 15h10M4 20h6",
  charge: "M4 7a2 2 0 0 1 2-2h4v4H4zM14 5h4a2 2 0 0 1 2 2v2h-6zM4 13h6v6H6a2 2 0 0 1-2-2zM14 13h6v4a2 2 0 0 1-2 2h-4z",
};

const TABS = [
  { name: "index", label: "Book", icon: "book" },
  { name: "charge", label: "Charge", icon: "charge" },
] as const;

const SLOTS = TABS.length;

function TabButton({
  index,
  pos,
  label,
  icon,
  onPress,
}: {
  index: number;
  pos: SharedValue<number>;
  label: string;
  icon: string;
  onPress: () => void;
}) {
  const pressed = useSharedValue(0);

  /** 1 when the indicator is on this tab, 0 once it is a slot away. */
  const nearness = useDerivedValue(() => Math.max(0, 1 - Math.abs(pos.value - index)));

  const wrap = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, 0.92]) }],
  }));

  const stroke = useAnimatedProps(() => ({
    stroke: interpolateColor(nearness.value, [0, 1], [ink.faint, palette.primary]),
    strokeWidth: interpolate(nearness.value, [0, 1], [1.6, 2]),
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(nearness.value, [0, 1], [0.5, 1]),
    color: interpolateColor(nearness.value, [0, 1], [ink.faint, palette.primary]),
  }));

  return (
    <Pressable
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityLabel={label}
      onPressIn={() => {
        pressed.value = withSpring(1, { damping: 18, stiffness: 320, mass: 0.6 });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { damping: 18, stiffness: 320, mass: 0.6 });
      }}
      onPress={() => {
        tap();
        onPress();
      }}
    >
      <Animated.View style={[styles.tabInner, wrap]}>
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          <AnimatedPath
            d={PATHS[icon] ?? PATHS.book}
            animatedProps={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <Animated.Text style={[styles.label, labelStyle]}>{label}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

/** Extracted because it owns hooks — see the borrower app for why an inline
 *  `tabBar` prop cannot. */
function MerchantTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);

  const pos = useSharedValue(state.index);
  const slotWidth = barWidth / SLOTS;

  useEffect(() => {
    pos.value = withSpring(state.index, { damping: 20, stiffness: 170, mass: 0.9 });
  }, [state.index]);

  const dot = useAnimatedStyle(() => ({
    transform: [{ translateX: pos.value * slotWidth + slotWidth / 2 - DOT / 2 }],
  }));

  return (
    <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
      <View
        style={styles.bar}
        onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
      >
        <View style={[styles.plateClip, { pointerEvents: "none" }]}>
          {Platform.OS === "ios" ? (
            <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.plate]} />
          )}
          <View style={styles.hairline} />
          {barWidth > 0 ? <Animated.View style={[styles.dot, dot]} /> : null}
        </View>

        {state.routes.map((route: any, i: number) => {
          const t = TABS.find((x) => x.name === route.name);
          if (!t) return null;
          return (
            <TabButton
              key={route.key}
              index={i}
              pos={pos}
              label={t.label}
              icon={t.icon}
              onPress={() => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!event.defaultPrevented) navigation.navigate(route.name);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      detachInactiveScreens
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
        lazy: true,
        freezeOnBlur: true,
      }}
      tabBar={(props) => <MerchantTabBar {...props} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="charge" />
    </Tabs>
  );
}

const DOT = 5;

const styles = StyleSheet.create({
  barWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    width: "100%",
    maxWidth: 620 + space.lg * 2,
    marginHorizontal: "auto",
  },
  bar: { flexDirection: "row", paddingVertical: space.sm + 2, backgroundColor: "transparent" },
  plateClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: ink.hairline,
    overflow: "hidden",
    boxShadow: "0px 14px 28px rgba(0, 0, 0, 0.6)",
    elevation: 18,
  },
  plate: { backgroundColor: "#080D16" },
  hairline: { position: "absolute", top: 0, left: 24, right: 24, height: 1, backgroundColor: ink.highlight },
  dot: {
    position: "absolute",
    top: 6,
    left: 0,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: palette.primary,
  },
  tab: { flex: 1 },
  tabInner: { alignItems: "center", justifyContent: "center", gap: 4 },
  label: {
    fontFamily: "SpaceGrotesk_500Medium",
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
});
