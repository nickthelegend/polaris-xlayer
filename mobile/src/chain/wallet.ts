import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Keypair } from "@solana/web3.js";

const KEY = "polaris.demo.wallet.v1";

/**
 * Where the key is kept.
 *
 * On a device that is the platform keystore — Keychain on iOS,
 * EncryptedSharedPreferences on Android. `expo-secure-store` has no web
 * implementation and throws there, so the web preview falls back to
 * `localStorage`.
 *
 * That fallback is not secure and is not pretended to be. Web is a preview
 * surface for this app, never a target, and the alternative is a preview that
 * crashes on launch. A real deployment replaces this whole module with Mobile
 * Wallet Adapter and stores nothing at all.
 */
const store = {
  async get(): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return globalThis.localStorage?.getItem(KEY) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(KEY);
  },
  async set(value: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.setItem(KEY, value);
      } catch {
        /* private mode: the wallet lasts for this session only */
      }
      return;
    }
    await SecureStore.setItemAsync(KEY, value);
  },
  async clear(): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.removeItem(KEY);
      } catch {
        /* nothing to clear */
      }
      return;
    }
    await SecureStore.deleteItemAsync(KEY);
  },
};

/**
 * The wallet this build signs with.
 *
 * **No private key ships in this repository.** An earlier version embedded a
 * seeded keypair in `deployment.json`, which meant a 64-byte secret sitting in
 * git — bad practice on any cluster, and the first thing anyone reading the
 * repo would notice.
 *
 * Instead the key is generated on the device the first time the app runs and
 * kept in the platform keystore (Keychain on iOS, EncryptedSharedPreferences
 * on Android). It never leaves the device and never enters version control.
 *
 * This is still a *demo* signer, and it is deliberately not the end state: a
 * shipped build hands this role to Mobile Wallet Adapter so the key belongs to
 * a wallet the user already trusts. Nothing else about the transaction path
 * changes when that happens — every instruction is already built by the chain
 * layer rather than by a screen, so only this module is replaced.
 */
export async function loadOrCreateWallet(): Promise<Keypair> {
  const stored = await store.get().catch(() => null);
  if (stored) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
    } catch {
      // A corrupt entry is not worth failing a launch over — replace it.
    }
  }
  const created = Keypair.generate();
  await store.set(JSON.stringify(Array.from(created.secretKey)));
  return created;
}

/** Forget the demo wallet, so the next launch starts a fresh borrower. */
export async function resetWallet(): Promise<void> {
  await store.clear().catch(() => {});
}
