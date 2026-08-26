import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { usePolaris } from "../../src/chain/provider";
import { nextCollection, useCreditLine } from "../../src/chain/usePolaris";
import { USDC, nextBand } from "../../src/chain/math";
import {
  Button,
  CreditOrb,
  ErrorState,
  Figure,
  Label,
  Loading,
  ProgressBar,
  Rule,
  Screen,
  StatTile,
  Surface,
  Text,
  WalletRow,
} from "../../src/components";
import { enterUpAfter } from "../../src/components/motion";
import { ink, space } from "../../src/theme";

const relativeDays = (unix: number) => {
  const days = Math.round((unix - Date.now() / 1000) / 86_400);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
};

export default function CreditScreen() {
  const router = useRouter();
  const { status, data, error, refresh, address } = usePolaris();
  const line = useCreditLine(data);

  if (status === "loading") {
    return (
      <Screen eyebrow="Your credit line" title="Polaris">
        <Loading label="Reading your credit line" />
      </Screen>
    );
  }

  if (!data || !line) {
    return (
      <Screen eyebrow="Your credit line" title="Polaris">
        <ErrorState message={error ?? "No data returned."} onRetry={refresh} />
      </Screen>
    );
  }

  const { profile, loans } = data;
  const next = nextCollection(loans);
  const band = nextBand(profile.score);

  return (
    <Screen eyebrow="Your credit line" title="Polaris">
      {error ? (
        <Text variant="bodySmall" tone="danger" style={styles.stale}>
          Showing the last good read — {error}
        </Text>
      ) : null}

      <View style={styles.orbWrap}>
        <CreditOrb score={profile.score} size={252} />
      </View>

      <WalletRow address={address} />

      <Animated.View entering={enterUpAfter(120)}>
        <Surface padded={20} style={styles.hero}>
          <Label>Available to spend</Label>
          <Figure value={line.available} variant="hero" tone="lime" />

          <View style={styles.limitRow}>
            <Text variant="bodySmall" tone="soft">
              of{" "}
            </Text>
            <Figure value={line.limit} variant="bodySmall" tone="soft" animate={false} />
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
              value={(profile.score - 580) / Math.max(1, band.at - 580)}
              tone="accent"
              style={{ marginTop: space.md }}
            />
            <View style={[styles.rowBetween, { marginTop: space.md }]}>
              <Text variant="bodySmall" tone="soft">
                Reach {band.at} and your limit becomes
              </Text>
              <Figure value={band.limit} variant="body" tone="accent" animate={false} />
            </View>
            <Text variant="bodySmall" tone="faint" style={{ marginTop: space.sm }}>
              Every installment paid on time is worth 12 points. A late one costs
              40.
            </Text>
          </Surface>
        </Animated.View>
      ) : null}

      <Animated.View entering={enterUpAfter(310)} style={styles.stats}>
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
  hero: { marginBottom: space.lg },
  card: { marginBottom: space.lg },
  stale: { marginBottom: space.md },
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
  breakItem: { flex: 1, gap: 5 },
  breakDivider: { width: 1, height: 28, backgroundColor: ink.hairline },
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
