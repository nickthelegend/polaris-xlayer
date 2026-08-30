"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

export const APPS = {
  dashboard: "https://dashboard.polarispay.app",
  merchant: "https://merchant.polarispay.app",
  demo: "https://demo-app.polarispay.app",
  docs: "https://docs.polarispay.app",
  github: "https://github.com/nickthelegend/polaris-solana",
} as const;

export const PROGRAM_ID = "CpRqbMywzAEKkEALZtrXqPYM36E5RrFewYnRtUYEEvUS";

/** The product's own mark, used as shipped — never redrawn, never recoloured. */
export function Star({ size = 24 }: { size?: number }) {
  return (
    <Image
      src="/star.png"
      alt=""
      width={Math.round(size * (552 / 599))}
      height={size}
      priority
    />
  );
}

/**
 * The hall sign.
 *
 * A board carries its own header rule and its status line. This is the sign
 * above the board: name at the left, the network it reads from at the right,
 * a hairline under the whole thing.
 */
export function Nav() {
  const [ruled, setRuled] = useState(false);
  useEffect(() => {
    const onScroll = () => setRuled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 bg-hall/92 backdrop-blur-sm transition-colors ${
        ruled ? "border-b border-[var(--color-rule)]" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-[1180px] items-center gap-6 px-6 py-[calc(var(--div)*1.5)]">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Polaris Pay">
          <Star size={20} />
          <span className="text-[15px] font-medium tracking-[-0.03em]">Polaris Pay</span>
        </Link>

        <nav className="ml-auto hidden items-center gap-6 md:flex">
          {[
            ["Board", "#board"],
            ["Limit", "#limit"],
            ["Collection", "#collection"],
            ["Merchants", "#merchants"],
            ["Mobile", "#mobile"],
          ].map(([t, href]) => (
            <a key={t} href={href} className="label transition-colors hover:text-ink">
              {t}
            </a>
          ))}
          <a href={APPS.docs} className="label transition-colors hover:text-ink">
            Docs
          </a>
          <Link href="/download" className="label transition-colors hover:text-ink">
            Download
          </Link>
        </nav>

        <a
          href={APPS.dashboard}
          className="press ml-auto bg-lamp px-4 py-2 text-[13px] font-medium text-hall transition-opacity hover:opacity-85 md:ml-0"
        >
          Open app
        </a>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-rule)]">
      <div className="mx-auto max-w-[1180px] px-6 py-[calc(var(--div)*5)]">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <span className="flex items-center gap-2.5">
              <Star size={18} />
              <span className="text-sm font-medium tracking-[-0.03em]">Polaris Pay</span>
            </span>
            <p className="mt-4 text-sm leading-relaxed text-ink/45">
              Pay in full, subscribe, or split into four against a line read from
              your wallet&rsquo;s own record.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-8 text-sm sm:grid-cols-4">
            {[
              ["Product", [["Dashboard", APPS.dashboard], ["Merchants", APPS.merchant], ["Demo store", APPS.demo]]],
              ["Get it", [["Android app", "/download"], ["All downloads", "/download"], ["Launch film", "/launch.mp4"]]],
              ["Build", [["Docs", APPS.docs], ["Source", APPS.github], ["About", "/about"]]],
              ["Legal", [["Privacy", "/privacy"]]],
            ].map(([heading, links]) => (
              <div key={heading as string}>
                <p className="label mb-3.5">{heading as string}</p>
                <ul className="space-y-2.5">
                  {(links as string[][]).map(([t, href]) => (
                    <li key={t}>
                      <a href={href} className="text-ink/55 transition-colors hover:text-ink">
                        {t}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-[var(--color-rule)] pt-7 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="figure text-[11px] text-ink/28">
            devnet · <span className="break-all">{PROGRAM_ID}</span>
          </p>
          <p className="label">Figures shown are program output</p>
        </div>
      </div>
    </footer>
  );
}
