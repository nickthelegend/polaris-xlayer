import { BlurView } from "expo-blur";
import { failed, press, succeeded, tap } from "../../src/lib/haptics";
import { Tabs, useRouter } from "expo-router";
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
  credit: "M12 3a9 9 0 1 0 9 9M12 3a9 9 0 0 1 9 9M12 8v4l3 2",
  plans: "M4 7h16M4 12h16M4 17h9",
  pay: "M12 5v14M12 19l5-5M12 19l-5-5M4 3h16",
  activity: "M3 12h4l3-7 4 14 3-7h4",
};

/** The scan glyph: four finder corners and a sweep line. */
const SCAN_PATH =
  "M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3M4 12h16";

const TABS = [
  { name: "index", label: "Credit", icon: "credit" },
  { name: "plans", label: "Plans", icon: "plans" },
  { name: "pay", label: "Pay", icon: "pay" },
  { name: "activity", label: "Activity", icon: "activity" },
] as const;

/**
 * Where each tab sits, in slot units.
 *
 * Five slots, not four: the middle one belongs to the scan button, which is an
 * action rather than a route. Mapping tab index to slot here keeps every
 * animated value in one coordinate space — the indicator, the glyph colours
 * and the layout all measure in slots, so none of them can disagree about
 * where "Pay" is.
 */
const SLOTS = 5;
const slotOf = (tabIndex: number) => (tabIndex < 2 ? tabIndex : tabIndex + 1);

/**
 * One tab.
 *
 * Everything it renders is a function of `pos` — the animated position of the
 * indicator, in slot units — rather than of its own boolean focused state.
 * That is the difference between four things switching on and off and one
 * object moving past them: as the indicator travels from Plans to Activity,
 * Pay warms and cools on the way through.
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
  const slot = slotOf(index);

  /** 1 when the indicator is on this tab, 0 once it is a slot away. */
  const nearness = useDerivedValue(() =>
    Math.max(0, 1 - Math.abs(pos.value - slot)),
  );

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
 * The raised scan button.
 *
 * The middle slot, lifted out of the bar rather than sitting in it. It is not
 * a tab: scanning is something you do and come back from, so it opens a modal
 * and the indicator never moves to it.
 */
function ScanButton({ onPress }: { onPress: () => void }) {
  const pressed = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, 0.9]) }],
  }));

  return (
    <View style={styles.scanSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan a Polaris code to pay"
        onPressIn={() => {
          pressed.value = withSpring(1, { damping: 16, stiffness: 340, mass: 0.5 });
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, { damping: 16, stiffness: 340, mass: 0.5 });
        }}
        onPress={() => {
          press();
          onPress();
        }}
      >
        <Animated.View style={[styles.scanButton, style]}>
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
            <Path
              d={SCAN_PATH}
              stroke="#07120A"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>
      </Pressable>
    </View>
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
  const router = useRouter();
  const [barWidth, setBarWidth] = useState(0);

  /*
   * The indicator's position, in slot units. One spring drives it and every
   * glyph's colour; animating those separately is how a tab bar ends up with
   * four things that almost agree.
   */
  const pos = useSharedValue(slotOf(state.index));
  const slotWidth = barWidth / SLOTS;

  // Driven from the router, so a deep link or a back gesture moves the
  // indicator exactly as a tap does.
  useEffect(() => {
    pos.value = withSpring(slotOf(state.index), {
      damping: 20,
      stiffness: 170,
      mass: 0.9,
    });
  }, [state.index]);

  /*
   * A single lime dot under the active glyph.
   *
   * This replaces a stack of three overlapping gradients — a radial halo, a
   * gradient pill and a gradient edge light. Layered translucent lime over a
   * near-black plate is exactly where gradients band, and three of them
   * competing made the bar look muddy at every position between two tabs. One
   * hard-edged dot travelling on the same spring reads as more deliberate and
   * cannot band, because there is nothing to interpolate.
   */
  const dot = useAnimatedStyle(() => ({
    transform: [{ translateX: pos.value * slotWidth + slotWidth / 2 - DOT / 2 }],
  }));

  return (
    <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
      <View
        style={styles.bar}
        onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
      >
        {/*
          The ground, in its own clipped layer.
          
          It has to be clipped to the bar's radius, and the scan button has to
          escape the bar entirely — one `overflow: hidden` cannot do both. So
          the plate is clipped here and the button is a sibling that is not.
          Without this the bar rendered transparent and the screen behind it
          read straight through the labels.
        */}
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
          const tab = TABS.find((t) => t.name === route.name);
          if (!tab) return null;
          const button = (
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
          // The scan button occupies the middle slot, between Plans and Pay.
          return i === 2 ? (
            <View key={`${route.key}-with-scan`} style={styles.pair}>
              <ScanButton onPress={() => router.push("/scan")} />
              {button}
            </View>
          ) : (
            button
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
       * Inactive screens must be detached, not merely left mounted. Four
       * screens all subscribed to the same chain state is four times the work
       * for one visible result — and on web it is four sets of absolutely
       * positioned scenes stacked on top of each other.
       */
      detachInactiveScreens
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
        lazy: true,
        // And stop rendering it while it is off screen.
        freezeOnBlur: true,
      }}
      tabBar={(props) => <PolarisTabBar {...props} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="plans" />
      <Tabs.Screen name="pay" />
      <Tabs.Screen name="activity" />
    </Tabs>
  );
}

const DOT = 5;
const SCAN_SIZE = 52;

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
    paddingVertical: space.sm + 2,
    // Deliberately not `overflow: hidden`: the scan button is taller than the
    // bar and has to be allowed out of it. The plate below does the clipping.
    backgroundColor: "transparent",
  },
  plateClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: ink.hairline,
    overflow: "hidden",
    boxShadow: "0px 14px 28px rgba(0, 0, 0, 0.6)",
    elevation: 18,
  },
  plate: {
    backgroundColor: "#080D16",
  },
  hairline: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: ink.highlight,
  },
  dot: {
    position: "absolute",
    top: 6,
    left: 0,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: palette.primary,
  },
  tab: {
    flex: 1,
  },
  /** Holds the scan button and the tab that follows it, so both keep a slot. */
  pair: {
    flex: 2,
    flexDirection: "row",
  },
  scanSlot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  scanButton: {
    width: SCAN_SIZE,
    height: SCAN_SIZE,
    borderRadius: SCAN_SIZE / 2,
    backgroundColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
    // Lifted clear of the bar. The offset is what makes it read as a primary
    // action rather than a fifth tab.
    marginTop: -26,
    borderWidth: 4,
    borderColor: "#080D16",
    boxShadow: "0px 6px 18px rgba(166, 242, 74, 0.35)",
    elevation: 12,
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
