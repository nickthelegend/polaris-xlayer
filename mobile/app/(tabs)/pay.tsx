import { failed, press, selected, succeeded, tap } from "../../src/lib/haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { usePolaris } from "../../src/chain/provider";
import { useCreditLine } from "../../src/chain/usePolaris";
import { DAY, USDC, plural, quote } from "../../src/chain/math";
import { merchants, type MerchantRef } from "../../src/chain/config";
import { PublicKey } from "@solana/web3.js";
import { describeError, payLater, payNow, subscribeToPlan } from "../../src/chain/actions";
import {
  Button,
  ErrorState,
  Figure,
  Label,
  Loading,
  Mono,
  Rule,
  ScheduleTimeline,
  Screen,
  Surface,
  Text,
} from "../../src/components";
import { enterFade, enterUp } from "../../src/components/motion";
import { ink, lime, palette, radius, space } from "../../src/theme";

type Mode = "now" | "later" | "subscribe";

const MODES: { id: Mode; title: string; note: string }[] = [
  { id: "now", title: "Pay in full", note: "Settles immediately" },
  { id: "later", title: "Pay in 4", note: "Every 7 days, 10% APR" },
  { id: "subscribe", title: "Subscribe", note: "Charges every period" },
];

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

/**
 * A round opening amount that fits the borrower's actual credit.
 *
 * Round because a checkout that opens on 187.43 looks like a bug, and capped
 * because one that opens on an amount the program will refuse is worse than
 * one that opens on nothing.
 */
function openingAmount(available: number | null): string {
  if (available === null) return "0";
  const units = Math.floor(available / USDC);
  for (const step of [240, 200, 150, 100, 50, 20, 10]) {
    if (units >= step) return String(step);
  }
  return units > 0 ? String(units) : "0";
}

