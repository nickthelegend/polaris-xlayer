"use client";
import { useCallback, useEffect, useState } from "react";

const usd = (v: string, d = 6) =>
  (Number(v) / 10 ** d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Admin() {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<any>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/state", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErr(j.error); return; }
    setState(j);
  }, []);
  useEffect(() => { load(); }, [load]);

  const post = async (mode: string, pct?: number) => {
    setErr(null); setOk(null); setBusy(mode + (pct ?? ""));
    const r = await fetch("/api/price", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, pct }),
    });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) { setErr(j.error); return; }
    setOk(j); load();
  };

  if (!state && !err) return <main className="wrap"><p className="soft">Reading X Layer…</p></main>;

  return (
    <main className="wrap">
      <p className="label">Stockline</p>
      <h1>The book &amp; the price</h1>
      <p className="lede">
        What the pool has lent, what it has earned, and the print every position is valued against.
      </p>

      {err && <div className="err" data-testid="error">{err}</div>}
      {ok && (
        <div className="ok" data-testid="price-done">
          Posted ${usd(ok.usdPerShare, 8)} — {ok.source}.{" "}
          <a href={ok.explorer} target="_blank" rel="noreferrer">View the transaction</a>
        </div>
      )}

      {state && (
        <>
          <div className="grid" style={{ marginTop: 32 }}>
            <div className="tile">
              <p className="label">Available</p>
              <p className="fig dim" data-testid="pool-available">${usd(state.pool.available)}</p>
            </div>
            <div className="tile">
              <p className="label">Out on loan</p>
              <p className="fig" data-testid="pool-outstanding">${usd(state.pool.outstanding)}</p>
            </div>
            <div className="tile">
              <p className="label">Earned</p>
              <p className="fig lamp" data-testid="pool-earned">${usd(state.pool.earned)}</p>
            </div>
            <div className="tile">
              <p className="label">Shares held</p>
              <p className="fig" data-testid="engine-shares">{(Number(state.balances.engineShares) / 1e18).toFixed(4)}</p>
            </div>
          </div>

          <div className="panel">
            <h2>The print</h2>
            <div className="row"><span className="soft">Price</span><span className="mono lamp" data-testid="admin-price">${usd(state.price.usdPerShare, 8)}</span></div>
            <div className="row"><span className="soft">Source</span><span className="mono" data-testid="admin-source">{state.price.source}</span></div>
            <div className="row"><span className="soft">Venue</span><span className="mono">{state.price.marketOpen ? "open" : "closed"}</span></div>
            <div className="row"><span className="soft">Age</span><span className="mono">{state.price.ageSeconds}s</span></div>
            <div className="row"><span className="soft">Usable</span><span className={`mono ${state.price.fresh ? "lamp" : "red"}`} data-testid="admin-fresh">{state.price.fresh ? "yes" : "stale"}</span></div>

            <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
              <button onClick={() => post("relay")} disabled={!!busy} data-testid="relay-btn">
                {busy === "relay" ? "Fetching…" : "Relay the live print"}
              </button>
              <button className="secondary" onClick={() => post("move", -45)} disabled={!!busy} data-testid="crash-btn">
                Move the price −45%
              </button>
              <button className="secondary" onClick={() => post("move", 20)} disabled={!!busy} data-testid="rally-btn">
                Move the price +20%
              </button>
            </div>
            <p className="faint" style={{ fontSize: 12, marginTop: 16 }}>
              A moved price is labelled as a demo move on chain, so it can never be mistaken for a real quote.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
