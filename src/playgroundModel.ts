import type { Bundle, Subject, Slot } from "./data";
import { requiresAttendance } from "./schedule";
export type PlanChoices = Record<string, "present" | "absent">;
export const planKey = (date: string, slot: Slot, index: number) =>
  `${date}:${String(slot.id ?? `${slot.subjectId ?? slot.subject?.id ?? slot.subjectName}:${slot.fromTime}:${index}`)}`;
export function futureClasses(
  bundles: Record<string, Bundle>,
  today: string,
  end: string,
) {
  return Object.entries(bundles)
    .filter(([date]) => date > today && date <= end)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, bundle]) =>
      bundle.timetable.flatMap((slot, index) =>
        slot.isSuspended || !requiresAttendance(slot)
          ? []
          : [{ date, slot, key: planKey(date, slot, index) }],
      ),
    );
}
export function projectAttendance(
  subjects: Subject[],
  base:
    { present?: number; totalSessionsIncludingActivity?: number } | undefined,
  bundles: Record<string, Bundle>,
  today: string,
  end: string,
  choices: PlanChoices,
) {
  const classes = futureClasses(bundles, today, end);
  let present = 0,
    absent = 0,
    unmatched = 0;
  const future = subjects.map(() => ({ present: 0, absent: 0 }));
  for (const item of classes) {
    const status = choices[item.key] || "present";
    if (status === "present") present++;
    else absent++;
    const id = item.slot.subjectId ?? item.slot.subject?.id,
      name = (
        item.slot.subjectName ??
        item.slot.subject?.name ??
        item.slot.subject?.subjectName ??
        ""
      )
        .trim()
        .toLowerCase();
    const candidates = subjects
      .map((subject, index) => ({ subject, index }))
      .filter(({ subject }) =>
        id !== undefined && subject.subjectId !== undefined
          ? String(subject.subjectId) === String(id)
          : !!name && subject.subjectName.trim().toLowerCase() === name,
      );
    if (candidates.length === 1) future[candidates[0].index][status]++;
    else unmatched++;
  }
  const currentPresent = Number(base?.present),
    currentTotal = Number(base?.totalSessionsIncludingActivity),
    valid =
      Number.isFinite(currentPresent) &&
      Number.isFinite(currentTotal) &&
      currentTotal >= currentPresent &&
      currentPresent >= 0;
  const total = valid ? currentTotal + present + absent : 0,
    attended = valid ? currentPresent + present : 0;
  return {
    present,
    absent,
    unmatched,
    total,
    attended,
    percentage: valid && total ? (attended / total) * 100 : null,
    subjects: subjects.map((s, i) => {
      const total = s.numberOfClasses + future[i].present + future[i].absent;
      return {
        ...s,
        future: future[i],
        projected: total ? ((s.present + future[i].present) / total) * 100 : 0,
      };
    }),
  };
}
