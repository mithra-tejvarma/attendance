import { test, expect } from "@playwright/test";
const fixture = {
  primary: {
    student: { fullName: "Test Student", rollNo: "TEST", branchCode: "CSE" },
    primaryAttendance: {
      present: 80,
      absent: 20,
      totalSessionsIncludingActivity: 100,
    },
  },
  subjectWise: {
    overallAttendance: 80,
    subjects: [
      {
        subjectName: "Mathematics",
        present: 8,
        numberOfClasses: 10,
        percentage: 80,
      },
    ],
  },
  dynamicContext: {
    classroomId: "test",
    semNo: "7",
    currentMonth: new Date().getMonth() + 1,
    currentYear: new Date().getFullYear(),
  },
  monthlyCalendar: {},
  dailyBundle: {},
};
test("demo navigation, planner, theme persistence and sign out", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore a sample dashboard" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your attendance", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Subjects", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Every subject, in focus." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Planner", exact: true })
    .first()
    .click();
  const before = await page.locator(".projection-value").textContent();
  await page.getByLabel("Future classes to attend").fill("10");
  expect(await page.locator(".projection-value").textContent()).not.toEqual(
    before,
  );
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Exit demo" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
test("login uses live API contract without persisting credentials or prefetching", async ({
  page,
}) => {
  const calls: string[] = [];
  await page.route("**/api/**", async (route) => {
    calls.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: fixture });
  });
  await page.goto("/");
  await page.getByLabel("CampX email or login ID").fill("fixture-login");
  await page.getByLabel("Password", { exact: true }).fill("fixture-secret");
  await page.getByRole("button", { name: "Open my dashboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Your attendance", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1300);
  expect(calls).toEqual(["/api/attendance"]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "fixture-secret",
  );
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "fixture-secret",
  );
  await page
    .getByRole("button", { name: "Calendar", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toBe("/api/month-complete-data");
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good to see you." }),
  ).toBeVisible();
});
test("API errors preserve the form and allow retry", async ({ page }) => {
  await page.route("**/api/attendance", (r) =>
    r.fulfill({ status: 401, json: { detail: "rejected" } }),
  );
  await page.goto("/");
  await page.getByLabel("CampX email or login ID").fill("fixture");
  await page.getByLabel("Password", { exact: true }).fill("fixture");
  await page.getByRole("button", { name: "Open my dashboard" }).click();
  await expect(page.getByRole("alert")).toContainText("CampX rejected");
  await expect(
    page.getByRole("button", { name: "Open my dashboard" }),
  ).toBeEnabled();
});
test("mobile layout has no overflow and switches pages immediately", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Explore a sample dashboard" })
    .click();
  for (const label of [
    "Subjects",
    "Calendar",
    "Planner",
    "Settings",
    "Overview",
  ]) {
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("button", { name: label, exact: true })
      .click();
    await expect(
      page
        .getByRole("navigation", { name: "Mobile navigation" })
        .getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: "/tmp/attendance-mobile.png", fullPage: true });
});
test("desktop dashboard renders cleanly", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore a sample dashboard" })
    .click();
  await page.screenshot({
    path: "/tmp/attendance-desktop.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("navigation remains available while a live refresh is pending", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  let requests = 0;
  await page.route("**/api/attendance", async (route) => {
    requests++;
    if (requests > 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill({ json: fixture });
  });
  await page.goto("/");
  await page.getByLabel("CampX email or login ID").fill("fixture");
  await page.getByLabel("Password", { exact: true }).fill("fixture");
  await page.getByRole("button", { name: "Open my dashboard" }).click();
  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(
    page.getByRole("button", { name: "Refreshing…" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Planner", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Make room for your plans." }),
  ).toBeVisible();
  await expect.poll(() => !!release).toBe(true);
  release?.();
  await expect(
    page.getByRole("button", { name: "Refresh data" }),
  ).toBeEnabled();
});

test("installed app shell is available offline without caching private API data", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Good to see you." }),
  ).toBeVisible();
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = [];
    for (const key of keys) {
      const cache = await caches.open(key);
      urls.push(...(await cache.keys()).map((r) => r.url));
    }
    return urls;
  });
  expect(cached.some((url) => url.includes("/api/"))).toBe(false);
  await context.setOffline(false);
});

test("small phone and tablet layouts keep controls within the viewport", async ({
  page,
}) => {
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Explore a sample dashboard" })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const nav =
      width === 320
        ? page.getByRole("navigation", { name: "Mobile navigation" })
        : page.locator(".sidebar-bottom");
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Make it yours." }),
    ).toBeVisible();
  }
});
