/**
 * The Polaris gateway.
 *
 * Two jobs, both of which exist because they cannot live in a wallet or a
 * shop page:
 *
 *   POST /underwrite   opens a line from a wallet's own history, signed by the
 *                      underwriter key
 *   GET|POST /pay/:id  a Solana Pay transaction request -- any Solana Pay
 *                      wallet can scan it and be handed a plan to approve
 *
 * Node's own http server, deliberately. A framework here would be four hundred
 * dependencies to route six paths.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { PublicKey } from "@solana/web3.js";
import QRCode from "qrcode";

import { CLUSTER, connect, type Chain } from "./chain.ts";
import { orderRef } from "./order.ts";
import { buildPaymentTransaction, totalOwed, type Order } from "./solana-pay.ts";
import { underwrite } from "./underwrite.ts";
import { checkoutPage } from "./page.ts";

const PORT = Number(process.env.PORT ?? 4100);
/**
 * The URL a wallet will fetch the transaction request from.
 *
 * A phone scanning a QR is not on localhost, so this has to be an address the
 * phone can actually reach. Set PUBLIC_URL to the machine's LAN address (or a
 * tunnel) before demoing to anything that is not this computer.
 */
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

let chain: Chain;

const json = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    // Solana Pay wallets fetch this cross-origin.
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(payload);
};

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Parse an order out of the query string, refusing anything unusable. */
function parseOrder(url: URL, orderId: string): Order {
  const merchant = url.searchParams.get("merchant");
  const amount = url.searchParams.get("amount");
  if (!merchant) throw new HttpError(400, "merchant is required");
  if (!amount) throw new HttpError(400, "amount is required");

  let merchantKey: PublicKey;
  try {
    merchantKey = new PublicKey(merchant);
  } catch {
    throw new HttpError(400, "merchant is not a valid address");
  }

  let value: bigint;
  try {
    value = BigInt(amount);
  } catch {
    throw new HttpError(400, "amount must be an integer in base units");
  }
  if (value <= 0n) throw new HttpError(400, "amount must be above zero");

  const mode = url.searchParams.get("mode") === "full" ? "full" : "later";
  const installmentCount = Number(url.searchParams.get("installments") ?? 4);
  const intervalSeconds = Number(url.searchParams.get("interval") ?? 7 * 86_400);
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 24) {
    throw new HttpError(400, "installments must be a whole number between 1 and 24");
  }
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60) {
    throw new HttpError(400, "interval must be at least 60 seconds");
  }

  return { merchant: merchantKey, amount: value, orderId, mode, installmentCount, intervalSeconds };
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", PUBLIC_URL);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  if (path === "/health") {
    const slot = await chain.connection.getSlot();
    json(res, 200, {
      cluster: CLUSTER,
      program: chain.program.programId.toBase58(),
      underwriter: chain.underwriter.publicKey.toBase58(),
      slot,
    });
    return;
  }

  if (path === "/underwrite" && req.method === "POST") {
    const { borrower } = await body(req);
    if (!borrower) throw new HttpError(400, "borrower is required");
    let key: PublicKey;
    try {
      key = new PublicKey(borrower);
    } catch {
      throw new HttpError(400, "borrower is not a valid address");
    }
    const result = await underwrite(key, chain);
    json(res, 200, {
      ...result,
      evidence: { ...result.evidence, stableBalance: result.evidence.stableBalance.toString() },
    });
    return;
  }

  if (path.startsWith("/pay/")) {
    const orderId = decodeURIComponent(path.slice("/pay/".length));
    if (!orderId) throw new HttpError(400, "an order id is required");
    const order = parseOrder(url, orderId);

    // The spec's GET: what the wallet shows before it asks for an account.
    if (req.method === "GET") {
      json(res, 200, { label: "Polaris", icon: `${PUBLIC_URL}/icon.svg` });
      return;
    }

    if (req.method === "POST") {
      const { account } = await body(req);
      if (!account) throw new HttpError(400, "account is required");
      let customer: PublicKey;
      try {
        customer = new PublicKey(account);
      } catch {
        throw new HttpError(400, "account is not a valid address");
      }

      /*
       * A customer with no line gets one here, from their own history, before
       * the plan is built. Without this the first scan of a QR by a new wallet
       * fails on a missing profile -- which is exactly the moment a payments
       * product cannot afford to fail.
       */
      await fetchMerchant(order.merchant);

      /*
       * Refuse an order that has already been financed, here rather than at
       * the chain.
       *
       * The program stops it either way — the guard account cannot be created
       * twice — but only after the customer has read the terms and approved
       * them. Being told "already paid" before you approve is a different
       * experience from being told it after.
       */
      if (order.mode === "later" && (await alreadyFinanced(order))) {
        throw new HttpError(409, "That order has already been paid.");
      }

      if (order.mode === "later") {
        await underwrite(customer, chain);
      }

      const { transaction, message } = await buildPaymentTransaction(chain, order, customer);
      json(res, 200, {
        transaction: transaction
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        message,
      });
      return;
    }
  }

  if (path === "/icon.svg") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0f0c"/><path d="M32 12l5.5 14.5L52 32l-14.5 5.5L32 52l-5.5-14.5L12 32l14.5-5.5z" fill="#c8f751"/></svg>`;
    res.writeHead(200, { "content-type": "image/svg+xml", "access-control-allow-origin": "*" });
    res.end(svg);
    return;
  }

  if (path === "/" || path === "/checkout") {
    const merchant = url.searchParams.get("merchant");
    const amount = url.searchParams.get("amount");
    const orderId = url.searchParams.get("order") ?? `order-${Date.now()}`;
    if (!(merchant && amount)) {
      throw new HttpError(400, "Open this with ?merchant=<address>&amount=<base units>");
    }
    const order = parseOrder(url, orderId);
    const merchantAccount = await fetchMerchant(order.merchant);

    const requestUrl = `${PUBLIC_URL}/pay/${encodeURIComponent(orderId)}?merchant=${merchant}&amount=${amount}&mode=${order.mode}&installments=${order.installmentCount}&interval=${order.intervalSeconds}`;
    const solanaPayUrl = `solana:${encodeURIComponent(requestUrl)}`;
    const qr = await QRCode.toString(solanaPayUrl, { type: "svg", margin: 1, width: 320 });
    const html = checkoutPage({
      qr,
      solanaPayUrl,
      requestUrl,
      order,
      owed: totalOwed(order.amount, order.installmentCount, order.intervalSeconds),
      merchantName: readName(merchantAccount.name),
      cluster: CLUSTER,
    });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  throw new HttpError(404, `No route for ${req.method} ${path}`);
}

