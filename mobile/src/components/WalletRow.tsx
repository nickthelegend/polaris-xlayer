import * as Clipboard from "expo-clipboard";
import { failed, press, succeeded, tap } from "../lib/haptics";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { PublicKey } from "@solana/web3.js";

import { CLUSTER } from "../chain/config";
import { usePolaris } from "../chain/provider";
import { ink, palette, space } from "../theme";
import { Mono, Text } from "./Text";
import { Surface } from "./Surface";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

/**
 * Whose credit line this is, and what is signing for it.
 *
 * Worth showing rather than hiding on both counts. The address is the only
 * thing that identifies the borrower and is what anyone needs to fund the
 * wallet on a test cluster — and *which key signs* is the difference between a
 * demo and a product, so the row says which one plainly rather than letting a
 * device key pass for a connected wallet.
 */
export function WalletRow({ address }: { address: PublicKey | null }) {
  const [copied, setCopied] = useState(false);
  const {
    signerKind,
    signerLabel,
    connecting,
    walletUnavailable,
    connectWallet,
    disconnectWallet,
  } = usePolaris();

  if (!address) return null;
  const value = address.toBase58();
  const connected = signerKind === "mwa";

  return (
    <Surface
      padded={14}
      onPress={async () => {
        await Clipboard.setStringAsync(value);
        succeeded();
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      style={styles.wrap}
      accessibilityLabel={`Wallet address ${value}. Tap to copy.`}
    >
      <View style={styles.row}>
        <View style={[styles.dot, connected && styles.connectedDot]} />
        <View style={{ flex: 1 }}>
          <Text variant="label" tone="label">
            {connected ? signerLabel : "This device"} · {CLUSTER}
          </Text>
          <Mono numberOfLines={1} style={styles.addr}>
            {short(value)}
          </Mono>
        </View>
        <Text variant="label" tone={copied ? "lime" : "faint"}>
          {copied ? "Copied" : "Copy"}
        </Text>
      </View>

      {/*
        The wallet affordance.
        
        Absent rather than disabled where a wallet app cannot be reached at all
        — a permanently greyed-out button on the web preview is a worse answer
        than a sentence saying why. When it can be reached, the label says which
        direction it goes.
      */}
      <View style={styles.action}>
        {walletUnavailable ? (
          <Text variant="bodySmall" tone="faint">
            {walletUnavailable}
          </Text>
        ) : (
          <Text
            variant="label"
            tone={connecting ? "faint" : "lime"}
            onPress={connecting ? undefined : connected ? disconnectWallet : connectWallet}
            accessibilityRole="button"
          >
            {connecting
              ? "Waiting for the wallet…"
              : connected
                ? "Disconnect wallet"
                : "Connect a wallet app"}
          </Text>
        )}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#64B3C0",
  },
  connectedDot: { backgroundColor: palette.primary },
  action: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: ink.hairline,
  },
  addr: { marginTop: 3, fontSize: 12 },
});
