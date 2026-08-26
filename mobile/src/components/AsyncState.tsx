import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { palette, space } from "../theme";
import { Button } from "./Button";
import { Text } from "./Text";

/**
 * Waiting on the chain.
 *
 * A spinner and nothing else. The alternative — a skeleton shaped like the
 * screen — implies the shape of data that has not arrived, and on a credit
 * screen that means implying a balance.
 */
export function Loading({ label = "Reading the chain" }: { label?: string }) {
  return (
    <View style={styles.wrap} accessibilityRole="progressbar">
      <ActivityIndicator size="small" color={palette.primary} />
      <Text variant="bodySmall" tone="faint" style={styles.text}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The chain could not be read.
 *
 * States what failed and offers the one action that can help. A blank screen
 * or an infinite spinner both read as "the app is broken" without saying what
 * or giving the user anything to do about it.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text variant="heading" tone="danger">
        Could not reach the network
      </Text>
      <Text variant="bodySmall" tone="soft" style={styles.text}>
        {message}
      </Text>
      {onRetry ? (
        <Button label="Try again" variant="ghost" size="sm" onPress={onRetry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    paddingVertical: space["5xl"],
    paddingHorizontal: space["2xl"],
  },
  text: {
    textAlign: "center",
    maxWidth: 300,
  },
});
