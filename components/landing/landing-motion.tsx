"use client";

import { useEffect } from "react";

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Scroll and pointer effects for the landing page. It renders nothing: the page is complete
 * and readable without it, and it stays out of the way when reduced motion is requested.
 *
 * Hooks it looks for under `.hm`:
 * - `[data-reveal]`  fades up once when scrolled into view
 * - `[data-count]`   counts up to its number once when scrolled into view
 * - `[data-tilt]`    gets `--tilt` (0 to 1) as it rises into the viewport
 * - `[data-words]`   lights its `[data-w]` children one by one while scrolling past
 * - `[data-glow]`    gets `--gx` / `--gy`, the pointer position inside the card
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".hm");
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];
    const all = <T extends HTMLElement>(selector: string) => Array.from(root.querySelectorAll<T>(selector));

    const tilts = all("[data-tilt]");
    const wordBlocks = all("[data-words]").map(block => ({ block, words: Array.from(block.querySelectorAll<HTMLElement>("[data-w]")) }));
    let frame = 0;
    const update = () => {
      frame = 0;
      const viewport = window.innerHeight, scrolled = window.scrollY;
      const scrollable = document.documentElement.scrollHeight - viewport;
      root.style.setProperty("--progress", scrollable > 0 ? clamp(scrolled / scrollable).toFixed(4) : "0");
      root.toggleAttribute("data-scrolled", scrolled > 24);
      if (reduce) return;
      for (const element of tilts) {
        const top = element.getBoundingClientRect().top;
        element.style.setProperty("--tilt", clamp((viewport - top) / (viewport * 0.62)).toFixed(3));
      }
      for (const { block, words } of wordBlocks) {
        const box = block.getBoundingClientRect();
        const lit = Math.round(clamp((viewport * 0.86 - box.top) / (box.height + viewport * 0.42)) * words.length);
        words.forEach((word, index) => word.toggleAttribute("data-lit", index < lit));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    cleanups.push(() => { window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); cancelAnimationFrame(frame); });

    if (!reduce) {
      const onScreen = (element: Element) => { const box = element.getBoundingClientRect(); return box.top < window.innerHeight && box.bottom > 0; };

      // Whatever is already on screen is marked before the hidden state switches on, so nothing flickers.
      const reveal = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) { entry.target.setAttribute("data-in", ""); reveal.unobserve(entry.target); }
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      for (const element of all("[data-reveal]")) {
        if (onScreen(element)) element.setAttribute("data-in", ""); else reveal.observe(element);
      }
      cleanups.push(() => reveal.disconnect());

      const count = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          count.unobserve(entry.target);
          const element = entry.target as HTMLElement, target = Number(element.dataset.count);
          if (!Number.isFinite(target)) continue;
          const startedAt = performance.now(), duration = 1100;
          const step = (time: number) => {
            const progress = clamp((time - startedAt) / duration);
            element.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      }, { threshold: 0.6 });
      for (const element of all("[data-count]")) if (!onScreen(element)) count.observe(element);
      cleanups.push(() => count.disconnect());

      for (const card of all("[data-glow]")) {
        const onMove = (event: PointerEvent) => {
          const box = card.getBoundingClientRect();
          card.style.setProperty("--gx", `${event.clientX - box.left}px`);
          card.style.setProperty("--gy", `${event.clientY - box.top}px`);
        };
        card.addEventListener("pointermove", onMove, { passive: true });
        cleanups.push(() => card.removeEventListener("pointermove", onMove));
      }
      root.setAttribute("data-motion", "");
    }
    update();
    return () => cleanups.forEach(cleanup => cleanup());
  }, []);

  return null;
}
