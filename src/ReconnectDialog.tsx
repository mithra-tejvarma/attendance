import { useEffect, useRef, useState } from "react";
import { X, LoaderCircle, RefreshCw } from "lucide-react";
import type { Credentials } from "./api";
export function ReconnectDialog({
  loginId,
  close,
  submit,
}: {
  loginId?: string;
  close: () => void;
  submit: (credentials: Credentials) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [email, setEmail] = useState(loginId || ""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="glass reconnect-dialog"
      aria-labelledby="reconnect-title"
      onCancel={close}
    >
      <button
        className="icon-button close"
        aria-label="Close reconnection"
        onClick={close}
      >
        <X size={20} />
      </button>
      <RefreshCw size={26} />
      <h2 id="reconnect-title">Reconnect to CampX</h2>
      <p>
        You’re still signed in here. CampX needs a new connection to fetch fresh
        attendance. Use the same student account.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await submit({ loginId: email.trim(), password });
            setPassword("");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="reconnect-email">CampX email or login ID</label>
        <input
          id="reconnect-email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={busy}
        />
        <label htmlFor="reconnect-password">Password</label>
        <input
          id="reconnect-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={busy}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy && <LoaderCircle size={16} className="spin" />}
          {busy ? "Reconnecting…" : "Reconnect"}
        </button>
      </form>
      <small>Your password is used for this connection and is not saved.</small>
    </dialog>
  );
}
