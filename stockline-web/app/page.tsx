"use client";
import { useCallback, useEffect, useState } from "react";

const usd = (v: string, d = 6) =>
  (Number(v) / 10 ** d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sh = (v: string) => (Number(v) / 1e18).toFixed(4);

export default function Checkout() {
  const [state, setState] = useState<any>(null);
  const [shares, setShares] = useState("10");
  const [ref, setRef] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/state", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErr(j.error); return; }
    setState(j);
  }, []);

  useEffect(() => {
    load();
    setRef("basket-" + Math.random().toString(36).slice(2, 8));
  }, [load]);

  const getQuote = async () => {
    setErr(null); setQuote(null); setBusy("quote");
    const r = await fetch("/api/quote", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shares, tenorDays: 7 }),
    });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) { setErr(j.error); return; }
    setQuote(j);
  };

  const pay = async () => {
    setErr(null); setBusy("pay"); setDone(null);
    const r = await fetch("/api/checkout", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shares, borrowAmount: quote.maxBorrow, orderRef: ref, tenorDays: 7 }),
    });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) { setErr(j.error); return; }
    setDone(j); setQuote(null);
    setRef("basket-" + Math.random().toString(36).slice(2, 8));
    load();
  };

  const faucet = async () => {
    setErr(null); setBusy("faucet");
    const r = await fetch("/api/faucet", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shares: 25 }),
    });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) { setErr(j.error); return; }
    load();
  };

  if (!state && !err) return <main className="wrap"><p className="soft" data-testid="loading">Reading X Layer…</p></main>;

  return (
    <main className="wrap">
      <p className="label">Stockline · X Layer</p>
      <h1>Spend the stock.<br />Don&rsquo;t sell the stock.</h1>
      <p className="lede">
        Pay the merchant in stablecoin against tokenized equity you keep. The shares lock,
        the merchant is paid now, and you still own the position.
      </p>

      {err && <div className="err" data-testid="error">{err}</div>}

      {state && (
        <>
          <div className="grid" style={{ marginTop: 32 }}>
            <div className="tile">
              <p className="label">{state.tokens.stockSymbol} price</p>
              <p className="fig lamp" data-testid="price">${usd(state.price.usdPerShare, 8)}</p>
              <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                {state.price.marketOpen ? "market open" : "market closed"} · {state.price.source}
              </p>
            </div>
            <div className="tile">
              <p className="label">You hold</p>
              <p className="fig" data-testid="shopper-shares">{sh(state.balances.shopperShares)}</p>
              <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{state.tokens.stockSymbol}</p>
            </div>
            <div className="tile">
              <p className="label">Pool available</p>
              <p className="fig dim" data-testid="pool-available">${usd(state.pool.available)}</p>
              <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>merchant is paid from here</p>
            </div>
            <div className="tile">
              <p className="label">Max LTV</p>
              <p className="fig">{state.price.marketOpen ? state.risk.maxLtvBps / 100 : (state.risk.maxLtvBps * (10000 - state.risk.closedMarketHaircutBps)) / 1e6}%</p>
              <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                {state.price.marketOpen ? "venue open" : `after-hours haircut applied`}
              </p>
            </div>
          </div>

          <div className="panel">
            <h2>Pay with stock credit</h2>
            <p className="soft" style={{ fontSize: 14, marginBottom: 20 }}>
              Merchant <span className="mono">{state.actors.merchant.slice(0, 10)}…</span>
            </p>

            <p className="label" style={{ marginBottom: 8 }}>Shares to lock</p>
            <input
              value={shares} onChange={(e) => { setShares(e.target.value); setQuote(null); }}
              inputMode="decimal" data-testid="shares-input" aria-label="Shares to lock"
            />

            <p className="label" style={{ margin: "20px 0 8px" }}>Order reference</p>
            <input
              value={ref} onChange={(e) => setRef(e.target.value)}
              data-testid="ref-input" aria-label="Order reference" style={{ fontSize: 15 }}
            />

            <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
              <button onClick={getQuote} disabled={!!busy} data-testid="quote-btn">
                {busy === "quote" ? "Quoting…" : "Get a quote"}
              </button>
              <button className="secondary" onClick={faucet} disabled={!!busy} data-testid="faucet-btn">
                {busy === "faucet" ? "Minting…" : "Get 25 test shares"}
              </button>
            </div>

            {quote && (
              <div style={{ marginTop: 28 }} data-testid="quote">
                <div className="row"><span className="soft">Collateral value</span><span className="mono">${usd(quote.collateralValue)}</span></div>
                <div className="row"><span className="soft">Ceiling at {quote.ltvBps / 100}% LTV</span><span className="mono">${usd(quote.maxBorrow)}</span></div>
                <div className="row"><span className="soft">Fee, 7 days</span><span className="mono">${usd(quote.feeOnMax)}</span></div>
                <div className="row">
                  <span>Merchant is paid</span>
                  <span className="mono lamp" style={{ fontSize: 20 }} data-testid="quote-pay">${usd(quote.maxBorrow)}</span>
                </div>
                <button onClick={pay} disabled={!!busy} style={{ marginTop: 20, width: "100%" }} data-testid="pay-btn">
                  {busy === "pay" ? "Signing on X Layer…" : `Pay $${usd(quote.maxBorrow)} with stock credit`}
                </button>
              </div>
            )}

            {done && (
              <div className="ok" data-testid="checkout-done">
                Loan #{done.loanId} opened. The merchant has been paid and your shares are locked.{" "}
                <a href={done.explorer} target="_blank" rel="noreferrer">View the transaction</a>
              </div>
            )}
          </div>

          <p className="faint" style={{ fontSize: 12, marginTop: 24 }}>
            Block {state.blockNumber} · engine <span className="mono">{state.addresses.engine}</span>
          </p>
          {state.standIns?.length > 0 && (
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }} data-testid="standins">
              Stand-ins on this network: {state.standIns.map((s: any) => s.what).join(", ")} — no real xStock or USDT0 exists on X Layer testnet.
            </p>
          )}
        </>
      )}
    </main>
  );
}
