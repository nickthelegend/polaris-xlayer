import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "polaris.merchant.address.v1";

/**
 * Which merchant this terminal is taking payment for.
 *
 * A merchant address is public — it is the whole point that a book needs no
 * key to read — so this is not secrecy, it is just the one durable store the
 * app already has on both platforms. Web has no SecureStore, so the preview
 * surface falls back to localStorage the same way the borrower app does.
 */
export async function getMerchant(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setMerchant(address: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(KEY, address);
    } catch {
      /* private mode: the choice lasts for this session */
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(KEY, address);
  } catch {
    /* a terminal that cannot persist still works for this session */
  }
}
