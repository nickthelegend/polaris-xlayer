import type { MwaFailure, SignerKind } from "./types.ts";

/**
 * Everything here is a pure function with no React Native, no `@solana/web3.js`
 * and no `@solana-mobile` import, so `mobile/test` can execute it in plain Node.
 *
 * That constraint is the point rather than an accident. The one line that is
 * genuinely untestable off-device — `TurboModuleRegistry.getEnforcing` — sits
 * behind a platform-split file, and the decisions worth getting wrong all live
 * in this module instead.
 */

/* ------------------------------------------------------------------------ */
/* Addresses                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Decode the address Mobile Wallet Adapter hands back.
 *
 * **It is base64, not base58.** `Account.address` is typed
 * `Base64EncodedAddress = string`, which is a plain string, so nothing in the
 * type system stops a base58 pubkey being passed here — and the failure is
 * vicious. Feeding a base58 address to a base64 decoder throws about 93% of
 * the time, and the other 7% it yields a perfectly valid 32-byte array for a
 * completely different account. That would sign with the wrong payer, derive
 * the wrong token account, and fail on chain nowhere near the cause.
 *
 * Both guards below are needed. Length alone lets the 7% through; the
 * round-trip alone would accept a 32-byte value that decoded from something
 * mangled.
 */
export function decodeBase64Address(address: string): Uint8Array {
  if (typeof address !== "string" || address.length === 0) {
    throw new Error("Wallet returned an empty account address.");
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(address);
  } catch {
    throw new Error(
      "Wallet returned an account address that is not base64. Mobile Wallet " +
        "Adapter addresses are base64-encoded, never base58.",
    );
  }

  if (bytes.length !== 32) {
    throw new Error(
      `Wallet returned a ${bytes.length}-byte account address; a Solana address is 32.`,
    );
  }

  /*
   * Round-trip, normalised.
   *
   * A wallet is free to emit base64url (`-` and `_`) or to drop the `=`
   * padding, and both are legitimate. Comparing raw strings would reject those
   * wallets, so the comparison is against a canonical form of the input.
   */
  if (bytesToBase64(bytes) !== canonicalBase64(address)) {
    throw new Error(
      "Wallet returned an account address that failed a base64 round-trip.",
    );
  }
  return bytes;
}

function canonicalBase64(input: string): string {
  const normalised = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const padding = normalised.length % 4 === 0 ? "" : "=".repeat(4 - (normalised.length % 4));
  return normalised + padding;
}

function base64ToBytes(input: string): Uint8Array {
  const canonical = canonicalBase64(input);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(canonical)) {
    throw new Error("not base64");
  }
  // `atob` in Hermes and the browser, `Buffer` in Node. Both are present in
  // exactly one of the two environments this module runs in.
  const g = globalThis as { atob?: (s: string) => string };
  if (typeof g.atob === "function") {
    const binary = g.atob(canonical);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(canonical, "base64"));
}

