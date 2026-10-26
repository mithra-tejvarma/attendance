import type { Bundle, Slot } from "./data";
export const CAMPUS_ZONE = "Asia/Kolkata";
export function campusDateKey(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAMPUS_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (name: string) => parts.find((p) => p.type === name)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function campusMinutes(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAMPUS_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return (
    Number(parts.find((p) => p.type === "hour")?.value) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value)
  );
}
export function timeMinutes(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 23 || (match[3] && (h < 1 || h > 12))) return null;
  if (match[3]) h = (h % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return h * 60 + m;
}
export function classPhase(slot: Slot, now: Date) {
  if (slot.isSuspended === true) return "Cancelled";
  const start = timeMinutes(slot.fromTime),
    end = timeMinutes(slot.toTime);
  if (start === null || end === null || end <= start) return "Time unavailable";
  const clock = campusMinutes(now);
  return clock < start ? "Upcoming" : clock < end ? "Live now" : "Completed";
}
export function classProgress(slot: Slot, now: Date) {
  if (slot.isSuspended === true) return 0;
  const start = timeMinutes(slot.fromTime),
    end = timeMinutes(slot.toTime);
  if (start === null || end === null || end <= start) return 0;
  return Math.max(
    0,
    Math.min(100, ((campusMinutes(now) - start) / (end - start)) * 100),
  );
}
export function recordStatus(record?: Slot) {
  if (record?.isAbsent === 0 || record?.isAbsent === false) return "Present";
  if (record?.isAbsent === 1 || record?.isAbsent === true) return "Absent";
  return "Not marked";
}
const subjectId = (s: Slot) => s.subjectId ?? s.subject?.id;
const same = (a: unknown, b: unknown) =>
  a !== undefined &&
  a !== null &&
  b !== undefined &&
  b !== null &&
  String(a) === String(b);
export function matchingAttendance(
  slot: Slot,
  bundle: Bundle,
): Slot | undefined {
  const records = bundle.attendance || [];
  const exact = records.filter((r) =>
    ["classroomTimetableId", "timetableId", "slotId"].some(
      (key) => same(slot[key], r[key]) || same(slot.id, r[key]),
    ),
  );
  if (exact.length) {
    if (exact.length !== 1) return undefined;
    const record = exact[0],
      left = subjectId(slot),
      right = subjectId(record);
    return left != null && right != null && !same(left, right)
      ? undefined
      : record;
  }
  // Legacy Render responses carry the exact class link inside studentAttendance.
  // Read the flag only from the already-owned my-classes record, never from an
  // unverified embedded student's status.
  const nested = slot.studentAttendance;
  if (
    nested &&
    typeof nested === "object" &&
    "id" in nested &&
    "classroomTimetableId" in nested
  ) {
    if (!same(slot.id, nested.classroomTimetableId)) return undefined;
    const linked = records.filter((record) => same(record.id, nested.id));
    if (linked.length !== 1) return undefined;
    const record = linked[0];
    return subjectId(slot) != null &&
      subjectId(record) != null &&
      !same(subjectId(slot), subjectId(record))
      ? undefined
      : record;
  }
  const timed = records.filter(
    (r) =>
      same(subjectId(slot), subjectId(r)) &&
      timeMinutes(slot.fromTime) !== null &&
      timeMinutes(r.fromTime) === timeMinutes(slot.fromTime) &&
      (!r.toTime || timeMinutes(r.toTime) === timeMinutes(slot.toTime)),
  );
  if (timed.length) return timed.length === 1 ? timed[0] : undefined;
  // Subject-only matching is safe only when the subject occurs once in each dataset.
  const subjects = records.filter((r) => same(subjectId(slot), subjectId(r)));
  if (
    subjects.length === 1 &&
    bundle.timetable.filter((s) => same(subjectId(slot), subjectId(s)))
      .length === 1
  ) {
    const r = subjects[0];
    if (
      r.fromTime &&
      slot.fromTime &&
      timeMinutes(r.fromTime) !== timeMinutes(slot.fromTime)
    )
      return undefined;
    return r;
  }
  return undefined;
}

