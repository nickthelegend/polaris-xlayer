import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { enterUp, enterUpAfter } from "../../src/components/motion";

import {
  Empty, ErrorState, Figure, Label, Loading, Mono, Rule, Screen, StatTile,
  StatusPill, Surface, Text, type Status,
} from "../../src/components";
import { listMerchants, readMerchantBook, type MerchantBook } from "../../src/chain/book";
import { getMerchant, setMerchant } from "../../src/lib/merchant";
import { space } from "../../src/theme";

/*
 * Base units all the way to the component — but rounded to the two decimals
 * that are actually displayed.
 *
 * `Figure` truncates the fractional part; the gateway's merchant page rounds.
 * Left raw, a book of 35.175 USDC renders "35.17" here and "35.18" on the web
 * POS, and a merchant holding both reads two different numbers for the same
 * balance. Rounding here is what makes the two surfaces agree, and it is the
 * same correction `chain/charge.ts` already applies to the quote.
 */
const units = (v: bigint) => Number((v + 5_000n) / 10_000n) * 10_000;

const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const ago = (unix: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
};

export default function BookScreen() {
  const [book, setBook] = useState<MerchantBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      let address = await getMerchant();
      if (!address) {
        /* First run: adopt the deployment's own registry rather than asking a
           merchant to type a 44-character key they would have to look up. */
        const all = await listMerchants();
        if (!all.length) {
          setBook(null);
          setError("No merchant is registered on this deployment yet.");
          return;
        }
        address = all[0].address;
        await setMerchant(address);
      }
      const b = await readMerchantBook(address);
      if (!b) {
        setError("That merchant is not registered on this deployment.");
        return;
      }
      setBook(b);
    } catch (e: any) {
      setError(e?.message ?? "Could not reach the chain.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setBusy(true);
    await load();
  }, [load]);

  if (busy && !book) return <Screen title="Your book"><Loading /></Screen>;
  if (error && !book)
    return (
      <Screen title="Your book">
        <ErrorState message={error} />
      </Screen>
    );
  if (!book) return null;

  return (
    <Screen
      title={book.name}
      lede="Paid in full up front. Polaris carries the instalments and collects them."
      scroll
      onRefresh={refresh}
    >
      <Mono tone="faint" style={styles.addr}>
        {book.address}
      </Mono>

      <Animated.View entering={enterUpAfter(60)} style={styles.tiles}>
        <StatTile label="Financed" value={units(book.financed)} decimals={2} tone="lime" note="written to date" />
        <StatTile label="Collected" value={units(book.collected)} decimals={2} note="drawn from buyers" />
      </Animated.View>
      <Animated.View entering={enterUpAfter(110)} style={styles.tiles}>
        <StatTile label="Outstanding" value={units(book.outstanding)} decimals={2} tone="accent" note="still to come in" />
        <Surface padded style={styles.countTile}>
          <Label>Plans</Label>
          <Text variant="stat">{book.loans.length}</Text>
          <Text variant="bodySmall" tone="faint">{book.activeCount} active</Text>
        </Surface>
      </Animated.View>

      <Label style={styles.heading}>The book</Label>

      {book.loans.length === 0 ? (
        <Empty title="No trade yet" note="Take a payment and the plan will appear here." />
      ) : (
        book.loans.map((l, i) => (
          <Animated.View key={`${l.id}-${l.borrower}`} entering={enterUp(i)}>
          <Surface padded style={styles.row}>
            <View style={styles.rowTop}>
              <Text variant="body">Plan #{l.id}</Text>
              <StatusPill value={l.status as Status} />
            </View>
            <View style={styles.rowMid}>
              <Mono tone="faint">{shortAddr(l.borrower)}</Mono>
              <Text variant="bodySmall" tone="faint">{ago(l.startedAt)}</Text>
            </View>
            <Rule />
            <View style={styles.rowBottom}>
              <View>
                <Label>Principal</Label>
                <Figure value={units(l.principal)} decimals={2} variant="body" />
              </View>
              <View>
                <Label>Paid</Label>
                <Text variant="body">{l.installmentsPaid}/{l.installmentCount}</Text>
              </View>
              <View style={styles.right}>
                <Label>Outstanding</Label>
                <Figure
                  value={l.status === "active" ? units(l.owed - l.repaid) : 0}
                  decimals={2}
                  variant="body"
                  tone={l.status === "active" ? "accent" : "soft"}
                />
              </View>
            </View>
          </Surface>
          </Animated.View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  addr: { marginBottom: space.md },
  tiles: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  countTile: { flex: 1, gap: 2 },
  heading: { marginTop: space.lg, marginBottom: space.sm },
  row: { marginBottom: space.sm, gap: space.xs },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowMid: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.xs },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: space.sm },
  right: { alignItems: "flex-end" },
});
