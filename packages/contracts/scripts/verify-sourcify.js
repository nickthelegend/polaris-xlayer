/**
 * Publish the contract source, without an explorer key.
 *
 * Every deployed contract read "Contract source code unverified" on OKLink,
 * which meant the most load-bearing part of this project — the engine, the
 * oracle's two staleness bounds, the partial-liquidation maths — was the one
 * part nobody could read. OKLink's verify endpoint needs an API key that does
 * not exist in this repository. Sourcify supports X Layer testnet (1952) and
 * mainnet (196), takes no key at all, and serves a full-matched source bundle
 * to anyone. Hardhat's own Sourcify plugin talks to a legacy path that now
 * answers HTML, so this posts to the v2 API directly.
 *
 *   node scripts/verify-sourcify.js
 */
const fs = require("fs");
const path = require("path");
const glob = require("glob");

const CHAIN = Number(process.env.CHAIN_ID || 1952);
const SOURCIFY = "https://sourcify.dev/server";

/**
 * Sourcify resets a connection now and then, and a verification run that dies
 * halfway leaves some contracts published and others not — which is worse than
 * not having run it, because the gap is invisible.
 */
async function http(url, init, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

const deployment = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "deployments", "polaris-xlayerTestnet.json"), "utf8")
);

/** Deployed address -> the fully-qualified contract Sourcify should match it against. */
const TARGETS = {
  [deployment.contracts.stock]: "contracts/polaris/TestnetStock.sol:TestnetStock",
  [deployment.contracts.stable]: "contracts/MockUSDC.sol:MockUSDC",
  [deployment.contracts.oracle]: "contracts/polaris/StockPriceOracle.sol:StockPriceOracle",
  [deployment.contracts.pool]: "contracts/polaris/LiquidityPool.sol:LiquidityPool",
  [deployment.contracts.engine]: "contracts/polaris/PolarisEngine.sol:PolarisEngine",
};

/**
 * Every build-info carrying a source, newest compile first.
 *
 * `glob` returns these in directory order, so taking the first match meant
 * submitting whichever compile happened to be listed first — which was the one
 * from before the oracle's circuit breaker was written. Sourcify then compared
 * stale source against fresh bytecode and reported no match, and the contract
 * silently stayed unverified. Newest first, and try each until one matches.
 */
function buildInfosFor(sourcePath) {
  return glob
    .sync(path.join(__dirname, "..", "artifacts", "build-info", "*.json"))
    .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ f }) => JSON.parse(fs.readFileSync(f, "utf8")))
    .filter((d) => d.input.sources[sourcePath]);
}

async function verify(address, identifier) {
  const [sourcePath] = identifier.split(":");
  const infos = buildInfosFor(sourcePath);
  if (infos.length === 0) return { address, identifier, ok: false, why: `no build-info carries ${sourcePath}` };

  let last = null;
  for (const info of infos) {
    const res = await http(`${SOURCIFY}/v2/verify/${CHAIN}/${address}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stdJsonInput: info.input,
        compilerVersion: info.solcLongVersion,
        contractIdentifier: identifier,
      }),
    });
    const body = await res.json().catch(() => ({}));
    // 202 is "accepted for matching"; already-verified is equally a success.
    if (res.status === 202 || res.status === 200 || /already/i.test(body?.message || "")) {
      return { address, identifier, ok: true, status: res.status, body };
    }
    last = { address, identifier, ok: false, status: res.status, body };
    // A bytecode mismatch just means this was the wrong compile; try an older one.
  }
  return last;
}

/** Sourcify matches asynchronously, so a 202 is a receipt rather than a result. */
async function settle(address) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await http(`${SOURCIFY}/v2/contract/${CHAIN}/${address}`);
    const d = await r.json().catch(() => ({}));
    if (d.match) return d.match;
  }
  return null;
}

async function main() {
  console.log(`Sourcify, chain ${CHAIN}\n`);
  const pending = [];
  for (const [address, identifier] of Object.entries(TARGETS)) {
    const r = await verify(address, identifier);
    const name = identifier.split(":")[1];
    if (r.ok) {
      console.log(`  submitted  ${name} ${address}`);
      pending.push([name, address]);
    } else {
      const why = r.body?.message || r.why || `HTTP ${r.status}`;
      // An already-verified contract is a success, not a failure.
      if (/already/i.test(why)) { console.log(`  already    ${name} ${address}`); pending.push([name, address]); }
      else console.log(`  FAILED     ${name} ${address} — ${why}`);
    }
  }

  console.log("\nwaiting for matches…\n");
  let good = 0;
  for (const [name, address] of pending) {
    const match = await settle(address);
    if (match) { good++; console.log(`  ${match.padEnd(14)} ${name}  https://repo.sourcify.dev/${CHAIN}/${address}`); }
    else console.log(`  no match yet   ${name} ${address}`);
  }
  console.log(`\n${good}/${Object.keys(TARGETS).length} verified`);
}

main().catch((e) => { console.error(e); process.exit(1); });
