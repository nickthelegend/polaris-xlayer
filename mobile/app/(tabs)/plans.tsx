import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { LayoutAnimation, Platform, Pressable, StyleSheet, UIManager, View } from "react-native";
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring
} from "react-native-reanimated";

import { enterFade, enterUp } from "../../src/components/motion";

import {
  Empty, Figure, Label, ProgressBar, Rule, ScheduleTimeline, Screen, StatusPill, Surface, Text, type Installment
} from "../../src/components";
import {
  installmentDueAt,
  loans,
  outstanding,
  plans,
  thresholdFor,
  type Loan,
  type Plan,
} from "../../src/data/polaris";
import { ink, motion, palette, radius, space } from "../../src/theme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Build the ladder a borrower sees from the two counters the program stores.
 *
 * The chain keeps `installments_paid` and `total_repaid`, not a list of rows —
 * the schedule is derived, never stored. Deriving it here from the same ceiling
 * ladder means the dates and amounts shown are the ones the keeper will act on
 * rather than a parallel record that can drift out of agreement with the chain.
 */
function scheduleFor(loan: Loan): Installment[] {
  const now = Date.now() / 1000;
  return Array.from({ length: loan.installmentCount }, (_, i) => {
    const dueAt = installmentDueAt(loan, i);
    const amount =
      thresholdFor(loan.totalOwed, loan.installmentCount, i + 1) -
      thresholdFor(loan.totalOwed, loan.installmentCount, i);

    let state: Installment["state"] = "upcoming";
    if (i < loan.installmentsPaid) state = "paid";
    else if (i === loan.installmentsPaid) state = now >= dueAt ? "due" : "upcoming";

    return { index: i, dueAt, amount, state };
  });
}

