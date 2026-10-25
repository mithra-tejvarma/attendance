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
function minutes(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 23 || (match[3] && (h < 1 || h > 12))) return null;
  if (match[3]) h = (h % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return h * 60 + m;
}
export function classPhase(slot: Slot, now: Date) {
  if (slot.isSuspended === true) return "Cancelled";
  const start = minutes(slot.fromTime),
    end = minutes(slot.toTime);
  if (start === null || end === null || end <= start) return "Time unavailable";
  const clock = campusMinutes(now);
  return clock < start ? "Upcoming" : clock < end ? "Live now" : "Completed";
}
export function classProgress(slot: Slot, now: Date) {
  if (slot.isSuspended === true) return 0;
  const start = minutes(slot.fromTime),
    end = minutes(slot.toTime);
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
export function attendanceFor(slot: Slot, bundle: Bundle) {
  if (slot.attendanceRequired === false) return "Not required";
  const records = bundle.attendance || [];
  const exact = records.filter((r) =>
    ["classroomTimetableId", "timetableId", "slotId"].some(
      (key) => same(slot[key], r[key]) || same(slot.id, r[key]),
    ),
  );
  if (exact.length)
    return exact.length === 1 ? recordStatus(exact[0]) : "Not marked";
  const timed = records.filter(
    (r) =>
      same(subjectId(slot), subjectId(r)) &&
      minutes(slot.fromTime) !== null &&
      minutes(r.fromTime) === minutes(slot.fromTime) &&
      (!r.toTime || minutes(r.toTime) === minutes(slot.toTime)),
  );
  if (timed.length)
    return timed.length === 1 ? recordStatus(timed[0]) : "Not marked";
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
      minutes(r.fromTime) !== minutes(slot.fromTime)
    )
      return "Not marked";
    return recordStatus(r);
  }
  return "Not marked";
}
