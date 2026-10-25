import { useGlassLight } from "./useGlassLight";
import { CAMPUS_ZONE, campusDateKey } from "./schedule";
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
  Check,
  ShieldCheck,
  WifiOff,
  X,
  CircleHelp,
} from "lucide-react";
import { monthKey, readTheme, type Dashboard, type Bundle } from "./data";
import { login, logout, post, type Credentials } from "./api";

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
const pct = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
export default function App() {
  useGlassLight();
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setClock(new Date());
    const timer = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const [theme, setTheme] = useState(readTheme),
    [page, setPage] = useState<Page>("overview");
  const [data, setData] = useState<Dashboard | null>(null),
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
    [monthLoading, setMonthLoading] = useState<Record<string, boolean>>({}),
    [monthErrors, setMonthErrors] = useState<Record<string, string>>({});
  const [monthRetry, setMonthRetry] = useState(0);
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
      ?.setAttribute("content", theme === "dark" ? "#090d16" : "#f3f4f6");
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
      if (next.dynamicContext)
        setCalendarDate(
          new Date(
            next.dynamicContext.currentYear,
            next.dynamicContext.currentMonth - 1,
            1,
          ),
        );
      setSelected(null);
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
  function signOut() {
    logout();
    generation.current++;
    setCredentials(null);
    setData(null);
    setBundles({});
    setMonths({});
    setSelected(null);
    setPage("overview");
    setUpdated(null);
    setError("");
    monthRequests.current.clear();
    setMonthLoading({});
    setMonthErrors({});
  }
  async function refresh() {
    if (busy) return;
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
  const monthBusy = !!monthLoading[calendarKey],
    monthError = monthErrors[calendarKey] || "";
  useEffect(() => {
    if (page !== "calendar") return;
    if (!months[calendarKey]) {
      if (selected && !selected.startsWith(calendarKey)) setSelected(null);
      return;
    }
    if (selected?.startsWith(calendarKey)) return;
    const today = campusDateKey(clock);
    const marked = Object.keys(months[calendarKey])
      .filter(
        (key) =>
          key.startsWith(calendarKey) &&
          ["present", "absent", "partial"].includes(months[calendarKey][key]),
      )
      .sort();
    setSelected(
      today.startsWith(calendarKey)
        ? today
        : marked.at(-1) || `${calendarKey}-01`,
    );
  }, [page, calendarKey, months, selected, clock]);
  useEffect(() => {
    if (
      !data ||
      page !== "calendar" ||
      months[calendarKey] ||
      !credentials ||
      monthRequests.current.has(calendarKey)
    )
      return;
    const token = generation.current;
    monthRequests.current.add(calendarKey);
    setMonthLoading((prev) => ({ ...prev, [calendarKey]: true }));
    setMonthErrors((prev) => ({ ...prev, [calendarKey]: "" }));
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
        if (token === generation.current)
          setMonthErrors((prev) => ({ ...prev, [calendarKey]: e.message }));
      })
      .finally(() => {
        monthRequests.current.delete(calendarKey);
        if (token === generation.current)
          setMonthLoading((prev) => ({ ...prev, [calendarKey]: false }));
      });
  }, [calendarKey, page, data, credentials, months, calendarDate, monthRetry]);
  const subjects = data?.subjectWise?.subjects || [],
    student = data?.primary?.student;
  const overall = pct(
    data?.subjectWise?.overallAttendance ?? data?.primary?.attendancePercentage,
  );
  const stats = data?.primary?.primaryAttendance;
  const today = campusDateKey(clock),
    todayBundle = bundles[today];
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  const moveMonth = (offset: number) => {
    setCalendarDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1),
    );
  };
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page, !!data]);
  function selectDay(date: string) {
    setSelected(date);
    if (matchMedia("(max-width: 1100px)").matches)
      requestAnimationFrame(() =>
        document
          .querySelector(".student-day-detail")
          ?.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
            block: "start",
          }),
      );
  }
  const calendar = (
    <Calendar
      date={calendarDate}
      statuses={months[calendarKey] || {}}
      bundles={bundles}
      move={moveMonth}
      select={selectDay}
      selected={selected}
      loading={monthBusy}
      error={monthError}
      retry={() => setMonthRetry((value) => value + 1)}
    />
  );
  return (
    <>
      {!data ? (
        <Login
          busy={busy}
          error={error}
          login={authenticate}
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
              <button
                className="nav-item"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              >
                {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
                <span>Switch theme</span>
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
            <main id="main-content">
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
              <div
                className={`page-heading ${page === "overview" ? "overview-heading" : ""}`}
              >
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
                          <i className="status-dot" /> <h1>Your attendance</h1>
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
                        <button
                          className="button secondary"
                          onClick={refresh}
                          disabled={busy || !online}
                        >
                          <RefreshCw size={16} className={busy ? "spin" : ""} />
                          {busy ? "Refreshing…" : "Refresh data"}
                        </button>
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
                  </div>
                  <Today bundle={todayBundle} now={clock} />
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
                    loading={monthBusy}
                    error={monthError}
                  />
                </div>
              )}
              {page === "planner" && <Planner subjects={subjects} />}
              {page === "settings" && (
                <Settings
                  theme={theme}
                  setTheme={setTheme}
                  student={student}
                  loginId={credentials?.loginId}
                  classroom={data.primary?.classroom?.name}
                  semester={data.dynamicContext?.semNo}
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
                      ? `Last refreshed at ${updated.toLocaleTimeString("en-IN", { timeZone: CAMPUS_ZONE, hour: "2-digit", minute: "2-digit" })}`
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
