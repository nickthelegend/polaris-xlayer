import type { ChainId } from "./pure.ts";
import type { ChainSigner } from "./types.ts";

/**
 * The non-Android build of the Mobile Wallet Adapter signer.
 *
 * This file is the whole platform gate, and it works by *not existing* on
 * Android: Metro resolves `./mwaSigner` to `mwaSigner.android.ts` there and to
 * this file everywhere else. Nothing in here imports `@solana-mobile`, so the
 * adapter is not in the iOS or web bundle graph at all.
 *
 * A `Platform.OS` check around a static import would not have done this. The
 * adapter calls `TurboModuleRegistry.getEnforcing` as a top-level statement, so
 * it throws while the *module* is being evaluated — long before any runtime
 * check of ours could run. On iOS that is a red screen at load, not a catchable
 * error.
 *
 * Note this is `.ts` and not `.native.ts` on purpose: `.native` matches iOS
 * too, which is precisely the case that must not get the real implementation.
 */
export const MWA_AVAILABLE = false;

export async function createMwaSigner(_chainId: ChainId): Promise<ChainSigner> {
  throw new Error("Mobile Wallet Adapter is only available in the Android build.");
}