export default function PayScreen() {
  const { status, data, error, refresh } = usePolaris();
  const line = useCreditLine(data);

  const [mode, setMode] = useState<Mode>("later");
  /*
   * The opening amount, derived rather than hardcoded.
   *
   * This was a flat "240". A wallet underwritten from an empty history opens a
   * 200 line, so every new user's first sight of this screen was an amount
   * they could not afford, and their first tap was a refusal. The default is
   * now the largest round number that actually fits their credit — and 0 when
   * nothing does, which is honest rather than a number that cannot be sent.
   */
  const [raw, setRaw] = useState(() => openingAmount(null));
  const [merchant, setMerchant] = useState<MerchantRef>(merchants[0]);
  const [planIndex, setPlanIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  /*
   * The real double-submit guard.
   *
   * `busy` drives the button's disabled state, but React state is not a lock:
   * a second tap 120ms later runs `submit` again before the re-render, reads
   * the stale `false`, and sends a second transaction. Tested by tapping three
   * times in quick succession — it opened two loans for one purchase and
   * charged the borrower twice.
   *
   * A ref updates synchronously, so the second tap sees the flag the first one
   * set. The state is still there because the button needs something to
   * render from.
   */
  const inFlight = useRef(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; signature?: string } | null>(
    null,
  );

  /*
   * Seeded once, when the line first arrives.
   *
   * A ref rather than an effect that watches `line`: re-deriving on every
   * change would overwrite what the user had typed the moment a refresh
   * landed, which is the worst possible time to move a number they are about
   * to send.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !line) return;
    seeded.current = true;
    setRaw(openingAmount(line.available));
  }, [line]);

  const amount = Math.round((parseFloat(raw || "0") || 0) * USDC);
  const plan = useMemo(
    () => quote(amount, 4, 7 * DAY),
    [amount],
  );

  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  /**
   * Refuse, and say why.
   *
   * This used to shake and stop. Safe — nothing was sent — but the user is
   * left guessing what they did wrong, which is the difference between a form
   * that validates and a form that just resists.
   */
  const refuse = (why: string) => {
    setResult({ ok: false, message: why });
    failed();
    shake.value = withSequence(
      withTiming(-8, { duration: 55 }),
      withTiming(8, { duration: 55 }),
      withTiming(-5, { duration: 55 }),
      withTiming(0, { duration: 55 }),
    );
  };

  if (status === "loading") {
    return (
      <Screen eyebrow="Checkout" title="Pay" onRefresh={refresh}>
        <Loading label="Reading your credit line" />
      </Screen>
    );
  }
  if (!data || !line) {
    return (
      <Screen eyebrow="Checkout" title="Pay" onRefresh={refresh}>
        <ErrorState message={error ?? "No data returned."} onRetry={refresh} />
      </Screen>
    );
  }

  const subscriptions = data.subscriptions;
  const affordable = mode !== "later" || plan.totalOwed <= line.available;

  const press = (key: string) => {
    selected();
    setResult(null);
    setRaw((cur) => {
      if (key === "⌫") return cur.length <= 1 ? "0" : cur.slice(0, -1);
      if (key === ".") return cur.includes(".") ? cur : `${cur}.`;
      const [, frac] = cur.split(".");
      if (frac !== undefined && frac.length >= 2) return cur;
      if (cur === "0") return key;
      if (cur.replace(".", "").length >= 7) return cur;
      return cur + key;
    });
  };

  const submit = async () => {
    if (inFlight.current) return;
    if (amount <= 0) return refuse("Enter an amount above zero.");
    if (!affordable) {
      return refuse(
        "That is more than your available credit. Repay a plan or lock collateral to raise the limit.",
      );
    }

    inFlight.current = true;
    setBusy(true);
    setResult(null);
    try {
      if (mode === "now") {
        const { signature } = await payNow({
          merchant: merchant.pda,
          merchantPayout: merchant.payout,
          amount,
          // Unique per attempt: the payment address is derived from this, and a
          // repeated reference is refused by the program as a duplicate.
          orderId: `POL-${Date.now().toString(36).toUpperCase()}`,
        });
        setResult({ ok: true, message: `Paid ${merchant.name} in full`, signature });
      } else if (mode === "later") {
        const { signature } = await payLater({
          merchant: merchant.pda,
          merchantPayout: merchant.payout,
          amount,
        });
        setResult({
          ok: true,
          message: `Split into 4 — ${merchant.name} paid in full today`,
          signature,
        });
      } else {
        const target = data.availablePlans[planIndex];
        if (!target) {
          setResult({
            ok: false,
            message: subscriptions.length
              ? "You already subscribe to every plan on offer."
              : "No merchant on this deployment offers a subscription yet.",
          });
          return;
        }
        const payout = merchants.find((m) => m.pda.toBase58() === target.merchantPda)?.payout;
        if (!payout) {
          setResult({ ok: false, message: "That merchant has no payout account." });
          return;
        }
        const { signature } = await subscribeToPlan({
          plan: new PublicKey(target.address),
          merchant: new PublicKey(target.merchantPda),
          merchantPayout: payout,
          pricePerPeriod: target.pricePerPeriod,
        });
        setResult({
          ok: true,
          message: `Subscribed to ${target.merchant} ${target.name} — period 1 charged`,
          signature,
        });
      }
      succeeded();
      // Clear the amount. Leaving a completed purchase armed in the field is
      // how a second tap becomes a second purchase nobody meant to make.
      setRaw("0");
      await refresh();
    } catch (e: any) {
      refuse(await describeError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen eyebrow="Checkout" title="Pay" onRefresh={refresh}>
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
            <Animated.View key={m.id} entering={enterUp(i)} style={{ flex: 1 }}>
              <Surface
                variant={on ? "selected" : "raised"}
                padded={13}
                onPress={() => {
                  setMode(m.id);
                  setResult(null);
                }}
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

      {/* Who is being paid. A checkout without this is not a checkout. */}
      {mode !== "subscribe" ? (
        <View style={{ marginBottom: space.xl }}>
          <Label style={{ marginBottom: space.md }}>Merchant</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.merchantRow}>
              {merchants.map((m) => {
                const on = m.pda.equals(merchant.pda);
                return (
                  <Surface
                    key={m.pda.toBase58()}
                    variant={on ? "selected" : "raised"}
                    padded={12}
                    onPress={() => {
                      setMerchant(m);
                      setResult(null);
                    }}
                    style={{ minWidth: 132 }}
                  >
                    <Text variant="heading" tone={on ? "lime" : "default"}>
                      {m.icon}
                    </Text>
                    <Text variant="bodySmall" numberOfLines={1} style={{ marginTop: 6 }}>
                      {m.name}
                    </Text>
                  </Surface>
                );
              })}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {mode === "later" ? (
        <Animated.View entering={enterFade()} layout={LinearTransition.springify()}>
          <Surface padded={18} style={{ marginBottom: space.lg }}>
            <View style={styles.rowBetween}>
              <Label>You repay</Label>
              <Figure value={plan.totalOwed} variant="stat" />
            </View>
            <View style={[styles.rowBetween, { marginTop: space.sm }]}>
              <Text variant="bodySmall" tone="faint" style={{ flex: 1 }}>
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
              intervalSeconds={7 * DAY}
              items={plan.schedule.map((s: any, i: number) => ({
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
                They both land or neither does, and {merchant.name} is paid in
                full today.
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
            <Label>Available plans</Label>
            {data.availablePlans.length ? (
              data.availablePlans.map((p, i) => {
                const on = i === planIndex;
                return (
                  <Surface
                    key={p.address}
                    variant={on ? "selected" : "raised"}
                    padded={14}
                    onPress={() => {
                      setPlanIndex(i);
                      setResult(null);
                    }}
                    style={{ marginTop: space.md }}
                  >
                    <View style={styles.rowBetween}>
                      <View style={{ flex: 1 }}>
                        <Text variant="body" tone={on ? "lime" : "default"} numberOfLines={1}>
                          {p.merchantIcon} {p.merchant} · {p.name}
                        </Text>
                        <Text variant="bodySmall" tone="faint">
                          every {Math.round(p.periodSeconds / 86_400) || 1} days
                        </Text>
                      </View>
                      <Figure value={p.pricePerPeriod} variant="body" animate={false} />
                    </View>
                  </Surface>
                );
              })
            ) : (
              /*
                Two different empty states, and they were one.
                
                `availablePlans` is what this borrower does not already hold, so
                an empty list means either "you have them all" or "this
                deployment has none". Saying the first on a deployment with no
                plans at all tells the borrower they subscribe to things that do
                not exist.
              */
              <Text variant="bodySmall" tone="faint" style={{ marginTop: space.sm }}>
                {subscriptions.length
                  ? "You already subscribe to every plan on offer."
                  : "No merchant on this deployment offers a subscription yet."}
              </Text>
            )}

            <Rule style={{ marginVertical: space.lg }} />
            <Text variant="bodySmall" tone="soft">
              You authorise twelve periods up front, not an unlimited amount, and
              you can cancel at any time without the merchant's agreement.
            </Text>
          </Surface>

          {subscriptions.length ? (
            <Surface padded={18} style={{ marginBottom: space.lg }}>
              <Label>Already subscribed</Label>
              {subscriptions.map((s, i) => (
                <View key={s.address} style={{ marginTop: space.md }}>
                  {i > 0 ? <Rule style={{ marginBottom: space.md }} /> : null}
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text variant="body" numberOfLines={1}>
                        {s.merchant} · {s.name}
                      </Text>
                      <Text variant="bodySmall" tone="faint">
                        {plural(s.periodsCharged, "period")} charged · {s.status}
                      </Text>
                    </View>
                    <Figure value={s.pricePerPeriod} variant="body" animate={false} />
                  </View>
                </View>
              ))}
            </Surface>
          ) : null}
        </Animated.View>
      ) : null}

      {result ? (
        <Animated.View entering={enterFade()}>
          <Surface padded={16} style={{ marginBottom: space.lg }}>
            <Text variant="body" tone={result.ok ? "lime" : "danger"}>
              {result.ok ? "Confirmed" : "Refused"}
            </Text>
            <Text variant="bodySmall" tone="soft" style={{ marginTop: 4 }}>
              {result.message}
            </Text>
            {result.signature ? (
              <Mono numberOfLines={1} style={{ marginTop: space.sm, opacity: 0.7 }}>
                {result.signature}
              </Mono>
            ) : null}
          </Surface>
        </Animated.View>
      ) : null}

      {mode !== "subscribe" ? (
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
      ) : null}

      <Button
        label={
          mode === "now"
            ? `Pay ${merchant.name}`
            : mode === "later"
              ? "Split into 4"
              : data.availablePlans.length
                ? `Subscribe to ${data.availablePlans[planIndex]?.merchant ?? ""}`
                : subscriptions.length
                  ? "Nothing left to subscribe to"
                  : "No plans on this deployment"
        }
        full
        loading={busy}
        disabled={busy}
        onPress={submit}
        style={{ marginTop: space.lg }}
      />
      <Text variant="bodySmall" tone="faint" style={styles.foot}>
        Signed and submitted to the cluster. Every figure above is what the
        program will compute.
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
  currency: { fontSize: 28 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  rowGap: { flexDirection: "row", alignItems: "center", gap: 6 },
  modes: { flexDirection: "row", gap: space.sm, marginBottom: space.xl },
  modeTitle: { fontWeight: "600" },
  modeNote: { marginTop: 3, fontSize: 11, lineHeight: 15 },
  merchantRow: { flexDirection: "row", gap: space.sm, paddingRight: space.xl },
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
  pad: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
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
  keyOn: { backgroundColor: palette.secondary, borderColor: ink.hairlineStrong },
  foot: { textAlign: "center", marginTop: space.md },
});