export function requiresAttendance(slot: Slot) {
  return typeof slot.attendanceRequired === "boolean"
    ? slot.attendanceRequired
    : slot.subject?.subjectType?.hasAttendance !== false;
}
export function attendanceFor(slot: Slot, bundle: Bundle) {
  return !requiresAttendance(slot)
    ? "Not required"
    : recordStatus(matchingAttendance(slot, bundle));
}
export function daySummary(bundle?: Bundle) {
  const rows = bundle?.attendance || [],
    required = (bundle?.timetable || []).filter(
      (slot) => requiresAttendance(slot) && slot.isSuspended !== true,
    );
  return {
    present: rows.filter((r) => recordStatus(r) === "Present").length,
    absent: rows.filter((r) => recordStatus(r) === "Absent").length,
    pending: required.filter(
      (slot) => attendanceFor(slot, bundle!) === "Not marked",
    ).length,
    scheduled: bundle?.timetable.length || 0,
  };
}
export type DayState =
  "present" | "absent" | "partial" | "pending" | "unknown" | "holiday";
export const dayLabels: Record<DayState, string> = {
  present: "All classes attended",
  absent: "All classes missed",
  partial: "Mixed attendance",
  pending: "Partially marked",
  unknown: "No confirmed attendance",
  holiday: "Holiday",
};
export function dayState(raw: string | undefined, bundle?: Bundle): DayState {
  const status = raw?.toLowerCase(),
    summary = daySummary(bundle);
  if (summary.present && summary.absent) return "partial";
  if (summary.pending && (summary.present || summary.absent)) return "pending";
  if (
    (status === "present" && summary.absent > 0) ||
    (status === "absent" && summary.present > 0)
  )
    return "pending";
  if (
    status === "present" ||
    status === "absent" ||
    status === "partial" ||
    status === "holiday"
  )
    return status;
  const required = (bundle?.timetable || []).filter(
    (slot) => requiresAttendance(slot) && slot.isSuspended !== true,
  );
  if (required.length && !summary.pending) {
    const states = required.map((slot) => attendanceFor(slot, bundle!));
    if (states.every((state) => state === "Present")) return "present";
    if (states.every((state) => state === "Absent")) return "absent";
    if (states.includes("Present") && states.includes("Absent"))
      return "partial";
  }
  return summary.present || summary.absent ? "pending" : "unknown";
}

export function formatClassTime(value: unknown) {
  const total = timeMinutes(value);
  if (total === null) return "Time unavailable";
  const hour = Math.floor(total / 60);
  return `${String(hour % 12 || 12).padStart(2, "0")}:${String(total % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
export function formatClassRange(slot: Slot) {
  const start = formatClassTime(slot.fromTime),
    end = formatClassTime(slot.toTime);
  return start === "Time unavailable" && end === "Time unavailable"
    ? "Time unavailable"
    : `${start} – ${end}`;
}
export function slotName(slot: Slot) {
  return (
    slot.subjectName ||
    slot.subject?.subjectName ||
    slot.subject?.name ||
    "Scheduled class"
  );
}
export function classEntries(bundle: Bundle) {
  const represented = new Set<Slot>();
  const scheduled = bundle.timetable.map((slot) => {
    const record = matchingAttendance(slot, bundle);
    if (record) represented.add(record);
    return {
      slot,
      status:
        slot.isSuspended && !record ? "Cancelled" : attendanceFor(slot, bundle),
    };
  });
  return [
    ...scheduled,
    ...bundle.attendance
      .filter((row) => !represented.has(row))
      .map((slot) => ({ slot, status: recordStatus(slot) })),
  ];
}

export function facultyLabel(slot: Slot) {
  if (typeof slot.facultyName === "string" && slot.facultyName.trim())
    return slot.facultyName;
  if (Array.isArray(slot.faculties)) {
    const names = slot.faculties
      .flatMap((f) =>
        f && typeof f === "object" && typeof f.fullName === "string"
          ? [f.fullName.slice(0, 120)]
          : [],
      )
      .slice(0, 3);
    if (names.length) return names.join(", ");
  }
  return "Faculty not provided";
}
