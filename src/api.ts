import type { Dashboard } from "./data";
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "https://attendance-temn.onrender.com"
).replace(/\/$/, "");
export type Credentials = { loginId: string; password: string };
export async function post<T>(path: string, body: object): Promise<T> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "CampX rejected this login. Check your details and try again."
          : `Attendance service returned ${response.status}. Please try again.`,
      );
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
export const login = (credentials: Credentials) =>
  post<Dashboard>("/api/attendance", credentials);
