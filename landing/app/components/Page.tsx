import { Nav, Footer } from "./Chrome";

/**
 * The reading shell.
 *
 * Read-mode surfaces on this board: the rules and the measure come with us,
 * the schedule does not. No eyebrow above the heading — the heading carries
 * its own weight, and a kicker is the one device the craft floor bans outright.
 */
export function Page({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Nav />
      <main className="px-6 pt-[calc(var(--div)*13)] pb-[calc(var(--div)*9)]">
        <article className="mx-auto max-w-[62ch]">
          <h1 className="destination text-[clamp(2rem,5vw,3.25rem)]">{title}</h1>
          {lede && (
            <p className="mt-6 text-[17px] leading-[1.6] text-ink/60">{lede}</p>
          )}
          <div className="mt-[calc(var(--div)*6)] space-y-[calc(var(--div)*5)]">
            {children}
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}

export function Block({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--color-rule)] pt-[calc(var(--div)*3)]">
      <h2 className="text-[21px] font-medium tracking-[-0.02em]">{heading}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-[1.65] text-ink/65">
        {children}
      </div>
    </section>
  );
}
