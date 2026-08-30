"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;
function register() {
  if (!registered && typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
}

/**
 * Whether the board is allowed to flip this page load.
 *
 * The inline script in `layout.tsx` is the single authority: it adds `.armed`
 * only when the document is visible and the reader has not asked for reduced
 * motion. Both the CSS hide rule and every timeline read that same class.
 *
 * Guarding only the CSS is not enough, and the reason is worth keeping: GSAP
 * writes a tween's from-state to the element the moment the tween is created,
 * so an unarmed page would still get `opacity: 0` stamped on every row — and
 * where requestAnimationFrame never fires, that zero is permanent. The content
 * has to be left alone entirely, not merely un-hidden.
 */
export function armed() {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("armed")
  );
}

/** Arm a page that loaded hidden once the reader actually switches to it. */
function useArmOnVisible() {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (armed()) return;
    const onVisible = () => {
      if (document.hidden) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      document.documentElement.classList.add("armed");
      setN((v) => v + 1);
      document.removeEventListener("visibilitychange", onVisible);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return n;
}

/**
 * Scope a section's animation to its own DOM and guarantee it can never
 * strand the page.
 *
 * `gsap.context` collects every tween and trigger so they revert together —
 * without it, React's double-invoke in development leaves a second set of
 * triggers attached and the scroll maths silently doubles.
 *
 * The watchdog is the safety net: if the ticker has not advanced 1.2s after
 * building, the context is torn down and the class removed, so the board shows
 * its finished state rather than a screen of from-states. A tab can report
 * itself visible and still be throttled; that was observed, not theorised.
 */
export function useBoard(
  build: (ctx: { gsap: typeof gsap; root: HTMLElement }) => void,
  deps: unknown[] = [],
) {
  const ref = useRef<HTMLElement | null>(null);
  const armedAt = useArmOnVisible();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    register();
    if (!armed()) return;

    const ctx = gsap.context(() => build({ gsap, root }), root);

    const startFrame = gsap.ticker.frame;
    const watchdog = window.setTimeout(() => {
      if (gsap.ticker.frame === startFrame) {
        ctx.revert();
        document.documentElement.classList.remove("armed");
      }
    }, 1200);

    return () => {
      window.clearTimeout(watchdog);
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, armedAt]);

  return ref;
}

/**
 * The flip.
 *
 * A departure board updates by rotating each flap on its own top edge, in
 * sequence down the board. Everything on this page that arrives, arrives this
 * way — one authored moment repeated with intent, rather than a different
 * entrance per section.
 */
export function flip(
  g: typeof gsap,
  targets: gsap.TweenTarget,
  opts: { trigger?: Element | string | null; stagger?: number; delay?: number } = {},
) {
  const { trigger, stagger = 0.055, delay = 0 } = opts;
  return g.fromTo(
    targets,
    { opacity: 0, rotateX: -82, y: -6 },
    {
      opacity: 1,
      rotateX: 0,
      y: 0,
      duration: 0.52,
      ease: "expo.out",
      stagger,
      delay,
      ...(trigger
        ? {
            scrollTrigger: {
              trigger,
              start: "top 84%",
              toggleActions: "play none none none",
            },
          }
        : {}),
    },
  );
}

/** Roll a figure to its real value. Fixed decimals so a cent never renders long. */
export function roll(
  el: HTMLElement,
  to: number,
  { from = 0, decimals = 0 }: { from?: number; decimals?: number } = {},
) {
  const proxy = { v: from };
  const render = () => (el.textContent = proxy.v.toFixed(decimals));
  render();
  return gsap.to(proxy, {
    v: to,
    duration: 1.1,
    ease: "expo.out",
    onUpdate: render,
    scrollTrigger: {
      trigger: el,
      start: "top 88%",
      toggleActions: "play none none none",
    },
  });
}

export { gsap, ScrollTrigger };
