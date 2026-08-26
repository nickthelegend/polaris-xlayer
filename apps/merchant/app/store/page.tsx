'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserProvider, Contract, formatUnits, parseUnits } from 'ethers';

import { useWallet } from '@/components/WalletProvider';

/**
 * A real storefront on the live contracts.
 *
 * The point of this page is to be the actual buyer journey, not a mock of one:
 * connect a wallet, have the chain tell you what you can afford, approve once,
 * and open a plan the keeper then collects on schedule. Every number on screen
 * is read from Sepolia and every button sends a real transaction.
 */

const CHAIN_ID = 11155111;
const CONTRACTS = {
  stablecoin: '0x49C86277a91002c4943837bf20F6ED41976Db09F',
  loanEngine: '0x21E9740DDe241f0653F699DAa206AfCE1FA25405',
  scoreManager: '0x81C333942eaEe7d3d724c6C2ea28100511934f3C',
  payments: '0x3BD1609abDC915eA9e01A399a26e2B8A2a06243f',
};

const ERC20 = [
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function faucet()',
];
const SCORES = [
  'function scoreOf(address) view returns (uint16)',
  'function creditLimitOf(address) view returns (uint256)',
];
const PAYMENTS = ['function pay(address,uint256,string) returns (bytes32)'];

/**
 * The gap between instalments, in seconds, and the single source of truth for
 * both the checkout request and the copy describing it. The engine enforces a
 * one-hour floor -- the guard that closed the intervalSeconds=0 exploit, where
 * a loan was interest-free and due in full at origination -- so hourly is the
 * shortest demonstrable term.
 *
 * It lived inline in the request body while the panel beside it promised "one a
 * fortnight", so the page described a schedule the code had never sent. Deriving
 * the wording from the constant means the two cannot drift apart again.
 */
const INSTALMENT_INTERVAL_SECONDS = 3600;

/**
 * The interval in words, in the two forms the copy needs: "in an hour" and
 * "every hour".
 */
function cadence(seconds: number): { after: string; every: string } {
  const units: Array<[number, string]> = [
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, name] of units) {
    if (seconds % size !== 0) continue;
    const n = seconds / size;
    const article = name === 'hour' ? 'an' : 'a';
    return n === 1
      ? { after: `${article} ${name}`, every: name }
      : { after: `${n} ${name}s`, every: `${n} ${name}s` };
  }
  return { after: `${seconds} seconds`, every: `${seconds} seconds` };
}

const INSTALMENT_CADENCE = cadence(INSTALMENT_INTERVAL_SECONDS);

type Product = { id: string; name: string; blurb: string; price: number };

const CATALOGUE: Product[] = [
  { id: 'SKU-KEYS', name: 'Mechanical keyboard', blurb: 'Hot-swap, tactile', price: 180 },
  { id: 'SKU-CANS', name: 'Studio headphones', blurb: 'Closed-back, 250Ω', price: 240 },
  { id: 'SKU-DESK', name: 'Standing desk', blurb: 'Electric, 120×70', price: 420 },
];

type Wallet = {
  address: string;
  balance: string;
  symbol: string;
  score: number;
  limit: string;
};

