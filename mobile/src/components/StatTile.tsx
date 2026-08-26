import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { space } from "../theme";
import { Figure } from "./Figure";
import { Label, Text } from "./Text";
import { Surface } from "./Surface";

/**
 * A figure with its name above it.
 *
 * Above, never beside. A column of money is read down the digits, and anything
 * to the left of them breaks that column — the web stylesheet makes the same
 * point about its `.stat` block, and it matters more on a narrow screen where
 * two tiles sit side by side.
 */
export function StatTile({
  label,
  value,
  decimals = 2,
  note,
  tone = "default",
  suffix,
  plain = false,
  animate = true,
  style,
}: {
  label: string;
  value: number;
  decimals?: number;
  note?: string;
  tone?: "default" | "lime" | "soft" | "accent" | "danger";
  suffix?: string;
  /** Drop the plane — for tiles already inside one. */
  plain?: boolean;
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const body = (
    <View style={styles.body}>
      <Label numberOfLines={1}>{label}</Label>
      <Figure
        value={value}
        decimals={decimals}
        variant="stat"
        tone={tone}
        suffix={suffix}
        animate={animate}
      />
      {note ? (
        <Text variant="bodySmall" tone="faint" numberOfLines={1}>
          {note}
        </Text>
      ) : null}
    </View>
  );

  if (plain) return <View style={[styles.plain, style]}>{body}</View>;

  return (
    <Surface style={[styles.flex, style]} padded={16}>
      {body}
    </Surface>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  plain: { flex: 1, padding: space.lg },
  body: { gap: 6 },
});
