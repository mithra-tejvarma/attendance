import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Hand, Sparkles, X } from "lucide-react";
type Page = "overview" | "subjects" | "calendar" | "playground";
export const TOUR_KEY = "vl-tour-v1";
export function tourSeen() {
  try {
    return localStorage.getItem(TOUR_KEY) === "done";
  } catch {
    return false;
  }
}
export function markTourSeen() {
  try {
    localStorage.setItem(TOUR_KEY, "done");
  } catch {}
}
const steps: {
  page: Page;
  target: string;
  title: string;
  body: string;
  action?: "history" | "finish";
  open?: boolean;
}[] = [
  {
    page: "overview",
    target: ".hero-card",
    title: "Your attendance, at a glance",
    body: "This is your real CampX percentage. The cards below show attended, missed and total classes. This tour uses your own dashboard.",
  },
  {
    page: "overview",
    target: ".today-card",
    title: "Follow your day",
    body: "Find the class time, faculty and personal attendance here. Live timing uses IST; Present and Absent come from CampX. An unmarked class is never counted as absent.",
  },
  {
    page: "subjects",
    target: ".subject-history",
    title: "Five classes, one quick look",
    body: "These are your latest available class results, newest first. Green means present, red means absent, and a dot means no confirmed mark. Tap a result or the arrow to see the real class details.",
    action: "history",
  },
  {
    page: "subjects",
    target: ".history-expanded",
    title: "See when each class happened",
    body: "The expanded list shows dates, 12-hour times, faculty and attendance. Load more reveals additional classes, then fetches one earlier month when needed.",
    open: true,
  },
  {
    page: "calendar",
    target: ".student-calendar",
    title: "Choose a day",
    body: "Tap a date to show its classes below or beside the calendar. Green is a full present day, red is full absent and orange is mixed. Unmarked days stay neutral.",
  },
  {
    page: "playground",
    target: ".playground-summary",
    title: "Plan before you miss a class",
    body: "This is your Playground. Choose a future day or class as present or absent and watch the projection change. Your official attendance is never edited.",
  },
  {
    page: "overview",
    target: ".floating-theme",
    title: "Make it comfortable",
    body: "Tap this button to switch light and dark themes. Your choice stays on this device. Motion follows your browser’s reduced-motion preference.",
  },
  {
    page: "overview",
    target: ".floating-settings",
    title: "You’re ready to explore",
    body: "Open Settings for your student details, installation, optional notifications and this tour. Notifications are enabled only when you choose. Tap Settings or Finish tour to continue.",
    action: "finish",
  },
];
type Rect = { top: number; left: number; width: number; height: number };
export function GuidedTour({
  navigate,
  close,
}: {
  navigate: (page: Page) => void;
  close: () => void;
}) {
  const [index, setIndex] = useState(0),
    [rect, setRect] = useState<Rect | null>(null),
    [size, setSize] = useState({ width: innerWidth, height: innerHeight });
  const panel = useRef<HTMLDivElement>(null),
    next = useRef<HTMLButtonElement>(null);
  const current = steps[index];
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    navigate(current.page);
    setRect(null);
    let findFrame = 0,
      measureFrame = 0,
      tries = 0,
      target: HTMLElement | null = null,
      observer: ResizeObserver | undefined;
    const measure = () => {
      if (!target) return;
      const r = target.getBoundingClientRect(),
        padding = 6;
      const left = Math.max(8, r.left - padding),
        top = Math.max(8, r.top - padding);
      setRect({
        left,
        top,
        width: Math.max(0, Math.min(innerWidth - 8, r.right + padding) - left),
        height: Math.max(
          0,
          Math.min(innerHeight - 8, r.bottom + padding) - top,
        ),
      });
      setSize({ width: innerWidth, height: innerHeight });
    };
    const queue = () => {
      cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(measure);
    };
    const click = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      if (
        current.action === "history" &&
        event.target.closest(".history-box,.history-toggle")
      )
        setIndex((i) => Math.min(steps.length - 1, i + 1));
      if (current.action === "finish") closeRef.current();
    };
    const find = () => {
      if (current.open) {
        const button = document.querySelector<HTMLButtonElement>(
          ".subject-history .history-toggle",
        );
        if (button?.getAttribute("aria-expanded") === "false") button.click();
      }
      target =
        Array.from(document.querySelectorAll<HTMLElement>(current.target)).find(
          (el) => el.getBoundingClientRect().width > 0,
        ) || null;
      if (!target && ++tries < 20) {
        findFrame = requestAnimationFrame(find);
        return;
      }
      target ||= document.querySelector("main");
      target?.scrollIntoView({ block: "center", behavior: "instant" });
      target?.addEventListener("click", click);
      observer = new ResizeObserver(queue);
      if (target) observer.observe(target);
      if (panel.current) observer.observe(panel.current);
      measure();
      next.current?.focus({ preventScroll: true });
    };
    findFrame = requestAnimationFrame(find);
    window.addEventListener("resize", queue);
    window.addEventListener("scroll", queue, true);
    return () => {
      cancelAnimationFrame(findFrame);
      cancelAnimationFrame(measureFrame);
      observer?.disconnect();
      target?.removeEventListener("click", click);
      window.removeEventListener("resize", queue);
      window.removeEventListener("scroll", queue, true);
    };
  }, [index, navigate]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const panelHeight = panel.current?.offsetHeight || 270,
    width = Math.min(340, size.width - 24),
    left = rect
      ? Math.max(
          12,
          Math.min(
            size.width - width - 12,
            rect.left + rect.width / 2 - width / 2,
          ),
        )
      : Math.max(12, (size.width - width) / 2),
    top =
      rect && rect.top + rect.height + panelHeight + 20 < size.height
        ? rect.top + rect.height + 16
        : rect && rect.top > panelHeight + 24
          ? rect.top - panelHeight - 16
          : Math.max(12, size.height - panelHeight - 16);
  return createPortal(
    <div className="tour-layer">
      {rect ? (
        <>
          <div
            className="tour-shade"
            style={{ inset: `0 0 auto 0`, height: rect.top }}
          />
          <div
            className="tour-shade"
            style={{
              top: rect.top + rect.height,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          <div
            className="tour-shade"
            style={{
              top: rect.top,
              left: 0,
              width: rect.left,
              height: rect.height,
            }}
          />
          <div
            className="tour-shade"
            style={{
              top: rect.top,
              left: rect.left + rect.width,
              right: 0,
              height: rect.height,
            }}
          />
          <div className="tour-spotlight" style={rect} />
          <Hand
            className="tour-hand"
            size={27}
            style={{
              top: Math.min(
                size.height - 36,
                rect.top + Math.min(rect.height, 56) - 14,
              ),
              left: Math.min(size.width - 36, rect.left + rect.width - 18),
            }}
          />
        </>
      ) : (
        <div className="tour-shade" style={{ inset: 0 }} />
      )}
      <div
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="tour-panel"
        style={{ top, left, width }}
      >
        <div className="tour-heading">
          <span>
            <Sparkles size={14} /> A QUICK WALKTHROUGH
          </span>
          <button
            className="icon-button"
            aria-label="Skip guided tour"
            onClick={close}
          >
            <X size={17} />
          </button>
        </div>
        <span className="tour-count" aria-live="polite">
          Step {index + 1} of {steps.length}
        </span>
        <h2 id="tour-title">{current.title}</h2>
        <p id="tour-body">{current.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <i key={i} className={i === index ? "active" : ""} />
          ))}
        </div>
        <div className="tour-actions">
          <button
            className="text-button"
            disabled={index === 0}
            onClick={() => setIndex((i) => i - 1)}
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <button
            ref={next}
            className="button primary"
            onClick={() =>
              index === steps.length - 1 ? close() : setIndex((i) => i + 1)
            }
          >
            {index === steps.length - 1 ? "Finish tour" : "Next"}
            <ArrowRight size={14} />
          </button>
        </div>
        <button className="tour-skip" onClick={close}>
          Skip for now
        </button>
      </div>
    </div>,
    document.body,
  );
}
