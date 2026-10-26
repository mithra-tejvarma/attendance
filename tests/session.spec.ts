import { test, expect, type Page, type Route } from "@playwright/test";
import { fixtureDashboard } from "./fixtures";
import { signIn } from "./helpers";
import AxeBuilder from "@axe-core/playwright";
const token = "remembered-" + "p".repeat(40),
  key = "vl-session-v1",
  data = { ...fixtureDashboard(), fetchedAt: new Date().toISOString() };
type Override = (route: Route, path: string) => Promise<boolean>;
async function mock(page: Page, override?: Override) {
  const calls: {
    path: string;
    method: string;
    authorization?: string;
    body: Record<string, unknown>;
  }[] = [];
  await page.context().route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    calls.push({
      path,
      method: request.method(),
      authorization: request.headers().authorization,
      body: request.postDataJSON() || {},
    });
    if (override && (await override(route, path))) return;
    if (path === "/api/logout") await route.fulfill({ status: 204 });
    else if (path === "/api/me/dashboard")
      await route.fulfill({ json: { data, loginId: "fixture@example.test" } });
    else if (path === "/api/notifications/config")
      await route.fulfill({ json: { enabled: false } });
    else
      await route.fulfill({
        json: { ...data, sessionToken: token, loginId: "fixture@example.test" },
      });
  });
  return calls;
}
async function dashboard(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Your attendance", exact: true }),
  ).toBeVisible();
}
async function signOut(page: Page) {
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
}

test("reload and reopening restore the account without credentials or new CampX login", async ({
  page,
  context,
}) => {
  const calls = await mock(page);
  await signIn(page, data, false);
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(Object.keys(stored).sort()).toEqual(["apiBase", "buildId", "token"]);
  expect(stored.token).toBe(token);
  expect(JSON.stringify(stored)).not.toContain("fixture@example.test");
  expect(JSON.stringify(stored)).not.toContain("test-only");
  calls.length = 0;
  await page.reload();
  await dashboard(page);
  expect(calls.map((c) => c.path)).toEqual(["/api/me/dashboard"]);
  expect(calls[0].authorization).toBe("Bearer " + token);
  await page
    .getByRole("button", { name: "Refresh data", exact: true })
    .first()
    .click();
  await expect
    .poll(() => calls.some((c) => c.path === "/api/refresh"))
    .toBe(true);
  expect(calls.find((c) => c.path === "/api/refresh")!.body).toEqual({});
  const reopened = await context.newPage();
  await reopened.goto("/");
  await dashboard(reopened);
  expect(calls.filter((c) => c.path === "/api/attendance")).toHaveLength(0);
  await reopened
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await expect(
    reopened.getByText("fixture@example.test", { exact: true }),
  ).toBeVisible();
});

