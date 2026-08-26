import React from "react";
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { enterFade, enterUpAfter } from "./motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { space } from "../theme";
import { Label, Text } from "./Text";

/**
 * The shell every route shares.
 *
 * One gutter, one opening rhythm: an eyebrow, a title, and a line of prose.
 * Every screen using the same block is most of what makes a set of screens feel
 * like one product rather than five apps that happen to share a palette.
 *
 * The head enters slightly ahead of the content so the eye is given somewhere
 * to land before anything else arrives.
 */
export function Screen({
  eyebrow,
  title,
  lede,
  action,
  children,
  scroll = true,
  contentStyle,
}: {
  eyebrow?: string;
  title?: string;
  lede?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();

  const head =
    title || eyebrow ? (
      <Animated.View
        entering={enterUpAfter(0)}
        style={styles.head}
      >
        {eyebrow ? <Label>{eyebrow}</Label> : null}
        <View style={styles.titleRow}>
          {title ? (
            <Text variant="title" style={styles.title}>
              {title}
            </Text>
          ) : null}
          {action}
        </View>
        {lede ? (
          <Text variant="body" tone="soft" style={styles.lede}>
            {lede}
          </Text>
        ) : null}
      </Animated.View>
    ) : null;

  const body = (
    <Animated.View
      entering={enterFade(70)}
      style={contentStyle}
    >
      {children}
    </Animated.View>
  );

  if (!scroll) {
    return (
      <View style={[styles.shell, { paddingTop: insets.top + space.sm }]}>
        {head}
        {body}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.shell,
        {
          paddingTop: insets.top + space.sm,
          // Clear the tab bar, which floats over the content.
          paddingBottom: insets.bottom + 96,
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {head}
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  shell: {
    paddingHorizontal: space.xl,
  },
  head: {
    gap: space.sm,
    paddingTop: space["2xl"],
    paddingBottom: space["2xl"],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.lg,
  },
  title: {
    flex: 1,
  },
  lede: {
    maxWidth: 460,
  },
});
