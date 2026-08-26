import React from "react";
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { enterFade, enterUpAfter } from "./motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { palette, space } from "../theme";
import { AmbientBackground } from "./AmbientBackground";
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

  /*
   * The ground is drawn per screen, and it is what makes the screen opaque.
   *
   * React Navigation does not hide an inactive scene on web — it drops it to
   * `z-index: -1` behind the active one. That only conceals it if the active
   * scene actually paints something, and these were transparent so the ambient
   * ground mounted at the root could show through. The result was every route
   * rendering on top of every other one at once.
   *
   * So the ground moves inside the screen. It is a static SVG with no
   * animation, identical on every route, so drawing it per screen costs a
   * little and changes nothing visually — and it gives each scene the opaque
   * base the navigator is relying on.
   */
  const content = !scroll ? (
    <View style={[styles.shell, { paddingTop: insets.top + space.sm }]}>
      {head}
      {body}
    </View>
  ) : (
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

  return (
    <View style={styles.ground}>
      <AmbientBackground />
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: palette.background,
  },
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