test("sign-out removes the remembered token and signs out other open tabs", async ({
  page,
  context,
}) => {
  const calls = await mock(page);
  await signIn(page, data, false);
  const other = await context.newPage();
  await other.goto("/");
  await dashboard(other);
  await signOut(page);
  await expect(
    other.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
  await expect
    .poll(() => calls.find((c) => c.path === "/api/logout")?.authorization)
    .toBe("Bearer " + token);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("a transient restore failure preserves sign-in and retries without a password", async ({
  page,
}) => {
  let fail = true;
  const calls = await mock(page, async (route, path) => {
    if (path !== "/api/me/dashboard" || !fail) return false;
    await route.fulfill({
      status: 503,
      json: {
        code: "server_busy",
        detail: "The server is waking up. Please retry.",
      },
    });
    return true;
  });
  await signIn(page, data, false);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your sign-in is saved", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate((key) => !!localStorage.getItem(key), key)).toBe(
    true,
  );
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await dashboard(page);
  expect(calls.filter((c) => c.path === "/api/attendance")).toHaveLength(1);
});

test("server revocation clears the saved token and shows the sign-in form", async ({
  page,
}) => {
  await mock(page, async (route, path) => {
    if (path !== "/api/me/dashboard") return false;
    await route.fulfill({
      status: 401,
      json: {
        code: "app_session",
        detail: "This app session was revoked. Please sign in.",
      },
    });
    return true;
  });
  await signIn(page, data, false);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
});

test("a website release change invalidates the remembered token", async ({
  page,
}) => {
  const calls = await mock(page);
  await signIn(page, data, false);
  await page.evaluate((key) => {
    const row = JSON.parse(localStorage.getItem(key)!);
    row.buildId = "previous-website-release";
    localStorage.setItem(key, JSON.stringify(row));
  }, key);
  calls.length = 0;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("app was updated");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
  await expect
    .poll(() => calls.some((c) => c.path === "/api/logout"))
    .toBe(true);
  expect(calls.some((c) => c.path === "/api/me/dashboard")).toBe(false);
});

test("a late restore response cannot log the user back in after sign-out", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  await mock(page, async (route, path) => {
    if (path !== "/api/me/dashboard") return false;
    await new Promise<void>((resolve) => {
      release = () => {
        void route
          .fulfill({ json: { data, loginId: "fixture@example.test" } })
          .then(resolve);
      };
    });
    return true;
  });
  await signIn(page, data, false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => !!release).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  release!();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
});

test("CampX expiry keeps the dashboard signed in and reconnects the same app session", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("vl-theme", "dark"));
  let expired = true;
  const calls = await mock(page, async (route, path) => {
    if (path === "/api/refresh" && expired) {
      await route.fulfill({
        status: 428,
        json: {
          code: "campx_reconnect",
          detail: "Reconnect to CampX to load updates.",
        },
      });
      return true;
    }
    if (path === "/api/reconnect") {
      expired = false;
      await route.fulfill({
        json: { ...data, loginId: "fixture@example.test" },
      });
      return true;
    }
    return false;
  });
  await signIn(page, data, false);
  await page
    .getByRole("button", { name: "Refresh data", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("You’re still signed in.", { exact: false }),
  ).toBeVisible();
  await dashboard(page);
  await page
    .getByRole("button", { name: "Reconnect CampX", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Reconnect to CampX",
    exact: true,
  });
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("renewed-test-only");
  await dialog.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await dashboard(page);
  const renew = calls.find((c) => c.path === "/api/reconnect")!;
  expect(renew.authorization).toBe("Bearer " + token);
  expect(renew.body).toEqual({
    loginId: "fixture@example.test",
    password: "renewed-test-only",
  });
  const stored = await page.evaluate((key) => localStorage.getItem(key), key);
  expect(stored).not.toContain("renewed-test-only");
  expect(JSON.parse(stored!).token).toBe(token);
  await page.reload();
  await dashboard(page);
});

test("a stale restored dashboard refreshes quietly with the app token", async ({
  page,
}) => {
  const calls = await mock(page, async (route, path) => {
    if (path === "/api/me/dashboard") {
      await route.fulfill({
        json: {
          data: { ...data, fetchedAt: "2020-01-01T00:00:00Z" },
          loginId: "fixture@example.test",
        },
      });
      return true;
    }
    if (path === "/api/refresh") {
      await route.fulfill({
        json: {
          ...data,
          subjectWise: { ...data.subjectWise!, overallAttendance: 91.2 },
        },
      });
      return true;
    }
    return false;
  });
  await signIn(page, data, false);
  await page.reload();
  await dashboard(page);
  await expect(page.locator(".hero-value")).toContainText("91.2");
  expect(calls.filter((c) => c.path === "/api/attendance")).toHaveLength(1);
  expect(calls.find((c) => c.path === "/api/refresh")!.authorization).toBe(
    "Bearer " + token,
  );
});

test("network failure on reopen preserves the saved sign-in", async ({
  page,
}) => {
  let disconnected = true;
  await mock(page, async (route, path) => {
    if (path !== "/api/me/dashboard" || !disconnected) return false;
    await route.abort("failed");
    return true;
  });
  await signIn(page, data, false);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your sign-in is saved", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate((key) => !!localStorage.getItem(key), key)).toBe(
    true,
  );
  disconnected = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await dashboard(page);
});

test("resuming a stale open app refreshes using the saved app session", async ({
  page,
}) => {
  const stale = { ...data, fetchedAt: "2020-01-01T00:00:00Z" };
  const calls = await mock(page, async (route, path) => {
    if (path === "/api/attendance") {
      await route.fulfill({ json: { ...stale, sessionToken: token } });
      return true;
    }
    return false;
  });
  await signIn(page, data, false);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect
    .poll(() => calls.some((c) => c.path === "/api/refresh"))
    .toBe(true);
  expect(calls.filter((c) => c.path === "/api/attendance")).toHaveLength(1);
  expect(calls.find((c) => c.path === "/api/refresh")!.authorization).toBe(
    "Bearer " + token,
  );
});
