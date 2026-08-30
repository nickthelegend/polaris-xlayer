import type { Metadata } from "next";
import { Nav, Footer, APPS, PROGRAM_ID } from "../components/Chrome";

export const metadata: Metadata = {
  title: "Download",
  description:
    "The Polaris Pay Android build, the source, the mark and the launch film. Real artefacts — the APK on this page is the one that came out of the release build.",
};

/**
 * The departures board for files.
 *
 * Same four-column grammar as the schedule boards on the home page — name,
 * note, figure, status — because a download list is a board too: a row per
 * thing, a size where the amount goes, and a state at the right edge. Static
 * markup and no timeline: this is a Read surface like /about and /docs, and
 * the one authored moment on this site belongs to the schedule.
 */

/* Measured from the artefact in public/downloads, not estimated.
   shasum -a 256 public/downloads/polaris-0.1.0-arm64.apk */
const APK = {
  href: "/downloads/polaris-0.1.0-universal.apk",
  version: "0.1.0",
  size: "70.9 MB",
  sha256: "865113cf93fcd4a62c74f091e97174431a4d5e99737d171f6baad850822cd96a",
  pkg: "fun.polaris.app",
  abi: "arm64-v8a + armeabi-v7a",
  minSdk: "Android 7.0+",
};

function Spec({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="row grid grid-cols-[8.5rem_1fr] items-baseline gap-x-5 py-[calc(var(--div)*1.25)]">
      <span className="label">{k}</span>
      <span className={`${mono ? "figure" : ""} text-[13px] break-all text-ink/70`}>{v}</span>
    </div>
  );
}

