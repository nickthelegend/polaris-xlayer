import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring, interpolate
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { Text } from "../../src/components";
import { ink, motion, palette, radius, space } from "../../src/theme";

/**
 * Line icons, drawn rather than imported.
 *
 * A 24px stroked glyph set is small enough to own outright, and owning it means
 * the weight matches the type instead of whatever an icon font happened to
 * ship. 1.6 tracks Space Grotesk's medium weight at this size.
 */
const Icon = ({ name, color }: { name: string; color: string }) => {
  const paths: Record<string, string> = {
    // A ring with an arc through it — the credit orb, reduced.
    credit: "M12 3a9 9 0 1 0 9 9M12 3a9 9 0 0 1 9 9M12 8v4l3 2",
    // Stacked installments.
    plans: "M4 7h16M4 12h16M4 17h9",
    // An arrow into a plane — paying out.
    pay: "M12 5v14M12 19l5-5M12 19l-5-5M4 3h16",
    // A pulse line.
    activity: "M3 12h4l3-7 4 14 3-7h4",
  };
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d={paths[name] ?? paths.credit}
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

function TabButton({
  focused,
  label,
  icon,
  onPress,
}: {
  focused: boolean;
  label: string;
  icon: string;
  onPress: () => void;
}) {
  const active = useSharedValue(focused ? 1 : 0);
  const pressed = useSharedValue(0);

  React.useEffect(() => {
    active.value = withSpring(focused ? 1 : 0, motion.spring.settle);
  }, [focused]);

  const wrap = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.08 }],
  }));

  // The lime pill slides in under the active tab rather than appearing.
  const pill = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [{ scaleX: interpolate(active.value, [0, 1], [0.4, 1]) }],
  }));

  const glyph = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(active.value, [0, 1], [0, -1]) }],
  }));

  return (
    <Pressable
      style={styles.tab}
      onPressIn={() => {
        pressed.value = withSpring(1, motion.spring.press);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, motion.spring.press);
      }}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
    >
      <Animated.View style={[styles.tabInner, wrap]}>
        <Animated.View style={[styles.pill, pill]} pointerEvents="none" />
        <Animated.View style={glyph}>
          <Icon name={icon} color={focused ? palette.primary : ink.faint} />
        </Animated.View>
        <Text
          variant="label"
          style={{
            color: focused ? palette.primary : ink.faint,
            fontSize: 9,
            letterSpacing: 0.6,
          }}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const TABS = [
  { name: "index", label: "Credit", icon: "credit" },
  { name: "plans", label: "Plans", icon: "plans" },
  { name: "pay", label: "Pay", icon: "pay" },
  { name: "activity", label: "Activity", icon: "activity" },
] as const;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
      }}
      tabBar={({ state, navigation }) => (
        <View
          style={[
            styles.barWrap,
            { paddingBottom: Math.max(insets.bottom, space.md) },
          ]}
        >
          <View style={styles.bar}>
            {/*
              The bar floats over the content rather than sitting under it, so
              it needs to be see-through enough to prove there is a screen
              beneath. Blur where the platform supports it, a tinted plate where
              it does not — Android's blur is expensive and lands inconsistently
              across OEM skins, and a solid plate at 96% reads better than a
              blur that stutters.
            */}
            {Platform.OS === "ios" ? (
              <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.plate]} />
            )}
            <View style={styles.edgeLight} pointerEvents="none" />

            {state.routes.map((route, i) => {
              const tab = TABS.find((t) => t.name === route.name);
              if (!tab) return null;
              return (
                <TabButton
                  key={route.key}
                  focused={state.index === i}
                  label={tab.label}
                  icon={tab.icon}
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
      )}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  barWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
  },
  bar: {
    flexDirection: "row",
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: ink.hairline,
    overflow: "hidden",
    paddingVertical: space.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 16,
  },
  plate: {
    backgroundColor: "#080D16F5",
  },
  edgeLight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: ink.highlight,
  },
  tab: {
    flex: 1,
  },
  tabInner: {
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: space.sm,
  },
  pill: {
    position: "absolute",
    top: 0,
    width: 44,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.primary,
    shadowColor: palette.glow,
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
});
