import { signIn } from "./helpers";
import { fixtureDashboard } from "./fixtures";
import { test, expect } from "@playwright/test";
import {
  attendanceFor,
  recordStatus,
  classPhase,
  classProgress,
  campusDateKey,
} from "../src/schedule";
import type { Bundle, Slot } from "../src/data";
test("attendance uses explicit flags and never treats a missing record as absent", () => {
  expect(recordStatus({ isAbsent: 0 })).toBe("Present");
  expect(recordStatus({ isAbsent: 1 })).toBe("Absent");
  expect(recordStatus({ isAbsent: 2 })).toBe("Not marked");
  expect(recordStatus()).toBe("Not marked");
  const slot = { subjectId: 3, fromTime: "09:00", toTime: "10:00" };
  const bundle: Bundle = {
    timetable: [slot],
    attendance: [{ subjectId: "3", isAbsent: 0 }],
    hasRecord: true,
  };
  expect(attendanceFor(slot, bundle)).toBe("Present");
  expect(attendanceFor(slot, { ...bundle, attendance: [] })).toBe("Not marked");
  expect(
    attendanceFor(slot, {
      ...bundle,
      attendance: [{ subjectId: 3, isAbsent: 1, fromTime: "11:00" }],
    }),
  ).toBe("Not marked");
});
test("repeated subjects need session identity or time and conflicting records stay unknown", () => {
  const one: Slot = {
      id: 11,
      subjectId: 3,
      fromTime: "09:00",
      toTime: "10:00",
    },
    two: Slot = { id: 12, subjectId: 3, fromTime: "11:00", toTime: "12:00" };
  const bundle: Bundle = {
    timetable: [one, two],
    attendance: [{ subjectId: 3, isAbsent: 0 }],
    hasRecord: true,
  };
  expect(attendanceFor(one, bundle)).toBe("Not marked");
  expect(attendanceFor(two, bundle)).toBe("Not marked");
  expect(
    attendanceFor(one, {
      ...bundle,
      attendance: [{ slotId: 11, isAbsent: 0 }],
    }),
  ).toBe("Present");
  expect(
    attendanceFor(two, {
      ...bundle,
      attendance: [{ subjectId: 3, fromTime: "11:00", isAbsent: 1 }],
    }),
  ).toBe("Absent");
  expect(
    attendanceFor(one, {
      ...bundle,
      attendance: [
        { slotId: 11, isAbsent: 0 },
        { slotId: 11, isAbsent: 1 },
      ],
    }),
  ).toBe("Not marked");
});
test("campus clock handles live boundaries, dates and invalid schedule times", () => {
  const slot = { fromTime: "09:00", toTime: "10:00" };
  expect(classPhase(slot, new Date("2026-10-24T03:29:00Z"))).toBe("Upcoming");
  expect(classPhase(slot, new Date("2026-10-24T03:30:00Z"))).toBe("Live now");
  expect(classProgress(slot, new Date("2026-10-24T04:00:00Z"))).toBe(50);
  expect(classPhase(slot, new Date("2026-10-24T04:30:00Z"))).toBe("Completed");
  expect(classPhase({ fromTime: "bad" }, new Date())).toBe("Time unavailable");
  expect(campusDateKey(new Date("2026-10-24T20:00:00Z"))).toBe("2026-10-25");
});
test("overview is focused and the live class changes without fetching attendance", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-24T04:00:00Z") });
  await page.goto("/");
  await signIn(page, fixtureDashboard(new Date("2026-10-24T04:00:00Z")));
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Subject breakdown" }),
  ).toHaveCount(0);
  await expect(page.locator(".calendar-card")).toHaveCount(0);
  await expect(page.locator(".class-live")).toContainText("Machine Learning");
  await expect(page.locator(".class-live")).toContainText("Present");
  await expect(
    page.locator(".timeline-row").filter({ hasText: "Cloud Computing" }),
  ).toContainText("Absent");
  await expect(
    page.locator(".timeline-row").filter({ hasText: "Data Analytics" }),
  ).toContainText("Not marked");
  await page.clock.fastForward(31 * 60 * 1000);
  await expect(page.locator(".class-live")).toContainText("Cloud Computing");
});

test("normalized exact links distinguish repeated subjects and cancelled classes are never live", () => {
  const first = {
      id: "slot-1",
      subjectId: "math",
      fromTime: "09:00",
      toTime: "10:00",
    },
    second = {
      id: "slot-2",
      subjectId: "math",
      fromTime: "11:00",
      toTime: "12:00",
    };
  const bundle: Bundle = {
    timetable: [first, second],
    attendance: [
      {
        id: "record-1",
        classroomTimetableId: "slot-1",
        subjectId: "math",
        isAbsent: 0,
      },
      {
        id: "record-2",
        classroomTimetableId: "slot-2",
        subjectId: "math",
        isAbsent: 1,
      },
    ],
    hasRecord: true,
  };
  expect(attendanceFor(first, bundle)).toBe("Present");
  expect(attendanceFor(second, bundle)).toBe("Absent");
  const cancelled = { ...first, isSuspended: true };
  expect(classPhase(cancelled, new Date("2026-10-24T04:00:00Z"))).toBe(
    "Cancelled",
  );
  expect(classProgress(cancelled, new Date("2026-10-24T04:00:00Z"))).toBe(0);
  expect(attendanceFor({ ...first, attendanceRequired: false }, bundle)).toBe(
    "Not required",
  );
});
