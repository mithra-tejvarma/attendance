import type { Dashboard } from "./data";
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "https://attendance-temn.onrender.com"
).replace(/\/$/, "");
export type Credentials = { loginId: string; password: string };
// Tab-local app session. Never persist it or upstream credentials in browser storage.
let sessionToken: string | null = null;
export async function post<T>(path: string, body: object): Promise<T> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 60000);
  const token = sessionToken;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/vnd.varmalabs.compact+json",
  };
  let payload = body;
  if (token && path !== "/api/attendance") {
    headers.Authorization = `Bearer ${token}`;
    const {
      loginId: _login,
      password: _password,
      ...safe
    } = body as Record<string, unknown>;
    payload = safe;
  }
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.status === 204) return undefined as T;
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The attendance service returned an unreadable response. Please try again.",
      );
    }
    if (!response.ok) {
      if (response.status === 401 && sessionToken === token)
        sessionToken = null;
      throw new Error(
        data.code && typeof data.detail === "string"
          ? data.detail
          : response.status === 401
            ? "CampX rejected this login. Check your details and try again."
            : `Attendance service returned ${response.status}. Please try again.`,
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(
        "The server is taking longer than expected. Please try again shortly.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Cannot reach the attendance service. Check your connection and try again.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export async function login(credentials: Credentials) {
  if (sessionToken) return post<Dashboard>("/api/refresh", {});
  const data = await post<Dashboard & { sessionToken?: string }>(
    "/api/attendance",
    credentials,
  );
  if (typeof data.sessionToken === "string") sessionToken = data.sessionToken;
  return data;
}
export function logout() {
  const token = sessionToken;
  sessionToken = null;
  if (token)
    void fetch(`${API_BASE}/api/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
    }).catch(() => {});
}

export async function get<T>(path: string): Promise<T> {
  const response = await fetch(API_BASE + path, {
    headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "This service is temporarily unavailable. Please try again.",
    );
  return response.json() as Promise<T>;
}
