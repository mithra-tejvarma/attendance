import {
  attendanceFor,
  recordStatus,
  classPhase,
  classProgress,
  CAMPUS_ZONE,
  campusDateKey,
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
import {
  dayKey,
  monthKey,
  type Bundle,
  type Subject,
  type Student,
} from "./data";
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
        a<span>•</span>
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
  explore,
  theme,
  toggleTheme,
}: {
  busy: boolean;
  error: string;
  login: (c: Credentials) => void;
  explore: () => void;
  theme: string;
  toggleTheme: () => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false);
  return (
    <div className="login-page">
      <header>
        <Brand />
        <button
          className="icon-button"
          aria-label="Toggle theme"
          onClick={toggleTheme}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>
      </header>
      <main className="login-layout">
        <section className="login-intro">
          <span className="label-chip">
            <i />A LITTLE MORE CLARITY
          </span>
          <h1>
            Your college day.
            <br />
            Beautifully
            <br />
            <span>in focus.</span>
          </h1>
          <p>
            Less checking. More knowing. A calmer space for your attendance,
            subjects, and the days ahead.
          </p>
          <div className="login-benefits">
            <span>
              <Check size={16} />
              Your personal attendance
            </span>
            <span>
              <Check size={16} />A clearer semester
            </span>
          </div>
          <div className="login-visual">
            <div className="visual-orbit" />
            <div className="glass visual-ticket">
              <span>
                <Sparkles size={15} /> A FRESH PERSPECTIVE
              </span>
              <strong>
                Show up.
                <br />
                Stay ahead.
              </strong>
              <div className="visual-bars">
                {[35, 60, 48, 80, 65, 92, 76, 100, 88].map((h, i) => (
                  <i key={i} style={{ height: h }} />
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="glass login-card">
          <div className="login-card-icon">
            <ArrowUpRight size={26} />
          </div>
          <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
          <h2>Good to see you.</h2>
          <p>Connect with your CampX details to see your attendance.</p>
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
              placeholder="Your college email or login ID"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={busy}
            />
            <div className="label-row">
              <label htmlFor="login-password">Password</label>
              <span>CampX credentials</span>
            </div>
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
                  Open my dashboard <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <span>
              Your password stays in this open session. It isn’t saved in your
              browser storage.
            </span>
          </div>
          <div className="login-divider">
            <span>JUST LOOKING AROUND?</span>
          </div>
          <button
            className="button secondary demo-button"
            onClick={explore}
            disabled={busy}
          >
            Explore a sample dashboard <ArrowUpRight size={16} />
          </button>
          <p className="login-disclaimer">
            Independent student app. Not affiliated with CampX.
            <br />
            Official records remain with your institution.
          </p>
        </section>
      </main>
      <footer className="login-footer">
        <span>© {new Date().getFullYear()} Varma Labs</span>
        <span>Designed for a clearer college day.</span>
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
}: {
  subjects: Subject[];
  compact?: boolean;
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
            <div className="subject-row" key={`${s.subjectName}-${i}`}>
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
function slotName(s: import("./data").Slot) {
  return (
    s.subjectName ||
    s.subject?.subjectName ||
    s.subject?.name ||
    "Scheduled class"
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
export function Today({ bundle, now }: { bundle?: Bundle; now: Date }) {
  const clock = now.toLocaleTimeString("en-IN", {
    timeZone: CAMPUS_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
  const timetable = bundle?.timetable || [];
  return (
    <section className="glass today-card">
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
                  <span>{slot.fromTime?.slice(0, 5) || "—"}</span>
                  <small>{slot.toTime?.slice(0, 5) || "No time"}</small>
                </div>
                <div className="class-content">
                  <div className="class-heading">
                    <h3>{slotName(slot)}</h3>
                    <span className={`phase-label ${live ? "is-live" : ""}`}>
                      {live && <i />}
                      {phase}
                    </span>
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
        </div>
      ) : bundle?.attendance?.length ? (
        <div className="timeline">
          {bundle.attendance.map((record, i) => (
            <div className="timeline-row record-only" key={i}>
              <BookOpen size={18} />
              <div className="class-content">
                <h3>{slotName(record)}</h3>
                <p className="slot-note">
                  Recorded attendance · schedule unavailable
                </p>
              </div>
              <AttendanceBadge status={recordStatus(record)} />
            </div>
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
  demo,
}: {
  date: Date;
  statuses: Record<string, string>;
  bundles: Record<string, Bundle>;
  move: (n: number) => void;
  select: (s: string) => void;
  selected: string | null;
  loading: boolean;
  error: string;
  demo: boolean;
}) {
  const first =
      (new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7,
    count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return (
    <section className="glass calendar-card">
      <SectionTitle
        kicker="YOUR ATTENDANCE CALENDAR"
        title={fmtMonth(date)}
        action={
          <div className="calendar-controls">
            <button aria-label="Previous month" onClick={() => move(-1)}>
              <ChevronLeft size={19} />
            </button>
            <button aria-label="Next month" onClick={() => move(1)}>
              <ChevronRight size={19} />
            </button>
          </div>
        }
      />
      {loading && (
        <p className="calendar-message" role="status">
          <LoaderCircle size={14} className="spin" />
          Loading selected month…
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error} Navigate away and back to retry.
        </p>
      )}
      {demo && monthKey(date) !== monthKey(new Date()) && (
        <p className="calendar-message">No sample records for this month.</p>
      )}
      <div className="calendar-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span className="weekday" key={i}>
            {d}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={`space-${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const key = dayKey(
            new Date(date.getFullYear(), date.getMonth(), i + 1),
          );
          const raw = statuses[key]?.toLowerCase() || "";
          const state =
            raw === "present"
              ? "present"
              : raw === "absent"
                ? "absent"
                : "unknown";
          return (
            <button
              key={key}
              className={`calendar-day ${state} ${key === campusDateKey(new Date()) ? "today" : ""} ${selected === key ? "selected" : ""}`}
              aria-label={`${key}: ${state === "unknown" ? "no confirmed status" : state}`}
              aria-pressed={selected === key}
              onClick={() => select(key)}
            >
              {i + 1}
              {(state !== "unknown" || bundles[key]?.hasRecord) && <i />}
            </button>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span>
          <i className="present" />
          Present
        </span>
        <span>
          <i className="absent" />
          Absent
        </span>
        <span>
          <i />
          No confirmed status
        </span>
      </div>
      {selected && (
        <DayDetails date={selected} bundle={bundles[selected]} compact />
      )}
    </section>
  );
}
export function DayDetails({
  date,
  bundle,
  compact = false,
}: {
  date: string | null;
  bundle?: Bundle;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "day-inline" : "glass day-detail"}>
      <span className="eyebrow">
        {date
          ? new Date(date + "T12:00:00").toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })
          : "THE DETAILS"}
      </span>
      <h2>{date ? "Day details" : "Pick a day"}</h2>
      {!date ? (
        <p>Select a date to explore its schedule and recorded attendance.</p>
      ) : !bundle ? (
        <p>
          No class details were returned for this day. Missing records do not
          mean absent.
        </p>
      ) : (
        <>
          <p>
            {bundle.timetable?.length || 0} scheduled classes ·{" "}
            {bundle.attendance?.length || 0} attendance records
          </p>
          {!compact &&
            (bundle.timetable || []).map((s, i) => (
              <div className="detail-row" key={i}>
                <BookOpen size={17} />
                <div>
                  <strong>{slotName(s)}</strong>
                  <span>
                    {s.fromTime?.slice(0, 5) || "Time unavailable"}{" "}
                    {s.toTime ? `– ${s.toTime.slice(0, 5)}` : ""}
                  </span>
                </div>
                <AttendanceBadge status={attendanceFor(s, bundle)} />
              </div>
            ))}
          <p className="muted">
            Only uniquely matched records are labeled present or absent. Missing
            or ambiguous records stay unmarked.
          </p>
        </>
      )}
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
  demo,
  student,
  loginId,
  classroom,
  semester,
  install,
  doInstall,
  signOut,
}: {
  theme: string;
  setTheme: (s: string) => void;
  demo: boolean;
  student?: Student;
  loginId?: string;
  classroom?: string;
  semester?: string | number;
  install: InstallEvent | null;
  doInstall: () => void;
  signOut: () => void;
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
              onClick={() => setTheme(id)}
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
            <p>
              {demo
                ? "Sample workspace · no live account"
                : "CampX connected for this open session"}
            </p>
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
          requires reconnecting. Usage tracking is not active in this release.
        </p>
        <button className="button secondary" onClick={signOut}>
          <LogOut size={16} />
          {demo ? "Exit demo" : "Sign out"}
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
        <SectionTitle
          kicker="COMING IN A LATER RELEASE"
          title="Attendance notifications"
        />
        <p>
          Push delivery and background synchronization are not connected yet.
          We’ll only request browser permission when the full service is ready.
        </p>
        <span className="label-chip">
          <Bell size={14} />
          Not available yet
        </span>
      </section>
    </div>
  );
}
