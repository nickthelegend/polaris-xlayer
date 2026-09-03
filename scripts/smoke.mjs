/**
 * The product-level checks, as something a machine runs.
 *
 * TEST-PLAN.md holds 84 items and every one of them was executed by hand,
 * which means nothing stops a change quietly breaking them between runs. These
 * are the ones that can be asserted from outside a browser: the API contract,
 * the redirects that keep already-printed merchant QR codes alive, and the
 * pages that have to answer at all.
 *
 *   node scripts/smoke.mjs                       # against production
 *   BASE=http://localhost:3200 node scripts/smoke.mjs
 *
 * Exits non-zero if anything fails, so CI can gate on it.
 */
const BASE = (process.env.BASE ?? "https://polaris-xlayer.vercel.app").replace(/\/$/, "");
const ADDRESS = process.env.SMOKE_ADDRESS ?? "0x0abcc45E20e1992502a1A9D1Fb2224295304eCe7";

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`);
  } else {
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`);
  }
}

const JSON_HEADERS = { "content-type": "application/json" };

async function req(path, init) {
  const res = await fetch(BASE + path, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not every response is JSON, and that is fine */
  }
  return { status: res.status, body, redirected: res.redirected, url: res.url };
}

const post = (path, payload, headers = {}) =>
  req(path, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

console.log(`\nPolaris smoke — ${BASE}\n`);

console.log("API");
{
  const s = await req(`/api/stock/state?address=${ADDRESS}`);
  check(
    "state names the viewer it was asked about",
    s.status === 200 && s.body?.viewer?.address?.toLowerCase() === ADDRESS.toLowerCase(),
  );

  const anon = await req("/api/stock/state");
  check("state without an address impersonates nobody", anon.status === 200 && !anon.body?.viewer?.address);

  check("state rejects a non-address", (await req("/api/stock/state?address=garbage")).status === 400);

  const health = await req("/api/stock/health");
  const names = Object.keys(health.body?.checks ?? {});
  check(
    "health reports rpc, price and liquidity separately",
    [200, 503].includes(health.status) && ["rpc", "price", "liquidity"].every((k) => names.includes(k)),
    `ok=${health.body?.ok}`,
  );

  const quote = await post("/api/stock/quote", { shares: "2", tenorDays: 7 });
  const withinCeiling =
    quote.status === 200 &&
    BigInt(quote.body.maxBorrow) + BigInt(quote.body.feeOnMax) <=
      (BigInt(quote.body.collateralValue) * BigInt(quote.body.ltvBps)) / 10000n + 1n;
  check("a quote stays inside its own LTV ceiling", withinCeiling, `ltv=${quote.body?.ltvBps}`);

  for (const shares of ["0", "-1", "abc", "1e30"]) {
    check(`quote rejects shares=${shares}`, (await post("/api/stock/quote", { shares, tenorDays: 7 })).status === 400);
  }
  check(
    "quote rejects a tenor outside 7-14 days",
    (await post("/api/stock/quote", { shares: "2", tenorDays: 3 })).status === 400,
  );
  check("quote rejects malformed JSON", (await post("/api/stock/quote", "{bad")).status === 400);

  check("the price relay needs the operator key", (await post("/api/stock/price", { mode: "relay" })).status === 401);
  check(
    "the price relay rejects a wrong key",
    (await post("/api/stock/price", { mode: "relay" }, { "x-relayer-key": "not-it" })).status === 401,
  );

  for (const gone of ["/api/stock/checkout", "/api/stock/repay", "/api/stock/faucet"]) {
    check(`${gone} stays deleted`, (await post(gone, {})).status === 404);
  }

  const stats = await req("/api/global-stats");
  check("global stats report X Layer", stats.status === 200 && stats.body?.chainId === 1952);

  const merchants = await req("/api/merchants");
  const list = Array.isArray(merchants.body) ? merchants.body : merchants.body?.merchants;
  check("merchants returns a list", merchants.status === 200 && Array.isArray(list));

  check("keeper feed returns a list", Array.isArray((await req("/api/keeper/recent")).body?.actions));
  check("limits returns a score", "creditScore" in ((await req(`/api/limits?address=${ADDRESS}`)).body ?? {}));
  check("limits needs an address", (await req("/api/limits")).status === 400);
  check("credit profile answers", (await req(`/api/credit/me?address=${ADDRESS}`)).status === 200);
}

console.log("\nRedirects — already-printed merchant codes and bookmarks must not 404");
for (const [from, to] of [
  ["/credit", "/activity"],
  ["/plans", "/activity"],
  ["/limits", "/"],
  ["/stock/positions", "/activity"],
  ["/stock/merchant", "/merchant"],
  ["/stock", "/"],
]) {
  const res = await fetch(BASE + from);
  const landed = new URL(res.url).pathname;
  check(`${from} -> ${to}`, res.redirected && landed === to, landed);
}

console.log("\nPages");
for (const path of ["/", "/activity", "/merchant", "/docs", "/merchants", "/faucet", "/stock/book"]) {
  const res = await fetch(BASE + path);
  check(`${path} answers`, res.status === 200, `${res.status}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nfailed:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
