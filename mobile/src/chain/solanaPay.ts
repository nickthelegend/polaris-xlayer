import { Platform } from "react-native";
import { Transaction } from "@solana/web3.js";

import { getConnection, getPublicKey, getSigner } from "./client";

/**
 * A Solana Pay transaction request, as the spec defines it.
 *
 * `solana:<url-encoded https url>` — the wallet GETs the url for a label, then
 * POSTs its account and is handed back a transaction to sign. The interesting
 * property is that the wallet never has to trust the page: it decodes every
 * instruction in what it was given before the user approves anything.
 *
 * A `solana:<address>` transfer request is a different, simpler thing and is
 * deliberately not handled here — this app pays merchants through the program,
 * not by bare transfer, and quietly treating one as the other would let a code
 * move money outside every check the protocol makes.
 */
export type ScannedRequest = {
  /** The endpoint that will build the transaction. */
  url: string;
  label: string;
  icon: string | null;
};

export function parseSolanaPayUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("solana:")) {
    throw new Error("That is not a Solana Pay code.");
  }
  const rest = trimmed.slice("solana:".length);
  const decoded = decodeURIComponent(rest);
  if (!/^https?:\/\//i.test(decoded)) {
    throw new Error(
      "That code is a plain transfer request. Polaris pays merchants through the program, so it cannot be used here.",
    );
  }
  return decoded;
}

/**
 * A fetch that blames the right thing when it fails.
 *
 * A dead checkout endpoint and a dead cluster both surface as "Failed to
 * fetch", and the generic handler read that as the RPC being down — so
 * scanning a code whose merchant was offline told the borrower to check their
 * validator. The merchant's server is the only thing being contacted here, so
 * it is the only thing that can be at fault.
 */
async function checkoutFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    /*
     * In a browser this is very often not silence — it is CORS.
     *
     * A cross-origin response with no `access-control-allow-origin` cannot be
     * read at all, so a merchant answering 404 and a merchant that is switched
     * off arrive here identically. Saying only "not answering" sent a merchant
     * integrating their checkout to look at their uptime, when what they
     * actually had to do was allow this origin. The shopper still gets a
     * sentence they can act on; the merchant gets the real cause.
     *
     * Kept short on purpose: `explainError` drops anything over 120 characters
     * as a probable stack trace, and the first draft of this sentence was 123.
     */
    throw new Error(
      crossOrigin(url)
        ? "That checkout could not be read from here — it may be offline, or not allow this app."
        : "That merchant's checkout is not answering. The code may be stale.",
    );
  }
}

/** True when the browser would apply CORS to this url — never on native. */
function crossOrigin(url: string): boolean {
  if (Platform.OS !== "web" || typeof location === "undefined") return false;
  try {
    return new URL(url).origin !== location.origin;
  } catch {
    return false;
  }
}

/** The spec's GET: what the code says it is, before any account is revealed. */
export async function describeRequest(url: string): Promise<ScannedRequest> {
  const res = await checkoutFetch(url, { headers: { accept: "application/json" } });
  /*
   * "Not answering" is only true of a server that did not answer.
   *
   * A 4xx means the checkout replied and refused what was sent — a stale code,
   * a malformed one, an order that no longer exists — and telling the user it
   * is unreachable sends them to check their signal instead of the code.
   */
  if (!res.ok) {
    throw new Error(
      res.status >= 500
        ? `That merchant's checkout is having trouble (${res.status}). Try again shortly.`
        : `That code was refused by the merchant's checkout (${res.status}). It may be stale.`,
    );
  }
  const body = await res.json().catch(() => null);
  return { url, label: String(body?.label ?? "Unknown merchant"), icon: body?.icon ?? null };
}

export type PreparedPayment = {
  transaction: Transaction;
  /** The merchant's own description of what is being agreed to. */
  message: string;
};

/**
 * The spec's POST. Hands over the account and gets a transaction back.
 *
 * Nothing is signed here. The transaction is returned so the screen can show
 * what it does and let the borrower decide — a scanner that signs the moment
 * it recognises a code is a scanner that can be pointed at a wall.
 */
export async function preparePayment(url: string): Promise<PreparedPayment> {
  const res = await checkoutFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: getPublicKey().toBase58() }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `The checkout refused this (${res.status}).`);
  }
  if (typeof body?.transaction !== "string") {
    throw new Error("The checkout did not return a transaction.");
  }

  const bytes = Uint8Array.from(atob(body.transaction), (c) => c.charCodeAt(0));

  /*
   * Legacy only, deliberately, and decided by parsing rather than sniffing.
   *
   * The first attempt at this asked `VersionedTransaction.deserialize` whether
   * the bytes were versioned — which returns happily for a legacy transaction
   * too, so every valid payment was refused as an unsupported format. Trying
   * the format this app actually signs, and treating a failure as unsupported,
   * cannot get that backwards.
   */
  let transaction: Transaction;
  try {
    transaction = Transaction.from(bytes);
  } catch {
    throw new Error("That checkout sent a transaction format this app does not sign.");
  }

  return { transaction, message: String(body?.message ?? "Payment") };
}

/**
 * Sign what was scanned and send it.
 *
 * Deliberately not `provider.sendAndConfirm`. That sets its own fee payer and
 * a fresh blockhash before signing, and both are already fixed here — the
 * gateway chose them and signed over them as the fee payer. Replacing either
 * invalidates the signature that is already on the transaction, which is
 * exactly what happened: every approval came back "Signature verification
 * failed".
 *
 * So: add the one signature the gateway could not provide — the token
 * authority's — and send the bytes untouched.
 */
export async function approvePayment(tx: Transaction): Promise<string> {
  /*
   * Send what the signer handed back, not what it was given.
   *
   * The device signer signs in place, so discarding the return value and
   * serializing the original worked and hid this for as long as the device key
   * was the only signer. A wallet app does not work that way: Mobile Wallet
   * Adapter returns a *new* transaction carrying the signature, and the
   * original object it was passed is never touched. So the borrower's slot
   * went out empty and the cluster answered "Signature verification failed"
   * for a payment the wallet had genuinely signed.
   *
   * The gateway's own partial signature — it sponsors both the fee and the
   * rent — rides along on the returned transaction, because the wallet signs
   * the same message rather than rebuilding it.
   */
  const signed = await getSigner().signTransaction(tx);

  const connection = getConnection();
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    // Preflight stays on: a plan that would fail should fail before it is sent,
    // not after the borrower has watched a spinner.
    skipPreflight: false,
  });

  /*
   * Confirm, but never wait forever.
   *
   * `confirmTransactionInitialTimeout` only governs the happy path. The
   * confirmation rides a signature subscription, and where that websocket
   * cannot be reached at all — a cluster whose wss endpoint the device cannot
   * open — the promise simply never settles and the screen sits on "Submitting
   * to the cluster…" with no way out. That was observed against devnet from an
   * emulator, indefinitely.
   *
   * A transaction that was broadcast and could not be confirmed is not a
   * failure to report as a refusal; the caller's error ladder has a sentence
   * for exactly this, naming the signature so it can be checked.
   */
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const confirmed = connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Transaction was not confirmed in 60 seconds. It is unknown if it succeeded or failed. Check signature ${signature}`,
          ),
        ),
      60_000,
    );
  });
  try {
    await Promise.race([confirmed, expired]);
  } finally {
    clearTimeout(timer);
  }
  return signature;
}

/** Exposed for the screen's "nothing was charged" copy. */
export async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok || res.status === 405;
  } catch {
    return false;
  }
}

export { getConnection };
