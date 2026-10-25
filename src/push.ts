import { post, get } from "./api";
export type PushConfig = {
  enabled: boolean;
  firebaseConfig?: Record<string, string>;
  vapidKey?: string;
  usageEnabled?: boolean;
  checkIntervalSeconds?: number;
};
let messaging: import("@firebase/messaging").Messaging | undefined;
let deviceToken: string | undefined;
export const isPushEnabled = () => !!deviceToken;
export const pushConfig = () => get<PushConfig>("/api/notifications/config");
export async function enablePush(config: PushConfig) {
  if (!config.enabled || !config.firebaseConfig || !config.vapidKey)
    throw new Error("Notifications are not connected yet.");
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  )
    throw new Error(
      "This browser does not support web push. Try an installed app on a supported device.",
    );
  const { isSupported, getMessaging, getToken } =
    await import("@firebase/messaging");
  if (!(await isSupported()))
    throw new Error("Web push is unavailable on this browser.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "Notification permission was not granted. You can change it in browser settings.",
    );
  const { initializeApp, getApps } = await import("@firebase/app");
  const app =
    getApps().find((app) => app.name === "attendance-push") ||
    initializeApp(config.firebaseConfig, "attendance-push");
  messaging = getMessaging(app);
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const token = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token)
    throw new Error(
      "This device could not register for push. Please try again.",
    );
  await post("/api/notifications/subscribe", { token });
  deviceToken = token;
  return true;
}
export async function disablePush() {
  if (deviceToken)
    await post("/api/notifications/unsubscribe", { token: deviceToken });
  if (messaging) {
    const { deleteToken } = await import("@firebase/messaging");
    await deleteToken(messaging);
  }
  deviceToken = undefined;
}
export async function testPush() {
  if (!deviceToken)
    throw new Error("Enable notifications on this device first.");
  await post("/api/notifications/test", { token: deviceToken });
}

export function forgetPushToken() {
  deviceToken = undefined;
}
