/**
 * What the Solana client libraries assume exists, and React Native does not
 * provide.
 *
 * Imported for its side effects at the very top of the root layout, before
 * anything touches `@solana/web3.js` — a keypair generated before
 * `getRandomValues` is installed throws, and a `PublicKey` constructed before
 * `Buffer` exists fails on a base58 decode. Order matters here, so this is one
 * module rather than four scattered imports.
 */
import "react-native-get-random-values";
import { Buffer } from "buffer";

// web3.js decodes account data with Buffer throughout. Hermes has no global one.
const g = globalThis as any;

if (typeof g.Buffer === "undefined") {
  g.Buffer = Buffer;
}

// Anchor's BorshCoder reaches for `process.env` when picking an error map.
if (typeof g.process === "undefined") {
  g.process = { env: {} };
} else if (!g.process.env) {
  g.process.env = {};
}

// Hermes has no structuredClone. Anchor uses it when cloning an IDL.
if (typeof g.structuredClone === "undefined") {
  g.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

export {};
