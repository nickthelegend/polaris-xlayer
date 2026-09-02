/**
 * The price relayer.
 *
 * Polaris lends against equity, so somebody has to carry the venue's price
 * on chain. Chainlink cannot do it here: there is no equity push feed on X
 * Layer (all 26 of its feeds are crypto), and equity prices exist only as Data
 * Streams — which is a paid subscription and whose on-chain StreamsLookup
 * pattern X Layer does not support. So this posts the print itself, and posts
 * the provenance with it: the source string and the venue's own timestamp go
 * on chain and onto the receipt, so a user can check the number against the
 * exchange rather than trust us.
 *
 * `marketOpen` is computed from the venue's published regular session, not
 * from a clock in Solidity. NYSE/Nasdaq hours move with daylight saving and a
 * holiday calendar; reimplementing that on chain would be a second source of
 * truth that silently drifts from the first.
 *
 *   npx hardhat run scripts/relayer.js --network xlayerTestnet
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const SYMBOL = process.env.STOCK_SYMBOL || "AAPL";
const EVERY_MS = Number(process.env.RELAY_INTERVAL_MS || 60_000);
const ONCE = process.env.RELAY_ONCE === "1";

async function fetchPrint(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 polaris-relayer" } });
  if (!res.ok) throw new Error(`quote http ${res.status}`);
  const meta = (await res.json())?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error("no price in response");

  const now = Math.floor(Date.now() / 1000);
  const reg = meta.currentTradingPeriod?.regular;
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

async function main() {
  const file = path.join(__dirname, "..", "deployments", `polaris-${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`no deployment for ${network.name}; run deploy-polaris.js first`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const oracle = await ethers.getContractAt("StockPriceOracle", dep.contracts.oracle);
  const stock = dep.contracts.stock;
  const [signer] = await ethers.getSigners();
  console.log(`relayer ${signer.address}\noracle  ${dep.contracts.oracle}\nstock   ${stock}\nsymbol  ${SYMBOL}\n`);

  const tick = async () => {
    try {
      const p = await fetchPrint(SYMBOL);
      const age = Math.floor(Date.now() / 1000) - p.printedAt;
      const tx = await oracle.postPrice(stock, p.usdPerShare, p.printedAt, p.marketOpen, p.source);
      await tx.wait();
      console.log(
        `${new Date().toISOString()}  $${p.human}  ${p.marketOpen ? "OPEN " : "CLOSED"}  print ${age}s old  ${p.source}  tx ${tx.hash}`
      );
    } catch (e) {
      // A relayer that dies on one bad response stops the whole book. Log and
      // carry on; the oracle's own staleness bound is what protects borrowers
      // if this stays broken.
      console.error(`${new Date().toISOString()}  relay failed: ${e.message}`);
    }
  };

  await tick();
  if (ONCE) return;
  setInterval(tick, EVERY_MS);
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
