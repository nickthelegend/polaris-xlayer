import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Extrapolation,
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
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { ink, palette, space } from "../../src/theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * Line icons, drawn rather than imported.
 *
 * A 24px stroked set is small enough to own outright, and owning it means the
 * weight matches the type instead of whatever an icon font happened to ship.
 * The stroke colour is animated, so each glyph warms as the indicator reaches
 * it rather than snapping on when the route changes.
 */
const PATHS: Record<string, string> = {
  // A ring with a hand through it — the credit orb, reduced.
  credit: "M12 3a9 9 0 1 0 9 9M12 3a9 9 0 0 1 9 9M12 8v4l3 2",
  // Stacked installments, the last one short: a schedule part-paid.
  plans: "M4 7h16M4 12h16M4 17h9",
  // An arrow landing on a plane — paying out.
  pay: "M12 5v14M12 19l5-5M12 19l-5-5M4 3h16",
  // A pulse.
  activity: "M3 12h4l3-7 4 14 3-7h4",
};

const TABS = [
  { name: "index", label: "Credit", icon: "credit" },
  { name: "plans", label: "Plans", icon: "plans" },
  { name: "pay", label: "Pay", icon: "pay" },
  { name: "activity", label: "Activity", icon: "activity" },
] as const;

/**
 * One tab.
 *
 * Everything it renders is a function of `pos` — the animated position of the
 * indicator, in tab units — rather than of its own boolean focused state.
 * That is the whole difference between four things switching on and off and
 * one object moving past them: as the pill travels from Plans to Activity, Pay
 * warms and cools on the way through.
 */
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

  /** 1 when the indicator is exactly here, 0 once it is a full tab away. */
  const nearness = useDerivedValue(() =>
    interpolate(Math.abs(pos.value - index), [0, 1], [1, 0], Extrapolation.CLAMP),
  );

  const wrap = useAnimatedStyle(() => ({
    transform: [
      { scale: (1 - pressed.value * 0.1) * interpolate(nearness.value, [0, 1], [1, 1.06]) },
      // The active glyph sits a little proud of its neighbours.
      { translateY: interpolate(nearness.value, [0, 1], [0, -2]) },
    ],
  }));

  const stroke = useAnimatedProps(() => ({
    stroke: interpolateColor(nearness.value, [0, 1], [ink.faint, palette.primary]),
    strokeWidth: interpolate(nearness.value, [0, 1], [1.5, 2]),
  }));

  const halo = useAnimatedStyle(() => ({
    opacity: interpolate(nearness.value, [0, 1], [0, 1]),
    transform: [{ scale: interpolate(nearness.value, [0, 1], [0.55, 1]) }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(nearness.value, [0, 1], [0.45, 1]),
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
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
    >
      <Animated.View style={[styles.tabInner, wrap]}>
        {/*
          The light the active glyph sits in — a real radial gradient, not a
          disc with a shadow on it. A shadow does not blur anything behind it
          on web, so the first version rendered as a solid lime coin with the
          icon lost inside it.
        */}
        <Animated.View style={[styles.halo, halo]} pointerEvents="none">
          <Svg width={44} height={44}>
            <Defs>
              <RadialGradient id={`halo-${icon}`} cx="0.5" cy="0.5" r="0.5">
                <Stop offset="0" stopColor={palette.glow} stopOpacity="0.55" />
                <Stop offset="0.5" stopColor={palette.glow} stopOpacity="0.16" />
                <Stop offset="1" stopColor={palette.glow} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect width={44} height={44} fill={`url(#halo-${icon})`} />
          </Svg>
        </Animated.View>
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          <AnimatedPath
            d={PATHS[icon] ?? PATHS.credit}
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

/**
 * The bar itself, as a real component.
 *
 * Extracted rather than left inline in the `tabBar` prop because it owns hooks.
 * Whether react-navigation renders that prop as a component or simply calls it
 * is an implementation detail, and hook ordering must not depend on one — an
 * inline function that is invoked rather than mounted puts its hooks into the
 * parent's list, which breaks the moment the parent's own hooks change.
 */
function PolarisTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);

  /*
   * The indicator's position, in tab units.
   *
   * One spring drives the pill, the travelling edge light and every glyph's
   * colour. Animating those separately is how a tab bar ends up with four
   * things that almost agree; with one number they cannot disagree.
   */
  const pos = useSharedValue(state.index);
  const tabWidth = barWidth / TABS.length;

  // Driven from the router, so a deep link or a back gesture moves the
  // indicator exactly as a tap does.
  useEffect(() => {
    pos.value = withSpring(state.index, { damping: 20, stiffness: 170, mass: 0.9 });
  }, [state.index]);

  const pill = useAnimatedStyle(() => ({
    width: tabWidth,
    transform: [{ translateX: pos.value * tabWidth }],
  }));

  // A short lime segment on the top edge that travels with the pill, so the
  // bar reads as lit from the active tab rather than uniformly outlined.
  const edge = useAnimatedStyle(() => ({
    width: tabWidth * 0.55,
    transform: [{ translateX: pos.value * tabWidth + tabWidth * 0.225 }],
  }));

  return (
    <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
      <View
        style={styles.bar}
        onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
      >
        {/*
          The bar floats over content, so it has to be see-through enough to
          prove there is a screen beneath. Blur where the platform does it well;
          a near-opaque plate where it does not — Android's blur is expensive
          and lands inconsistently across OEM skins, and a plate at 97% reads
          better than a blur that stutters.
        */}
        {Platform.OS === "ios" ? (
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.plate]} />
        )}

        {barWidth > 0 ? (
          <>
            <Animated.View style={[styles.pillWrap, pill]} pointerEvents="none">
              <LinearGradient
                colors={["rgba(177,239,74,0.13)", "rgba(177,239,74,0.04)", "transparent"]}
                locations={[0, 0.6, 1]}
                style={styles.pill}
              />
            </Animated.View>

            <Animated.View style={[styles.edgeWrap, edge]} pointerEvents="none">
              <LinearGradient
                colors={["transparent", palette.primary, "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.edge}
              />
            </Animated.View>
          </>
        ) : null}

        <View style={styles.hairline} pointerEvents="none" />

        {state.routes.map((route: any, i: number) => {
          const tab = TABS.find((t) => t.name === route.name);
          if (!tab) return null;
          return (
            <TabButton
              key={route.key}
              index={i}
              pos={pos}
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
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      /*
       * Inactive screens must be detached, not merely left mounted.
       *
       * The scenes are deliberately transparent so the ambient ground mounted
       * above the navigator shows through. That makes a mounted-but-inactive
       * screen fully visible rather than hidden behind an opaque one — all
       * four routes render on top of each other, which is what was happening.
       * On native react-native-screens detaches them for you; on web nothing
       * does unless you ask.
       */
      detachInactiveScreens
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
        // Do not mount a route until it is first visited.
        lazy: true,
        // And stop rendering it while it is off screen.
        freezeOnBlur: true,
      }}
      tabBar={(props) => <PolarisTabBar {...props} />}
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
    // Matches the content column, so on a tablet the bar sits under the
    // content rather than spanning away from it.
    width: "100%",
    maxWidth: 620 + space.lg * 2,
    alignSelf: "center",
  },
  bar: {
    flexDirection: "row",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: ink.hairline,
    overflow: "hidden",
    paddingVertical: space.sm + 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.6,
    shadowRadius: 28,
    elevation: 18,
  },
  plate: {
    backgroundColor: "#080D16F7",
  },
  hairline: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: ink.highlight,
  },
  pillWrap: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  pill: {
    flex: 1,
    // Inset enough to read as a lozenge sitting in the bar rather than a cell
    // filling it. Flush against the edges it looks like a table row.
    marginHorizontal: 11,
    marginVertical: 5,
    borderRadius: 18,
  },
  halo: {
    position: "absolute",
    top: -6,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  edgeWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    height: 2,
  },
  edge: {
    flex: 1,
    height: 2,
    shadowColor: palette.glow,
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  tab: {
    flex: 1,
  },
  tabInner: {
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: space.sm - 2,
  },
  label: {
    fontFamily: "SpaceGrotesk_500Medium",
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
});