function Chevron({ open }: { open: boolean }) {
  const rot = useSharedValue(open ? 1 : 0);
  React.useEffect(() => {
    rot.value = withSpring(open ? 1 : 0, motion.spring.settle);
  }, [open]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value * 180}deg` }],
  }));
  return (
    <Animated.View style={style}>
      <Text variant="bodySmall" tone="faint">
        ▾
      </Text>
    </Animated.View>
  );
}

function LoanCard({ loan, index }: { loan: Loan; index: number }) {
  const [open, setOpen] = useState(loan.status === "active" && index === 0);
  const paidPct = loan.totalOwed === 0 ? 0 : loan.totalRepaid / loan.totalOwed;

  return (
    <Animated.View
      entering={enterUp(index)}
      style={{ marginBottom: space.lg }}
    >
      <Surface padded={18}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            LayoutAnimation.configureNext(
              LayoutAnimation.create(
                motion.duration.base,
                LayoutAnimation.Types.easeInEaseOut,
                LayoutAnimation.Properties.opacity,
              ),
            );
            setOpen((v) => !v);
          }}
        >
          <View style={styles.rowBetween}>
            <View style={styles.merchant}>
              <View style={styles.mark}>
                <Text variant="heading" tone="lime">
                  {loan.merchantIcon}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="heading" numberOfLines={1}>
                  {loan.merchant}
                </Text>
                <Text variant="bodySmall" tone="faint">
                  {loan.installmentsPaid} of {loan.installmentCount} collected
                </Text>
              </View>
            </View>
            <Chevron open={open} />
          </View>

          <View style={styles.figures}>
            <View style={{ flex: 1 }}>
              <Label>{loan.status === "repaid" ? "Repaid" : "Outstanding"}</Label>
              <Figure
                value={loan.status === "repaid" ? loan.totalOwed : outstanding(loan)}
                variant="stat"
                tone={loan.status === "repaid" ? "soft" : "default"}
              />
            </View>
            <StatusPill value={loan.status} />
          </View>

          <ProgressBar value={paidPct} style={{ marginTop: space.md }} />
        </Pressable>

        {open ? (
          <Animated.View entering={enterFade()}>
            <Rule style={{ marginVertical: space.xl }} />
            <ScheduleTimeline items={scheduleFor(loan)} />

            <View style={styles.terms}>
              <View style={styles.termItem}>
                <Label>Principal</Label>
                <Figure value={loan.principal} variant="body" animate={false} />
              </View>
              <View style={styles.termItem}>
                <Label>Interest</Label>
                <Figure
                  value={loan.totalOwed - loan.principal}
                  variant="body"
                  tone="soft"
                  animate={false}
                />
              </View>
              <View style={styles.termItem}>
                <Label>Rate</Label>
                <Text variant="body">10% APR</Text>
              </View>
            </View>
            <Text variant="bodySmall" tone="faint" style={{ marginTop: space.md }}>
              Interest is annualised and pro-rated over the term, so a shorter
              plan costs proportionally less.
            </Text>
          </Animated.View>
        ) : null}
      </Surface>
    </Animated.View>
  );
}

function PlanRow({ plan, index }: { plan: Plan; index: number }) {
  const days = Math.max(
    0,
    Math.round((plan.nextChargeAt - Date.now() / 1000) / 86_400),
  );
  return (
    <Animated.View
      entering={enterUp(index)}
      style={{ marginBottom: space.lg }}
    >
      <Surface padded={18}>
        <View style={styles.rowBetween}>
          <View style={styles.merchant}>
            <View style={styles.mark}>
              <Text variant="heading" tone="accent">
                {plan.merchantIcon}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading" numberOfLines={1}>
                {plan.merchant}
              </Text>
              <Text variant="bodySmall" tone="faint">
                {plan.name} · {plan.periodsCharged} periods charged
              </Text>
            </View>
          </View>
          <Figure value={plan.pricePerPeriod} variant="stat" />
        </View>

        <Rule style={{ marginVertical: space.lg }} />

        <View style={styles.rowBetween}>
          <Text variant="bodySmall" tone="soft">
            Renews {days === 0 ? "today" : `in ${days} days`}
          </Text>
          <StatusPill value={plan.status} />
        </View>

        <Text variant="bodySmall" tone="faint" style={{ marginTop: space.sm }}>
          You can cancel at any time without the merchant's agreement. That is
          what makes the standing authorisation safe to grant.
        </Text>
      </Surface>
    </Animated.View>
  );
}

const TABS = ["Installments", "Subscriptions"] as const;

export default function PlansScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Installments");
  const active = loans.filter((l) => l.status === "active");
  const closed = loans.filter((l) => l.status !== "active");

  return (
    <Screen
      eyebrow="What you owe"
      title="Plans"
      lede="Every plan you have open, and exactly when the keeper will collect."
    >
      <View style={styles.segment}>
        {TABS.map((t) => {
          const on = tab === t;
          return (
            <Pressable
              key={t}
              style={[styles.segmentItem, on && styles.segmentOn]}
              onPress={() => {
                Haptics.selectionAsync();
                setTab(t);
              }}
            >
              <Text variant="label" tone={on ? "default" : "faint"}>
                {t}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === "Installments" ? (
        active.length || closed.length ? (
          <>
            {active.map((loan, i) => (
              <LoanCard key={loan.id} loan={loan} index={i} />
            ))}
            {closed.length ? (
              <>
                <Label style={{ marginTop: space.sm, marginBottom: space.md }}>
                  Closed
                </Label>
                {closed.map((loan, i) => (
                  <LoanCard key={loan.id} loan={loan} index={active.length + i} />
                ))}
              </>
            ) : null}
          </>
        ) : (
          <Empty
            title="No plans open"
            note="Split a purchase into four at checkout and it will appear here."
          />
        )
      ) : plans.length ? (
        plans.map((plan, i) => <PlanRow key={plan.id} plan={plan} index={i} />)
      ) : (
        <Empty
          title="No subscriptions"
          note="A merchant's plan charges on a schedule you agreed to, and stops the moment you cancel."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: {
    flexDirection: "row",
    padding: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: ink.hairline,
    backgroundColor: palette.card,
    marginBottom: space.xl,
  },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: space.md - 2,
    borderRadius: radius.pill,
  },
  segmentOn: {
    backgroundColor: palette.secondary,
    borderWidth: 1,
    borderColor: ink.hairline,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  merchant: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    flex: 1,
  },
  mark: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
    borderWidth: 1,
    borderColor: ink.hairline,
  },
  figures: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.md,
    marginTop: space.lg,
  },
  terms: {
    flexDirection: "row",
    gap: space.lg,
    marginTop: space.sm,
  },
  termItem: {
    flex: 1,
    gap: 5,
  },
});
