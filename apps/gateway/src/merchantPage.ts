import type { MerchantBook, MerchantLoan } from "./merchant.ts";

/**
 * USDC to the nearest cent, rounded rather than truncated.
 *
 * Every figure on this page is money that has already moved or is already
 * owed, so cutting the fraction off understates it: a merchant who had
 * collected 401.415 was shown 401.41, a cent less than they were paid.
 * Truncation is the right rule for spending headroom — never offer more than
 * exists — and the wrong one for a statement of account.
 */
const usd = (raw: bigint) => {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const cents = (v + 5_000n) / 10_000n;
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole.toLocaleString()}.${frac}`;
};

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const ago = (unix: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
};

const STYLE = `
  :root{--bg:#070a08;--panel:#0d120f;--line:#1d2620;--ink:#eaf2ec;--dim:#8fa396;--lime:#c8f751;--blue:#7fd4ff;--red:#ff6b6b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,-apple-system,"Segoe UI",sans-serif;padding:28px 20px 64px}
  .wrap{width:min(100%,860px);margin:0 auto}
  .eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:0}
  h1{margin:6px 0 2px;font-size:30px;letter-spacing:-.02em}
  h2{margin:34px 0 12px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);font-weight:500}
  .mono{font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dim);word-break:break-all}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:22px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:18px}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
  .stat .k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
  .stat .v{font-size:26px;font-weight:600;letter-spacing:-.02em;margin-top:4px}
  .lime{color:var(--lime)} .blue{color:var(--blue)} .red{color:var(--red)} .dim{color:var(--dim)}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th{text-align:left;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);font-weight:500;padding:0 10px 10px 0}
  td{padding:11px 10px 11px 0;border-top:1px solid var(--line);font-size:14px;vertical-align:top}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  th.num{text-align:right}
  .pill{display:inline-block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:999px;border:1px solid var(--line)}
  .pill.active{color:var(--lime);border-color:#33471c}
  .pill.repaid{color:var(--blue);border-color:#1d3b4a}
  .pill.liquidated{color:var(--red);border-color:#4a1d1d}
  form{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;align-items:end}
  label{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:6px}
  input,select{width:100%;background:#0a0f0c;border:1px solid var(--line);color:var(--ink);border-radius:10px;padding:11px;font:15px inherit}
  button{background:var(--lime);color:#0a0f0c;font-weight:600;border:0;border-radius:10px;padding:12px 18px;font-size:15px;cursor:pointer}
  a{color:var(--lime)}
  .empty{color:var(--dim);font-size:14px;padding:18px 0}
  ul.plain{list-style:none;padding:0;margin:0}
  ul.plain li{border-top:1px solid var(--line);padding:14px 0;display:flex;justify-content:space-between;gap:16px;align-items:center}
  @media (prefers-color-scheme: light){
    :root{--bg:#f6f8f6;--panel:#fff;--line:#e3e9e4;--ink:#0d120f;--dim:#5d6b62}
    input,select{background:#f2f5f2}
  }
`;

function shell(title: string, cluster: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head><body><div class="wrap">
<p class="eyebrow">${escape(cluster)} · Polaris merchant</p>
${body}
</div></body></html>`;
}

/**
 * The merchant's own view of their trade.
 *
 * Server-rendered with no client JavaScript, for the same reason the checkout
 * page is: a dashboard that needs a bundle is a dashboard that fails on the
 * venue's wifi. Every figure is read from chain at request time — there is no
 * merchant database to fall out of step with it.
 */
export function merchantPage(p: { book: MerchantBook; cluster: string; origin: string }): string {
  const b = p.book;
  const rows = b.loans.length
    ? b.loans
        .map(
          (l: MerchantLoan) => `<tr>
      <td>#${l.id}<div class="mono">${escape(short(l.borrower))}</div></td>
      <td><span class="pill ${escape(l.status)}">${escape(l.status)}</span></td>
      <td class="num">${usd(l.principal)}</td>
      <td class="num">${l.installmentsPaid}/${l.installmentCount}</td>
      <td class="num">${usd(l.repaid)}</td>
      <td class="num">${usd(l.status === "active" ? l.owed - l.repaid : 0n)}</td>
      <td class="num dim">${escape(ago(l.startedAt))}</td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="7" class="empty">No plan has been financed against this merchant yet. Take a charge below and it will appear here.</td></tr>`;

  return shell(
    `${b.name} — Polaris merchant`,
    p.cluster,
    `<h1>${escape(b.name)}</h1>
<p class="mono">${escape(b.address)}${b.active ? "" : " · INACTIVE"}</p>

<div class="stats">
  <div class="stat"><div class="k">Financed</div><div class="v lime">${usd(b.financed)}</div></div>
  <div class="stat"><div class="k">Collected</div><div class="v">${usd(b.collected)}</div></div>
  <div class="stat"><div class="k">Outstanding</div><div class="v blue">${usd(b.outstanding)}</div></div>
  <div class="stat"><div class="k">Plans</div><div class="v">${b.loans.length}</div></div>
</div>

<h2>Take a payment</h2>
<div class="card">
  <form method="get" action="/checkout">
    <input type="hidden" name="merchant" value="${escape(b.address)}">
    <div><label for="usdc">Amount (USDC)</label><input id="usdc" name="usdc" value="25" inputmode="decimal"></div>
    <div><label for="mode">Mode</label><select id="mode" name="mode">
      <option value="later">Split into 4</option>
      <option value="now">Pay in full</option>
    </select></div>
    <div><label for="installments">Installments</label><input id="installments" name="installments" value="4" inputmode="numeric"></div>
    <div><label for="interval">Every (seconds)</label><input id="interval" name="interval" value="604800" inputmode="numeric"></div>
    <div><button type="submit">Show the code</button></div>
  </form>
  <p class="mono" style="margin-top:14px">Amount is in whole USDC. You are paid in full, up front; Polaris collects the instalments.</p>
</div>

<h2>The book</h2>
<table>
  <thead><tr>
    <th>Plan</th><th>Status</th><th class="num">Principal</th><th class="num">Paid</th>
    <th class="num">Collected</th><th class="num">Outstanding</th><th class="num">Opened</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

<h2>Settlement</h2>
<div class="card">
  <ul class="plain">
    <li><span class="dim">Paid out to</span><span class="mono">${escape(b.payout)}</span></li>
    <li><span class="dim">Settled lifetime, by the program</span><span>${usd(b.totalSettled)}</span></li>
    <li><span class="dim">Largest single order allowed</span><span>${usd(b.maxOrderValue)}</span></li>
    <li><span class="dim">Active · repaid · liquidated</span><span>${b.active_count} · ${b.repaid_count} · ${b.liquidated_count}</span></li>
  </ul>
</div>`
  );
}

/** The list a merchant lands on when they have not named themselves yet. */
export function merchantIndexPage(p: {
  merchants: { name: string; pda: string }[];
  cluster: string;
}): string {
  const list = p.merchants.length
    ? `<ul class="plain">${p.merchants
        .map(
          (m) =>
            `<li><a href="/merchant/${escape(m.pda)}">${escape(m.name)}</a><span class="mono">${escape(short(m.pda))}</span></li>`
        )
        .join("")}</ul>`
    : `<p class="empty">No merchant is registered on this deployment yet.</p>`;

  return shell(
    "Polaris merchant",
    p.cluster,
    `<h1>Your book</h1>
<p class="dim" style="margin-top:2px">Pick a merchant registered on this deployment, or open <span class="mono">/merchant/&lt;address&gt;</span> directly. Nothing here needs a key — a merchant's trade is public state under their own address.</p>
<h2>Registered on this deployment</h2>
<div class="card">${list}</div>`
  );
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}
