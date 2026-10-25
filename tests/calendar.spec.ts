import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";
import { fixtureDashboard } from "./fixtures";
import { dayState } from "../src/schedule";
import type { Bundle } from "../src/data";

function calendarData() {
  const data = fixtureDashboard(new Date("2026-10-24T04:00:00Z"));
  data.monthlyCalendar = {
    "2026-10-01": "present",
    "2026-10-02": "absent",
    "2026-10-03": "partial",
    "2026-10-04": "present",
    "2026-10-05": "present",
  };
  function day(flags: (0 | 1 | null)[]): Bundle {
    return {
      hasRecord: flags.some((f) => f !== null),
      timetable: flags.map((_, i) => ({
        id: "slot" + i,
        subjectId: "subject" + i,
        subjectName: ["Mathematics", "Physics"][i],
        subjectCode: ["MAT101", "PHY101"][i],
        facultyName: "Fixture Lecturer",
        fromTime: i ? "10:00" : "09:00",
        toTime: i ? "11:00" : "10:00",
      })),
      attendance: flags.flatMap((flag, i) =>
        flag === null
          ? []
          : [
              {
                id: "record" + i,
                classroomTimetableId: "slot" + i,
                subjectId: "subject" + i,
                isAbsent: flag,
              },
            ],
      ),
    };
  }
  data.dailyBundle = {
    "2026-10-01": day([0, 0]),
    "2026-10-02": day([1, 1]),
    "2026-10-03": day([0, 1]),
    "2026-10-04": day([0, null]),
    "2026-10-05": {
      hasRecord: true,
      timetable: [],
      attendance: [
        { id: "orphan", subjectName: "Recorded laboratory", isAbsent: 0 },
      ],
    },
  };
  return data;
}
test("calendar distinguishes full present, full absent, mixed and partially marked days", async ({
  page,
}) => {
  await signIn(page, calendarData());
  await page
    .getByRole("button", { name: "Calendar", exact: true })
    .first()
    .click();
  for (const [day, state, label] of [
    ["01", "present", "All classes attended"],
    ["02", "absent", "All classes missed"],
    ["03", "partial", "Mixed attendance"],
    ["04", "pending", "Partially marked"],
  ]) {
    const cell = page.getByRole("button", {
      name: `2026-10-${day}: ${label}`,
      exact: true,
    });
    await expect(cell).toHaveClass(new RegExp(state));
    await cell.click();
    await expect(
      page.getByRole("region", { name: "Selected day details" }),
    ).toContainText("Mathematics");
    await expect(
      page.getByRole("region", { name: "Selected day details" }),
    ).toContainText("MAT101");
  }
  const panel = page.getByRole("region", { name: "Selected day details" });
  await expect(panel.locator(".attendance-badge.unmarked")).toHaveCount(1);
  await page
    .getByRole("button", { name: "2026-10-03: Mixed attendance", exact: true })
    .click();
  await expect(panel.locator(".marked-present")).toHaveCount(1);
  await expect(panel.locator(".marked-absent")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "2026-10-05: All classes attended",
      exact: true,
    })
    .click();
  await expect(panel).toContainText("Recorded laboratory");
  await expect(panel.locator(".marked-present")).toHaveCount(1);
});
test("mobile calendar shows the full class list instead of hiding it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, calendarData());
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Calendar", exact: true })
    .click();
  await page
    .getByRole("button", { name: "2026-10-03: Mixed attendance", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Selected day details" });
  await expect(panel.getByText("Physics", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("Fixture Lecturer", { exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/attendance-mobile-calendar.png",
    fullPage: true,
  });
});
test("login offers no sample workspace or marketing intro", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sample|explore|demo/i }),
  ).toHaveCount(0);
  await expect(page.locator(".login-intro")).toHaveCount(0);
  await expect(page.getByLabel("CampX email or login ID")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/attendance-login.png", fullPage: true });
});
test("failed month requests are retryable without replacing current student data", async ({
  page,
}) => {
  let attempts = 0;
  const data = calendarData();
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/month-complete-data" && ++attempts === 1)
      await route.fulfill({
        status: 503,
        json: { code: "upstream_unavailable", detail: "Please try again." },
      });
    else
      await route.fulfill({
        json:
          path === "/api/month-complete-data"
            ? { monthlyCalendar: {}, dailyBundle: {} }
            : data,
      });
  });
  await signIn(page, data, false);
  await page
    .getByRole("button", { name: "Calendar", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("alert")).toContainText("Please try again.");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
});
test("an earlier month finishing cannot clear the loading state of the selected month", async ({
  page,
}) => {
  let finishNovember: (() => void) | undefined,
    finishDecember: (() => void) | undefined;
  const data = calendarData();
  await page.route("**/api/**", async (route) => {
    if (
      new URL(route.request().url()).pathname === "/api/month-complete-data"
    ) {
      const month = route.request().postDataJSON().month;
      await new Promise<void>((resolve) => {
        if (month === 11) finishNovember = resolve;
        else finishDecember = resolve;
      });
      await route.fulfill({ json: { monthlyCalendar: {}, dailyBundle: {} } });
    } else await route.fulfill({ json: data });
  });
  await signIn(page, data, false);
  await page
    .getByRole("button", { name: "Calendar", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect.poll(() => !!finishNovember).toBe(true);
  await page.getByRole("button", { name: "Next month" }).click();
  await expect.poll(() => !!finishDecember).toBe(true);
  finishNovember!();
  await page.waitForTimeout(100);
  await expect(
    page.getByText("Loading this month…", { exact: true }),
  ).toBeVisible();
  finishDecember!();
  await expect(
    page.getByText("Loading this month…", { exact: true }),
  ).toHaveCount(0);
});
test("unmarked sessions never turn a partly recorded day fully green or absent", () => {
  const data = calendarData();
  expect(dayState("present", data.dailyBundle!["2026-10-04"])).toBe("pending");
  expect(dayState("absent", data.dailyBundle!["2026-10-01"])).toBe("pending");
  expect(
    dayState(undefined, { hasRecord: false, timetable: [], attendance: [] }),
  ).toBe("unknown");
});

test("glass highlights respond to the pointer and respect reduced motion", async ({
  page,
}) => {
  await signIn(page);
  const hero = page.locator(".hero-card");
  await hero.hover();
  await expect(hero).toHaveAttribute("data-lit", "");
  expect(
    await hero.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue("--light-x"),
    ),
  ).not.toBe("");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(hero).not.toHaveAttribute("data-lit");
});
