import { SubjectHistory } from "./SubjectHistory";
import { subjectHistory } from "./subjectHistory";
import { NotificationSettings } from "./NotificationSettings";
import {
  attendanceFor,
  matchingAttendance,
  dayState,
  dayLabels,
  daySummary,
  recordStatus,
  classPhase,
  classProgress,
  CAMPUS_ZONE,
  campusDateKey,
  formatClassTime,
  formatClassRange,
  slotName,
  facultyLabel,
} from "./schedule";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Sun,
  Moon,
  LogOut,
  Check,
  ChevronLeft,
  ChevronRight,
  Bell,
  ShieldCheck,
  Download,
  Sparkles,
  Eye,
  EyeOff,
  LoaderCircle,
} from "lucide-react";
import { dayKey, type Bundle, type Subject, type Student } from "./data";
import type { Credentials } from "./api";
export type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const pct = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const fmtMonth = (date: Date) =>
  date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
export function HelpDialog({
  close,
  children,
}: {
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="glass help-dialog"
      aria-labelledby="help-title"
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      {children}
    </dialog>
  );
}
export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Attendance home">
      <span className="brand-mark">
        <img src="/icon.svg" alt="" aria-hidden="true" />
      </span>
      <span>
        attendance<span className="brand-by">BY VARMA LABS</span>
      </span>
    </a>
  );
}
export function Login({
  busy,
  error,
  login: submit,
}: {
  busy: boolean;
  error: string;
  login: (c: Credentials) => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false);
  return (
    <div className="login-page simple-login">
      <header>
        <Brand />
      </header>
      <main className="login-layout">
        <section className="glass login-card">
          <div className="login-emblem">
            <img src="/icon.svg" alt="" />
          </div>
          <span className="eyebrow">YOUR STUDENT WORKSPACE</span>
          <h1>Sign in</h1>
          <p>Use your CampX email and password.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit({ loginId: email.trim(), password });
            }}
          >
            <label htmlFor="login-email">CampX email or login ID</label>
            <input
              id="login-email"
              name="username"
              autoComplete="username"
              inputMode="email"
              placeholder="Your college email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={busy}
            />
            <label className="password-label" htmlFor="login-password">
              Password
            </label>
            <div className="password-field">
              <input
                id="login-password"
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={busy}
              />
              <button
                type="button"
                aria-label={show ? "Hide password" : "Show password"}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary login-submit" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle size={18} className="spin" />
                  Connecting to CampX…
                </>
              ) : (
                <>
                  Open my dashboard
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="privacy-note">
            <ShieldCheck size={16} />
            <span>Your password isn’t saved in browser storage.</span>
          </div>
        </section>
      </main>
      <footer className="login-footer">
        <span>Attendance by Varma Labs</span>
        <span>Independent student app</span>
      </footer>
    </div>
  );
}
export function SectionTitle({
  kicker,
  title,
  action,
}: {
  kicker: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <span className="eyebrow">{kicker}</span>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
export function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value?: number;
  note: string;
  icon: string;
}) {
  return (
    <section className="glass stat-card">
      <div className={`stat-icon ${icon}`}>
        {icon === "present" ? (
          <Check size={19} />
        ) : icon === "absent" ? (
          <ArrowUpRight size={19} />
        ) : (
          <BookOpen size={19} />
        )}
      </div>
      <div>
        <span>{label}</span>
        <strong>{value ?? "—"}</strong>
      </div>
      <small>{note}</small>
    </section>
  );
}
export function Subjects({
  subjects,
  compact = false,
  history,
}: {
  subjects: Subject[];
  compact?: boolean;
  history?: {
    bundles: Record<string, Bundle>;
    now: Date;
    loading: boolean;
    error: string;
    retry: () => void;
    loadOlder: () => Promise<boolean>;
    olderLoading: boolean;
    olderError: string;
    range: string;
  };
}) {
  return (
    <div className="subject-list">
      {!subjects.length ? (
        <Empty
          title="No subject data yet"
          text="Refresh to retrieve available subject records from CampX."
        />
      ) : (
        subjects.slice(0, compact ? 5 : undefined).map((s, i) => {
          const n = pct(s.percentage);
          return (
            <article
              className="subject-card"
              key={`${s.subjectId ?? s.subjectName}-${i}`}
            >
              <div className="subject-row">
                <div className={`subject-symbol color-${i % 5}`}>
                  <BookOpen size={18} />
                </div>
                <div className="subject-info">
                  <strong>{s.subjectName}</strong>
                  <span>
                    {s.present ?? "—"} of {s.numberOfClasses ?? "—"} classes
                    attended
                  </span>
                  <div className="progress-track">
                    <i
                      className={`color-${i % 5}`}
                      style={{ width: `${clamp(n)}%` }}
                    />
                    <b style={{ left: "75%" }} />
                  </div>
                </div>
                <div className={`subject-percent ${n < 75 ? "low" : ""}`}>
                  <strong>
                    {n.toFixed(1)}
                    <small>%</small>
                  </strong>
                  <span>{n >= 75 ? "On track" : "Below target"}</span>
                </div>
              </div>
              {history && !compact && (
                <SubjectHistory
                  name={s.subjectName}
                  rows={subjectHistory(
                    s,
                    subjects,
                    history.bundles,
                    history.now,
                  )}
                  {...history}
                />
              )}
            </article>
          );
        })
      )}
    </div>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <CalendarDays size={26} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function AttendanceBadge({ status }: { status: string }) {
  return (
    <span
      className={`attendance-badge ${status === "Present" ? "marked-present" : status === "Absent" ? "marked-absent" : "unmarked"}`}
    >
      {status === "Present" ? (
        <Check size={13} />
      ) : status === "Absent" ? (
        <span aria-hidden="true">×</span>
      ) : (
        <span aria-hidden="true">·</span>
      )}
      {status}
    </span>
  );
}
function RecordedClassRow({ record }: { record: import("./data").Slot }) {
  return (
    <div className="timeline-row record-only">
      <BookOpen size={18} />
      <div className="class-content">
        <h3>{slotName(record)}</h3>
        <p className="record-time">{formatClassRange(record)}</p>
        <p className="class-meta">{facultyLabel(record)}</p>
        <p className="slot-note">Recorded attendance · schedule unavailable</p>
      </div>
      <AttendanceBadge status={recordStatus(record)} />
    </div>
  );
}
export function Today({ bundle, now }: { bundle?: Bundle; now: Date }) {
  const clock = now.toLocaleTimeString("en-IN", {
    timeZone: CAMPUS_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const timetable = bundle?.timetable || [];
  const represented = new Set(
    timetable.map((slot) => matchingAttendance(slot, bundle!)).filter(Boolean),
  );
  const extra = (bundle?.attendance || []).filter(
    (record) => !represented.has(record),
  );
  return (
    <section className="glass today-card" data-tour="today">
      <SectionTitle
        kicker="YOUR DAY, IN MOTION"
        title="Today’s classes"
        action={
          <span className="schedule-clock">
            <i />
            {clock} <small>IST</small>
          </span>
        }
      />
      {timetable.length ? (
        <div className="timeline">
          {timetable.map((slot, i) => {
            const phase = classPhase(slot, now),
              live = phase === "Live now",
              status = attendanceFor(slot, bundle!);
            return (
              <div
                className={`timeline-row ${live ? "class-live" : ""} ${phase === "Completed" ? "class-complete" : ""}`}
                key={i}
              >
                <div className="timeline-marker" />
                <div className="class-time">
                  <span>{formatClassTime(slot.fromTime)}</span>
                  <small>{formatClassTime(slot.toTime)}</small>
                </div>
                <div className="class-content">
                  <div className="class-heading">
                    <h3>{slotName(slot)}</h3>
                    <span className={`phase-label ${live ? "is-live" : ""}`}>
                      {live && <i />}
                      {phase}
                    </span>
                  </div>
                  <div className="class-meta">
                    {(slot.subjectCode || slot.subject?.subjectCode) && (
                      <span>
                        {slot.subjectCode || slot.subject?.subjectCode}
                      </span>
                    )}
                    <span>{facultyLabel(slot)}</span>
                  </div>
                  <p className="slot-note">
                    {status === "Not required"
                      ? "Attendance is not required for this class"
                      : status === "Not marked"
                        ? "No confirmed attendance record"
                        : `Attendance marked ${status.toLowerCase()}`}
                  </p>
                  {live && (
                    <div
                      className="class-progress"
                      role="progressbar"
                      aria-label={`${slotName(slot)} class progress`}
                      aria-valuenow={Math.round(classProgress(slot, now))}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span style={{ width: `${classProgress(slot, now)}%` }} />
                    </div>
                  )}
                </div>
                <AttendanceBadge status={status} />
              </div>
            );
          })}
          {extra.map((record, i) => (
            <RecordedClassRow record={record} key={`extra-${record.id ?? i}`} />
          ))}
        </div>
      ) : bundle?.attendance?.length ? (
        <div className="timeline">
          {bundle.attendance.map((record, i) => (
            <RecordedClassRow record={record} key={String(record.id ?? i)} />
          ))}
        </div>
      ) : (
        <Empty
          title="No classes to show"
          text={
            bundle
              ? "No scheduled classes were returned for today. This does not confirm a holiday."
              : "Today’s schedule is not available. Refresh to check for new data."
          }
        />
      )}
      <div className="schedule-footer">
        <span className="clock-dot" />
        Class timing follows campus time (IST). Refresh for newly marked
        attendance.
      </div>
    </section>
  );
}
export function Calendar({
  date,
  statuses,
  bundles,
  move,
  select,
  selected,
  loading,
  error,
  retry,
}: {
  date: Date;
  statuses: Record<string, string>;
  bundles: Record<string, Bundle>;
  move: (n: number) => void;
  select: (s: string) => void;
  selected: string | null;
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  const first =
      (new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7,
    count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: count }, (_, i) => {
    const key = dayKey(new Date(date.getFullYear(), date.getMonth(), i + 1));
    return {
      key,
      number: i + 1,
      state: dayState(statuses[key], bundles[key]),
      summary: daySummary(bundles[key]),
    };
  });
  const today = campusDateKey(new Date()),
    current = new Date(today + "T12:00:00");
  return (
    <section
      className="glass calendar-card student-calendar"
      aria-label="Attendance calendar"
      aria-busy={loading}
    >
      <SectionTitle
        kicker="ONE DAY AT A TIME"
        title={fmtMonth(date)}
        action={
          <div className="calendar-controls">
            <button aria-label="Previous month" onClick={() => move(-1)}>
              <ChevronLeft size={18} />
            </button>
            <button
              className="calendar-today"
              onClick={() =>
                move(
                  (current.getFullYear() - date.getFullYear()) * 12 +
                    current.getMonth() -
                    date.getMonth(),
                )
              }
            >
              Today
            </button>
            <button aria-label="Next month" onClick={() => move(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        }
      />
      <div className="month-summary">
        <span className="month-present">
          <strong>{days.filter((d) => d.state === "present").length}</strong>
          full present
        </span>
        <span className="month-partial">
          <strong>{days.filter((d) => d.state === "partial").length}</strong>
          mixed
        </span>
        <span className="month-absent">
          <strong>{days.filter((d) => d.state === "absent").length}</strong>full
          absent
        </span>
      </div>
      {loading && (
        <p className="calendar-message" role="status">
          <LoaderCircle size={14} className="spin" />
          Loading this month…
        </p>
      )}
      {error && (
        <div className="calendar-error" role="alert">
          <span>{error}</span>
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
          <span key={"gap" + i} />
        ))}
        {days.map((day) => (
          <button
            key={day.key}
            className={`calendar-day ${day.state} ${day.key === today ? "today" : ""} ${selected === day.key ? "selected" : ""}`}
            aria-label={`${day.key}: ${dayLabels[day.state]}`}
            aria-pressed={selected === day.key}
            onClick={() => select(day.key)}
          >
            <span className="day-number">{day.number}</span>
            {day.summary.present + day.summary.absent > 0 ? (
              <small>
                {day.summary.present}/{day.summary.present + day.summary.absent}
              </small>
            ) : (
              <span className="day-marker" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      <div className="calendar-legend">
        <span>
          <i className="present" />
          Full present
        </span>
        <span>
          <i className="partial" />
          Mixed
        </span>
        <span>
          <i className="absent" />
          Full absent
        </span>
        <span>
          <i className="pending" />
          Awaiting marks
        </span>
        <span>
          <i />
          Unmarked
        </span>
      </div>
      <p className="calendar-hint">
        Select a day for class-by-class attendance. Fractions show attended /
        marked classes.
      </p>
    </section>
  );
}
export function DayDetails({
  date,
  bundle,
  loading = false,
  error = "",
}: {
  date: string | null;
  bundle?: Bundle;
  loading?: boolean;
  error?: string;
}) {
  const summary = daySummary(bundle),
    represented = new Set(
      (bundle?.timetable || [])
        .map((slot) => matchingAttendance(slot, bundle!))
        .filter(Boolean),
    );
  const extra = (bundle?.attendance || []).filter(
    (record) => !represented.has(record),
  );
  return (
    <section
      className="glass day-detail student-day-detail"
      aria-label="Selected day details"
      aria-busy={loading}
      aria-live="polite"
    >
      <div className="day-detail-heading">
        <span className="eyebrow">YOUR DAILY RECORD</span>
        <h2>
          {date
            ? new Date(date + "T12:00:00").toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : "Choose a day"}
        </h2>
        <p>
          {loading
            ? "Fetching class details…"
            : error
              ? "Day details could not be refreshed."
              : date
                ? "Your classes and their recorded attendance."
                : "Tap a date on the calendar to see your classes."}
        </p>
      </div>
      {loading ? (
        <div className="day-loading" role="status">
          <LoaderCircle size={23} className="spin" />
          Loading attendance…
        </div>
      ) : error ? (
        <Empty
          title="Details unavailable"
          text="Retry the month to retrieve this day’s attendance."
        />
      ) : date && bundle ? (
        <>
          <div className="day-summary">
            <span className="present">
              <strong>{summary.present}</strong>Present
            </span>
            <span className="absent">
              <strong>{summary.absent}</strong>Absent
            </span>
            <span className="pending">
              <strong>{summary.pending}</strong>Unmarked
            </span>
          </div>
          {bundle.timetable.length || extra.length ? (
            <div className="day-class-list">
              {bundle.timetable.map((slot, i) => (
                <div className="detail-row" key={String(slot.id ?? i)}>
                  <div className="class-order">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="detail-content">
                    <strong>{slotName(slot)}</strong>
                    <span>
                      {formatClassRange(slot)}
                      {slot.isSuspended ? " · Cancelled" : ""}
                    </span>
                    {(slot.subjectCode || slot.subject?.subjectCode) && (
                      <small>
                        {slot.subjectCode || slot.subject?.subjectCode}
                      </small>
                    )}
                    <small>{facultyLabel(slot)}</small>
                  </div>
                  <AttendanceBadge status={attendanceFor(slot, bundle)} />
                </div>
              ))}
              {extra.length > 0 && bundle.timetable.length > 0 && (
                <h3 className="extra-record-title">Other recorded classes</h3>
              )}
              {extra.map((record, i) => (
                <div className="detail-row" key={"record" + i}>
                  <div className="class-order">
                    <BookOpen size={15} />
                  </div>
                  <div className="detail-content">
                    <strong>{slotName(record)}</strong>
                    <span>{formatClassRange(record)}</span>
                    {record.subjectCode && <small>{record.subjectCode}</small>}
                    <small>{facultyLabel(record)}</small>
                  </div>
                  <AttendanceBadge status={recordStatus(record)} />
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="No classes recorded"
              text="No schedule or attendance was returned for this date. Missing data does not mean absent."
            />
          )}
        </>
      ) : date && !error && !loading ? (
        <Empty
          title="No details yet"
          text="This day has no available class records. Refresh the month to check for updates."
        />
      ) : null}
    </section>
  );
}
export function Planner({ subjects }: { subjects: Subject[] }) {
  const [index, setIndex] = useState(0),
    [attend, setAttend] = useState(0),
    [miss, setMiss] = useState(0);
  const sub = subjects[index],
    present = Number(sub?.present) || 0,
    total = Number(sub?.numberOfClasses) || 0,
    projected =
      total + attend + miss
        ? (100 * (present + attend)) / (total + attend + miss)
        : 0,
    needed = Math.max(0, Math.ceil((0.75 * total - present) / 0.25));
  if (!sub)
    return (
      <section className="glass">
        <Empty
          title="Your planner is waiting"
          text="Subject attendance is needed to calculate a projection."
        />
      </section>
    );
  return (
    <div className="planner-layout">
      <section className="glass planner-controls">
        <SectionTitle kicker="WHAT IF?" title="A plan, not a prediction" />
        <label htmlFor="subject-choice">Choose a subject</label>
        <select
          id="subject-choice"
          value={index}
          onChange={(e) => {
            setIndex(Number(e.target.value));
            setAttend(0);
            setMiss(0);
          }}
        >
          {subjects.map((s, i) => (
            <option value={i} key={i}>
              {s.subjectName}
            </option>
          ))}
        </select>
        <label htmlFor="attend-range">
          Future classes to attend <strong>{attend}</strong>
        </label>
        <input
          id="attend-range"
          type="range"
          min="0"
          max="30"
          value={attend}
          onChange={(e) => setAttend(Number(e.target.value))}
        />
        <label htmlFor="miss-range">
          Future classes to miss <strong>{miss}</strong>
        </label>
        <input
          id="miss-range"
          type="range"
          min="0"
          max="30"
          value={miss}
          onChange={(e) => setMiss(Number(e.target.value))}
        />
        <button
          className="button secondary"
          onClick={() => {
            setAttend(0);
            setMiss(0);
          }}
        >
          Reset scenario
        </button>
        <p className="muted">
          Illustrative calculation using a 75% target. Exemptions and
          institutional rules can change the official result.
        </p>
      </section>
      <section className="glass projection-card">
        <Sparkles size={25} />
        <span className="eyebrow">YOUR PROJECTED ATTENDANCE</span>
        <div className="projection-value">
          {projected.toFixed(1)}
          <span>%</span>
        </div>
        <span className={`status-pill ${projected >= 75 ? "good" : "warn"}`}>
          {projected >= 75
            ? "Above the reference target"
            : "Below the reference target"}
        </span>
        <p>
          {present + attend} attended / {total + attend + miss} total classes
        </p>
        <div className="projection-note">
          {needed
            ? `At your current counts, attend the next ${needed} consecutive classes to reach 75%.`
            : "Your current counts meet the 75% reference target."}
        </div>
        <small>This never changes your official attendance.</small>
      </section>
    </div>
  );
}
export function Settings({
  theme,
  setTheme,
  student,
  loginId,
  classroom,
  semester,
  install,
  doInstall,
  signOut,
  startTour,
}: {
  theme: string;
  setTheme: (s: string, origin?: HTMLElement) => void;
  student?: Student;
  loginId?: string;
  classroom?: string;
  semester?: string | number;
  install: InstallEvent | null;
  doInstall: () => void;
  signOut: () => void;
  startTour: () => void;
}) {
  return (
    <div className="settings-grid">
      <section className="glass settings-card">
        <SectionTitle kicker="FEELS LIKE YOU" title="Appearance" />
        <p>Clear contrast, considered color. Choose your preferred view.</p>
        <div className="theme-options">
          {[
            { id: "light", Icon: Sun, label: "Light" },
            { id: "dark", Icon: Moon, label: "Dark" },
          ].map(({ id, Icon, label }) => (
            <button
              aria-pressed={theme === id}
              className={theme === id ? "selected" : ""}
              key={id}
              onClick={(event) => setTheme(id, event.currentTarget)}
            >
              <Icon size={23} />
              <span>{label}</span>
              {theme === id && <Check size={16} />}
            </button>
          ))}
        </div>
      </section>
      <section className="glass settings-card">
        <SectionTitle kicker="YOUR WORKSPACE" title="Account" />
        <div className="setting-row">
          <div>
            <strong>{student?.fullName || "Connected student"}</strong>
            <p>CampX connected for this open session</p>
          </div>
          <ShieldCheck size={23} />
        </div>
        <dl className="student-profile">
          <div className="profile-wide">
            <dt>Name</dt>
            <dd>{student?.fullName || "Not provided by CampX"}</dd>
          </div>
          <div className="profile-wide">
            <dt>CampX profile email</dt>
            <dd>{student?.email || "Not provided by CampX"}</dd>
          </div>
          <div className="profile-wide">
            <dt>Login used</dt>
            <dd>{loginId || "Not available"}</dd>
          </div>
          <div>
            <dt>Roll number</dt>
            <dd>{student?.rollNo || "Not provided"}</dd>
          </div>
          <div>
            <dt>Branch</dt>
            <dd>{student?.branchCode || "Not provided"}</dd>
          </div>
          <div>
            <dt>Class / section</dt>
            <dd>{classroom || "Not provided"}</dd>
          </div>
          <div>
            <dt>Semester</dt>
            <dd>{student?.semNo ?? semester ?? "Not provided"}</dd>
          </div>
        </dl>
        <p className="muted">
          Credentials are kept in memory, not browser storage. Reloading
          requires reconnecting. Private usage totals exclude your password and
          attendance records.
        </p>
        <button className="button secondary" onClick={signOut}>
          <LogOut size={16} />
          Sign out
        </button>
      </section>
      <section className="glass settings-card">
        <SectionTitle kicker="LEARN BY DOING" title="Show me around" />
        <p>
          Follow a short guided tour on your own dashboard, subjects and
          calendar.
        </p>
        <button className="button secondary" onClick={startTour}>
          <Sparkles size={16} />
          Start guided tour
        </button>
      </section>
      <section className="glass settings-card">
        <SectionTitle kicker="LESS TABS, MORE FOCUS" title="Install the app" />
        <p>
          Add Attendance to your home screen for a dedicated app window.
          Installation depends on your browser and device.
        </p>
        <button className="button secondary" onClick={doInstall}>
          <Download size={17} />
          {install ? "Install Attendance" : "Installation instructions"}
        </button>
      </section>
      <section className="glass settings-card">
        <NotificationSettings />
      </section>
    </div>
  );
}
