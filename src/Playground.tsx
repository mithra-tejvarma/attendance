import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Check,
  SlidersHorizontal,
  CalendarDays,
} from "lucide-react";
import type { Bundle, Dashboard } from "./data";
import { dayKey, monthKey } from "./data";
import { campusDateKey, formatClassRange, facultyLabel } from "./schedule";
import {
  futureClasses,
  projectAttendance,
  type PlanChoices,
} from "./playgroundModel";
import { Planner } from "./components";
export function Playground({
  data,
  bundles,
  date,
  move,
  ready,
  loading,
  error,
  retry,
  choices,
  setChoices,
  end,
  setEnd,
}: {
  data: Dashboard;
  bundles: Record<string, Bundle>;
  date: Date;
  move: (n: number) => void;
  ready: boolean;
  loading: boolean;
  error: string;
  retry: () => void;
  choices: PlanChoices;
  setChoices: (choices: PlanChoices) => void;
  end: string;
  setEnd: (date: string) => void;
}) {
  const [mode, setMode] = useState<"daywise" | "classwise">("daywise"),
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState<"calendar" | "quick">("calendar");
  const today = campusDateKey(new Date()),
    subjects = data.subjectWise?.subjects || [],
    projection = projectAttendance(
      subjects,
      data.primary?.primaryAttendance,
      bundles,
      today,
      end,
      choices,
    );
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(),
    first = (date.getDay() + 6) % 7;
  const classes = futureClasses(bundles, today, end),
    days = Array.from({ length: count }, (_, i) => {
      const key = dayKey(new Date(date.getFullYear(), date.getMonth(), i + 1));
      return {
        key,
        number: i + 1,
        classes: classes.filter((c) => c.date === key),
      };
    });
  const current = selected?.startsWith(monthKey(date))
    ? selected
    : days.find((d) => d.classes.length)?.key;
  const items = classes.filter((item) => item.date === current);
  function markDay(key: string, status: "present" | "absent") {
    const next = { ...choices };
    for (const item of classes.filter((c) => c.date === key))
      next[item.key] = status;
    setChoices(next);
  }
  return (
    <div className="playground">
      <div className="segmented" aria-label="Playground view">
        <button
          aria-pressed={tab === "calendar"}
          onClick={() => setTab("calendar")}
        >
          <CalendarDays size={16} />
          Calendar plan
        </button>
        <button aria-pressed={tab === "quick"} onClick={() => setTab("quick")}>
          <SlidersHorizontal size={16} />
          Quick calculator
        </button>
      </div>
      {tab === "quick" ? (
        <Planner subjects={subjects} />
      ) : (
        <>
          <section className="glass playground-summary">
            <div>
              <span className="eyebrow">YOUR WHAT-IF SCENARIO</span>
              <strong
                className={
                  projection.percentage !== null && projection.percentage < 75
                    ? "scenario-low"
                    : projection.percentage !== null &&
                        projection.percentage < 77
                      ? "scenario-risk"
                      : "scenario-safe"
                }
              >
                {projection.percentage === null
                  ? "—"
                  : projection.percentage.toFixed(1) + "%"}
              </strong>
              <p>
                Projected from class counts · {projection.attended}/
                {projection.total} classes
              </p>
            </div>
            <div className="scenario-counts">
              <span>
                <b>{projection.present}</b>future present
              </span>
              <span>
                <b>{projection.absent}</b>future absent
              </span>
            </div>
            <label>
              Plan through
              <input
                type="date"
                min={today}
                value={end}
                onChange={(e) => {
                  if (e.target.value >= today) setEnd(e.target.value);
                }}
              />
            </label>
            <button className="button secondary" onClick={() => setChoices({})}>
              <RotateCcw size={15} />
              Reset scenario
            </button>
          </section>
          <p className="playground-note">
            Only loaded future timetables are included. Unedited future classes
            assume Present. This is a simulation; your official attendance never
            changes.
          </p>
          <div className="calendar-page">
            <section className="glass student-calendar">
              <div className="section-title">
                <div>
                  <span className="eyebrow">CHOOSE YOUR FUTURE DAYS</span>
                  <h2>
                    {date.toLocaleDateString("en-IN", {
                      month: "long",
                      year: "numeric",
                    })}
                  </h2>
                </div>
                <div className="calendar-controls">
                  <button
                    aria-label="Previous playground month"
                    onClick={() => move(-1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    aria-label="Next playground month"
                    onClick={() => move(1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
              <div className="segmented plan-mode">
                <button
                  aria-pressed={mode === "daywise"}
                  onClick={() => setMode("daywise")}
                >
                  Day-wise
                </button>
                <button
                  aria-pressed={mode === "classwise"}
                  onClick={() => setMode("classwise")}
                >
                  Class-wise
                </button>
              </div>
              {loading && (
                <p role="status" className="calendar-message">
                  Loading selected month…
                </p>
              )}
              {error && (
                <div role="alert" className="calendar-error">
                  {error}
                  <button className="text-button" onClick={retry}>
                    Try again
                  </button>
                </div>
              )}
              <div className="calendar-grid">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <span className="weekday" key={d}>
                    {d}
                  </span>
                ))}
                {Array.from({ length: first }, (_, i) => (
                  <span key={"blank" + i} />
                ))}
                {days.map((day) => {
                  const editable =
                      ready &&
                      !loading &&
                      day.key > today &&
                      day.key <= end &&
                      day.classes.length > 0,
                    miss = day.classes.filter(
                      (c) => choices[c.key] === "absent",
                    ).length;
                  return (
                    <button
                      key={day.key}
                      disabled={!editable}
                      aria-label={`${day.key}: ${editable ? `${day.classes.length - miss} planned present, ${miss} planned absent` : "not editable"}`}
                      className={`calendar-day ${editable ? (miss === 0 ? "present" : miss === day.classes.length ? "absent" : "partial") : "unknown"} ${current === day.key ? "selected" : ""}`}
                      onClick={() => {
                        setSelected(day.key);
                        if (mode === "daywise")
                          markDay(day.key, miss ? "present" : "absent");
                      }}
                    >
                      <span className="day-number">{day.number}</span>
                      {editable && (
                        <small>
                          {day.classes.length - miss}/{day.classes.length}
                        </small>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="calendar-hint">
                {mode === "daywise"
                  ? "Tap a future day to toggle all its classes."
                  : "Choose a future day, then change individual classes."}{" "}
                Past dates and today stay read-only. Empty dates are not assumed
                to be holidays.
              </p>
            </section>
            <section className="glass day-detail student-day-detail">
              <div className="day-detail-heading">
                <span className="eyebrow">CLASS-BY-CLASS PLAN</span>
                <h2>
                  {current
                    ? new Date(current + "T12:00:00").toLocaleDateString(
                        "en-IN",
                        { weekday: "long", day: "numeric", month: "long" },
                      )
                    : "No future classes loaded"}
                </h2>
                <p>
                  {items.length
                    ? "Change a class below or mark the whole day."
                    : "Navigate to a future month to load its real timetable. No classes are invented."}
                </p>
              </div>
              {items.length > 0 && (
                <>
                  <div className="plan-day-actions">
                    <button
                      className="button secondary"
                      onClick={() => markDay(current!, "present")}
                    >
                      All present
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => markDay(current!, "absent")}
                    >
                      All absent
                    </button>
                  </div>
                  <div className="day-class-list">
                    {items.map((item, i) => (
                      <div className="detail-row" key={item.key}>
                        <div className="class-order">{i + 1}</div>
                        <div className="detail-content">
                          <strong>
                            {item.slot.subjectName ||
                              item.slot.subject?.name ||
                              "Scheduled class"}
                          </strong>
                          <span>{formatClassRange(item.slot)}</span>
                          {item.slot.facultyName && (
                            <small>{item.slot.facultyName}</small>
                          )}
                        </div>
                        <button
                          role="switch"
                          aria-checked={choices[item.key] !== "absent"}
                          aria-label={`Plan ${item.slot.subjectName || item.slot.subject?.name || "class"} as present`}
                          className={`attendance-badge ${choices[item.key] === "absent" ? "marked-absent" : "marked-present"}`}
                          onClick={() =>
                            setChoices({
                              ...choices,
                              [item.key]:
                                choices[item.key] === "absent"
                                  ? "present"
                                  : "absent",
                            })
                          }
                        >
                          {choices[item.key] === "absent" ? (
                            "Absent"
                          ) : (
                            <>
                              <Check size={13} />
                              Present
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
          <section className="glass scenario-subjects">
            <div className="section-title">
              <div>
                <span className="eyebrow">THE EFFECT ON EACH SUBJECT</span>
                <h2>Subject projections</h2>
              </div>
            </div>
            {projection.subjects.map((s, i) => (
              <div className="scenario-subject" key={i}>
                <div>
                  <strong>{s.subjectName}</strong>
                  <span>
                    {s.percentage.toFixed(1)}% now · +{s.future.present} present
                    / +{s.future.absent} absent
                  </span>
                </div>
                <b
                  className={
                    s.projected >= 77
                      ? "scenario-safe"
                      : s.projected >= 75
                        ? "scenario-risk"
                        : "scenario-low"
                  }
                >
                  {s.projected.toFixed(1)}%
                </b>
              </div>
            ))}
            <p className="calendar-hint">
              75% is a reference minimum; 77% is a buffer, not an institutional
              rule. One timetable row counts as one class. Secondary attendance,
              exemptions and future schedule changes may change the official
              result.
              {projection.unmatched > 0
                ? ` ${projection.unmatched} planned classes have no unique subject match and appear only in the overall projection.`
                : ""}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
export function initialPlanEnd() {
  const now = new Date(campusDateKey(new Date()) + "T12:00:00");
  now.setDate(now.getDate() + 30);
  return dayKey(now);
}
