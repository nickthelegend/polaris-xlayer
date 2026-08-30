import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";

import { ink, radius, space } from "../theme";
import { Text } from "./Text";

/**
 * Nothing here yet.
 *
 * A sentence centred in a void reads as a screen that failed to load rather
 * than one with nothing in it. A dashed plane with a hatched fill at least says
 * "this is the container, and it is empty" — the shape of the thing survives
 * its own emptiness. Same reasoning as the web's `.empty`, same 45° hatch.
 */
export function Empty({
  title,
  note,
  action,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <Pattern id="hatch" width={9} height={9} patternUnits="userSpaceOnUse">
            <Line
              x1="0"
              y1="9"
              x2="9"
              y2="0"
              stroke={ink.hatch}
              strokeWidth={1}
              strokeOpacity={0.5}
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#hatch)" />
      </Svg>

      <Text variant="heading" tone="soft">
        {title}
      </Text>
      {note ? (
        <Text variant="bodySmall" tone="faint" style={styles.note}>
          {note}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: space.lg }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingVertical: space["4xl"],
    paddingHorizontal: space["2xl"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: ink.hatch,
    overflow: "hidden",
  },
  note: {
    textAlign: "center",
    maxWidth: 260,
  },
});
