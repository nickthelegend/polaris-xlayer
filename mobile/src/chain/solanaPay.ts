import { Transaction } from "@solana/web3.js";

import { getConnection, getWallet } from "./client";

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

/** The spec's GET: what the code says it is, before any account is revealed. */
export async function describeRequest(url: string): Promise<ScannedRequest> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`That merchant's checkout is not answering (${res.status}).`);
  const body = await res.json();
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
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: getWallet().publicKey.toBase58() }),
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
  tx.partialSign(getWallet());

  const connection = getConnection();
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    // Preflight stays on: a plan that would fail should fail before it is sent,
    // not after the borrower has watched a spinner.
    skipPreflight: false,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
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
