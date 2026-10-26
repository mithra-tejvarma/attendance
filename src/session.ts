export const SESSION_KEY = "vl-session-v1";
export const SESSION_EVENT = "attendance-session-change";
export const APP_BUILD_ID = __APP_BUILD_ID__;
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "https://attendance-temn.onrender.com"
).replace(/\/$/, "");
export { API_BASE };
type SavedSession = { token: string; apiBase: string; buildId: string };
let notice = "";
export function savedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const row = JSON.parse(raw) as SavedSession;
    if (
      typeof row.token !== "string" ||
      row.token.length < 32 ||
      row.token.length > 200
    ) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    if (row.buildId !== APP_BUILD_ID || row.apiBase !== API_BASE) {
      localStorage.removeItem(SESSION_KEY);
      notice = "The app was updated. Please sign in again.";
      if (row.apiBase === API_BASE) void revoke(row.token);
      return null;
    }
    return row;
  } catch {
    return null;
  }
}
export function startupNotice() {
  return notice;
}
export function remember(token: string) {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token, apiBase: API_BASE, buildId: APP_BUILD_ID }),
    );
    return true;
  } catch {
    return false;
  }
}
export function forget(token: string | null) {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw && (!token || JSON.parse(raw).token === token))
      localStorage.removeItem(SESSION_KEY);
  } catch {}
}
export async function revoke(token: string) {
  try {
    await fetch(API_BASE + "/api/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
      signal: AbortSignal.timeout(60000),
    });
  } catch {}
}
