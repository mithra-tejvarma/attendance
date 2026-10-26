import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn } from "./helpers";
import { fixtureDashboard } from "./fixtures";
import { subjectHistory } from "../src/subjectHistoryModel";
import {
  formatClassTime,
  formatClassRange,
  facultyLabel,
  attendanceFor,
} from "../src/schedule";
import type { Bundle, Subject } from "../src/data";
const now = new Date("2026-10-25T07:00:00Z");
const subject: Subject = {
  subjectId: "math",
  subjectName: "Mathematics",
  present: 8,
  numberOfClasses: 10,
  percentage: 80,
};
function day(date: string, status: number | null = 0): Bundle {
  const id = date + "-class";
  return {
    hasRecord: status !== null,
    timetable: [
      {
        id,
        subjectId: "math",
        subjectName: "Mathematics",
        facultyName: "Fixture Lecturer",
        fromTime: "13:00:00",
        toTime: "14:00:00",
      },
    ],
    attendance:
      status === null
        ? []
        : [
            {
              id: date + "-record",
              classroomTimetableId: id,
              subjectId: "math",
              isAbsent: status,
            },
          ],
  };
}
test("12-hour formatting is correct at noon, midnight, AM/PM and invalid input", () => {
  expect(formatClassTime("00:05:00")).toBe("12:05 AM");
  expect(formatClassTime("12:00")).toBe("12:00 PM");
  expect(formatClassTime("13:45:00")).toBe("01:45 PM");
  expect(formatClassTime(" 9:30 AM ")).toBe("09:30 AM");
  expect(formatClassTime("24:00")).toBe("Time unavailable");
  expect(formatClassTime("bad")).toBe("Time unavailable");
  expect(formatClassRange({ fromTime: "09:00", toTime: "10:00" })).toBe(
    "09:00 AM – 10:00 AM",
  );
  expect(
    facultyLabel({
      faculties: [
        { fullName: "Legacy Lecturer", email: "excluded@example.test" },
      ],
    }),
  ).toBe("Legacy Lecturer");
});
test("history keeps personal links, sorts repeated classes and excludes upcoming sessions", () => {
  const past = day("2026-10-24"),
    last = day("2026-09-30", 1);
  past.timetable.push({
    id: "second",
    subjectId: "math",
    subjectName: "Mathematics",
    fromTime: "15:00",
    toTime: "16:00",
  });
  past.attendance.push({
    id: "second-record",
    classroomTimetableId: "second",
    subjectId: "math",
    isAbsent: 1,
  });
  const rows = subjectHistory(
    subject,
    [subject],
    {
      "2026-09-30": last,
      "2026-10-24": past,
      "2026-10-25": day("2026-10-25"),
      "2026-10-26": day("2026-10-26"),
    },
    now,
  );
  expect(rows.map((row) => [row.slot.id, row.status])).toEqual([
    ["second", "Absent"],
    ["2026-10-24-class", "Present"],
    ["2026-09-30-class", "Absent"],
  ]);
  const raw = {
    id: "legacy",
    subjectId: "math",
    studentAttendance: {
      id: "owned",
      classroomTimetableId: "legacy",
      status: true,
    },
  };
  const bundle: Bundle = {
    hasRecord: true,
    timetable: [raw],
    attendance: [{ id: "owned", subjectId: "math", isAbsent: 0 }],
  };
  // Legacy embedded status is not a source of truth without server verification.
  expect(attendanceFor(raw, bundle)).toBe("Present");
  expect(
    attendanceFor(
      {
        ...raw,
        studentAttendance: { ...raw.studentAttendance, id: "other-student" },
      },
      bundle,
    ),
  ).toBe("Not marked");
  expect(
    attendanceFor(raw, {
      ...bundle,
      attendance: [{ id: "owned", subjectId: "different", isAbsent: 0 }],
    }),
  ).toBe("Not marked");
});
test("history does not merge duplicate subject names or assume missing marks are absent", () => {
  const data = day("2026-10-24", null);
  const missing = subjectHistory(
    subject,
    [subject],
    { "2026-10-24": data },
    now,
  );
  expect(missing[0].status).toBe("Not marked");
  const sameNames = [
    { ...subject, subjectId: "one" },
    { ...subject, subjectId: "two" },
  ];
  const ambiguous = {
    ...data,
    timetable: [
      { subjectName: "Mathematics", fromTime: "09:00", toTime: "10:00" },
    ],
  };
  expect(
    subjectHistory(sameNames[0], sameNames, { "2026-10-24": ambiguous }, now),
  ).toEqual([]);
  const onlyRecord = {
    timetable: [],
    attendance: [{ id: "only", subjectId: "math", isAbsent: 1 }],
    hasRecord: true,
  };
  expect(
    subjectHistory(subject, [subject], { "2026-10-24": onlyRecord }, now)[0]
      .status,
  ).toBe("Absent");
});
for (const theme of ["dark", "light"]) {
  test(`${theme} subject results show five boxes, correct details, local pagination and one shared older-month request`, async ({
    page,
  }) => {
    await page.clock.install({ time: now });
    await page.addInitScript(
      (value) => localStorage.setItem("vl-theme", value),
      theme,
    );
    if (theme === "light")
      await page.setViewportSize({ width: 390, height: 844 });
    const data = fixtureDashboard(now);
    data.subjectWise = { overallAttendance: 80, subjects: [subject] };
    data.dailyBundle = {};
    for (let n = 15; n <= 24; n++)
      data.dailyBundle[`2026-10-${n}`] = day(
        `2026-10-${n}`,
        n === 23 ? null : n % 2,
      );
    const months: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/month-complete-data") {
        months.push(String(route.request().postDataJSON().month));
        await route.fulfill({
          json: {
            monthlyCalendar: {},
            dailyBundle: { "2026-09-30": day("2026-09-30", 1) },
          },
        });
      } else await route.fulfill({ json: data });
    });
    await signIn(page, data, false);
    await page
      .getByRole("button", { name: "Subjects", exact: true })
      .first()
      .click();
    const card = page.locator(".subject-card").first();
    await expect(card.locator(".history-box")).toHaveCount(5);
    await expect(card.locator(".history-box").first()).toHaveText(/Present/);
    await expect(card.locator(".history-box").nth(1)).toHaveText(/No mark/);
    expect(months).toEqual([]);
    await card
      .getByRole("button", { name: "Show recent classes for Mathematics" })
      .click();
    await expect(card.locator(".history-detail")).toHaveCount(5);
    await expect(card.locator(".history-detail").first()).toContainText(
      "24 Oct 2026",
    );
    await expect(card.locator(".history-detail").first()).toContainText(
      "01:00 PM – 02:00 PM",
    );
    await expect(card.locator(".history-detail").first()).toContainText(
      "Fixture Lecturer",
    );
    await expect(card.locator(".history-detail").nth(1)).toContainText(
      "No attendance marked",
    );
    await card.getByRole("button", { name: "Load more classes" }).click();
    await expect(card.locator(".history-detail")).toHaveCount(10);
    expect(months).toEqual([]);
    await card
      .getByRole("button", { name: "Load more · earlier month" })
      .click();
    await expect(card.locator(".history-detail")).toHaveCount(11);
    expect(months).toEqual(["9"]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    await page.screenshot({
      path: `/tmp/attendance-${theme}-history.png`,
      fullPage: true,
    });
  });
}
test.describe("first-login guided tour", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const mobile of [false, true])
    test(`${mobile ? "mobile" : "desktop"} tour points to live pages, responds to a click and can be replayed`, async ({
      page,
    }) => {
      await page.clock.install({ time: new Date("2026-10-24T04:00:00Z") });
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await signIn(page, fixtureDashboard(new Date("2026-10-24T04:00:00Z")));
      const tour = page.getByRole("dialog", {
        name: "Your attendance, at a glance",
      });
      await expect(tour).toBeVisible();
      await expect(page.locator(".tour-spotlight")).toBeVisible();
      await page
        .locator(".tour-panel")
        .getByRole("button", { name: "Next", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Follow your day" }),
      ).toBeVisible();
      await page
        .locator(".tour-panel")
        .getByRole("button", { name: "Next", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Five classes, one quick look" }),
      ).toBeVisible();
      await page
        .locator(".subject-history .history-toggle")
        .first()
        .click({ timeout: 5000 });
      await expect(
        page.getByRole("dialog", { name: "See when each class happened" }),
      ).toBeVisible();
      await expect(page.locator(".history-expanded").first()).toBeVisible();
      for (const name of [
        "Choose a day",
        "Plan before you miss a class",
        "Make it comfortable",
        "You’re ready to explore",
      ]) {
        await page
          .locator(".tour-panel")
          .getByRole("button", { name: "Next", exact: true })
          .click();
        await expect(page.getByRole("dialog", { name })).toBeVisible();
        expect(
          await page.locator(".tour-panel").evaluate((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.left >= 0 &&
              r.right <= innerWidth &&
              r.top >= 0 &&
              r.bottom <= innerHeight
            );
          }),
        ).toBe(true);
      }
      const note = page.getByRole("complementary", {
        name: "Your attendance comes from CampX",
      });
      await expect(note).toBeVisible();
      await expect(note).toContainText(
        "Keep your own record of offline attendance and pending corrections",
      );
      await expect(note).toContainText(
        "This app cannot add or correct official attendance",
      );
      const lastScan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(lastScan.violations).toEqual([]);
      await page.screenshot({
        path: `/tmp/attendance-tour-final-${mobile ? "mobile" : "desktop"}.png`,
        fullPage: false,
      });
      await page
        .getByRole("button", { name: "Open settings", exact: true })
        .click();
      await expect(page.locator(".tour-panel")).toHaveCount(0);
      await expect(
        page.getByRole("dialog", { name: "Settings", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => localStorage.getItem("vl-tour-v1")),
      ).toBe("done");
      await page
        .getByRole("button", { name: "Start guided tour", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Your attendance, at a glance" }),
      ).toBeVisible();
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(scan.violations).toEqual([]);
      await page.screenshot({
        path: `/tmp/attendance-tour-${mobile ? "mobile" : "desktop"}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(page.locator(".tour-panel")).toHaveCount(0);
      await signIn(page);
      await expect(page.locator(".tour-panel")).toHaveCount(0);
    });
});

test("a late month response cannot replace classes after the verified academic context changes", async ({
  page,
}) => {
  const date = new Date("2026-10-24T04:00:00Z");
  await page.clock.install({ time: date });
  const base = fixtureDashboard(date),
    fresh = fixtureDashboard(date);
  fresh.dynamicContext = {
    ...fresh.dynamicContext!,
    classroomId: "new-class",
    semNo: "8",
  };
  fresh.dailyBundle = {
    "2026-10-24": {
      timetable: [
        {
          id: "new",
          subjectId: "new",
          subjectName: "New semester class",
          fromTime: "09:00",
          toTime: "10:00",
        },
      ],
      attendance: [{ classroomTimetableId: "new", isAbsent: 0 }],
      hasRecord: true,
    },
  };
  let completeOld: (() => void) | undefined,
    requests = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/attendance")
      await route.fulfill({
        json: {
          ...base,
          dailyBundle: {},
          monthDetailsComplete: false,
          sessionToken: "fixture-session",
        },
      });
    else if (path === "/api/refresh")
      await route.fulfill({
        json: { ...fresh, dailyBundle: {}, monthDetailsComplete: false },
      });
    else if (path === "/api/month-complete-data") {
      if (++requests === 1)
        await new Promise<void>((resolve) => {
          completeOld = () => {
            void route.fulfill({ json: base }).then(resolve);
          };
        });
      else await route.fulfill({ json: fresh });
    } else await route.fulfill({ json: { enabled: false } });
  });
  await signIn(page, base, false);
  await page
    .getByRole("button", { name: "Calendar", exact: true })
    .first()
    .click();
  await expect.poll(() => !!completeOld).toBe(true);
  await page
    .getByRole("button", { name: "Refresh data", exact: true })
    .first()
    .click();
  await expect(page.locator(".student-day-detail")).toContainText(
    "New semester class",
  );
  completeOld!();
  await expect(page.locator(".student-day-detail")).toContainText(
    "New semester class",
  );
  await expect(page.locator(".student-day-detail")).not.toContainText(
    "Machine Learning",
  );
  expect(requests).toBe(2);
});
