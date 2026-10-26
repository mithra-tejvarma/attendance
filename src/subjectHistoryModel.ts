import type { Bundle, Subject, Slot } from "./data";
import {
  campusDateKey,
  campusMinutes,
  classEntries,
  timeMinutes,
  slotName,
} from "./schedule";
export type HistoryClass = {
  key: string;
  date: string;
  slot: Slot;
  status: string;
};
export function subjectHistory(
  subject: Subject,
  subjects: Subject[],
  bundles: Record<string, Bundle>,
  now: Date,
): HistoryClass[] {
  const today = campusDateKey(now),
    clock = campusMinutes(now);
  const name = subject.subjectName.trim().toLocaleLowerCase();
  const uniqueName =
    subjects.filter((s) => s.subjectName.trim().toLocaleLowerCase() === name)
      .length === 1;
  return Object.entries(bundles)
    .filter(([date]) => date <= today)
    .flatMap(([date, bundle]) =>
      classEntries(bundle).flatMap(({ slot, status }, index) => {
        const id = slot.subjectId ?? slot.subject?.id;
        const matches =
          id != null && subject.subjectId != null
            ? String(id) === String(subject.subjectId)
            : uniqueName && slotName(slot).trim().toLocaleLowerCase() === name;
        const end = timeMinutes(slot.toTime),
          start = timeMinutes(slot.fromTime);
        const hasMark = status === "Present" || status === "Absent";
        if (
          !matches ||
          (date === today && start !== null && start > clock) ||
          (date === today && !hasMark && (end === null || end > clock))
        )
          return [];
        return [
          {
            key: `${date}:${slot.id ?? slot.classroomTimetableId ?? index}`,
            date,
            slot,
            status,
          },
        ];
      }),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (timeMinutes(b.slot.fromTime) ??
          (typeof b.slot.orderNumber === "number" ? b.slot.orderNumber : -1)) -
          (timeMinutes(a.slot.fromTime) ??
            (typeof a.slot.orderNumber === "number"
              ? a.slot.orderNumber
              : -1)) ||
        b.key.localeCompare(a.key),
    );
}
export function historyTone(status: string) {
  return status === "Present"
    ? "present"
    : status === "Absent"
      ? "absent"
      : "unknown";
}
export function historyDate(date: string) {
  return new Date(date + "T12:00:00+05:30").toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
