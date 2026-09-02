"use client";
import { useCallback, useEffect, useState } from "react";

const usd = (v: string, d = 6) =>
  (Number(v) / 10 ** d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sh = (v: string) => (Number(v) / 1e18).toFixed(4);
const STATUS = ["None", "Active", "Repaid", "Liquidated", "Refunded"];

export default function Positions() {
  const [state, setState] = useState<any>(null);
  const [as, setAs] = useState("shopper");
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<any>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/state?as=${as}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErr(j.error); return; }
    setState(j);
  }, [as]);
  useEffect(() => { load(); }, [load]);

  const act = async (loanId: number, action: string) => {
    setErr(null); setOk(null); setBusy(loanId);
    const r = await fetch("/api/repay", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ loanId, action }),
    });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) { setErr(j.error); return; }
    setOk(j); load();
  };

  if (!state && !err) return <main className="wrap"><p className="soft">Reading X Layer…</p></main>;

  const loans = state?.loans ?? [];
  return (
    <main className="wrap">
      <p className="label">Stockline</p>
      <h1>Your positions</h1>
      <p className="lede">Every share you locked, what it is securing, and how much cover is left.</p>

      <div style={{ display: "flex", gap: 8, marginTop: 24 }} data-testid="actor-switch">
        {["shopper", "merchant", "liquidator"].map((r) => (
          <button key={r} onClick={() => setAs(r)}
            className={as === r ? "" : "secondary"}
            style={{ padding: "8px 16px", fontSize: 13, textTransform: "capitalize" }}
            data-testid={`as-${r}`}>
            {r}
          </button>
        ))}
      </div>

      {err && <div className="err" data-testid="error">{err}</div>}
      {ok && (
        <div className="ok" data-testid="action-done">
          {ok.action} confirmed. <a href={ok.explorer} target="_blank" rel="noreferrer">View the transaction</a>
        </div>
      )}

      {loans.length === 0 ? (
        <div className="panel" data-testid="empty">
          <h2>Nothing locked yet</h2>
          <p className="soft" style={{ marginTop: 8, fontSize: 15 }}>
            This account has no positions. When you pay a merchant with stock credit,
            the position shows up here. <a href="/">Go to checkout</a>.
          </p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          <table data-testid="positions-table">
            <thead>
              <tr>
                <th>#</th><th>Shares</th><th>Owed</th><th>Health</th><th>Due</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l: any) => (
                <tr key={l.id} data-testid={`loan-${l.id}`}>
                  <td className="mono">{l.id}</td>
                  <td className="mono">{sh(l.shares)}</td>
                  <td className="mono">{l.status === 1 ? `$${usd(l.owed)}` : "—"}</td>
                  <td className={`mono ${l.healthFactor && Number(l.healthFactor) < 1 ? "red" : "lamp"}`}>
                    {l.status === 1 ? (l.healthFactor ?? "unpriced") : "—"}
                  </td>
                  <td className="mono faint">{new Date(l.dueAt * 1000).toISOString().slice(0, 10)}</td>
                  <td>
                    <span className={`pill ${l.status === 1 ? "lamp" : l.status === 3 ? "red" : "soft"}`}>
                      {STATUS[l.status]}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {l.status === 1 && (
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button onClick={() => act(l.id, "repay")} disabled={busy !== null}
                          style={{ padding: "8px 14px", fontSize: 13 }} data-testid={`repay-${l.id}`}>
                          {busy === l.id ? "…" : "Repay"}
                        </button>
                        <button className="secondary" onClick={() => act(l.id, "refund")} disabled={busy !== null}
                          style={{ padding: "8px 14px", fontSize: 13 }} data-testid={`refund-${l.id}`}>
                          Refund
                        </button>
                        {l.liquidatable && (
                          <button className="secondary" onClick={() => act(l.id, "liquidate")} disabled={busy !== null}
                            style={{ padding: "8px 14px", fontSize: 13, borderColor: "var(--red)", color: "var(--red)" }}
                            data-testid={`liquidate-${l.id}`}>
                            Liquidate
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state && (
        <p className="faint" style={{ fontSize: 12, marginTop: 24 }}>
          Block {state.blockNumber} · {state.viewer.role} <span className="mono">{state.viewer.address}</span>
        </p>
      )}
    </main>
  );
}
