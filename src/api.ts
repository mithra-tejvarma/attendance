import type { Dashboard } from "./data";
import {
  API_BASE,
  SESSION_KEY,
  SESSION_EVENT,
  APP_BUILD_ID,
  savedSession,
  remember,
  forget,
  revoke,
} from "./session";
export { SESSION_EVENT, startupNotice } from "./session";
export type Credentials = { loginId: string; password: string };
export type Account = { loginId?: string; legacyCredentials?: Credentials };
export type SavedDashboard = {
  data: Dashboard;
  loginId?: string;
  campxReconnectRequired?: boolean;
  sessionExpiresAt?: string;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
let sessionToken: string | null = savedSession()?.token || null;
let epoch = 0;
let restoreInFlight: Promise<SavedDashboard> | null = null;
let restoreEpoch = -1;
export const hasSession = () => !!sessionToken;
export const hasSavedSession = () => !!savedSession();
function invalidated(token: string | null, message: string) {
  if (sessionToken !== token) return;
  sessionToken = null;
  epoch++;
  forget(token);
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { message } }));
}
window.addEventListener("storage", (event) => {
  if (event.key !== SESSION_KEY && event.key !== null) return;
  try {
    const incoming = event.newValue ? JSON.parse(event.newValue) : null;
    if (
      incoming &&
      incoming.apiBase === API_BASE &&
      incoming.buildId !== APP_BUILD_ID
    ) {
      location.reload();
      return;
    }
  } catch {}
  const next = savedSession()?.token || null;
  if (next === sessionToken) return;
  sessionToken = next;
  epoch++;
  window.dispatchEvent(
    new CustomEvent(SESSION_EVENT, {
      detail: { message: next ? "" : "You signed out in another tab." },
    }),
  );
});
async function request<T>(path: string, body?: object): Promise<T> {
  const token = sessionToken;
  const headers: Record<string, string> = {
    Accept: "application/vnd.varmalabs.compact+json",
  };
  let payload = body;
  if (body) headers["Content-Type"] = "application/json";
  if (token && path !== "/api/attendance") {
    headers.Authorization = `Bearer ${token}`;
    if (body && path !== "/api/reconnect") {
      const {
        loginId: _login,
        password: _password,
        ...safe
      } = body as Record<string, unknown>;
      payload = safe;
    }
  }
  try {
    const response = await fetch(API_BASE + path, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    if (response.status === 204) return undefined as T;
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(
        "The attendance service returned an unreadable response. Please try again.",
        response.status,
        "invalid_response",
      );
    }
    if (!response.ok) {
      const code = typeof data.code === "string" ? data.code : "request_failed";
      const message =
        typeof data.code === "string" && typeof data.detail === "string"
          ? data.detail
          : response.status === 401
            ? "CampX rejected this login. Check your details and try again."
            : "This service is temporarily unavailable. Please try again.";
      if (
        response.status === 401 &&
        token &&
        !code.startsWith("campx_") &&
        code !== "session_invalid"
      )
        invalidated(token, message);
      throw new ApiError(message, response.status, code);
    }
    return data as T;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    )
      throw new ApiError(
        "The server is taking longer than expected. Please try again shortly.",
        0,
        "network_timeout",
      );
    if (error instanceof TypeError)
      throw new ApiError(
        "Cannot reach the attendance service. Check your connection and try again.",
        0,
        "network_error",
      );
    throw error;
  }
}
export const post = <T>(path: string, body: object) => request<T>(path, body);
export const get = <T>(path: string) => request<T>(path);
export async function login(credentials: Credentials) {
  const active = epoch;
  const data = await post<
    Dashboard & { sessionToken?: string; loginId?: string }
  >("/api/attendance", credentials);
  if (active !== epoch) {
    if (data.sessionToken) void revoke(data.sessionToken);
    throw new ApiError(
      "The account changed. Please try again.",
      409,
      "session_changed",
    );
  }
  if (typeof data.sessionToken === "string") {
    sessionToken = data.sessionToken;
    remember(sessionToken);
  }
  return data;
}
export async function refreshDashboard(legacy?: Credentials) {
  if (sessionToken) return post<Dashboard>("/api/refresh", {});
  if (legacy) return login(legacy);
  throw new ApiError("Please sign in to load attendance.", 401, "app_session");
}
export const reconnect = (credentials: Credentials) =>
  post<Dashboard & { loginId?: string }>("/api/reconnect", credentials);
export function restoreSession(): Promise<SavedDashboard> {
  if (restoreInFlight && restoreEpoch === epoch) return restoreInFlight;
  sessionToken ||= savedSession()?.token || null;
  if (!sessionToken)
    return Promise.reject(new ApiError("Please sign in.", 401, "app_session"));
  const active = epoch;
  const promise = (async () => {
    let snapshot: SavedDashboard;
    try {
      snapshot = await get<SavedDashboard>("/api/me/dashboard");
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 404 &&
        error.code === "snapshot_missing"
      )
        snapshot = { data: await refreshDashboard() };
      else throw error;
    }
    if (active !== epoch)
      throw new ApiError(
        "The account changed. Please try again.",
        409,
        "session_changed",
      );
    if (!snapshot.data?.primary && !snapshot.data?.subjectWise)
      throw new ApiError(
        "Your saved dashboard is unavailable. Please retry.",
        502,
        "snapshot_invalid",
      );
    return snapshot;
  })();
  restoreEpoch = active;
  restoreInFlight = promise;
  void promise
    .finally(() => {
      if (restoreInFlight === promise) restoreInFlight = null;
    })
    .catch(() => {});
  return promise;
}
export function logout() {
  const token = sessionToken;
  sessionToken = null;
  epoch++;
  forget(token);
  if (token) void revoke(token);
}
