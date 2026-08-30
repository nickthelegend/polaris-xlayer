import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";

import { enterUpAfter } from "../../src/components/motion";
import QRCode from "react-native-qrcode-svg";

import {
  Button, ErrorState, Figure, Label, Loading, Mono, Rule, Screen, Surface, Text,
} from "../../src/components";
import { buildCharge, quote, type Charge, type Mode } from "../../src/chain/charge";
import { listMerchants, readMerchantBook } from "../../src/chain/book";
import { getMerchant, setMerchant } from "../../src/lib/merchant";
import { ink, palette, space, radius } from "../../src/theme";
import { press, succeeded } from "../../src/lib/haptics";
import { printReceipt, printerAvailable } from "../../src/lib/receipt";
import { printer, type PrinterStatus } from "../../modules/imin-printer";

const MODES: { key: Mode; label: string; note: string }[] = [
  { key: "later", label: "Split into 4", note: "every 7 days, 10% APR" },
  { key: "full", label: "Pay in full", note: "settles immediately" },
];

export default function ChargeScreen() {
  const [merchant, setMerchantAddr] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [amount, setAmount] = useState("25");
  const [mode, setMode] = useState<Mode>("later");
  const [charge, setCharge] = useState<Charge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [printed, setPrinted] = useState<string | null>(null);
  const [head, setHead] = useState<PrinterStatus | null>(null);

  useEffect(() => {
    if (!printerAvailable) return;
    printer.getStatus().then(setHead).catch(() => setHead(null));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        let a = await getMerchant();
        if (!a) {
          const all = await listMerchants();
          if (!all.length) {
            setError("No merchant is registered on this deployment yet.");
            return;
          }
          a = all[0].address;
          await setMerchant(a);
        }
        setMerchantAddr(a);
        const b = await readMerchantBook(a);
        setName(b?.name ?? "Merchant");
      } catch (e: any) {
        setError(e?.message ?? "Could not reach the chain.");
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const usdc = Number(amount) || 0;

  /* Quoted before the code is handed over, so the merchant is never reading a
     number out that the program is going to disagree with. */
  const q = useMemo(
    () => (mode === "later" && usdc > 0 ? quote(usdc, 4) : null),
    [usdc, mode],
  );

  const show = useCallback(() => {
    if (!merchant || usdc <= 0) return;
    press();
    setPrinted(null);
    setCharge(buildCharge({ merchant, usdc, mode, now: Date.now() }));
    succeeded();
  }, [merchant, usdc, mode]);

  if (busy) return <Screen title="Charge"><Loading label="Reading the registry" /></Screen>;
  if (error) return <Screen title="Charge"><ErrorState message={error} /></Screen>;

  if (charge) {
    return (
      <Screen title="Show this code" lede={`${name} · devnet`} scroll>
        <Animated.View entering={enterUpAfter(40)}>
        <Surface padded style={styles.qrWrap}>
          {/* White quiet zone is not decoration: a scanner needs the contrast,
              and a lime-on-black code fails on half the phones that try it. */}
          <View style={styles.qrPlate}>
            <QRCode value={charge.solanaUrl} size={232} backgroundColor="#ffffff" color="#000000" />
          </View>
          <Figure value={charge.usdc * 1_000_000} decimals={2} variant="hero" prefix="$" />
          <Label>USDC · {charge.mode === "later" ? "split into 4" : "in full"}</Label>
        </Surface>
        </Animated.View>

        {q && charge.mode === "later" && (
          <Surface padded style={styles.plan}>
            <View style={styles.line}>
              <Text tone="soft">Buyer repays</Text>
              <Figure value={q.total} decimals={2} variant="body" />
            </View>
            <View style={styles.line}>
              <Text tone="soft">4 payments of</Text>
              <Figure value={q.each} decimals={2} variant="body" tone="lime" />
            </View>
            <Rule />
            <View style={styles.line}>
              <Text tone="soft">You are paid</Text>
              <Figure value={charge.usdc * 1_000_000} decimals={2} variant="body" tone="lime" />
            </View>
            <Text variant="bodySmall" tone="faint" style={styles.note}>
              In full, today. Polaris carries the instalments.
            </Text>
          </Surface>
        )}

        <Mono tone="faint" style={styles.order}>{charge.orderId}</Mono>

        {/* Only offered on hardware that has a head. On a phone build the
            native module is absent and there is nothing to promise. */}
        {printerAvailable && (
          <>
            <Button
              label={printing ? "Printing…" : "Print receipt"}
              variant="secondary"
              full
              disabled={printing}
              onPress={async () => {
                press();
                setPrinting(true);
                setPrinted(null);
                try {
                  await printReceipt({
                    charge,
                    merchantName: name,
                    merchantAddress: merchant!,
                  });
                  succeeded();
                  setPrinted("Receipt printed.");
                } catch (e: any) {
                  /* The head reports why — out of paper, door open, overheated.
                     Show that, never a generic failure. */
                  setPrinted(e?.message ?? "The printer did not respond.");
                } finally {
                  setPrinting(false);
                }
              }}
            />
            {(printed || head) && (
              <Text variant="bodySmall" tone="faint" style={styles.order}>
                {printed ?? `Printer ${head!.generation} · ${head!.text}`}
              </Text>
            )}
          </>
        )}

        <Button label="Take another payment" variant="secondary" full onPress={() => setCharge(null)} />
      </Screen>
    );
  }

  return (
    <Screen title="Take a payment" lede={`${name} · devnet`} scroll>
      <Surface padded style={styles.card}>
        <Label>Amount (USDC)</Label>
        <View style={styles.amountRow}>
          <Text variant="hero" tone="soft">$</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            style={styles.input}
            placeholder="0"
            placeholderTextColor={ink.faint}
            selectionColor={palette.primary}
          />
        </View>
      </Surface>

      <Label style={styles.heading}>How they pay</Label>
      {MODES.map((m) => {
        const on = mode === m.key;
        return (
          <Pressable key={m.key} onPress={() => { press(); setMode(m.key); }}>
            <Surface padded style={[styles.mode, on && styles.modeOn]}>
              <View>
                <Text variant="body" tone={on ? "lime" : "default"}>{m.label}</Text>
                <Text variant="bodySmall" tone="faint">{m.note}</Text>
              </View>
            </Surface>
          </Pressable>
        );
      })}

      {q && (
        <Surface padded style={styles.plan}>
          <View style={styles.line}>
            <Text tone="soft">Buyer repays</Text>
            <Figure value={q.total} decimals={2} variant="body" />
          </View>
          <View style={styles.line}>
            <Text tone="soft">4 payments of</Text>
            <Figure value={q.each} decimals={2} variant="body" tone="lime" />
          </View>
        </Surface>
      )}

      <Button label="Show the code" full disabled={usdc <= 0} onPress={show} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space.md },
  amountRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  input: {
    flex: 1,
    color: palette.foreground,
    fontFamily: "JetBrainsMono_500Medium",
    fontSize: 44,
    paddingVertical: space.xs,
  },
  heading: { marginBottom: space.sm },
  mode: { marginBottom: space.sm, borderWidth: 1, borderColor: "transparent" },
  modeOn: { borderColor: palette.primary },
  plan: { marginVertical: space.md, gap: space.xs },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  note: { marginTop: space.xs },
  qrWrap: { alignItems: "center", gap: space.sm, marginBottom: space.md },
  qrPlate: { backgroundColor: "#ffffff", padding: space.md, borderRadius: radius.md },
  order: { textAlign: "center", marginBottom: space.md },
});
