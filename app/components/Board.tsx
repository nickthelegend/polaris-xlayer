"use client";

import { useBoard, flip, roll } from "../lib/board";
import { APPS, PROGRAM_ID, Star } from "./Chrome";

/* The four instalments the program computes for a $200 checkout. */
const DEPARTURES = [
  ["1", "Sep 4", "50.38", "Scheduled"],
  ["2", "Sep 11", "50.38", "Scheduled"],
  ["3", "Sep 18", "50.38", "Scheduled"],
  ["4", "Sep 25", "50.38", "Scheduled"],
];

const MODES = [
  ["Pay in full", "Settles immediately", "One transfer, one signature."],
  ["Pay in 4", "Every 7 days, 10% APR", "The merchant is paid in full today; the four draws come later."],
  ["Subscribe", "Charges every period", "A PDA seeded by (subscriber, plan) makes a double-subscribe impossible."],
];

const FACTORS = [
  ["Wallet age", "how long the address has existed"],
  ["Transactions signed", "what it has actually done"],
  ["Tokens held", "what it carries"],
  ["USDC on hand", "what it can cover today"],
];

/** A ruled row. The board is rules and columns — never a card. */
function Row({
  children,
  lit = false,
  collects = false,
}: {
  children: React.ReactNode;
  lit?: boolean;
  collects?: boolean;
}) {
  return (
    <div
      data-flap
      data-collect-row={collects ? "" : undefined}
      className={`flap row grid items-baseline gap-x-5 px-4 py-[calc(var(--div)*1.5)] ${lit ? "lit" : ""}`}
      style={{ gridTemplateColumns: "2.5rem 1fr auto 7.5rem" }}
    >
      {children}
    </div>
  );
}

