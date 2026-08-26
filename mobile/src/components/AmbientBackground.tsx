import { StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, {
  Defs, LinearGradient, Mask, Path, Pattern, RadialGradient, Rect, Stop
} from "react-native-svg";

import { palette } from "../theme";

/**
 * The ground the whole app sits on.
 *
 * This is doing perceptual work, not decoration. A raised plane needs something
 * behind it to read as raised, and near-black gives it nothing — every screen
 * ends up looking like a card floating in a void, and a sparse screen reads as
 * a bug rather than as a screen with little on it.
 *
 * Two layers, both far below the content and both under 5% opacity so neither
 * ever competes with a figure:
 *
 *   - a 64px hairline grid, faded out downward so it frames the top of the
 *     screen and then gets out of the way
 *   - one soft lime bloom in the upper right, which is where the eye lands first
 *
 * Rendered once at the root and shared by every screen, rather than per-route:
 * it is the ground, so it must not move or re-render when a route changes.
 */
export function AmbientBackground() {
  const { width, height } = useWindowDimensions();
  const h = height * 1.1;

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
      <Svg width={width} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern
            id="grid"
            width={64}
            height={64}
            patternUnits="userSpaceOnUse"
          >
            <Path
              d="M 64 0 L 0 0 0 64"
              fill="none"
              stroke={palette.foreground}
              strokeOpacity={0.03}
              strokeWidth={1}
            />
          </Pattern>

          {/*
            The grid fades to nothing by ~55% of the screen. Carrying it all the
            way down turns the background into graph paper and flattens the
            content onto it.
          */}
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity="1" />
            <Stop offset="0.35" stopColor="#fff" stopOpacity="0.85" />
            <Stop offset="0.75" stopColor="#fff" stopOpacity="0" />
          </LinearGradient>

          <Mask id="gridMask">
            <Rect x="0" y="0" width={width} height={h} fill="url(#fade)" />
          </Mask>

          <RadialGradient id="bloom" cx="0.82" cy="0.02" rx="0.85" ry="0.55">
            <Stop offset="0" stopColor={palette.glow} stopOpacity="0.10" />
            <Stop offset="0.55" stopColor={palette.glow} stopOpacity="0.035" />
            <Stop offset="1" stopColor={palette.glow} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Rect x="0" y="0" width={width} height={h} fill={palette.background} />
        <Rect
          x="0"
          y="0"
          width={width}
          height={h}
          fill="url(#grid)"
          mask="url(#gridMask)"
        />
        <Rect x="0" y="0" width={width} height={h} fill="url(#bloom)" />
      </Svg>
    </View>
  );
}