export default function Store() {
  const { address, connect, connecting, getProvider } = useWallet();
  const [wallet, setWallet] = useState<Wallet>();
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<{ kind: 'ok' | 'err' | 'info'; text: string; url?: string }>();
  const [selected, setSelected] = useState<Product>(CATALOGUE[0]!);
  const [mode, setMode] = useState<'now' | 'later'>('later');

  const perInstalment = useMemo(() => (selected.price / 4).toFixed(2), [selected]);

  const readWallet = useCallback(async (address: string, provider: BrowserProvider) => {
    const token = new Contract(CONTRACTS.stablecoin, ERC20, provider);
    const scores = new Contract(CONTRACTS.scoreManager, SCORES, provider);
    const [decimals, symbol, balance, score, limit] = await Promise.all([
      token.decimals(),
      token.symbol(),
      token.balanceOf(address),
      scores.scoreOf(address),
      scores.creditLimitOf(address),
    ]);
    setWallet({
      address,
      // formatUnits gives full precision, which renders a balance as
      // "9789145.412883" -- technically right and unreadable. Money is shown
      // the way money is written.
      balance: money(formatUnits(balance, decimals)),
      symbol,
      score: Number(score),
      limit: money(formatUnits(limit, decimals)),
    });
  }, []);

  // Whatever the connected address is -- connected here, connected from the
  // header, or switched in the wallet itself -- the panel re-reads the chain for
  // it. Account switching mid-session is the case that otherwise silently shows
  // one address's credit next to another address's balance.
  useEffect(() => {
    if (!address) {
      setWallet(undefined);
      return;
    }
    const provider = getProvider();
    if (!provider) return;
    let live = true;
    // Retry once before saying anything. A public RPC drops the occasional
    // read, and the panel going red over a blip -- while every number behind it
    // is fine -- reads as a broken product rather than a slow node.
    readWallet(address, provider)
      .catch(() => (live ? sleep(1200).then(() => readWallet(address, provider)) : undefined))
      .catch((err) => {
        if (live) setNote({ kind: 'err', text: readable(err) });
      });
    return () => {
      live = false;
    };
  }, [address, getProvider, readWallet]);

  /** Test tokens, so the flow is reachable without asking anyone for funds. */
  const claim = useCallback(async () => {
    const provider = getProvider();
    if (!provider || !wallet) return;
    try {
      setBusy('faucet');
      const signer = await provider.getSigner();
      const tx = await new Contract(CONTRACTS.stablecoin, ERC20, signer).faucet();
      await tx.wait();
      await readWallet(wallet.address, provider);
      setNote({ kind: 'ok', text: 'Claimed 1,000 test tokens.', url: explorer(tx.hash) });
    } catch (err) {
      setNote({ kind: 'err', text: readable(err) });
    } finally {
      setBusy(undefined);
    }
  }, [wallet, readWallet]);

  const buy = useCallback(async () => {
    const provider = getProvider();
    if (!provider || !wallet) return;
    const orderId = `${selected.id}-${Date.now()}`;

    try {
      const signer = await provider.getSigner();
      const token = new Contract(CONTRACTS.stablecoin, ERC20, signer);
      const decimals = await token.decimals();
      const total = parseUnits(String(selected.price), decimals);

      if (mode === 'now') {
        setBusy('buy');
        setNote({ kind: 'info', text: 'Approving the payment…' });
        if ((await token.allowance(wallet.address, CONTRACTS.payments)) < total) {
          await (await token.approve(CONTRACTS.payments, total)).wait();
        }
        setNote({ kind: 'info', text: 'Paying the merchant…' });
        const tx = await new Contract(CONTRACTS.payments, PAYMENTS, signer).pay(
          await merchantAddress(),
          total,
          orderId
        );
        await tx.wait();
        await readWallet(wallet.address, provider);
        setNote({ kind: 'ok', text: `Paid ${selected.price} in full.`, url: explorer(tx.hash) });
        return;
      }

      // Pay later. The buyer's only on-chain action is one approval covering
      // the full repayment; the plan itself is opened by the merchant's
      // backend, because createLoan is originator-gated on chain.
      setBusy('buy');
      const withInterest = (total * 110n) / 100n;
      if ((await token.allowance(wallet.address, CONTRACTS.loanEngine)) < withInterest) {
        setNote({ kind: 'info', text: 'Approve the repayment allowance in your wallet…' });
        await (await token.approve(CONTRACTS.loanEngine, withInterest)).wait();
      }

      setNote({ kind: 'info', text: 'Opening your payment plan…' });
      // The shop's own backend, which holds the merchant API key. Sending the
      // key from here would publish it to every visitor.
      const res = await fetch('/api/store/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          borrower: wallet.address,
          amount: String(selected.price),
          orderId,
          installments: 4,
          intervalSeconds: INSTALMENT_INTERVAL_SECONDS,
          chainId: CHAIN_ID,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Checkout failed (${res.status})`);

      await readWallet(wallet.address, provider);
      setNote({
        kind: 'ok',
        text: `Plan open. Loan #${body.loanId}, Instalments of ${perInstalment} are collected automatically.`,
        url: body.transactionHash ? explorer(body.transactionHash) : undefined,
      });
    } catch (err) {
      setNote({ kind: 'err', text: readable(err) });
    } finally {
      setBusy(undefined);
    }
  }, [wallet, selected, mode, perInstalment, readWallet]);

  const affordable = wallet
    ? Number.parseFloat(wallet.limit.replace(/,/g, '')) >= selected.price
    : true;

  return (
    <div className="min-h-screen bg-background font-display text-foreground">
      <main className="mx-auto max-w-[1180px] px-6 pb-24 pt-12 md:px-10">
        <header className="max-w-[52ch]">
          <p className="label">Demo store · live Sepolia</p>
          <h1 className="mt-4 text-[clamp(2rem,4.5vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
            Buy something on credit
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-foreground/55">
            Real contracts, real transactions. Nothing is locked up front, and the instalments
            collect themselves.
          </p>
        </header>

        {/* Catalogue beside the checkout, the way a shop actually reads: browse
            on the left, commit on the right, with the panel staying in view. */}
        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12 lg:items-start">
          <section aria-label="Products" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {CATALOGUE.map((p) => (
              <ProductTile
                key={p.id}
                product={p}
                selected={p.id === selected.id}
                onSelect={() => setSelected(p)}
              />
            ))}
          </section>

          <aside className="surface lg:sticky lg:top-24 p-6">
            {wallet ? (
              <>
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-base font-semibold">Checkout</h2>
                  <span className="font-mono text-[11px] text-foreground/60">
                    {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                  </span>
                </div>

                <p className="mt-1 text-sm text-foreground/55">{selected.name}</p>

                <div className="mt-6 space-y-3">
                  {/* Nothing is charged at checkout: the buyer signs an
                      allowance and the backend opens the plan, and buildInstallments
                      dates the first charge one full interval after origination.
                      The panel used to say "First today, then one a fortnight",
                      which got both the timing and the cadence wrong. */}
                  <PlanOption
                    selected={mode === 'later'}
                    onSelect={() => setMode('later')}
                    disabled={!affordable}
                    title={`4 payments of ${perInstalment}`}
                    caption={
                      affordable
                        ? `Nothing today. First in ${INSTALMENT_CADENCE.after}, then one every ${INSTALMENT_CADENCE.every}. Collected automatically.`
                        : `Above your ${wallet.limit} limit`
                    }
                    lead={perInstalment}
                    schedule={4}
                  />
                  <PlanOption
                    selected={mode === 'now'}
                    onSelect={() => setMode('now')}
                    title="Pay in full"
                    caption="One transaction, settled immediately."
                    lead={selected.price.toFixed(2)}
                    schedule={1}
                  />
                </div>

                <button
                  onClick={buy}
                  disabled={Boolean(busy) || (mode === 'later' && !affordable)}
                  className="mt-6 w-full rounded-[calc(var(--radius)-2px)] bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === 'buy'
                    ? 'Working…'
                    : mode === 'later'
                      ? 'Open plan, nothing due today'
                      : `Pay ${selected.price.toFixed(2)}`}
                </button>

                <dl className="mt-6 space-y-2.5 border-t border-foreground/8 pt-5 text-sm">
                  <Row term="Balance" value={`${wallet.balance} ${wallet.symbol}`} />
                  <Row term="Credit limit" value={wallet.limit} />
                  <Row term="Polaris score" value={String(wallet.score)} />
                </dl>

                <button
                  onClick={claim}
                  disabled={Boolean(busy)}
                  className="mt-4 w-full rounded-[calc(var(--radius)-2px)] border border-foreground/12 px-5 py-2.5 text-[13px] text-foreground/65 transition-colors hover:border-foreground/25 hover:text-foreground disabled:opacity-50"
                >
                  {busy === 'faucet' ? 'Claiming…' : 'Get test tokens'}
                </button>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold">Checkout</h2>
                <p className="mt-2 text-sm leading-relaxed text-foreground/55">
                  Connect a wallet to see what you can spend. Your limit is read from the chain,
                  not from a form.
                </p>
                <button
                  onClick={connect}
                  disabled={connecting}
                  className="mt-6 w-full rounded-[calc(var(--radius)-2px)] bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
                >
                  {connecting ? 'Connecting…' : 'Connect wallet'}
                </button>
                <p className="mt-4 text-xs leading-relaxed text-foreground/60">
                  Sepolia testnet. Nothing here moves real money.
                </p>
              </>
            )}

            {note && (
              <p
                className={`mt-5 text-[13px] leading-relaxed ${
                  note.kind === 'err'
                    ? 'text-rose-300'
                    : note.kind === 'ok'
                      ? 'text-primary'
                      : 'text-foreground/55'
                }`}
              >
                {note.text}{' '}
                {note.url && (
                  <a
                    href={note.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    View transaction
                  </a>
                )}
              </p>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

/**
 * A product. The price leads because the price is what the plan is built from,
 * and the split sits under it so the two are read as one offer rather than as a
 * figure and a footnote.
 */
function ProductTile({
  product,
  selected,
  onSelect,
}: {
  product: Product;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`surface surface-interactive flex w-full items-center gap-5 p-5 text-left ${
        selected ? 'surface-selected' : ''
      }`}
    >
      <ProductMark id={product.id} selected={selected} />

      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-tight">{product.name}</span>
        <span className="mt-1 block text-[13px] text-foreground/60">{product.blurb}</span>
      </span>

      <span className="shrink-0 text-right">
        <span className="figure block text-lg font-semibold">{product.price.toFixed(2)}</span>
        <span className="mt-0.5 block font-mono text-[11px] text-foreground/60">
          {(product.price / 4).toFixed(2)} × 4
        </span>
      </span>
    </button>
  );
}

/**
 * The product mark.
 *
 * Two initials in a box was honest -- there is no photography for this
 * catalogue, and a stock photo would have been a claim about goods that do not
 * exist -- but it left a shop looking like a spreadsheet. A drawing keeps the
 * honesty: nobody mistakes line art for a product shot, and it still gives each
 * row something to recognise before reading the label.
 *
 * Paths are on a 32x32 grid, stroked with `currentColor` so the selected state
 * inherits the accent rather than needing a second set of colours.
 */
function ProductMark({ id, selected }: { id: string; selected: boolean }) {
  const art: Record<string, React.ReactNode> = {
    'SKU-KEYS': (
      <>
        <rect x="3" y="10" width="26" height="15" rx="2.5" />
        <path d="M7 14h3M12 14h3M17 14h3M22 14h3M7 18h3M12 18h8M22 18h3M11 22h10" />
      </>
    ),
    'SKU-CANS': (
      <>
        <path d="M6 20v-4a10 10 0 0 1 20 0v4" />
        <rect x="3" y="19" width="6" height="9" rx="2.5" />
        <rect x="23" y="19" width="6" height="9" rx="2.5" />
      </>
    ),
    'SKU-DESK': (
      <>
        <path d="M3 12h26" />
        <path d="M7 12v16M25 12v16" />
        <path d="M7 20h18" />
      </>
    ),
  };

  return (
    <span
      aria-hidden
      className={`grid size-14 shrink-0 place-items-center rounded-[calc(var(--radius)-3px)] border transition-colors ${
        selected
          ? 'border-primary/40 bg-primary/12 text-primary'
          : 'border-foreground/10 bg-foreground/[0.04] text-foreground/35'
      }`}
    >
      <svg
        viewBox="0 0 32 32"
        className="size-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {art[id] ?? <circle cx="16" cy="16" r="10" />}
      </svg>
    </span>
  );
}

/**
 * The payment choice, which is the moment this product exists for. Each option
 * draws its own schedule, so splitting into four is something you can see
 * rather than a label you have to trust.
 */
function PlanOption({
  selected,
  onSelect,
  disabled,
  title,
  caption,
  lead,
  schedule,
}: {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title: string;
  caption: string;
  lead: string;
  schedule: number;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`surface surface-interactive w-full p-4 text-left disabled:cursor-not-allowed disabled:opacity-45 ${
        selected ? 'surface-selected' : ''
      }`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium leading-tight">{title}</span>
          <span className="mt-1 block text-xs leading-relaxed text-foreground/60">{caption}</span>
        </span>
        <span
          aria-hidden
          className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
            selected ? 'border-primary bg-primary' : 'border-foreground/25'
          }`}
        >
          {selected && <span className="size-1.5 rounded-full bg-primary-foreground" />}
        </span>
      </span>

      <span className="mt-3.5 flex gap-1" aria-hidden>
        {Array.from({ length: schedule }, (_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              selected ? (i === 0 ? 'bg-primary' : 'bg-primary/30') : 'bg-foreground/15'
            }`}
          />
        ))}
      </span>
      {/* A split plan takes nothing at checkout, so only the pay-in-full option
          can honestly say "today". The old line claimed the first instalment
          was charged on the spot for both. */}
      <span className="mt-2 block font-mono text-[11px] text-foreground/60">
        {schedule > 1 ? `Nothing today, then ${schedule} × ${lead}` : `${lead} today`}
      </span>
    </button>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-foreground/60">{term}</dt>
      <dd className="figure font-medium">{value}</dd>
    </div>
  );
}