function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as { btoa?: (s: string) => string };
  if (typeof g.btoa === "function") {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return g.btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

/* ------------------------------------------------------------------------ */
/* Clusters                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * The CAIP-2 chain identifier a wallet will accept, or `null`.
 *
 * `null` is the important return. There is no chain identifier for a local
 * validator, and there could not be a useful one: a wallet on a phone cannot
 * reach the host machine's loopback address. Rather than let that fail
 * mysteriously inside the wallet, the app refuses Mobile Wallet Adapter on
 * localnet and says why.
 */
export type ChainId = `${string}:${string}`;

export function chainIdFor(cluster: string): ChainId | null {
  switch (cluster) {
    case "mainnet-beta":
    case "mainnet":
      return "solana:mainnet";
    case "devnet":
      return "solana:devnet";
    case "testnet":
      return "solana:testnet";
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Choosing a signer                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Which signer this build should use.
 *
 * The platform arrives as an argument rather than being read from
 * `Platform.OS`, so the decision is testable in Node — `react-native` cannot
 * be imported there. The single untestable line is the call site that supplies
 * it.
 */
export function selectSigner(input: {
  os: string;
  mwaAvailable: boolean;
  chainId: ChainId | null;
}): SignerKind {
  if (input.os !== "android") return "device";
  if (!input.mwaAvailable) return "device";
  if (input.chainId === null) return "device";
  return "mwa";
}

/** Why Mobile Wallet Adapter is not on offer, in the user's words. */
export function whyNoMwa(input: {
  os: string;
  mwaAvailable: boolean;
  chainId: ChainId | null;
}): string | null {
  if (input.os === "web") return "Wallet apps can only be reached from the Android build.";
  if (input.os !== "android") return "Mobile Wallet Adapter is Android-only.";
  if (!input.mwaAvailable) {
    return "This build cannot reach wallet apps. It needs a development build rather than Expo Go.";
  }
  if (input.chainId === null) {
    return "A wallet app cannot reach a local validator. Point the app at devnet to connect one.";
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Errors                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Turn whatever Mobile Wallet Adapter threw into something actionable.
 *
 * Classified by duck-typing rather than `instanceof`, for two reasons: this
 * module must not import the adapter (it would drag a native module into the
 * web bundle), and the protocol's own error classes are constructed in two
 * different builds that are not `instanceof`-compatible with each other.
 *
 * The numeric codes come from `SolanaMobileWalletAdapterProtocolErrorCode` and
 * the string codes from `SolanaMobileWalletAdapterErrorCode`. Note there is no
 * "user declined" code anywhere in the protocol: a refusal arrives as
 * ERROR_NOT_SIGNED.
 */
export function classifyMwaError(error: unknown): MwaFailure {
  const e = error as { code?: unknown; message?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message : String(error);

  if (typeof e?.code === "number") {
    switch (e.code) {
      case -1:
        // ERROR_AUTHORIZATION_FAILED. The only signal that a cached auth token
        // has gone stale, and the only failure worth retrying automatically.
        return { kind: "stale-auth" };
      case -3:
        return { kind: "declined" }; // ERROR_NOT_SIGNED
      case -4:
        return { kind: "not-submitted" }; // ERROR_NOT_SUBMITTED
      default:
        return { kind: "unknown", message };
    }
  }

  if (typeof e?.code === "string") {
    if (e.code === "ERROR_WALLET_NOT_FOUND") return { kind: "no-wallet" };
    if (e.code === "ERROR_BROWSER_NOT_SUPPORTED") return { kind: "unsupported" };
    if (e.code === "ERROR_SESSION_CLOSED" || e.code === "ERROR_SESSION_TIMEOUT") {
      return { kind: "cancelled" };
    }
    /*
     * Cancelling the wallet chooser does not produce a code at all. The native
     * module rejects with the sentence as the code, so the sentence is the
     * only thing there is to match on. Fragile, and deliberately last.
     */
    if (/cancelled|canceled|not established/i.test(e.code)) return { kind: "cancelled" };
    return { kind: "unknown", message: e.code };
  }

  if (/cancelled|canceled/i.test(message)) return { kind: "cancelled" };
  return { kind: "unknown", message };
}

/** The sentence a user should read for each failure. */
export function explainMwaFailure(failure: MwaFailure): string {
  switch (failure.kind) {
    case "no-wallet":
      return "No Solana wallet app is installed on this device.";
    case "declined":
      return "The wallet declined to sign.";
    case "stale-auth":
      return "That wallet authorization expired. Connect again.";
    case "not-submitted":
      return "The wallet signed but could not broadcast. Nothing was charged.";
    case "cancelled":
      return "Cancelled before the wallet could sign.";
    case "unsupported":
      return "This build cannot reach a wallet app.";
    default:
      return failure.message || "The wallet could not complete that.";
  }
}

/* ------------------------------------------------------------------------ */
/* Transactions                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Refuse a transaction the wallet cannot serialize.
 *
 * The adapter serializes with `requireAllSignatures: false`, which sounds like
 * it relaxes everything but does not: a legacy transaction still needs a fee
 * payer and a recent blockhash to compile at all. Without them web3.js throws
 * "Transaction recentBlockhash required" from three frames inside the adapter,
 * which reads as a wallet fault rather than ours.
 */
export function assertSignable(tx: {
  feePayer?: unknown;
  recentBlockhash?: unknown;
  version?: unknown;
}): void {
  // Versioned transactions carry both inside a compiled message.
  if (typeof tx.version === "number") return;
  if (!tx.feePayer) {
    throw new Error("This transaction has no fee payer set, so no wallet can sign it.");
  }
  if (!tx.recentBlockhash) {
    throw new Error("This transaction has no recent blockhash, so no wallet can sign it.");
  }
}

/**
 * Whether to authorize afresh or reuse a cached token.
 *
 * `reauthorize` is called explicitly rather than passing `auth_token` to
 * `authorize`. They are not equivalent: against a wallet speaking the legacy
 * protocol, `authorize` falls through into the `reauthorize` branch and drops
 * every parameter except the token and the identity — including the chain.
 */
export function shouldAuthorize(
  cached: { token: string; chainId: string } | null,
  wantChainId: ChainId,
): "authorize" | "reauthorize" {
  if (!cached) return "authorize";
  if (cached.chainId !== wantChainId) return "authorize";
  return "reauthorize";
}