export default function Download() {
  return (
    <>
      <Nav />
      <main className="px-6 pt-[calc(var(--div)*13)] pb-[calc(var(--div)*9)]">
        <div className="mx-auto max-w-[1180px]">
          <h1 className="destination max-w-[16ch] text-[clamp(2.25rem,6vw,4.25rem)]">
            Everything, as built.
          </h1>
          <p className="mt-6 max-w-[58ch] text-[17px] leading-[1.55] text-ink/60">
            The Android build below is the artefact the release build produced —
            not a placeholder and not a store listing that goes nowhere. Its
            size and checksum are read off the file this page serves.
          </p>

          {/* ── Android ──────────────────────────────────────────────────── */}
          <section className="mt-[calc(var(--div)*7)] border border-[var(--color-rule)]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 bg-panel px-4 py-[calc(var(--div)*1.25)]">
              <span className="label">Android · APK</span>
              <span className="label">Preview build</span>
            </div>

            <div className="grid gap-x-14 gap-y-9 px-4 py-[calc(var(--div)*3)] lg:grid-cols-[minmax(0,30rem)_1fr]">
              <div>
                <h2 className="text-[21px] font-medium tracking-[-0.02em]">
                  Polaris for Android
                </h2>
                <p className="mt-4 text-[15px] leading-[1.65] text-ink/60">
                  Four screens and a scanner: your line, the ladder of what is
                  owed and when, a pay flow, and the activity the keeper wrote.
                  The instalment maths is a direct port of{" "}
                  <span className="figure text-ink/80">programs/polaris/src/math.rs</span>,
                  so the four draws the app quotes are the four the keeper
                  collects.
                </p>

                <p className="mt-4 border-l border-lamp/40 pl-4 text-[15px] leading-[1.65] text-ink/60">
                  <span className="text-ink">Devnet only.</span> This build signs
                  through Mobile Wallet Adapter and reads live program state — it
                  was verified on an iMin terminal opening a real credit line
                  (score 520, limit 200.00) and quoting{" "}
                  <span className="figure text-ink/80">4 × 50.38</span> against a
                  $200 checkout. The funds are test funds; nothing here touches
                  mainnet.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <a
                    href={APK.href}
                    download
                    className="press bg-lamp px-6 py-3 font-medium text-hall transition-opacity hover:opacity-85"
                  >
                    Download APK · {APK.size}
                  </a>
                  <span className="figure text-[13px] text-ink/40">v{APK.version}</span>
                </div>
              </div>

              <div className="border-t border-[var(--color-rule)] lg:border-t-0">
                <Spec k="Version" v={`${APK.version} (versionCode 1)`} />
                <Spec k="Package" v={APK.pkg} />
                <Spec k="Architecture" v={`${APK.abi} — 64- and 32-bit phones`} />
                <Spec k="Requires" v={APK.minSdk} />
                <Spec k="Size" v={APK.size} />
                <Spec k="Permissions" v="Camera — decoding a payment code" />
                <Spec k="SHA-256" v={APK.sha256} />
              </div>
            </div>

            <div className="border-t border-[var(--color-rule)] px-4 py-[calc(var(--div)*2.5)]">
              <p className="label mb-3">Installing it</p>
              <ol className="grid gap-2 text-[15px] leading-[1.6] text-ink/60 sm:grid-cols-3 sm:gap-x-10">
                <li>
                  <span className="figure mr-2 text-ink/35">01</span>
                  Download the APK on the phone, or copy it across.
                </li>
                <li>
                  <span className="figure mr-2 text-ink/35">02</span>
                  Android will ask to allow installs from your browser — this
                  build is signed with a debug key, not a Play Store key.
                </li>
                <li>
                  <span className="figure mr-2 text-ink/35">03</span>
                  Open it. There is no account and no sign-up.
                </li>
              </ol>
              <p className="mt-5 text-[13px] leading-[1.6] text-ink/40">
                Verify what you downloaded before installing it:{" "}
                <span className="figure text-ink/60">
                  shasum -a 256 polaris-0.1.0-universal.apk
                </span>{" "}
                should print the digest above.
              </p>
            </div>
          </section>

          {/* ── Everything else ──────────────────────────────────────────── */}
          <section className="mt-[calc(var(--div)*7)]">
            <div className="flex items-baseline justify-between border-b border-[var(--color-rule)] pb-[calc(var(--div)*1.25)]">
              <h2 className="label">Everything else</h2>
              <span className="label">Size</span>
            </div>

            {[
              {
                name: "Launch film",
                note: "The 41s launch piece, 1080p H.264",
                size: "10.7 MB",
                href: "/launch.mp4",
                state: "Download",
                dl: true,
              },
              {
                name: "The mark",
                note: "The four-point star, 552 × 599 PNG with alpha",
                size: "166 KB",
                href: "/star.png",
                state: "Download",
                dl: true,
              },
              {
                name: "Source",
                note: "The Anchor program, the keeper, the apps and this site",
                size: "—",
                href: APPS.github,
                state: "GitHub",
                dl: false,
              },
              {
                name: "iOS",
                note: "The Expo project targets it; no signed build exists yet",
                size: "—",
                href: null,
                state: "Not built",
                dl: false,
              },
            ].map((r) => (
              <div
                key={r.name}
                className="row grid items-baseline gap-x-6 gap-y-1 py-[calc(var(--div)*2)] sm:grid-cols-[13rem_1fr_6rem_7rem]"
              >
                <span className="text-[19px] font-medium tracking-[-0.01em]">{r.name}</span>
                <span className="text-[15px] text-ink/50">{r.note}</span>
                <span className="figure text-ink/60 sm:text-right">{r.size}</span>
                {r.href ? (
                  <a
                    href={r.href}
                    {...(r.dl ? { download: true } : { target: "_blank", rel: "noreferrer" })}
                    className="press text-[13px] font-medium text-lamp underline-offset-4 hover:underline sm:text-right"
                  >
                    {r.state} →
                  </a>
                ) : (
                  <span className="label sm:text-right">{r.state}</span>
                )}
              </div>
            ))}
          </section>

          <p className="figure mt-[calc(var(--div)*6)] text-[11px] text-ink/25">
            devnet · <span className="break-all">{PROGRAM_ID}</span>
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