/**
 * The merchant account, or a 404 that says so.
 *
 * A well-formed address for a merchant that was never registered -- or one
 * from a cluster that has since been reset -- is a caller's mistake, not a
 * fault on our side. Left to Anchor it surfaced as "Account does not exist",
 * which the catch-all turned into a 500 and the sentence "Something went wrong
 * on our side." It did not go wrong on our side.
 */
/** True once a plan has been opened against this exact basket. */
async function alreadyFinanced(order: Order): Promise<boolean> {
  const pda = chain.pda([
    Buffer.from("order"),
    order.merchant.toBuffer(),
    orderRef(order.orderId),
  ]);
  return (await chain.connection.getAccountInfo(pda)) !== null;
}

async function fetchMerchant(pda: PublicKey): Promise<{ name: unknown; payout: PublicKey }> {
  const account = await chain.program.account.merchant.fetchNullable(pda);
  if (!account) {
    throw new HttpError(404, "That merchant is not registered on this deployment.");
  }
  return account as unknown as { name: unknown; payout: PublicKey };
}

function readName(name: unknown): string {
  if (typeof name === "string") return name;
  if (Array.isArray(name)) return Buffer.from(name).toString("utf8").replace(/\0+$/, "");
  return "Merchant";
}

export function createGateway(c: Chain) {
  chain = c;
  return createServer((req, res) => {
    route(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) {
        // The chain's message names accounts and program ids. That is a log
        // line, not something to hand a shopper.
        console.error(`[gateway] ${req.method} ${req.url} failed`, err);
      }
      if (!res.headersSent) {
        json(res, status, {
          error: status === 500 ? "Something went wrong on our side." : err.message,
        });
      }
    });
  });
}

// Started directly rather than imported by a test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  const c = connect();
  createGateway(c).listen(PORT, () => {
    console.log(`polaris gateway · ${CLUSTER} · ${PUBLIC_URL}`);
    console.log(`  program      ${c.program.programId.toBase58()}`);
    console.log(`  underwriter  ${c.underwriter.publicKey.toBase58()}`);
  });
}
