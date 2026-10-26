import { expect, type Page } from "@playwright/test";
import { fixtureDashboard } from "./fixtures";
import type { Dashboard } from "../src/data";
export async function signIn(
  page: Page,
  data: Dashboard = fixtureDashboard(),
  mock = true,
) {
  if (mock)
    await page.route("**/api/**", async (route) => {
      if (new URL(route.request().url()).pathname === "/api/logout")
        await route.fulfill({ status: 204 });
      else await route.fulfill({ json: data });
    });
  await page.goto("/");
  await page.getByLabel("CampX email or login ID").fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-only");
  await page.getByRole("button", { name: "Open my dashboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Your attendance", exact: true }),
  ).toBeVisible();
}