const explorer = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

/** Two decimals, thousands separated. */
function money(raw: string): string {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : raw;
}

async function merchantAddress(): Promise<string> {
  const res = await fetch('/api/merchant/address');
  if (res.ok) {
    const body = await res.json();
    if (body.address) return body.address;
  }
  // Burn address, so a misconfigured demo cannot silently pay the wrong party.
  return '0x000000000000000000000000000000000000dEaD';
}

function readable(err: unknown): string {
  const raw =
    (err as { shortMessage?: string })?.shortMessage ?? (err as Error)?.message ?? String(err);
  if (/user rejected|user denied/i.test(raw)) return 'You cancelled the request.';
  if (/insufficient funds/i.test(raw)) return 'Not enough Sepolia ETH for the network fee.';
  if (/ExceedsCreditLimit/i.test(raw)) return 'This order is above your credit limit.';
  if (/DuplicatePayment/i.test(raw)) return 'This order has already been paid.';
  if (/FaucetCooldown/i.test(raw)) return 'The faucet allows one claim per hour.';
  if (/InsufficientAllowance/i.test(raw)) return 'Approve the allowance first, then try again.';
  // Anything left is an ethers or RPC internal ("missing revert data",
  // "could not coalesce error"). Those name a cause the shopper cannot act on,
  // so say what it means for them instead.
  if (/missing revert data|could not coalesce|CALL_EXCEPTION|network|fetch/i.test(raw)) {
    return 'Could not reach the network just now. Try again in a moment.';
  }
  return raw.length > 150 ? `${raw.slice(0, 147)}…` : raw;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
