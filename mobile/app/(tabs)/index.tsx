import { useRouter } from "expo-router";
import { StyleSheet, useWindowDimensions, View } from "react-native";
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

/**
 * The stored evidence, read back out of the borrower's own profile.
 *
 * Every number here was written on chain by the attestation that opened the
 * line, so the limit can still be explained on a cold start with no gateway
 * in reach.
 */
function evidenceReasons(p: {
  walletAgeDays: number;
  transactionCount: number;
  tokenAccounts: number;
  stableBalance: number;
}): string[] {
  const age =
    p.walletAgeDays >= 365
      ? `${Math.floor(p.walletAgeDays / 365)} year${p.walletAgeDays >= 730 ? "s" : ""}`
      : p.walletAgeDays >= 30
        ? `${Math.floor(p.walletAgeDays / 30)} month${p.walletAgeDays >= 60 ? "s" : ""}`
        : null;
  return [
    age ? `Wallet first used ${age} ago` : "Wallet is less than a month old",
    `${p.transactionCount.toLocaleString()} transactions signed`,
    p.tokenAccounts === 0
      ? "No tokens held"
      : `${p.tokenAccounts} token${p.tokenAccounts === 1 ? "" : "s"} held`,
    `${(p.stableBalance / USDC).toFixed(2)} USDC on hand`,
  ];
}

export default function CreditScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();

  /*
   * The orb is sized to the screen, not to a constant.
   *
   * At a fixed 252 it filled a small phone edge to edge and took 40% of the
   * vertical space on a short one, pushing "available to spend" — the number
   * the screen exists for — below the fold. Bounded by width so it never
   * touches the gutters, and by height so the figure under it always survives
   * the fold.
   */
  const orbSize = Math.round(
    Math.max(150, Math.min(252, width * 0.68, height * 0.30)),
  );
  const { status, data, error, refresh, address } = usePolaris();
  const line = useCreditLine(data);

  if (status === "loading") {
    return (
      <Screen eyebrow="Your credit line" title="Polaris">
        <Loading label="Reading your credit line" />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen eyebrow="Your credit line" title="Polaris">
        <ErrorState message={error ?? "No data returned."} onRetry={refresh} />
      </Screen>
    );
  }

  /*
   * No line yet is its own state, not an error.
   *
   * It means the underwriter has not been reached, so nothing has read this
   * wallet's history. Showing an error here sent people looking for a fault in
   * the chain; showing a limit here — which is what the app used to do, from a
   * hardcoded 600 — was worse, because the number was invented.
   */
  if (!data.profile || !line) {
    return (
      <Screen eyebrow="Your credit line" title="Polaris">
        <WalletRow address={address} />
        <Animated.View entering={enterUpAfter(80)}>
          <Surface padded={20} style={styles.unopened}>
            <Label>No credit line yet</Label>
            <Text variant="body" style={styles.unopenedBody}>
              Your limit is read from this wallet&apos;s own history on chain —
              how long it has been active, what it has done, and what it holds.
              Nothing has read it yet.
            </Text>
            <Text variant="bodySmall" tone="faint" style={styles.unopenedBody}>
              {error ?? "The underwriter is not reachable from here."}
            </Text>
            <Button label="Try again" onPress={refresh} />
          </Surface>
        </Animated.View>
      </Screen>
    );
  }

  const { profile, loans, underwriting } = data;
  const next = nextCollection(loans);
  const band = nextBand(profile.score);

  /*
   * The gateway's reasons when it has just opened the line, and the profile's
   * own recorded evidence otherwise — the program stores what it scored, so a
   * limit stays explainable long after the attestation that set it.
   */
  const reasons =
    underwriting?.reasons.length
      ? underwriting.reasons
      : profile.underwrittenAt > 0
        ? evidenceReasons(profile)
        : [];

  return (
    <Screen eyebrow="Your credit line" title="Polaris">
      {error ? (
        <Text variant="bodySmall" tone="danger" style={styles.stale}>
          Showing the last good read — {error}
        </Text>
      ) : null}

      <View style={styles.orbWrap}>
        <CreditOrb score={profile.score} size={orbSize} />
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

      {reasons.length > 0 ? (
        <Animated.View entering={enterUpAfter(280)}>
          <Surface padded={18} style={styles.card}>
            <Label>How this limit was set</Label>
            <Text variant="bodySmall" tone="soft" style={{ marginTop: space.sm }}>
              Read from this wallet on chain. No application, no bureau, nothing
              you had to tell us.
            </Text>
            {reasons.map((reason) => (
              <View key={reason} style={styles.reason}>
                <Text variant="bodySmall" tone="soft" style={styles.reasonText}>
                  {reason}
                </Text>
              </View>
            ))}
            <Text variant="bodySmall" tone="faint" style={{ marginTop: space.sm }}>
              History opens a line. Repaying is what raises it.
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
  unopened: { marginTop: space.lg, gap: space.md },
  unopenedBody: { marginTop: space.xs },
  reason: {
    marginTop: space.sm,
    paddingLeft: space.md,
    borderLeftWidth: 2,
    borderLeftColor: ink.hairline,
  },
  reasonText: { lineHeight: 20 },
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
