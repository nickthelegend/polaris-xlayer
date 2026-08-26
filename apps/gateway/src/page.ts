import type { Order } from "./solana-pay.ts";

const usd = (raw: bigint) => {
  const whole = raw / 1_000_000n;
  const frac = (raw % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString()}.${frac}`;
};

/**
 * The merchant-facing side of a Solana Pay checkout: a QR, and enough of the
 * terms beside it that scanning is an informed act rather than a leap.
 *
 * Server-rendered with no client JavaScript at all. A checkout screen that
 * cannot render without a bundle is a checkout screen that fails on the
 * venue's wifi.
 */
export function checkoutPage(p: {
  qr: string;
  solanaPayUrl: string;
  requestUrl: string;
  order: Order;
  owed: bigint;
  merchantName: string;
  cluster: string;
}): string {
  const each = p.owed / BigInt(p.order.installmentCount);
  const interest = p.owed - p.order.amount;
  const days = Math.round(p.order.intervalSeconds / 86_400);
  const every =
    p.order.intervalSeconds >= 86_400
      ? `every ${days} day${days === 1 ? "" : "s"}`
      : `every ${p.order.intervalSeconds}s`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(p.merchantName)} — Polaris checkout</title>
<style>
  :root{--bg:#070a08;--panel:#0d120f;--line:#1d2620;--ink:#eaf2ec;--dim:#8fa396;--lime:#c8f751}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,-apple-system,"Segoe UI",sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{width:min(100%,460px);background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:28px}
  .eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
  h1{margin:8px 0 2px;font-size:26px;letter-spacing:-.02em}
  .total{font-size:40px;font-weight:600;letter-spacing:-.03em;margin:14px 0 2px}
  .total span{font-size:16px;color:var(--dim);font-weight:400}
  .qr{background:#fff;border-radius:16px;padding:14px;margin:22px 0;display:flex;justify-content:center}
  .qr svg{width:100%;height:auto;display:block}
  dl{margin:0;border-top:1px solid var(--line)}
  .row{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid var(--line);font-size:14px}
  .row dt{color:var(--dim);margin:0}
  .row dd{margin:0;text-align:right}
  .lime{color:var(--lime)}
  .hint{margin:20px 0 0;font-size:13px;color:var(--dim)}
  .url{margin-top:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dim);
       word-break:break-all;background:#0a0f0c;border:1px solid var(--line);border-radius:10px;padding:10px}
  a.btn{display:block;margin-top:16px;text-align:center;background:var(--lime);color:#0a0f0c;font-weight:600;
        text-decoration:none;padding:13px;border-radius:12px}
  @media (prefers-color-scheme: light){
    :root{--bg:#f6f8f6;--panel:#fff;--line:#e3e9e4;--ink:#0d120f;--dim:#5d6b62}
    .url{background:#f2f5f2}
  }
</style>
</head><body>
<div class="card">
  <p class="eyebrow">${escape(p.cluster)} · Solana Pay</p>
  <h1>${escape(p.merchantName)}</h1>
  <p class="total">${usd(p.order.amount)} <span>USDC</span></p>

  <div class="qr">${p.qr}</div>

  <dl>
    ${
      p.order.mode === "full"
        ? `<div class="row"><dt>Paying</dt><dd>In full, now</dd></div>`
        : `<div class="row"><dt>Plan</dt><dd>${p.order.installmentCount} payments of ${usd(each)}</dd></div>
           <div class="row"><dt>Collected</dt><dd>${escape(every)}</dd></div>
           <div class="row"><dt>Interest</dt><dd>${usd(interest)} USDC</dd></div>
           <div class="row"><dt>Total</dt><dd>${usd(p.owed)} USDC</dd></div>`
    }
    <div class="row"><dt>Network fee</dt><dd class="lime">Paid by Polaris</dd></div>
    <div class="row"><dt>Order</dt><dd>${escape(p.order.orderId)}</dd></div>
  </dl>

  <a class="btn" href="${escape(p.solanaPayUrl)}">Open in a wallet</a>
  <p class="hint">Scan with any Solana Pay wallet. Your limit is read from your
  wallet's own history — there is no application, and nothing is locked up front.</p>
  <p class="url">${escape(p.requestUrl)}</p>
</div>
</body></html>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}
