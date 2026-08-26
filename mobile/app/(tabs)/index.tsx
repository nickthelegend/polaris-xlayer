import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { enterUpAfter } from "../../src/components/motion";

import {
  Button, CreditOrb, Figure, Label, ProgressBar, Rule, Screen, StatTile, Surface, Text
} from "../../src/components";
import {
  USDC, creditLine, nextBand, nextCollection, profile
} from "../../src/data/polaris";
import { ink, space } from "../../src/theme";

const relativeDays = (unix: number) => {
  const days = Math.round((unix - Date.now() / 1000) / 86_400);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
};

export default function CreditScreen() {
  const router = useRouter();
  const line = creditLine(profile);
  const next = nextCollection();
  const band = nextBand(profile.score);

  return (
    <Screen eyebrow="Your credit line" title="Polaris">
      <View style={styles.orbWrap}>
        <CreditOrb score={profile.score} size={252} />
      </View>

      {/*
        The available figure is the one number this screen exists for, so it
        gets the hero size and nothing competes with it. The limit and the debt
        that produce it sit underneath in the quiet weight.
      */}
      <Animated.View entering={enterUpAfter(120)}>
        <Surface padded={20} style={styles.hero}>
          <Label>Available to spend</Label>
          <Figure value={line.available} variant="hero" tone="lime" />

          <View style={styles.limitRow}>
            <Text variant="bodySmall" tone="soft">
              of{" "}
            </Text>
            <Figure
              value={line.limit}
              variant="bodySmall"
              tone="soft"
              animate={false}
            />
            <Text variant="bodySmall" tone="soft">
              {" "}
              limit
            </Text>
          </View>

          <ProgressBar
            value={line.limit === 0 ? 0 : line.activeDebt / line.limit}
            style={{ marginTop: space.lg }}
          />

          <View style={styles.breakdown}>
            <View style={styles.breakItem}>
              <Label numberOfLines={1}>Score</Label>
              <Figure value={line.base} variant="body" animate={false} />
            </View>
            <View style={styles.breakDivider} />
            <View style={styles.breakItem}>
              <Label numberOfLines={1}>Collateral</Label>
              <Figure
                value={line.boost}
                variant="body"
                tone={line.boost > 0 ? "accent" : "soft"}
                animate={false}
              />
            </View>
            <View style={styles.breakDivider} />
            <View style={styles.breakItem}>
              <Label numberOfLines={1}>Owed</Label>
              <Figure value={line.activeDebt} variant="body" tone="soft" animate={false} />
            </View>
          </View>
        </Surface>
      </Animated.View>

      {/*
        What the keeper does next. This is the question a borrower actually has
        — "when does money leave my account, and how much" — and answering it
        without being asked is most of what makes an automated collection feel
        like a service rather than a surprise.
      */}
      {next ? (
        <Animated.View entering={enterUpAfter(190)}>
          <Surface padded={18} style={styles.card}>
            <View style={styles.rowBetween}>
              <Label>Next collection</Label>
              <Text variant="label" tone="lime">
                {relativeDays(next.dueAt)}
              </Text>
            </View>

            <View style={[styles.rowBetween, { marginTop: space.md }]}>
              <View style={{ flex: 1 }}>
                <Text variant="heading" numberOfLines={1}>
                  {next.loan.merchant}
                </Text>
                <Text variant="bodySmall" tone="faint">
                  Installment {next.loan.installmentsPaid + 1} of{" "}
                  {next.loan.installmentCount}
                </Text>
              </View>
              <Figure value={next.amount} variant="stat" />
            </View>

            <Rule style={{ marginVertical: space.lg }} />

            <Text variant="bodySmall" tone="soft">
              Collected automatically. You do not need to be online, and the
              keeper pays the network fee.
            </Text>
          </Surface>
        </Animated.View>
      ) : null}

      {/* What the next score band is worth, in money rather than in points. */}
      {band ? (
        <Animated.View entering={enterUpAfter(250)}>
          <Surface padded={18} style={styles.card}>
            <View style={styles.rowBetween}>
              <Label>Next tier</Label>
              <Text variant="label" tone="soft">
                {band.at - profile.score} points away
              </Text>
            </View>
            <ProgressBar
              value={
                (profile.score - 580) / (band.at - 580 || 1)
              }
              tone="accent"
              style={{ marginTop: space.md }}
            />
            <View style={[styles.rowBetween, { marginTop: space.md }]}>
              <Text variant="bodySmall" tone="soft">
                Reach {band.at} and your limit becomes
              </Text>
              <Figure
                value={band.limit}
                variant="body"
                tone="accent"
                animate={false}
              />
            </View>
            <Text variant="bodySmall" tone="faint" style={{ marginTop: space.sm }}>
              Every installment paid on time is worth 12 points. A late one costs
              40.
            </Text>
          </Surface>
        </Animated.View>
      ) : null}

      <Animated.View
        entering={enterUpAfter(310)}
        style={styles.stats}
      >
        <StatTile
          label="On time"
          value={profile.onTimePayments * USDC}
          decimals={0}
          tone="lime"
          note="payments"
        />
        <StatTile
          label="Collateral"
          value={profile.lockedCollateral}
          tone="accent"
          note="locked, earns 150%"
        />
      </Animated.View>

      <Animated.View entering={enterUpAfter(370)}>
        <Button
          label="Pay with Polaris"
          full
          onPress={() => router.push("/pay")}
          style={{ marginTop: space.lg }}
        />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  orbWrap: {
    alignItems: "center",
    paddingTop: space.sm,
    paddingBottom: space["3xl"],
  },
  hero: {
    marginBottom: space.lg,
  },
  card: {
    marginBottom: space.lg,
  },
  limitRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  breakdown: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: space.xl,
    gap: space.md,
  },
  breakItem: {
    flex: 1,
    gap: 5,
  },
  breakDivider: {
    width: 1,
    height: 28,
    backgroundColor: ink.hairline,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  stats: {
    flexDirection: "row",
    gap: space.md,
    marginBottom: space.sm,
  },
});
