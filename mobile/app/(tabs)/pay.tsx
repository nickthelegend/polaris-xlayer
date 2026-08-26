import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  LinearTransition, useAnimatedStyle, useSharedValue, withSequence, withTiming
} from "react-native-reanimated";

import { enterFade, enterUp } from "../../src/components/motion";

import {
  Button, Figure, Label, Rule, ScheduleTimeline, Screen, Surface, Text
} from "../../src/components";
import {
  DAY, USDC, creditLine, profile, quote
} from "../../src/data/polaris";
import { ink, lime, palette, radius, space } from "../../src/theme";

type Mode = "now" | "later" | "subscribe";

const MODES: { id: Mode; title: string; note: string }[] = [
  { id: "now", title: "Pay in full", note: "Settles immediately" },
  { id: "later", title: "Pay in 4", note: "Every 7 days, 10% APR" },
  { id: "subscribe", title: "Subscribe", note: "Charges every 30 days" },
];

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

export default function PayScreen() {
  const [mode, setMode] = useState<Mode>("later");
  const [raw, setRaw] = useState("240");

  const line = creditLine(profile);
  const amount = Math.round((parseFloat(raw || "0") || 0) * USDC);

  const plan = useMemo(() => quote(amount, 4, 7 * DAY), [amount]);
  const affordable = mode !== "later" || plan.totalOwed <= line.available;

  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  const press = (key: string) => {
    Haptics.selectionAsync();
    setRaw((cur) => {
      if (key === "⌫") return cur.length <= 1 ? "0" : cur.slice(0, -1);
      if (key === ".") return cur.includes(".") ? cur : `${cur}.`;
      // Two decimal places is what a price has. A third is a typo.
      const [, frac] = cur.split(".");
      if (frac !== undefined && frac.length >= 2) return cur;
      if (cur === "0") return key;
      if (cur.replace(".", "").length >= 7) return cur;
      return cur + key;
    });
  };

  const submit = () => {
    if (!affordable) {
      // Refuse visibly rather than silently disabling the button — a dead
      // control tells you nothing about why.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      shake.value = withSequence(
        withTiming(-8, { duration: 55 }),
        withTiming(8, { duration: 55 }),
        withTiming(-5, { duration: 55 }),
        withTiming(0, { duration: 55 }),
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <Screen eyebrow="Checkout" title="Pay">
      {/* The amount, as the largest thing on the screen. */}
      <Animated.View style={shakeStyle}>
        <Surface padded={22} style={{ marginBottom: space.xl }}>
          <Label>Amount</Label>
          <View style={styles.amountRow}>
            <Text variant="hero" tone="soft" style={styles.currency}>
              $
            </Text>
            <Text variant="hero" numberOfLines={1} adjustsFontSizeToFit>
              {raw}
            </Text>
          </View>
          <View style={styles.rowBetween}>
            <Text variant="bodySmall" tone="faint">
              USDC
            </Text>
            <View style={styles.rowGap}>
              <Text variant="bodySmall" tone="faint">
                Available
              </Text>
              <Figure
                value={line.available}
                variant="bodySmall"
                tone={affordable ? "soft" : "danger"}
                animate={false}
              />
            </View>
          </View>
        </Surface>
      </Animated.View>

      <View style={styles.modes}>
        {MODES.map((m, i) => {
          const on = mode === m.id;
          return (
            <Animated.View
              key={m.id}
              entering={enterUp(i)}
              style={{ flex: 1 }}
            >
              <Surface
                variant={on ? "selected" : "raised"}
                padded={13}
                onPress={() => setMode(m.id)}
                style={{ minHeight: 84 }}
              >
                <Text
                  variant="bodySmall"
                  tone={on ? "lime" : "default"}
                  numberOfLines={2}
                  style={styles.modeTitle}
                >
                  {m.title}
                </Text>
                <Text variant="bodySmall" tone="faint" numberOfLines={2} style={styles.modeNote}>
                  {m.note}
                </Text>
              </Surface>
            </Animated.View>
          );
        })}
      </View>

      {/*
        The quote. Shown before anything is signed, and built from the same
        ceiling ladder the program uses — so the four numbers here are the four
        the keeper will collect, not an estimate that drifts by a base unit.
      */}
      {mode === "later" ? (
        <Animated.View
          entering={enterFade()}
          layout={LinearTransition.springify()}
        >
          <Surface padded={18} style={{ marginBottom: space.lg }}>
            <View style={styles.rowBetween}>
              <Label>You repay</Label>
              <Figure value={plan.totalOwed} variant="stat" />
            </View>
            <View style={[styles.rowBetween, { marginTop: space.sm }]}>
              <Text variant="bodySmall" tone="faint">
                {`${(amount / USDC).toFixed(2)} principal + interest, pro-rated over 28 days`}
              </Text>
              <Figure
                value={plan.interest}
                variant="bodySmall"
                tone="soft"
                animate={false}
                prefix="+"
              />
            </View>

            <Rule style={{ marginVertical: space.lg }} />

            <ScheduleTimeline
              items={plan.schedule.map((s, i) => ({
                ...s,
                state: i === 0 ? "due" : "upcoming",
              }))}
            />

            <View style={styles.callout}>
              <Text variant="bodySmall" tone="lime">
                One signature
              </Text>
              <Text variant="bodySmall" tone="soft" style={{ marginTop: 3 }}>
                The authorisation and the purchase go in a single transaction.
                They both land or neither does, and the merchant is paid in full
                today.
              </Text>
            </View>

            {!affordable ? (
              <Animated.View entering={enterFade()} style={styles.warn}>
                <Text variant="bodySmall" tone="danger">
                  This is more credit than you have. Repay a plan or lock
                  collateral to raise the limit.
                </Text>
              </Animated.View>
            ) : null}
          </Surface>
        </Animated.View>
      ) : null}

      {mode === "subscribe" ? (
        <Animated.View entering={enterFade()}>
          <Surface padded={18} style={{ marginBottom: space.lg }}>
            <View style={styles.rowBetween}>
              <Label>Every 30 days</Label>
              <Figure value={amount} variant="stat" />
            </View>
            <Rule style={{ marginVertical: space.lg }} />
            <Text variant="bodySmall" tone="soft">
              You authorise twelve periods up front, not an unlimited amount,
              and you can cancel at any time without the merchant's agreement.
            </Text>
          </Surface>
        </Animated.View>
      ) : null}

      {/* A keypad rather than a text field: a price is entered, not typed. */}
      <View style={styles.pad}>
        {KEYS.map((k) => (
          <Pressable
            key={k}
            style={({ pressed }) => [styles.key, pressed && styles.keyOn]}
            onPress={() => press(k)}
          >
            <Text variant="heading" tone={k === "⌫" ? "faint" : "default"}>
              {k}
            </Text>
          </Pressable>
        ))}
      </View>

      <Button
        label={
          mode === "now"
            ? "Pay now"
            : mode === "later"
              ? "Split into 4"
              : "Start subscription"
        }
        full
        onPress={submit}
        style={{ marginTop: space.lg }}
      />
      <Text variant="bodySmall" tone="faint" style={styles.foot}>
        Nothing is signed in this build — the wallet is not connected yet.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  amountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space.sm,
    marginVertical: space.sm,
  },
  currency: {
    fontSize: 28,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  rowGap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modes: {
    flexDirection: "row",
    gap: space.sm,
    marginBottom: space.xl,
  },
  modeTitle: {
    fontWeight: "600",
  },
  modeNote: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 15,
  },
  callout: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: lime.ghost,
    borderWidth: 1,
    borderColor: lime.rim,
  },
  warn: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: "#E7000B14",
    borderWidth: 1,
    borderColor: "#E7000B44",
  },
  pad: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.sm,
  },
  key: {
    width: "31.7%",
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: ink.hairline,
    backgroundColor: palette.card,
  },
  keyOn: {
    backgroundColor: palette.secondary,
    borderColor: ink.hairlineStrong,
  },
  foot: {
    textAlign: "center",
    marginTop: space.md,
  },
});
