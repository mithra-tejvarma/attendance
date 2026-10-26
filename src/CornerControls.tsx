import { useEffect, useRef, type ReactNode } from "react";
import { Settings2, Sun, Moon, X } from "lucide-react";
export function CornerControls({
  theme,
  toggle,
  settings,
}: {
  theme: string;
  toggle: (origin: HTMLElement) => void;
  settings?: () => void;
}) {
  return (
    <>
      <button
        className="floating-control floating-theme"
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        onClick={(event) => toggle(event.currentTarget)}
      >
        {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
      </button>
      {settings && (
        <button
          className="floating-control floating-settings"
          aria-label="Open settings"
          onClick={settings}
        >
          <Settings2 size={20} />
        </button>
      )}
    </>
  );
}
export function CornerSettings({
  close,
  children,
}: {
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      dialog?.animate(
        [
          { opacity: 0, transform: "scale(.12)", borderRadius: "50%" },
          { opacity: 1, transform: "scale(1)", borderRadius: "24px" },
        ],
        { duration: 260, easing: "cubic-bezier(.16,1,.3,1)" },
      );
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      className="settings-sheet"
      ref={ref}
      aria-labelledby="settings-title"
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="settings-sheet-header">
        <h2 id="settings-title">Settings</h2>
        <button
          className="icon-button"
          aria-label="Close settings"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
