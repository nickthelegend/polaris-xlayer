import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { enterUp } from "./motion";

import { ink, lime, palette, space } from "../theme";
import { Figure } from "./Figure";
import { Label, Text } from "./Text";

export type Installment = {
  index: number;
  /** Unix seconds, the unit the program stores. */
  dueAt: number;
  /** Base units. */
  amount: number;
  state: "paid" | "due" | "upcoming" | "missed";
};

/**
 * A due date, at the resolution the schedule actually runs at.
 *
 * A weekly plan wants a date. A plan whose installments are a minute apart
 * renders four identical dates, which reads as a rendering bug rather than as a
 * schedule — so anything under a day carries the time instead.
 */
const dateOf = (unix: number, intervalSeconds: number) => {
  const d = new Date(unix * 1000);
  if (intervalSeconds < 86_400) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * The installment ladder.
 *
 * A vertical run of nodes joined by a line that is lime where the plan has been
 * paid and hairline where it has not, so progress is legible before a single
 * number is read. The web draws this with a gradient `.step-line`; the gradient
 * is the same here, cut at the paid boundary.
 *
 * The dates come off `started_at + (index + 1) * interval_seconds` — the same
 * arithmetic `installment_due_at` does on chain — so what a borrower reads here
 * is what the keeper will act on, not a UI approximation of it.
 */
export function ScheduleTimeline({
  items,
  intervalSeconds = 604_800,
}: {
  items: Installment[];
  intervalSeconds?: number;
}) {
  return (
    <View>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        const paid = item.state === "paid";
        const due = item.state === "due";
        const missed = item.state === "missed";

        const dot = paid
          ? palette.primary
          : due
            ? palette.primary
            : missed
              ? palette.destructive
              : ink.hairlineStrong;

        return (
          <Animated.View
            key={item.index}
            entering={enterUp(i)}
            style={styles.row}
          >
            <View style={styles.gutter}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: paid ? palette.primary : palette.card,
                    borderColor: dot,
                  },
                  due && styles.dotDue,
                ]}
              >
                {paid ? <View style={styles.tick} /> : null}
              </View>

              {!last ? (
                <LinearGradient
                  colors={
                    paid
                      ? [palette.primary, lime.ghost]
                      : [ink.hairline, ink.hairline]
                  }
                  style={styles.line}
                />
              ) : null}
            </View>

            <View style={styles.content}>
              <View style={styles.head}>
                <Label>
                  Installment {item.index + 1} · {dateOf(item.dueAt, intervalSeconds)}
                </Label>
                <Figure
                  value={item.amount}
                  variant="body"
                  tone={paid ? "soft" : "default"}
                  animate={false}
                  style={
                    paid
                      ? { textDecorationLine: "line-through", opacity: 0.7 }
                      : undefined
                  }
                />
              </View>
              <Text
                variant="bodySmall"
                tone={due ? "lime" : missed ? "danger" : "faint"}
              >
                {paid
                  ? "Collected"
                  : due
                    ? "Due now — the keeper collects this next"
                    : missed
                      ? "Past due, inside grace"
                      : "Scheduled"}
              </Text>
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: space.lg,
  },
  gutter: {
    alignItems: "center",
    width: 18,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDue: {
    // The one that is due gets the light. Nothing else on the ladder does.
    shadowColor: palette.glow,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  tick: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.primaryForeground,
  },
  line: {
    width: 2,
    flex: 1,
    minHeight: 26,
    borderRadius: 1,
  },
  content: {
    flex: 1,
    paddingBottom: space["2xl"],
    gap: 3,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
});
