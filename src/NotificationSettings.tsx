import { useEffect, useState } from "react";
import { Bell, LoaderCircle } from "lucide-react";
import {
  pushConfig,
  enablePush,
  disablePush,
  testPush,
  isPushEnabled,
  type PushConfig,
} from "./push";
export function NotificationSettings() {
  const [config, setConfig] = useState<PushConfig | null>(null),
    [error, setError] = useState(""),
    [enabled, setEnabled] = useState(isPushEnabled),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    pushConfig()
      .then((c) => {
        if (active) setConfig(c);
      })
      .catch(() => {
        if (active) setError("Notification settings could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function act(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">YOUR DEVICE, YOUR CHOICE</span>
          <h2>Attendance notifications</h2>
        </div>
        <Bell size={19} />
      </div>
      <p>
        Get a private heads-up when your attendance changes. Background checks
        need a valid CampX connection; reconnect when it expires.
      </p>
      {config?.enabled ? (
        <>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              act(
                async () => {
                  if (enabled) {
                    await disablePush();
                    setEnabled(false);
                  } else {
                    await enablePush(config);
                    setEnabled(true);
                  }
                },
                enabled
                  ? "Notifications disabled on this device."
                  : "Notifications enabled on this device.",
              )
            }
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Bell size={16} />
            )}{" "}
            {enabled ? "Disable notifications" : "Enable notifications"}
          </button>
          {enabled && (
            <button
              className="text-button notification-test"
              disabled={busy}
              onClick={() =>
                act(
                  testPush,
                  "Test accepted by the push service. Device delivery depends on browser settings.",
                )
              }
            >
              Send a test
            </button>
          )}
          <p className="notification-footnote">
            Checks are scheduled, not instant. Timing depends on queue load,
            CampX and device delivery.
          </p>
        </>
      ) : (
        <p className="notification-footnote">
          Notifications are being connected. Permission will only be requested
          when the service is ready.
        </p>
      )}
      {config?.usageEnabled && (
        <p className="notification-footnote">
          Usage totals are recorded privately to improve the app. Passwords and
          attendance records are excluded.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notification-footnote">
          {message}
        </p>
      )}
    </>
  );
}
