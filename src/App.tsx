import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  LayoutDashboard,
  BookOpen,
  CalendarDays,
  SlidersHorizontal,
  Settings2,
  Sun,
  Moon,
  RefreshCw,
  LogOut,
  Check,
  ChevronLeft,
  ChevronRight,
  Bell,
  ShieldCheck,
  Download,
  WifiOff,
  X,
  Sparkles,
  Eye,
  EyeOff,
  LoaderCircle,
  CircleHelp,
} from "lucide-react";
import {
  demoData,
  dayKey,
  monthKey,
  readTheme,
  type Dashboard,
  type Bundle,
  type Subject,
} from "./data";
import { login, post, type Credentials } from "./api";

import {
  HelpDialog,
  Brand,
  Login,
  SectionTitle,
  Stat,
  Subjects,
  Today,
  Calendar,
  DayDetails,
  Planner,
  Settings,
  type InstallEvent,
} from "./components";
type Page = "overview" | "subjects" | "calendar" | "planner" | "settings";
const pages: { id: Page; label: string; icon: typeof Sun }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "subjects", label: "Subjects", icon: BookOpen },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "planner", label: "Planner", icon: SlidersHorizontal },
];
const fmtMonth = (date: Date) =>
  date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const pct = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
export default function App() {
  const [theme, setTheme] = useState(readTheme),
    [page, setPage] = useState<Page>("overview");
  const [data, setData] = useState<Dashboard | null>(null),
    [demo, setDemo] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [updated, setUpdated] = useState<Date | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [notice, setNotice] = useState("");
  const [swUpdate, setSwUpdate] = useState<ServiceWorkerRegistration | null>(
    null,
  );
  const [calendarDate, setCalendarDate] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [months, setMonths] = useState<Record<string, Record<string, string>>>(
      {},
    ),
    [bundles, setBundles] = useState<Record<string, Bundle>>({}),
    [monthBusy, setMonthBusy] = useState(false),
    [monthError, setMonthError] = useState("");
  const [selected, setSelected] = useState<string | null>(null),
    [help, setHelp] = useState(false);
  const monthRequests = useRef(new Set<string>()),
    loginLock = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("vl-theme", theme);
    } catch {}
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0c1218" : "#f4f6f2");
  }, [theme]);
  useEffect(() => {
    // Remove legacy plaintext credentials and personal browser caches on migration.
    for (const key of [
      "campx_password",
      "campx_loginId",
      "campx_dashboard_cache",
      "campx_daily_cache",
      "campx_monthly_map",
    ]) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
    for (const key of ["campx_password", "campx_loginId"])
      document.cookie = `${key}=; Max-Age=0; path=/`;
    const on = () => setOnline(true),
      off = () => setOnline(false),
      prompt = (e: Event) => {
        e.preventDefault();
        setInstall(e as InstallEvent);
      };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", prompt);
    if ("serviceWorker" in navigator && import.meta.env.PROD)
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (reg.waiting) setSwUpdate(reg);
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setSwUpdate(reg);
            });
          });
        })
        .catch(() => {});
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  function apply(next: Dashboard) {
    setData(next);
    setBundles(next.dailyBundle || {});
    const context = next.dynamicContext;
    const current = context
      ? `${context.currentYear}-${String(context.currentMonth).padStart(2, "0")}`
      : monthKey(new Date());
    setMonths({ [current]: next.monthlyCalendar || {} });
    setUpdated(new Date());
  }
  async function authenticate(input: Credentials) {
    if (loginLock.current) return;
    loginLock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await login(input);
      generation.current++;
      setDemo(false);
      setCredentials(input);
      apply(next);
      setPage("overview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      loginLock.current = false;
      setBusy(false);
    }
  }
  function explore() {
    generation.current++;
    setCredentials(null);
    setDemo(true);
    apply(demoData());
    setError("");
    setPage("overview");
  }
  function signOut() {
    generation.current++;
    setCredentials(null);
    setData(null);
    setBundles({});
    setMonths({});
    setDemo(false);
    setSelected(null);
    setPage("overview");
    setUpdated(null);
    setError("");
    monthRequests.current.clear();
  }
  async function refresh() {
    if (busy) return;
    if (demo) {
      apply(demoData());
      setNotice("Sample data refreshed. No CampX request was made.");
      return;
    }
    if (!credentials) return;
    const token = generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await login(credentials);
      if (token === generation.current) {
        apply(next);
        setNotice("Your attendance is up to date.");
      }
    } catch (e) {
      if (token === generation.current) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const calendarKey = monthKey(calendarDate);
  useEffect(() => {
    if (
      !data ||
      (page !== "calendar" && page !== "overview") ||
      months[calendarKey] ||
      demo ||
      !credentials ||
      monthRequests.current.has(calendarKey)
    )
      return;
    const token = generation.current;
    monthRequests.current.add(calendarKey);
    setMonthBusy(true);
    setMonthError("");
    post<{
      monthlyCalendar: Record<string, string>;
      dailyBundle: Record<string, Bundle>;
    }>("/api/month-complete-data", {
      ...credentials,
      month: calendarDate.getMonth() + 1,
      year: calendarDate.getFullYear(),
      classroomId: data.dynamicContext?.classroomId,
      semNo: data.dynamicContext?.semNo,
    })
      .then((next) => {
        if (token === generation.current) {
          setMonths((prev) => ({
            ...prev,
            [calendarKey]: next.monthlyCalendar || {},
          }));
          setBundles((prev) => ({ ...prev, ...next.dailyBundle }));
        }
      })
      .catch((e) => {
        if (token === generation.current) setMonthError(e.message);
      })
      .finally(() => {
        monthRequests.current.delete(calendarKey);
        if (token === generation.current) setMonthBusy(false);
      });
  }, [calendarKey, page, data, demo, credentials, months, calendarDate]);
  const subjects = data?.subjectWise?.subjects || [],
    student = data?.primary?.student;
  const overall = pct(
    data?.subjectWise?.overallAttendance ?? data?.primary?.attendancePercentage,
  );
  const stats = data?.primary?.primaryAttendance;
  const today = dayKey(new Date()),
    todayBundle = bundles[today];
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  const moveMonth = (offset: number) => {
    setCalendarDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1),
    );
    setMonthError("");
  };
  const calendar = (
    <Calendar
      date={calendarDate}
      statuses={months[calendarKey] || {}}
      bundles={bundles}
      move={moveMonth}
      select={setSelected}
      selected={selected}
      loading={monthBusy}
      error={monthError}
      demo={demo}
    />
  );
  return (
    <>
      {!data ? (
        <Login
          busy={busy}
          error={error}
          login={authenticate}
          explore={explore}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      ) : (
        <div className="app-shell">
          <aside className="sidebar">
            <Brand />
            <div className="workspace-label">YOUR WORKSPACE</div>
            <nav aria-label="Main navigation">
              {pages.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={`nav-item ${page === id ? "active" : ""}`}
                  onClick={() => {
                    setPage(id);
                    setSelected(null);
                  }}
                  aria-current={page === id ? "page" : undefined}
                >
                  <Icon size={19} />
                  <span>{label}</span>
                  {page === id && <span className="nav-dot" />}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="small-note">
                <ShieldCheck size={19} />
                <strong>
                  Your attendance.
                  <br />
                  Your space.
                </strong>
                <p>Built for a little more clarity in your college day.</p>
              </div>
              <button
                className={`nav-item ${page === "settings" ? "active" : ""}`}
                onClick={() => setPage("settings")}
              >
                <Settings2 size={19} />
                Settings
              </button>
              <button className="nav-item" onClick={() => setHelp(true)}>
                <CircleHelp size={19} />
                Help & information
                <ArrowUpRight size={15} />
              </button>
              <div className="sidebar-footer">
                MADE BY <b>VARMA LABS</b>
                <span>v1.0</span>
              </div>
            </div>
          </aside>
          <div className="main-shell">
            <header className="topbar">
              <div className="breadcrumb">
                Workspace <span>/</span>
                <strong>{page[0].toUpperCase() + page.slice(1)}</strong>
              </div>
              <div className="top-actions">
                <span className="live-chip">
                  <i />
                  {demo ? "Demo workspace" : online ? "Connected" : "Offline"}
                </span>
                <button
                  className="icon-button"
                  aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                  onClick={toggleTheme}
                >
                  {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
                </button>
                <button
                  className="icon-button"
                  aria-label="Notification settings"
                  onClick={() => setPage("settings")}
                >
                  <Bell size={19} />
                </button>
                <button
                  className="avatar"
                  aria-label="Open account settings"
                  onClick={() => setPage("settings")}
                >
                  {(student?.fullName || "S")
                    .split(" ")
                    .slice(0, 2)
                    .map((x) => x[0])
                    .join("")}
                </button>
              </div>
            </header>
            <main id="main-content">
              {demo && (
                <div className="demo-banner">
                  <Sparkles size={15} />
                  <span>Demo workspace · sample data, not your attendance</span>
                  <button onClick={signOut}>
                    Connect CampX <ArrowRight size={14} />
                  </button>
                </div>
              )}
              {!online && (
                <div className="alert">
                  <WifiOff size={17} />
                  You're offline. Showing data from this open session.
                </div>
              )}
              {error && (
                <div className="alert" role="alert">
                  {error}
                  <button onClick={refresh}>Retry</button>
                </div>
              )}
              {swUpdate && (
                <div className="alert">
                  A new version is ready.
                  <button
                    onClick={() => {
                      navigator.serviceWorker.addEventListener(
                        "controllerchange",
                        () => location.reload(),
                        { once: true },
                      );
                      swUpdate.waiting?.postMessage("ACTIVATE_UPDATE");
                    }}
                  >
                    Update now
                  </button>
                </div>
              )}
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {new Date().toLocaleDateString("en-IN", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </div>
                  <h1>
                    {page === "overview" ? (
                      <>
                        A little clarity.
                        <br className="mobile-break" /> A better day
                        <span className="accent">.</span>
                      </>
                    ) : page === "subjects" ? (
                      "Every subject, in focus."
                    ) : page === "calendar" ? (
                      "Your month, at a glance."
                    ) : page === "planner" ? (
                      "Make room for your plans."
                    ) : (
                      "Make it yours."
                    )}
                  </h1>
                  <p>
                    {page === "overview"
                      ? `Welcome${student?.fullName ? `, ${student.fullName.split(" ")[0]}` : ""}. Here’s where you stand today.`
                      : page === "subjects"
                        ? "Know your numbers. Find your balance."
                        : page === "calendar"
                          ? "Explore recorded attendance, one day at a time."
                          : page === "planner"
                            ? "Explore what-if scenarios without changing your records."
                            : "Your account, appearance, and app preferences."}
                  </p>
                </div>
                <button
                  className="button secondary refresh-button"
                  onClick={refresh}
                  disabled={busy || !online}
                >
                  <RefreshCw size={16} className={busy ? "spin" : ""} />
                  {busy ? "Refreshing…" : "Refresh data"}
                </button>
              </div>
              {page === "overview" && (
                <>
                  <div className="overview-grid">
                    <section className="glass hero-card">
                      <div className="card-overline">
                        <span>
                          <i className="status-dot" /> YOUR ATTENDANCE
                        </span>
                        <span>
                          SEMESTER{" "}
                          {data.dynamicContext?.semNo || student?.semNo || "—"}
                        </span>
                      </div>
                      <div className="hero-body">
                        <div>
                          <span className="hero-kicker">
                            Showing up adds up.
                          </span>
                          <div className="hero-value">
                            {overall.toFixed(1)}
                            <span>%</span>
                          </div>
                          <span
                            className={`status-pill ${overall >= 75 ? "good" : "warn"}`}
                          >
                            <span />
                            {overall >= 75
                              ? "Looking good"
                              : "Needs your attention"}
                          </span>
                        </div>
                        <div
                          className="attendance-ring"
                          style={
                            {
                              "--progress": `${clamp(overall) * 3.6}deg`,
                            } as React.CSSProperties
                          }
                        >
                          <div>
                            <span>GOAL</span>
                            <strong>
                              75<span>%</span>
                            </strong>
                            <Check size={18} />
                          </div>
                        </div>
                      </div>
                      <div className="hero-footer">
                        <span>
                          {overall >= 75
                            ? `${(overall - 75).toFixed(1)}% above the 75% reference target`
                            : "A few more classes can make a difference."}
                        </span>
                        <ArrowUpRight size={17} />
                      </div>
                    </section>
                    <div className="stats-column">
                      <Stat
                        label="Classes attended"
                        value={stats?.present}
                        note="Every class counts"
                        icon="present"
                      />
                      <Stat
                        label="Classes missed"
                        value={stats?.absent}
                        note="A little room to improve"
                        icon="absent"
                      />
                      <Stat
                        label="Total classes"
                        value={stats?.totalSessionsIncludingActivity}
                        note="This semester so far"
                        icon="total"
                      />
                    </div>
                    <section className="glass focus-card">
                      <div className="card-overline">
                        <span>THE BIG PICTURE</span>
                        <Sparkles size={17} />
                      </div>
                      <h2>
                        Small steps.
                        <br />
                        Strong semester.
                      </h2>
                      <p>
                        Your attendance is a habit, not just a number. Stay
                        consistent and keep your options open.
                      </p>
                      <div className="focus-meta">
                        <span className="mini-avatar">
                          {student?.branchCode?.slice(0, 2) || "ST"}
                        </span>
                        <div>
                          <strong>
                            {student?.branchCode || "Student"} ·{" "}
                            {data.primary?.classroom?.name || "Your classroom"}
                          </strong>
                          <span>{student?.rollNo || "Connected student"}</span>
                        </div>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setPage("planner")}
                      >
                        Try attendance planner <ArrowUpRight size={16} />
                      </button>
                    </section>
                  </div>
                  <div className="content-grid">
                    <section className="glass subject-card">
                      <SectionTitle
                        kicker="STAY ON TRACK"
                        title="Subject breakdown"
                        action={
                          <button
                            className="text-button"
                            onClick={() => setPage("subjects")}
                          >
                            View all <ArrowUpRight size={15} />
                          </button>
                        }
                      />
                      <Subjects subjects={subjects} compact />
                      <div className="subtle-footer">
                        <span className="legend-dot" />
                        75% reference target · check your institution’s rules
                      </div>
                    </section>
                    <Today
                      bundle={todayBundle}
                      onCalendar={() => setPage("calendar")}
                    />
                  </div>
                  <div className="content-grid bottom-grid">
                    {calendar}
                    <section className="glass reminder-card">
                      <div className="reminder-icon">
                        <Bell size={23} />
                      </div>
                      <span className="eyebrow">A LITTLE LESS CHECKING</span>
                      <h2>
                        A heads-up,
                        <br />
                        when it matters.
                      </h2>
                      <p>
                        Attendance notifications are on the roadmap. Your
                        browser won’t be asked for permission until they’re
                        ready.
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => setPage("settings")}
                      >
                        View app settings <ArrowUpRight size={16} />
                      </button>
                    </section>
                  </div>
                </>
              )}
              {page === "subjects" && (
                <section className="glass">
                  <SectionTitle
                    kicker="YOUR SEMESTER"
                    title={`${subjects.length} subjects · one clear view`}
                  />
                  <Subjects subjects={subjects} />
                  <div className="subtle-footer">
                    Percentages are reported by CampX. The planner uses a 75%
                    reference target.
                  </div>
                </section>
              )}
              {page === "calendar" && (
                <div className="calendar-page">
                  {calendar}
                  <DayDetails
                    date={selected}
                    bundle={selected ? bundles[selected] : undefined}
                  />
                </div>
              )}
              {page === "planner" && <Planner subjects={subjects} />}
              {page === "settings" && (
                <Settings
                  theme={theme}
                  setTheme={setTheme}
                  demo={demo}
                  studentName={student?.fullName}
                  install={install}
                  doInstall={async () => {
                    if (install) {
                      await install.prompt();
                      setInstall(null);
                    } else
                      setNotice(
                        "Use your browser menu → Install app or Add to Home Screen, if supported.",
                      );
                  }}
                  signOut={signOut}
                />
              )}
              <footer className="page-footer">
                <span>
                  <i className={busy ? "pulse" : ""} />
                  {busy
                    ? "Fetching from CampX…"
                    : updated
                      ? `${demo ? "Sample updated" : "Last refreshed"} at ${updated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
                      : "Not refreshed"}
                </span>
                <span>
                  Thoughtfully built by <b>Varma Labs</b>
                  <ArrowUpRight size={12} />
                </span>
              </footer>
            </main>
          </div>
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {[
              ...pages,
              { id: "settings" as Page, label: "Settings", icon: Settings2 },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                aria-current={page === id ? "page" : undefined}
                onClick={() => {
                  setPage(id);
                  setSelected(null);
                }}
              >
                <Icon size={20} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <HelpDialog close={() => setHelp(false)}>
          <button
            className="icon-button close"
            aria-label="Close help"
            autoFocus
            onClick={() => setHelp(false)}
          >
            <X />
          </button>
          <ShieldCheck size={30} />
          <h2 id="help-title">A clearer view of CampX.</h2>
          <p>
            This is an independent student interface by Varma Labs, not an
            official CampX application. CampX remains the source of truth.
          </p>
          <p>
            Login details are kept in memory for this open session. Reloading
            requires reconnecting. Firebase usage tracking, server sessions, and
            push delivery are not connected in this frontend release.
          </p>
          <p>
            No recorded data does not mean absent. Refresh failures never turn
            into attendance records.
          </p>
        </HelpDialog>
      )}
    </>
  );
}
