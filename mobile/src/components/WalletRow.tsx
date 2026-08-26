import * as Clipboard from "expo-clipboard";
import { failed, press, succeeded, tap } from "../lib/haptics";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { PublicKey } from "@solana/web3.js";

import { CLUSTER } from "../chain/config";
import { space } from "../theme";
import { Mono, Text } from "./Text";
import { Surface } from "./Surface";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

/**
 * Whose credit line this is.
 *
 * Worth showing rather than hiding: the signer is generated on this device, so
 * the address is the only thing that identifies the borrower, and it is what
 * anyone needs in order to fund the wallet on a test cluster. A demo that
 * silently uses an identity you cannot see or name is the kind of thing that
 * reads as fake.
 */
export function WalletRow({ address }: { address: PublicKey | null }) {
  const [copied, setCopied] = useState(false);

  if (!address) return null;
  const value = address.toBase58();

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
        <View style={styles.dot} />
        <View style={{ flex: 1 }}>
          <Text variant="label" tone="label">
            This device · {CLUSTER}
          </Text>
          <Mono numberOfLines={1} style={styles.addr}>
            {short(value)}
          </Mono>
        </View>
        <Text variant="label" tone={copied ? "lime" : "faint"}>
          {copied ? "Copied" : "Copy"}
        </Text>
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
  addr: { marginTop: 3, fontSize: 12 },
});
