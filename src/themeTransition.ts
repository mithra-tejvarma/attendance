import { flushSync } from "react-dom";
export function revealTheme(
  next: string,
  setTheme: (theme: string) => void,
  origin?: HTMLElement,
) {
  const apply = () =>
    flushSync(() => {
      document.documentElement.dataset.theme = next;
      setTheme(next);
    });
  if (
    !document.startViewTransition ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    apply();
    return;
  }
  const rect = origin?.getBoundingClientRect(),
    x = rect ? rect.left + rect.width / 2 : innerWidth - 36,
    y = rect ? rect.top + rect.height / 2 : 36;
  const radius = Math.hypot(
    Math.max(x, innerWidth - x),
    Math.max(y, innerHeight - y),
  );
  const transition = document.startViewTransition(apply);
  void transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 520,
          easing: "cubic-bezier(.2,.75,.2,1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {});
}
