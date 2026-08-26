'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * What happens at checkout, as a stack that resolves one card at a time.
 *
 * The motion is here because the content is a sequence: underwrite, then
 * approve, then collect. A reader who sees all three at once has to work out
 * the order from the numbering; a reader who is handed them one at a time gets
 * the order for free. That is the only justification for pinning a section, and
 * without it this would be a list.
 *
 * Reduced motion collapses the whole thing to a plain stacked list. Nothing is
 * hidden behind the animation, so nothing is lost.
 */

export type Step = {
  title: string;
  body: string;
};

export function CheckoutStack({ steps }: { steps: Step[] }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = root.current;
    if (!node) return;

    // Read the preference directly rather than through a hook, so this leaf
    // stays free of any Motion import; GSAP and Motion fight over frames when
    // they share a tree.
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (query.matches) return;

    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>('[data-stack-card]');

      cards.forEach((card, i) => {
        if (i === cards.length - 1) return;

        ScrollTrigger.create({
          trigger: card,
          start: 'top top',
          endTrigger: cards[cards.length - 1],
          end: 'top top',
          pin: true,
          pinSpacing: false,
        });

        // The outgoing card recedes as the next one arrives, so depth carries
        // the ordering rather than a counter.
        gsap.to(card, {
          scale: 0.94,
          opacity: 0.4,
          ease: 'none',
          scrollTrigger: {
            trigger: cards[i + 1],
            start: 'top bottom',
            end: 'top top',
            scrub: true,
          },
        });
      });
    }, node);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={root} className="relative">
      {steps.map((step, i) => (
        <div
          key={step.title}
          data-stack-card
          className="sticky top-0 flex min-h-[100dvh] items-center"
        >
          <div className="surface w-full px-7 py-12 sm:px-12 sm:py-16">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
              <h3 className="text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
                {step.title}
              </h3>
              <p className="max-w-[52ch] self-center text-[15px] leading-relaxed text-foreground/55">
                {step.body}
              </p>
            </div>

            {/* Position in the sequence, drawn rather than numbered. */}
            <div className="mt-12 flex gap-2" aria-hidden>
              {steps.map((s, j) => (
                <span
                  key={s.title}
                  className={`h-[3px] flex-1 rounded-full transition-colors ${
                    j <= i ? 'bg-primary' : 'bg-foreground/12'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