export function Hall() {
  const ref = useBoard(({ gsap, root }) => {
    const tl = gsap.timeline();
    // The board wakes: the sign, then the destination, then the schedule.
    tl.fromTo("[data-flap='sign']", { opacity: 0 }, { opacity: 1, duration: 0.4 });
    flip(gsap, "[data-flap='dest']", { stagger: 0.08 });
    flip(gsap, "[data-flap='sub']", { delay: 0.42 });
    flip(gsap, "[data-flap='act']", { delay: 0.52, stagger: 0.05 });

    root.querySelectorAll<HTMLElement>("[data-board]").forEach((b) => {
      flip(gsap, b.querySelectorAll("[data-flap]"), { trigger: b });
    });

    /*
      The collection sequence — the page's one piece of explanatory motion.

      The section claims a draw was taken while nobody was looking. Rendering
      the rows already-collected asserts that; playing the collection shows it.
      Purpose is Explanation, which the frequency tier (a landing visit) and
      the surface mode (persuade) both allow.

      The rows are AUTHORED settled, so a page that never animates still tells
      the truth. The timeline rewinds them to Scheduled and plays forward, which
      is why every from-state here is explicit.
    */
    const collectRows = root.querySelectorAll<HTMLElement>("[data-collect-row]");
    if (collectRows.length) {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: collectRows[0].closest("[data-board]"),
          start: "top 74%",
          toggleActions: "play none none none",
        },
      });

      // rewind: the board as it stood before collection
      tl.set(collectRows, { "--lit-a": 0 } as gsap.TweenVars)
        .set(root.querySelectorAll("[data-collects]"), { color: "rgb(245 249 255 / 0.85)" })
        .set(root.querySelectorAll("[data-was]"), { opacity: 1 });

      collectRows.forEach((row, i) => {
        const at = 0.34 + i * 0.09;   // 90ms apart, the way a board updates
        tl.to(row.querySelectorAll("[data-collects]"),
              { color: "#bffa62", duration: 0.32, ease: "expo.out" }, at)
          .to(row.querySelector("[data-was]"),
              { opacity: 0, duration: 0.2, ease: "expo.out" }, at)
          .fromTo(row,
              { backgroundPosition: "-100% 0" },
              { backgroundPosition: "0% 0", duration: 0.42, ease: "expo.out" }, at);
      });
    }

    const total = root.querySelector<HTMLElement>("[data-roll='total']");
    if (total) roll(total, 201.53, { decimals: 2 });

    const score = root.querySelector<HTMLElement>("[data-roll='score']");
    if (score) roll(score, 520, { from: 300 });
    const book: [string, number][] = [
      ["financed", 240], ["collected", 23.18], ["outstanding", 218.57],
    ];
    book.forEach(([k, v]) => {
      const el = root.querySelector<HTMLElement>(`[data-roll='${k}']`);
      if (el) roll(el, v, { decimals: 2 });
    });
  });

  return (
    <main ref={ref as React.Ref<HTMLElement>}>
      {/* ── The hall ─────────────────────────────────────────────────────── */}
      <section className="graticule border-b border-[var(--color-rule)] px-6 pt-[calc(var(--div)*13)] pb-[calc(var(--div)*7)]">
        <div className="mx-auto max-w-[1180px]">
          <div data-flap="sign" className="mb-[calc(var(--div)*3)] flex items-center gap-3">
            <Star size={26} />
            <span className="label">Polaris Pay · devnet</span>
          </div>

          <h1 className="destination max-w-[19ch] text-[clamp(2.75rem,8.5vw,6rem)]">
            <span data-flap="dest" className="flap block">Credit, built</span>
            <span data-flap="dest" className="flap block">into the payment.</span>
          </h1>

          <div className="mt-[calc(var(--div)*4)] grid gap-x-16 gap-y-8 md:grid-cols-[minmax(0,32rem)_auto] md:items-end">
            <p data-flap="sub" className="flap text-[17px] leading-[1.55] text-ink/60">
              Pay in full, subscribe, or split into four — against a line read
              from your wallet&rsquo;s own record. No application, no bureau,
              nothing you had to tell us.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <a
                data-flap="act"
                className="press flap bg-lamp px-6 py-3 font-medium text-hall transition-opacity hover:opacity-85"
                href={APPS.dashboard}
              >
                Open the app
              </a>
              <a
                data-flap="act"
                className="press flap border border-[var(--color-rule)] px-6 py-3 font-medium text-ink/80 transition-colors hover:border-ink/30 hover:text-ink"
                href={APPS.demo}
              >
                Try a checkout
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── The board ────────────────────────────────────────────────────── */}
      <section id="board" className="border-b border-[var(--color-rule)] px-6 py-[calc(var(--div)*8)]">
        <div className="mx-auto max-w-[1180px]">
          <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,26rem)_1fr]">
            <div>
              <h2 className="destination text-[clamp(1.9rem,3.4vw,2.75rem)]">
                Four departures, dated.
              </h2>
              <p className="mt-5 text-[15px] leading-relaxed text-ink/60">
                Split a{" "}
                <span className="figure text-ink">$200</span> purchase and it
                becomes four draws of{" "}
                <span className="figure text-ink">50.38</span>, seven days
                apart. You repay{" "}
                <span className="figure text-ink">201.53</span> — principal plus{" "}
                <span className="figure text-dim">1.53</span> pro-rated over 28
                days. The merchant is paid{" "}
                <span className="figure text-ink">200.00</span> today and carries
                none of it.
              </p>
            </div>

            {/* the board proper */}
            <div data-board className="border border-[var(--color-rule)]">
              <div
                className="row grid gap-x-5 bg-panel px-4 py-[calc(var(--div))]"
                style={{ gridTemplateColumns: "2.5rem 1fr auto 7.5rem" }}
              >
                <span className="label">No</span>
                <span className="label">Draw</span>
                <span className="label text-right">Amount</span>
                <span className="label">Status</span>
              </div>

              {DEPARTURES.map(([no, date, amt, status]) => (
                <Row key={no}>
                  <span className="figure text-sm text-ink/35">{no}</span>
                  <span className="text-[15px] text-ink/85">{date}</span>
                  <span className="figure text-right text-[15px]">{amt}</span>
                  <span className="label !text-ink/50">{status}</span>
                </Row>
              ))}

              <div
                className="grid gap-x-5 border-t border-[var(--color-rule)] bg-panel px-4 py-[calc(var(--div)*1.5)]"
                style={{ gridTemplateColumns: "2.5rem 1fr auto 7.5rem" }}
              >
                <span />
                <span className="label self-center">Total repaid</span>
                <span data-roll="total" className="figure text-right text-[21px]">
                  201.53
                </span>
                <span />
              </div>
            </div>
          </div>

          {/* modes, as ruled rows rather than three identical cards */}
          <div data-board className="mt-[calc(var(--div)*6)] border-t border-[var(--color-rule)]">
            {MODES.map(([name, terms, note], i) => (
              <div
                key={name}
                data-flap
                className={`flap row grid items-baseline gap-x-8 gap-y-2 px-1 py-[calc(var(--div)*2.5)] md:grid-cols-[14rem_11rem_1fr] ${
                  i === 1 ? "lit" : ""
                }`}
              >
                <span className={`text-[19px] font-medium ${i === 1 ? "text-lamp" : ""}`}>
                  {name}
                </span>
                <span className="label !text-ink/45">{terms}</span>
                <span className="text-[15px] leading-relaxed text-ink/60">{note}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The limit ────────────────────────────────────────────────────── */}
      <section id="limit" className="graticule border-b border-[var(--color-rule)] px-6 py-[calc(var(--div)*8)]">
        <div className="mx-auto max-w-[1180px]">
          <h2 className="destination max-w-[16ch] text-[clamp(1.9rem,3.4vw,2.75rem)]">
            Read from the wallet, not from paperwork.
          </h2>

          <div className="mt-[calc(var(--div)*5)] grid gap-x-16 gap-y-12 lg:grid-cols-[auto_1fr] lg:items-start">
            {/* the reading, at extreme scale against tiny labels */}
            <div className="flex items-baseline gap-5">
              <span
                data-roll="score"
                className="figure block text-[clamp(5rem,14vw,9.5rem)] leading-[0.8] text-lamp"
              >
                520
              </span>
              <span className="label whitespace-nowrap">
                of 300 — 850
              </span>
            </div>

            <div data-board className="border-t border-[var(--color-rule)]">
              {FACTORS.map(([name, note]) => (
                <div
                  key={name}
                  data-flap
                  className="flap row flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-1 py-[calc(var(--div)*1.75)] sm:grid sm:grid-cols-[13rem_1fr_auto]"
                >
                  <span className="text-[15px] text-ink/85">{name}</span>
                  <span className="text-sm text-ink/40">{note}</span>
                  <span className="figure text-sm text-ink/30">read</span>
                </div>
              ))}
              <div data-flap className="flap row flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-1 py-[calc(var(--div)*1.75)] sm:grid sm:grid-cols-[13rem_1fr_auto]">
                <span className="text-[15px] text-lamp">On-time instalment</span>
                <span className="text-sm text-ink/40">a late one costs 40</span>
                <span className="figure text-sm text-lamp">+12</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Collection ───────────────────────────────────────────────────── */}
      <section id="collection" className="border-b border-[var(--color-rule)] px-6 py-[calc(var(--div)*8)]">
        <div className="mx-auto max-w-[1180px] grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,30rem)_1fr] lg:items-start">
          <div>
            <h2 className="destination text-[clamp(1.9rem,3.4vw,2.75rem)]">
              Draw two was taken while the phone was face down.
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-ink/60">
              At checkout the buyer authorises once. Each instalment is drawn
              later without them being online — an SPL delegate, decremented
              automatically on use, so the allowance cannot be spent twice.
            </p>
            <a
              href={APPS.docs}
              className="mt-6 inline-block text-sm text-lamp underline decoration-lamp/40 hover:decoration-lamp"
            >
              How collection works
            </a>
          </div>

          {/* the row as it reads after collection — the board's lit state */}
          <div data-board className="border border-[var(--color-rule)]">
            <div
              className="row grid gap-x-5 bg-panel px-4 py-[calc(var(--div))]"
              style={{ gridTemplateColumns: "2.5rem 1fr auto 7.5rem" }}
            >
              <span className="label">No</span>
              <span className="label">Draw</span>
              <span className="label text-right">Amount</span>
              <span className="label">Status</span>
            </div>
            {[
              ["1", "Sep 4", "50.38", true],
              ["2", "Sep 11", "50.38", true],
              ["3", "Sep 18", "50.38", false],
              ["4", "Sep 25", "50.38", false],
            ].map(([no, date, amt, done]) => (
              <Row key={no as string} lit={done as boolean} collects={done as boolean}>
                <span className="figure text-sm text-ink/35">{no as string}</span>
                <span
                  data-collects={done ? "" : undefined}
                  className={`text-[15px] ${done ? "text-lamp" : "text-ink/85"}`}
                >
                  {date as string}
                </span>
                <span
                  data-collects={done ? "" : undefined}
                  className={`figure text-right text-[15px] ${done ? "text-lamp" : ""}`}
                >
                  {amt as string}
                </span>
                {/* The status carries both words: the timeline crossfades one
                    into the other in place, so the column never reflows. */}
                <span className="relative block">
                  <span className={`label ${done ? "!text-lamp" : "!text-ink/50"}`}>
                    {done ? "Collected" : "Scheduled"}
                  </span>
                  {done ? (
                    <span
                      data-was
                      className="label absolute inset-0 !text-ink/50"
                      aria-hidden
                    >
                      Scheduled
                    </span>
                  ) : null}
                </span>
              </Row>
            ))}
            <div className="grid gap-x-6 border-t border-[var(--color-rule)] bg-panel px-4 py-[calc(var(--div)*1.5)] sm:grid-cols-3">
              {[
                ["No signature", "the buyer is not prompted"],
                ["No network fee", "the keeper is fee payer"],
                ["Lands once", "replay protection is native"],
              ].map(([t, n]) => (
                <div key={t}>
                  <p className="text-[13px] text-ink/85">{t}</p>
                  <p className="mt-1 text-[11px] leading-snug text-ink/40">{n}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Merchants ────────────────────────────────────────────────────── */}
      <section id="merchants" className="graticule border-b border-[var(--color-rule)] px-6 py-[calc(var(--div)*8)]">
        <div className="mx-auto max-w-[1180px] grid gap-x-16 gap-y-10 lg:grid-cols-2 lg:items-start">
          <div>
            <h2 className="destination text-[clamp(1.9rem,3.4vw,2.75rem)]">
              Paid in full, up front.
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-ink/60">
              You are paid the whole amount on the day of the sale. The
              instalments are Polaris&rsquo;s problem — and a payment PDA seeded
              by{" "}
              <span className="figure text-ink/80">(merchant, order_ref)</span>{" "}
              makes a retried checkout idempotent rather than a double charge.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-ink/40">
              Nothing here needs a key. A merchant&rsquo;s trade is public state
              under their own address, so the book below is read straight from
              chain.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href={APPS.merchant} className="press bg-lamp px-5 py-2.5 text-sm font-medium text-hall transition-opacity hover:opacity-85">
                Open your book
              </a>
              <a href={APPS.demo} className="press border border-[var(--color-rule)] px-5 py-2.5 text-sm font-medium text-ink/80 transition-colors hover:border-ink/30 hover:text-ink">
                See a live checkout
              </a>
            </div>
          </div>

          <div data-board className="border-t border-[var(--color-rule)]">
            {[
              ["Financed", "financed", "written to date"],
              ["Collected", "collected", "drawn from buyers so far"],
              ["Outstanding", "outstanding", "still to come in"],
            ].map(([label, key, note]) => (
              <div
                key={key}
                data-flap
                className="flap row grid items-baseline gap-x-6 px-1 py-[calc(var(--div)*2)] sm:grid-cols-[10rem_1fr_auto]"
              >
                <span className="label">{label}</span>
                <span className="text-sm text-ink/40">{note}</span>
                <span data-roll={key} className="figure text-right text-[28px]">
                  0.00
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The app ──────────────────────────────────────────────────────
           What is actually behind "Open the app". Four surfaces, named the
           way the routes are named, so the page does not promise a product
           tour that the dashboard does not have. */}
      <section id="app" className="border-b border-[var(--color-rule)] px-6 py-[calc(var(--div)*8)]">
        <div className="mx-auto max-w-[1180px] grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,26rem)_1fr] lg:items-start">
          <div>
            <h2 className="destination text-[clamp(1.9rem,3.4vw,2.75rem)]">
              Open it and it already knows you.
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-ink/60">
              There is no sign-up screen because there is no account. Connect a
              wallet and the app underwrites it on the spot from its own record,
              then shows you the same four things every time: what you can
              spend, what you owe, where it works, and how to get test funds.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href={APPS.dashboard} className="press bg-lamp px-5 py-2.5 text-sm font-medium text-hall transition-opacity hover:opacity-85">
                Open the app
              </a>
              <a href={APPS.docs} className="press border border-[var(--color-rule)] px-5 py-2.5 text-sm font-medium text-ink/80 transition-colors hover:border-ink/30 hover:text-ink">
                Read the docs
              </a>
            </div>
          </div>

          <div data-board className="border-t border-[var(--color-rule)]">
            {[
              ["Limit", "What the line is today, and the four factors that set it"],
              ["Plans", "Every schedule you are carrying, and the next draw on each"],
              ["Merchants", "Who accepts Polaris, and what they accept it for"],
              ["Faucet", "Devnet USDC, so the whole thing can be tried with nothing at stake"],
            ].map(([name, note]) => (
              <div
                key={name}
                data-flap
                className="flap row grid items-baseline gap-x-6 gap-y-1 px-1 py-[calc(var(--div)*1.75)] sm:grid-cols-[9rem_1fr]"
              >
                <span className="text-[19px] font-medium tracking-[-0.01em]">{name}</span>
                <span className="text-[15px] leading-relaxed text-ink/50">{note}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The pocket ───────────────────────────────────────────────────
           The Android build. Described by what its screens show, and the
           preview status is stated here rather than only on /download —
           a download page is not the place a reader first learns the app
           does not sign yet. */}
      <section id="mobile" className="graticule border-b border-[var(--color-rule)] px-6 py-[calc(var(--div)*8)]">
        <div className="mx-auto max-w-[1180px] grid gap-x-16 gap-y-10 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-start">
          <div data-board className="order-2 border-t border-[var(--color-rule)] lg:order-1">
            {[
              ["Line", "The credit orb, arced through the 300–850 band the program enforces"],
              ["Plans", "The ladder — lime where the plan is paid, hairline where it is not"],
              ["Pay", "The amount, and a card that shakes rather than a button that goes dead"],
              ["Activity", "Every collection the keeper wrote, newest first"],
              ["Scan", "The camera decodes a payment code; the frame is never stored"],
            ].map(([name, note]) => (
              <div
                key={name}
                data-flap
                className="flap row grid items-baseline gap-x-6 gap-y-1 px-1 py-[calc(var(--div)*1.75)] sm:grid-cols-[9rem_1fr]"
              >
                <span className="text-[19px] font-medium tracking-[-0.01em]">{name}</span>
                <span className="text-[15px] leading-relaxed text-ink/50">{note}</span>
              </div>
            ))}
          </div>

          <div className="order-1 lg:order-2">
            <h2 className="destination text-[clamp(1.9rem,3.4vw,2.75rem)]">
              The same board, in your pocket.
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-ink/60">
              An Android app built against this design language rather than a
              phone-shaped reinterpretation of it. The instalment maths is a
              direct port of the program&rsquo;s own{" "}
              <span className="figure text-ink/80">math.rs</span>, so the four
              draws it quotes are the four the keeper collects — not a rounded
              approximation that drifts by a base unit.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-ink/40">
              Build <span className="figure text-ink/60">0.1.0</span>, devnet. It
              signs through Mobile Wallet Adapter and reads live program state —
              verified on an iMin terminal opening a real line and quoting{" "}
              <span className="figure text-ink/60">4 × 50.38</span> against a
              $200 checkout.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="/download" className="press bg-lamp px-5 py-2.5 text-sm font-medium text-hall transition-opacity hover:opacity-85">
                Download for Android
              </a>
              <a href="/download" className="press border border-[var(--color-rule)] px-5 py-2.5 text-sm font-medium text-ink/80 transition-colors hover:border-ink/30 hover:text-ink">
                Everything else
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── The last board ───────────────────────────────────────────────── */}
      <section className="px-6 py-[calc(var(--div)*11)]">
        <div data-board className="mx-auto max-w-[1180px]">
          <h2 data-flap className="flap destination max-w-[15ch] text-[clamp(2.25rem,6vw,4.25rem)]">
            Credit, built into the payment.
          </h2>
          <div data-flap className="flap mt-[calc(var(--div)*3)] flex flex-wrap items-center gap-3">
            <a href={APPS.dashboard} className="press bg-lamp px-6 py-3 font-medium text-hall transition-opacity hover:opacity-85">
              Open the app
            </a>
            <a href={APPS.docs} className="press border border-[var(--color-rule)] px-6 py-3 font-medium text-ink/80 transition-colors hover:border-ink/30 hover:text-ink">
              Read the docs
            </a>
          </div>
          <p data-flap className="flap figure mt-[calc(var(--div)*4)] text-[11px] text-ink/25">
            devnet · <span className="break-all">{PROGRAM_ID}</span>
          </p>
        </div>
      </section>
    </main>
  );
}
