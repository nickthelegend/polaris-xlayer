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

/*
 * Hermes loses the Buffer prototype through `subarray`.
 *
 * `Buffer.prototype.subarray` is inherited from `Uint8Array`, which builds its
 * result through the species constructor. Under Hermes that resolves to
 * `Uint8Array` rather than `Buffer`, so the returned view has none of the
 * Buffer read methods. `slice` is unaffected — only `subarray` is.
 *
 * That is not a curiosity. Anchor's account coder strips the eight-byte
 * discriminator with `data.subarray(8)` before handing the rest to
 * buffer-layout, which immediately calls `b.readUIntLE(...)`. On device every
 * single account decode therefore failed with "undefined is not a function",
 * thrown deep inside a borsh decode with nothing in the stack naming Buffer.
 * The browser never sees it: real Buffer there gets species right.
 *
 * Re-attaching the prototype is the whole fix. `subarray` shares the
 * underlying memory by definition, so nothing is copied and the view stays a
 * view — it just remembers what it is.
 */
{
  const B: any = g.Buffer;
  const probe = B.from([1, 2, 3, 4]).subarray(1);
  if (!B.isBuffer(probe)) {
    const original = B.prototype.subarray;
    B.prototype.subarray = function subarray(this: any, ...args: any[]) {
      const view = original.apply(this, args);
      Object.setPrototypeOf(view, B.prototype);
      return view;
    };
  }
}

// Hermes has no structuredClone. Anchor uses it when cloning an IDL.
if (typeof g.structuredClone === "undefined") {
  g.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

export {};
