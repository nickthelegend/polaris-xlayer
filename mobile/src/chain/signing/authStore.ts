import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "polaris.mwa.auth.v1";

export type CachedAuth = { token: string; chainId: string; address: string };

/**
 * Where a wallet authorization is remembered.
 *
 * Only the auth token, the chain it was issued for, and the account it named —
 * never a key, because with Mobile Wallet Adapter there is no key to hold. The
 * token lets the app reconnect without sending the user back to the wallet on
 * every launch.
 *
 * The chain is stored beside the token on purpose: reauthorizing carries the
 * chain implicitly, so a token issued for one cluster must not be reused after
 * the app is pointed at another.
 */
export const authStore = {
  async load(): Promise<CachedAuth | null> {
    try {
      const raw =
        Platform.OS === "web"
          ? (globalThis.localStorage?.getItem(KEY) ?? null)
          : await SecureStore.getItemAsync(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedAuth;
      return parsed?.token && parsed?.chainId ? parsed : null;
    } catch {
      // A corrupt entry is a reconnect, not a crash.
      return null;
    }
  },

  async save(auth: CachedAuth): Promise<void> {
    const raw = JSON.stringify(auth);
    try {
      if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, raw);
      else await SecureStore.setItemAsync(KEY, raw);
    } catch {
      /* the authorization simply will not survive this launch */
    }
  },

  async clear(): Promise<void> {
    try {
      if (Platform.OS === "web") globalThis.localStorage?.removeItem(KEY);
      else await SecureStore.deleteItemAsync(KEY);
    } catch {
      /* nothing to clear */
    }
  },
};
