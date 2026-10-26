import { ReconnectDialog } from "./ReconnectDialog";
import { GuidedTour, tourSeen, markTourSeen } from "./GuidedTour";
import { subjectHistory } from "./subjectHistoryModel";
import { forgetPushToken } from "./push";
import { CornerControls, CornerSettings } from "./CornerControls";
import { Playground, initialPlanEnd } from "./Playground";
import type { PlanChoices } from "./playgroundModel";
import { revealTheme } from "./themeTransition";
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
import {
  login,
  logout,
  post,
  get,
  refreshDashboard,
  restoreSession,
  reconnect,
  hasSession,
  SESSION_EVENT,
  startupNotice,
  ApiError,
  type Account,
  type Credentials,
  type SavedDashboard,
} from "./api";

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
  Settings,
  type InstallEvent,
} from "./components";
type Page = "overview" | "subjects" | "calendar" | "playground";
const pages: { id: Page; label: string; icon: typeof Sun }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "subjects", label: "Subjects", icon: BookOpen },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "playground", label: "Playground", icon: SlidersHorizontal },
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
    [error, setError] = useState(startupNotice),
    [updated, setUpdated] = useState<Date | null>(null);
  const [account, setAccount] = useState<Account | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [notice, setNotice] = useState("");
  const [restoring, setRestoring] = useState(hasSession),
    [restoreError, setRestoreError] = useState("");
  const [reconnectRequired, setReconnectRequired] = useState(false),
    [reconnectOpen, setReconnectOpen] = useState(false);
  const restoreAttempt = useRef(0);
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
  const [settingsOpen, setSettingsOpen] = useState(false),
    [planChoices, setPlanChoices] = useState<PlanChoices>({}),
    [planEnd, setPlanEnd] = useState(initialPlanEnd);
  const [tourOpen, setTourOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [help, setHelp] = useState(false);
  const latestData = useRef<Dashboard | null>(null);
  const monthRequests = useRef(new Map<string, Promise<boolean>>()),
    historyBootstrap = useRef(false),
    loginLock = useRef(false),
    generation = useRef(0),
    contextGeneration = useRef(0);
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
    const previous = latestData.current;
    latestData.current = next;
    setData(next);
    const changed =
      !previous ||
      previous.dynamicContext?.classroomId !==
        next.dynamicContext?.classroomId ||
      previous.dynamicContext?.semNo !== next.dynamicContext?.semNo;
    if (changed) {
      contextGeneration.current++;
      monthRequests.current.clear();
      historyBootstrap.current = false;
      setMonthLoading({});
      setMonthErrors({});
      setPlanChoices({});
      setSelected(null);
      if (previous && next.dynamicContext)
        setCalendarDate(
          new Date(
            next.dynamicContext.currentYear,
            next.dynamicContext.currentMonth - 1,
            1,
          ),
        );
    }
    setBundles((prev) =>
      changed || next.monthDetailsComplete !== false
        ? next.dailyBundle || {}
        : { ...prev, ...next.dailyBundle },
    );
    const context = next.dynamicContext;
    const current = context
      ? `${context.currentYear}-${String(context.currentMonth).padStart(2, "0")}`
      : monthKey(new Date());
    setMonths((prev) => {
      const result = changed ? {} : { ...prev };
      if (next.monthDetailsComplete !== false)
        result[current] = next.monthlyCalendar || {};
      else delete result[current];
      return result;
    });
    setUpdated(new Date(next.fetchedAt || Date.now()));
  }
  useEffect(() => {
    if (!data || !("serviceWorker" in navigator)) return;
    const onNotification = async (event: MessageEvent) => {
      if (event.data?.type !== "ATTENDANCE_NOTIFICATION_OPEN") return;
      const active = generation.current;
      try {
        const snapshot = await get<SavedDashboard>("/api/me/dashboard");
        if (active !== generation.current) return;
        apply(snapshot.data);
        setReconnectRequired(!!snapshot.campxReconnectRequired);
        setPage("overview");
        setSettingsOpen(false);
        setNotice(
          "Showing your saved attendance. Check the refresh time below.",
        );
      } catch {
        if (active === generation.current)
          setNotice("Reconnect or refresh to see your latest attendance.");
      }
    };
    navigator.serviceWorker.addEventListener("message", onNotification);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onNotification);
  }, [data]);
  async function authenticate(input: Credentials) {
    if (loginLock.current) return;
    loginLock.current = true;
    setBusy(true);
    setError("");
    try {
      const active = generation.current;
      const next = await login(input);
      if (active !== generation.current) return;
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
      setAccount({
        loginId: input.loginId,
        legacyCredentials: hasSession() ? undefined : input,
      });
      setRestoreError("");
      setReconnectRequired(false);
      apply(next);
      setPage("overview");
      setTourOpen(!tourSeen());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      loginLock.current = false;
      setBusy(false);
    }
  }
  function clearAccount() {
    restoreAttempt.current++;
    setRestoring(false);
    setRestoreError("");
    setReconnectRequired(false);
    setReconnectOpen(false);
    forgetPushToken();
    generation.current++;
    contextGeneration.current++;
    setBusy(false);
    setAccount(null);
    setSettingsOpen(false);
    setTourOpen(false);
    historyBootstrap.current = false;
    setPlanChoices({});
    setPlanEnd(initialPlanEnd());
    latestData.current = null;
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
  function signOut() {
    logout();
    clearAccount();
  }
  async function restoreAccount() {
    const attempt = ++restoreAttempt.current,
      active = generation.current;
    setRestoring(true);
    setRestoreError("");
    try {
      const snapshot = await restoreSession();
      if (attempt !== restoreAttempt.current || active !== generation.current)
        return;
      setAccount({ loginId: snapshot.loginId });
      if (snapshot.data.dynamicContext)
        setCalendarDate(
          new Date(
            snapshot.data.dynamicContext.currentYear,
            snapshot.data.dynamicContext.currentMonth - 1,
            1,
          ),
        );
      apply(snapshot.data);
      setReconnectRequired(!!snapshot.campxReconnectRequired);
      setError("");
      setPage("overview");
      const age = Date.now() - Date.parse(snapshot.data.fetchedAt || "");
      if (
        !snapshot.campxReconnectRequired &&
        (!Number.isFinite(age) || age > 60000)
      ) {
        setBusy(true);
        void refreshDashboard()
          .then((next) => {
            if (active !== generation.current) return;
            apply(next);
            setReconnectRequired(false);
          })
          .catch((e) => {
            if (active !== generation.current) return;
            if (
              e instanceof ApiError &&
              (e.code === "campx_reconnect" || e.code === "campx_session")
            )
              setReconnectRequired(true);
            else setError((e as Error).message);
          })
          .finally(() => {
            if (active === generation.current) setBusy(false);
          });
      }
    } catch (e) {
      if (attempt !== restoreAttempt.current || active !== generation.current)
        return;
      if (e instanceof ApiError && e.code === "session_changed") return;
      if (hasSession()) setRestoreError((e as Error).message);
      else setError((e as Error).message);
      if (
        e instanceof ApiError &&
        (e.code === "campx_reconnect" || e.code === "campx_session")
      )
        setReconnectRequired(true);
    } finally {
      if (attempt === restoreAttempt.current && active === generation.current)
        setRestoring(false);
    }
  }
  useEffect(() => {
    const changed = (event: Event) => {
      clearAccount();
      const message = (event as CustomEvent<{ message?: string }>).detail
        ?.message;
      if (hasSession()) void restoreAccount();
      else if (message) setError(message);
    };
    window.addEventListener(SESSION_EVENT, changed);
    return () => window.removeEventListener(SESSION_EVENT, changed);
  }, []);
  useEffect(() => {
    if (hasSession()) void restoreAccount();
    return () => {
      restoreAttempt.current++;
    };
  }, []);
  async function reconnectAccount(input: Credentials) {
    const active = generation.current;
    const next = await reconnect(input);
    if (active !== generation.current) return;
    setAccount({ loginId: input.loginId });
    apply(next);
    setReconnectRequired(false);
    setReconnectOpen(false);
    setRestoreError("");
    setError("");
    setNotice("CampX is connected again. Your attendance is up to date.");
  }
  async function refresh() {
    if (busy) return;
    if (!account) return;
    const token = generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await refreshDashboard(account.legacyCredentials);
      if (token === generation.current) {
        apply(next);
        setReconnectRequired(false);
        setNotice(
          next.source === "cache"
            ? "Showing your recent saved attendance. Check the refresh time below."
            : "Your attendance is up to date.",
        );
      }
    } catch (e) {
      if (token === generation.current) {
        setError((e as Error).message);
        if (
          e instanceof ApiError &&
          (e.code === "campx_reconnect" || e.code === "campx_session")
        )
          setReconnectRequired(true);
      }
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    const resume = () => {
      if (
        document.visibilityState !== "visible" ||
        !account ||
        busy ||
        reconnectRequired
      )
        return;
      const age = Date.now() - Date.parse(latestData.current?.fetchedAt || "");
      if (!Number.isFinite(age) || age > 60000) void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [account, busy, reconnectRequired]);
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
  async function loadMonth(target: Date): Promise<boolean> {
    const key = monthKey(target);
    if (months[key]) return true;
    if (!data || !account) return false;
    const running = monthRequests.current.get(key);
    if (running) return running;
    const active = generation.current,
      scope = contextGeneration.current;
    setMonthLoading((prev) => ({ ...prev, [key]: true }));
    setMonthErrors((prev) => ({ ...prev, [key]: "" }));
    const request = post<{
      monthlyCalendar: Record<string, string>;
      dailyBundle: Record<string, Bundle>;
    }>("/api/month-complete-data", {
      ...account.legacyCredentials,
      month: target.getMonth() + 1,
      year: target.getFullYear(),
      classroomId: data.dynamicContext?.classroomId,
      semNo: data.dynamicContext?.semNo,
    })
      .then((next) => {
        if (
          active !== generation.current ||
          scope !== contextGeneration.current
        )
          return false;
        setMonths((prev) => ({ ...prev, [key]: next.monthlyCalendar || {} }));
        setBundles((prev) => ({ ...prev, ...next.dailyBundle }));
        return true;
      })
      .catch((e) => {
        if (
          active === generation.current &&
          scope === contextGeneration.current
        ) {
          setMonthErrors((prev) => ({ ...prev, [key]: e.message }));
          if (
            e instanceof ApiError &&
            (e.code === "campx_reconnect" || e.code === "campx_session")
          )
            setReconnectRequired(true);
        }
        return false;
      })
      .finally(() => {
        if (monthRequests.current.get(key) === request)
          monthRequests.current.delete(key);
        if (
          active === generation.current &&
          scope === contextGeneration.current
        )
          setMonthLoading((prev) => ({ ...prev, [key]: false }));
      });
    monthRequests.current.set(key, request);
    return request;
  }
  const currentHistoryKey = campusDateKey(clock).slice(0, 7);
  const currentHistoryMonth = new Date(currentHistoryKey + "-01T12:00:00");
  let historyStart = new Date(currentHistoryMonth);
  for (let i = 0; i < 1200 && months[currentHistoryKey]; i++) {
    const previous = new Date(
      historyStart.getFullYear(),
      historyStart.getMonth() - 1,
      1,
    );
    if (!months[monthKey(previous)]) break;
    historyStart = previous;
  }
  const historyStartKey = monthKey(historyStart),
    olderMonth = new Date(
      historyStart.getFullYear(),
      historyStart.getMonth() - 1,
      1,
    ),
    olderKey = monthKey(olderMonth),
    historyBundles = Object.fromEntries(
      Object.entries(bundles).filter(
        ([date]) =>
          date >= historyStartKey + "-01" &&
          date.slice(0, 7) <= currentHistoryKey,
      ),
    );
  useEffect(() => {
    if (!data || !account) return;
    if (page === "calendar" || page === "playground")
      void loadMonth(calendarDate);
    else if (page === "subjects") void loadMonth(currentHistoryMonth);
  }, [calendarKey, page, data, account, months, monthRetry, currentHistoryKey]);
  useEffect(() => {
    if (
      page !== "subjects" ||
      !months[currentHistoryKey] ||
      historyBootstrap.current
    )
      return;
    historyBootstrap.current = true;
    const rows = data?.subjectWise?.subjects || [];
    if (
      rows.some((subject) => {
        const count = subjectHistory(
          subject,
          rows,
          historyBundles,
          clock,
        ).length;
        return count < 5 && subject.numberOfClasses > count;
      })
    )
      void loadMonth(olderMonth);
  }, [page, months, data, currentHistoryKey]);
  const subjects = data?.subjectWise?.subjects || [],
    student = data?.primary?.student;
  const overall = pct(
    data?.subjectWise?.overallAttendance ?? data?.primary?.attendancePercentage,
  );
  const stats = data?.primary?.primaryAttendance;
  const today = campusDateKey(clock),
    todayBundle = bundles[today];
  const changeTheme = (next: string, origin?: HTMLElement) =>
    revealTheme(next, setTheme, origin);
  const toggleTheme = (origin?: HTMLElement) =>
    changeTheme(theme === "dark" ? "light" : "dark", origin);
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
        document.querySelector(".student-day-detail")?.scrollIntoView({
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
      <CornerControls
        theme={theme}
        toggle={toggleTheme}
        settings={data ? () => setSettingsOpen(true) : undefined}
      />
      {!data && (restoring || restoreError) ? (
        <div className="session-gate">
          <Brand />
          <section className="glass">
            {restoring && <RefreshCw className="spin" size={25} />}
            <h1>
              {restoring ? "Opening your account…" : "Your sign-in is saved"}
            </h1>
            <p>{restoring ? "Loading your saved attendance." : restoreError}</p>
            <div className="session-gate-actions">
              {!restoring && (
                <button
                  className="button primary"
                  onClick={() =>
                    reconnectRequired
                      ? setReconnectOpen(true)
                      : void restoreAccount()
                  }
                >
                  {reconnectRequired ? "Reconnect CampX" : "Try again"}
                </button>
              )}
              <button className="button secondary" onClick={signOut}>
                Sign out
              </button>
            </div>
          </section>
        </div>
      ) : !data ? (
        <Login busy={busy} error={error} login={authenticate} />
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
                className={`nav-item ${settingsOpen ? "active" : ""}`}
                onClick={() => setSettingsOpen(true)}
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
            <main id="main-content">
              {!online && (
                <div className="alert">
                  <WifiOff size={17} />
                  You're offline. Showing data from this open session.
                </div>
              )}
              {reconnectRequired && (
                <div className="alert" role="status">
                  <span>
                    You’re still signed in. Reconnect CampX to load new
                    attendance; your saved records remain available.
                  </span>
                  <button onClick={() => setReconnectOpen(true)}>
                    Reconnect CampX
                  </button>
                </div>
              )}
              {error && !reconnectRequired && (
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
                    ) : page === "playground" ? (
                      "Your attendance playground."
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
                          : page === "playground"
                            ? "Plan future days and classes without changing your official records."
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
                    title={`${subjects.length} ${subjects.length === 1 ? "subject" : "subjects"} · one clear view`}
                  />
                  <Subjects
                    subjects={subjects}
                    history={{
                      bundles: historyBundles,
                      now: clock,
                      loading: !!monthLoading[currentHistoryKey],
                      error: monthErrors[currentHistoryKey] || "",
                      retry: () => setMonthRetry((v) => v + 1),
                      loadOlder: () => loadMonth(olderMonth),
                      olderLoading: !!monthLoading[olderKey],
                      olderError: monthErrors[olderKey] || "",
                      range: `Loaded from ${historyStart.toLocaleDateString("en-IN", { month: "short", year: "numeric" })} to ${currentHistoryMonth.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`,
                    }}
                  />

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
              {page === "playground" && (
                <Playground
                  data={data}
                  bundles={bundles}
                  date={calendarDate}
                  move={moveMonth}
                  ready={!!months[calendarKey]}
                  loading={monthBusy}
                  error={monthError}
                  retry={() => setMonthRetry((v) => v + 1)}
                  choices={planChoices}
                  setChoices={setPlanChoices}
                  end={planEnd}
                  setEnd={setPlanEnd}
                />
              )}
              {settingsOpen && (
                <CornerSettings close={() => setSettingsOpen(false)}>
                  <Settings
                    theme={theme}
                    setTheme={changeTheme}
                    student={student}
                    loginId={account?.loginId}
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
                    startTour={() => {
                      setSettingsOpen(false);
                      setTourOpen(true);
                    }}
                  />
                </CornerSettings>
              )}
              <footer className="page-footer">
                <span>
                  <i className={busy ? "pulse" : ""} />
                  {busy
                    ? "Fetching from CampX…"
                    : updated
                      ? `Last refreshed at ${updated.toLocaleTimeString("en-IN", { timeZone: CAMPUS_ZONE, hour: "2-digit", minute: "2-digit", hour12: true })}`
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
            {pages.map(({ id, label, icon: Icon }) => (
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
            <button
              className={settingsOpen ? "active" : ""}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={20} />
              <span>Settings</span>
            </button>
          </nav>
        </div>
      )}
      {reconnectOpen && (
        <ReconnectDialog
          loginId={account?.loginId}
          close={() => setReconnectOpen(false)}
          submit={reconnectAccount}
        />
      )}
      {tourOpen && data && (
        <GuidedTour
          navigate={setPage}
          close={() => {
            markTourSeen();
            setTourOpen(false);
          }}
        />
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
