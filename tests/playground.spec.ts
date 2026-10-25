import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";
import { fixtureDashboard } from "./fixtures";
import { projectAttendance } from "../src/playgroundModel";
import type { Bundle, Subject } from "../src/data";
const today = "2026-10-24",
  future = "2026-10-26";
const subjects: Subject[] = [
  {
    subjectId: "math",
    subjectName: "Mathematics",
    present: 8,
    numberOfClasses: 10,
    percentage: 80,
  },
];
const bundle: Bundle = {
  hasRecord: false,
  timetable: [
    {
      id: "a",
      subjectId: "math",
      subjectName: "Mathematics",
      fromTime: "09:00",
      toTime: "10:00",
    },
    {
      id: "b",
      subjectId: "math",
      subjectName: "Mathematics",
      fromTime: "11:00",
      toTime: "12:00",
    },
  ],
  attendance: [],
};
test("future projection preserves actual data and excludes past, cancelled, and non-attendance classes", () => {
  const data = {
    [today]: bundle,
    [future]: {
      ...bundle,
      timetable: [
        ...bundle.timetable,
        { id: "c", subjectId: "math", isSuspended: true },
        { id: "d", subjectId: "math", attendanceRequired: false },
      ],
    },
  };
  const snapshot = JSON.stringify(data);
  const defaultPlan = projectAttendance(
    subjects,
    { present: 8, totalSessionsIncludingActivity: 10 },
    data,
    today,
    future,
    {},
  );
  expect(defaultPlan.present).toBe(2);
  expect(defaultPlan.percentage).toBeCloseTo((100 * 10) / 12);
  const mixed = projectAttendance(
    subjects,
    { present: 8, totalSessionsIncludingActivity: 10 },
    data,
    today,
    future,
    { [future + ":a"]: "absent" },
  );
  expect(mixed.percentage).toBe(75);
  expect(mixed.subjects[0].projected).toBe(75);
  expect(
    projectAttendance(
      subjects,
      { present: 8, totalSessionsIncludingActivity: 10 },
      data,
      today,
      today,
      {},
    ).present,
  ).toBe(0);
  expect(JSON.stringify(data)).toBe(snapshot);
});
test("Playground allows day-wise and class-wise future planning with no mark-writing requests", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-24T04:00:00Z") });
  const data = fixtureDashboard(new Date("2026-10-24T04:00:00Z"));
  data.subjectWise = { overallAttendance: 80, subjects };
  data.primary!.primaryAttendance = {
    present: 8,
    absent: 2,
    totalSessionsIncludingActivity: 10,
  };
  data.dailyBundle = { [future]: bundle };
  await signIn(page, data);
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests++;
  });
  await page
    .getByRole("button", { name: "Playground", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Your attendance playground." }),
  ).toBeVisible();
  await expect(page.locator(".playground-summary")).toContainText("83.3%");
  await page
    .getByRole("button", { name: /2026-10-26: 2 planned present/ })
    .click();
  await expect(page.locator(".playground-summary")).toContainText("66.7%");
  await page.getByRole("button", { name: "Class-wise", exact: true }).click();
  await page.getByRole("switch").first().click();
  await expect(page.locator(".playground-summary")).toContainText("75.0%");
  await expect(
    page.getByRole("button", { name: "2026-10-24: not editable", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Overview", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Playground", exact: true })
    .first()
    .click();
  await expect(page.locator(".playground-summary")).toContainText("75.0%");
  expect(requests).toBe(0);
  await page.screenshot({
    path: "/tmp/attendance-playground.png",
    fullPage: true,
  });
});
test("corner controls open a compact settings dialog and theme changes persist", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Switch to light theme", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("compact login loads the selected month only and notifications stay opt-in", async ({
  page,
}) => {
  const data = fixtureDashboard(new Date("2026-10-24T04:00:00Z"));
  await page.clock.install({ time: new Date("2026-10-24T04:00:00Z") });
  const compact = {
    ...data,
    dailyBundle: {},
    monthDetailsComplete: false,
    sessionToken: "fixture-session-token",
  };
  const calls: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path === "/api/notifications/config")
      await route.fulfill({ json: { enabled: false } });
    else if (path === "/api/month-complete-data")
      await route.fulfill({ json: data });
    else await route.fulfill({ json: compact });
  });
  await signIn(page, compact, false);
  expect(calls).toEqual(["/api/attendance"]);
  await page
    .getByRole("button", { name: "Calendar", exact: true })
    .first()
    .click();
  await expect
    .poll(() => calls.filter((x) => x === "/api/month-complete-data").length)
    .toBe(1);
  await page
    .getByRole("button", { name: "Playground", exact: true })
    .first()
    .click();
  expect(calls.filter((x) => x === "/api/month-complete-data")).toHaveLength(1);
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await expect(
    page.getByText("Notifications are being connected.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enable notifications", exact: true }),
  ).toHaveCount(0);
});

test("opening a push notification reads the authenticated saved dashboard without a CampX refresh", async ({
  page,
}) => {
  const data = fixtureDashboard();
  const latest = {
    ...data,
    subjectWise: { ...data.subjectWise!, overallAttendance: 91.2 },
  };
  const calls: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    await route.fulfill({
      json:
        path === "/api/me/dashboard"
          ? { data: latest }
          : { ...data, sessionToken: "fixture-session-token" },
    });
  });
  await signIn(page, data, false);
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "ATTENDANCE_NOTIFICATION_OPEN" },
      }),
    ),
  );
  await expect(page.locator(".hero-value")).toContainText("91.2");
  expect(calls).toEqual(["/api/attendance", "/api/me/dashboard"]);
});
