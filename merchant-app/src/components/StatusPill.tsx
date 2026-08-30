import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { radius, space, status, withAlpha } from "../theme";
import { Text } from "./Text";

/**
 * Loan and subscription state.
 *
 * The keys are the program's own enum variants, not a UI vocabulary invented
 * beside it, so a status a screen can render is a status the chain can actually
 * be in. Adding a state to the program breaks this at the type level rather
 * than rendering a blank pill.
 */
export type Status = keyof typeof status;

const copy: Record<Status, string> = {
  active: "Active",
  repaid: "Repaid",
  liquidated: "Liquidated",
  cancelled: "Cancelled",
  lapsed: "Lapsed",
  overdue: "Overdue",
};

export function StatusPill({ value, style }: { value: Status; style?: StyleProp<ViewStyle> }) {
  const tint = status[value];
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: withAlpha(tint, 0.12), borderColor: withAlpha(tint, 0.35) },
        style,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Text variant="label" style={{ color: tint }}>
        {copy[value]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm - 2,
    alignSelf: "flex-start",
    paddingHorizontal: space.md - 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
});
