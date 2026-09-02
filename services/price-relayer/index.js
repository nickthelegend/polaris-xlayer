/**
 * The price relayer, as a service.
 *
 * Polaris lends against equity, so the venue's price has to live on chain, and
 * it has to stay fresh: the oracle rejects a print older than 15 minutes while
 * the market is open, and the engine refuses to open a loan against a stale
 * mark. Posting by hand is fine while building, but it means the deployed app
 * is only usable for the fifteen minutes after somebody remembers to poke it.
 * Anyone arriving later — a judge, a user — gets PriceStale and a checkout
 * that will not go through.
 *
 * Chainlink cannot carry this feed. X Layer has 26 push feeds and every one of
 * them is crypto; equity prices exist only as Data Streams, which is a paid
 * subscription whose on-chain StreamsLookup pattern X Layer does not support.
 * So Polaris posts the print itself and posts its provenance with it — the
 * source string and the venue's own timestamp go on chain, so the number can
 * be checked against the exchange rather than taken on trust.
 *
 * Vercel's Hobby plan schedules cron once a day, which is two orders of
 * magnitude short of a fifteen-minute bound, so this runs as its own worker.
 */
const { ethers } = require("ethers");

const RPC = need("XLAYER_TESTNET_RPC_URL");
const KEY = need("DEPLOYER_PRIVATE_KEY");
const ORACLE = need("POLARIS_ORACLE");
const STOCK = need("POLARIS_STOCK");
const SYMBOL = process.env.STOCK_SYMBOL || "AAPL";

// Comfortably inside the oracle's 15-minute open-market bound, with room for a
// couple of consecutive failures before anything on chain goes stale.
const EVERY_MS = Number(process.env.RELAY_INTERVAL_MS || 240_000);

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; the relayer cannot sign or address anything without it.`);
  return v;
}

const ORACLE_ABI = [
  "function postPrice(address asset, uint256 usdPerShare, uint64 printedAt, bool marketOpen, string source)",
  "function peek(address asset) view returns (uint256, uint64, bool, uint64)",
];

// X Layer serves pre-transaction state for a short window after a receipt, and
// batching upsets its RPC, so both are disabled.
const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1, staticNetwork: true });
const oracle = new ethers.Contract(ORACLE, ORACLE_ABI, new ethers.Wallet(KEY, provider));

async function fetchPrint() {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(SYMBOL)}?interval=1m&range=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 polaris-relayer" } });
  if (!res.ok) throw new Error(`venue answered HTTP ${res.status}`);
  const meta = (await res.json())?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error("venue returned no price");

  const now = Math.floor(Date.now() / 1000);
  const reg = meta.currentTradingPeriod?.regular;
  // Market hours come from the venue's own published session, not a clock in
  // Solidity: NYSE/Nasdaq hours move with daylight saving and a holiday
  // calendar, and reimplementing that on chain is a second source of truth
  // that silently drifts from the first.
  const marketOpen = !!reg && now >= reg.start && now < reg.end;
  return {
    // 1e8, the scale Chainlink feeds use, so a real feed drops in unchanged.
    usdPerShare: BigInt(Math.round(meta.regularMarketPrice * 1e8)),
    printedAt: Number(meta.regularMarketTime),
    marketOpen,
    source: `${meta.fullExchangeName || meta.exchangeName || "unknown"} ${marketOpen ? "last" : "close"}`,
    human: meta.regularMarketPrice,
  };
}

async function tick() {
  const p = await fetchPrint();

  // The oracle rejects a print that moves time backwards, and the venue
  // repeats its last print outside trading hours, so a duplicate is the
  // expected steady state overnight rather than a failure.
  const [, lastPrintedAt] = await oracle.peek(STOCK);
  if (p.printedAt <= Number(lastPrintedAt)) {
    console.log(`[relay] $${p.human} already on chain at ${p.printedAt}; nothing to post`);
    return;
  }

  const tx = await oracle.postPrice(STOCK, p.usdPerShare, p.printedAt, p.marketOpen, p.source);
  await tx.wait();
  console.log(`[relay] posted $${p.human} (${p.source}, venue ${p.marketOpen ? "open" : "closed"}) in ${tx.hash}`);
}

async function main() {
  console.log(`[relay] ${SYMBOL} -> oracle ${ORACLE} every ${EVERY_MS / 1000}s`);
  for (;;) {
    // A failed tick must not take the worker down: the venue and the RPC both
    // have bad minutes, and the next tick is only four minutes away.
    await tick().catch((e) => console.error(`[relay] tick failed: ${e.shortMessage || e.message}`));
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}

main().catch((e) => {
  console.error(`[relay] cannot start: ${e.message}`);
  process.exit(1);
});
