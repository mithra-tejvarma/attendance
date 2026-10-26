import { useEffect } from "react";

// One compositor background and at most one highlighted card; no animation loop at rest.
export function useGlassLight() {
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
      fine = matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0,
      x = 0,
      y = 0,
      card: HTMLElement | null = null,
      lit: HTMLElement | null = null;
    const clear = () => {
      lit?.removeAttribute("data-lit");
      lit = null;
    };
    const render = () => {
      frame = 0;
      if (reduced.matches) {
        clear();
        document.documentElement.style.setProperty("--flow-y", "0px");
        return;
      }
      document.documentElement.style.setProperty(
        "--flow-y",
        `${Math.min(scrollY * 0.055, 100)}px`,
      );
      if (card && fine.matches) {
        if (lit !== card) {
          clear();
          lit = card;
        }
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--light-x", `${x - rect.left}px`);
        card.style.setProperty("--light-y", `${y - rect.top}px`);
        card.setAttribute("data-lit", "");
      } else clear();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    const pointer = (event: PointerEvent) => {
      if (!fine.matches || event.pointerType === "touch") return;
      x = event.clientX;
      y = event.clientY;
      card =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(".glass")
          : null;
      schedule();
    };
    window.addEventListener("pointermove", pointer, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    reduced.addEventListener("change", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      clear();
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("scroll", schedule);
      reduced.removeEventListener("change", schedule);
      document.documentElement.style.removeProperty("--flow-y");
    };
  }, []);
}
