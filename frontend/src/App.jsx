import { useState, useEffect, useRef, useCallback } from "react";

const API = "http://localhost:8001";

// ── Helpers ────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, "0"); }
function fmtTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${pad(m)}:${pad(s)}`;
}
function token() { return localStorage.getItem("sf_token"); }
function authHeaders() { return { "Content-Type": "application/json", Authorization: `Bearer ${token()}` }; }

const SUBJECTS = ["Bio", "Combined Maths", "Physics", "Chemistry"];
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Auth Screen ────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      if (mode === "register") {
        const r = await fetch(`${API}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const d = await r.json();
        if (!r.ok) { setErr(d.detail || "Registration failed"); setLoading(false); return; }
        localStorage.setItem("sf_token", d.token);
        onLogin({ name: d.name, session_length: d.session_length, cache: null });
      } else {
        const body = new URLSearchParams({ username: form.email, password: form.password });
        const r = await fetch(`${API}/auth/login`, { method: "POST", body });
        const d = await r.json();
        if (!r.ok) { setErr(d.detail || "Login failed"); setLoading(false); return; }
        localStorage.setItem("sf_token", d.access_token);
        onLogin({ name: d.name, session_length: d.session_length, cache: d.cache });
      }
    } catch {
      setErr("Cannot connect to server. Is the backend running?");
    }
    setLoading(false);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="logo-mark">⏱</div>
        <h1 className="auth-title">StudyFlow</h1>
        <p className="auth-sub">Focus. Track. Grow.</p>
        <div className="tab-row">
          <button className={`tab-btn${mode === "login" ? " active" : ""}`} onClick={() => setMode("login")}>Log in</button>
          <button className={`tab-btn${mode === "register" ? " active" : ""}`} onClick={() => setMode("register")}>Register</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === "register" && (
            <input className="input-field" placeholder="Full name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          )}
          <input className="input-field" type="email" placeholder="Email" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          <input className="input-field" type="password" placeholder="Password" value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          {err && <p className="err-msg">{err}</p>}
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Timer Ring ────────────────────────────────────────────────────────────
function TimerRing({ pct, timeLeft, running, subject }) {
  const R = 110, C = 2 * Math.PI * R;
  const dash = C * (1 - pct);
  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 260 260" className="ring-svg">
        <circle cx="130" cy="130" r={R} fill="none" strokeWidth="12" className="ring-track" />
        <circle cx="130" cy="130" r={R} fill="none" strokeWidth="12"
          strokeDasharray={C} strokeDashoffset={dash}
          strokeLinecap="round" className={`ring-bar${running ? " running" : ""}`}
          style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }} />
      </svg>
      <div className="ring-inner">
        <span className="ring-subject">{subject}</span>
        <span className="ring-time">{fmtTime(timeLeft)}</span>
        <span className="ring-label">{running ? "focusing" : "paused"}</span>
      </div>
    </div>
  );
}

// ── Weekly Bar Chart ──────────────────────────────────────────────────────
function WeeklyChart({ weekly, totalMinutes }) {
  const max = Math.max(...Object.values(weekly).map(d => d.minutes), 1);
  const totalHrs = (totalMinutes / 60).toFixed(1);
  return (
    <div className="chart-card">
      <div className="chart-header">
        <div>
          <p className="chart-label">This week</p>
          <p className="chart-total">{totalHrs}h studied</p>
        </div>
        <div className="chart-meta">
          {Object.values(weekly).reduce((a, d) => a + d.sessions, 0)} sessions
        </div>
      </div>
      <div className="bar-grid">
        {DAY_ORDER.map(day => {
          const d = weekly[day] || { minutes: 0, sessions: 0 };
          const pct = max > 0 ? (d.minutes / max) * 100 : 0;
          const hrs = d.minutes >= 60 ? `${(d.minutes / 60).toFixed(1)}h` : `${d.minutes}m`;
          return (
            <div key={day} className="bar-col">
              <div className="bar-outer">
                <div className="bar-fill" style={{ height: `${pct}%` }}>
                  {d.minutes > 0 && <span className="bar-val">{hrs}</span>}
                </div>
              </div>
              <span className="bar-day">{day}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Recent Sessions ───────────────────────────────────────────────────────
function SessionList({ sessions }) {
  const recent = [...(sessions || [])].reverse().slice(0, 8);
  if (!recent.length) return <p className="empty-msg">No sessions yet. Start your first one!</p>;
  return (
    <div className="session-list">
      {recent.map((s, i) => {
        const date = new Date(s.ended_at);
        const label = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        return (
          <div key={i} className="session-row">
            <div className="session-left">
              <span className={`session-dot ${s.completed ? "done" : "stop"}`} />
              <span className="session-subject">{s.subject || "Bio"}</span>
            </div>
            <div className="session-right">
              <span className="session-dur">{s.duration_minutes} min</span>
              <span className="session-date">{label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────
function SettingsPanel({ sessionLength, onSave }) {
  const [val, setVal] = useState(sessionLength);
  const [saved, setSaved] = useState(false);

  async function save() {
    await fetch(`${API}/settings`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ session_length: val }),
    });
    onSave(val);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="settings-card">
      <h3 className="settings-title">Session settings</h3>
      <label className="settings-label">Default session length: <strong>{val} min</strong></label>
      <input type="range" min="5" max="180" step="5" value={val}
        onChange={e => setVal(Number(e.target.value))} className="settings-range" />
      <div className="range-marks">
        {[15, 30, 45, 60, 90, 120].map(n => (
          <span key={n} onClick={() => setVal(n)} className={`range-mark${val === n ? " active" : ""}`}>{n}m</span>
        ))}
      </div>
      <button className="btn-primary sm" onClick={save}>{saved ? "Saved ✓" : "Save"}</button>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [cache, setCache] = useState(null);
  const [view, setView] = useState("timer");
  const [sessionLen, setSessionLen] = useState(60);
  const [subject, setSubject] = useState("Bio");
  const [timeLeft, setTimeLeft] = useState(60 * 60);
  const [running, setRunning] = useState(false);
  const [sessionStart, setSessionStart] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [weekly, setWeekly] = useState({});
  const [totalMinutes, setTotalMinutes] = useState(0);
  const timerRef = useRef(null);
  const wsRef = useRef(null);
  const pollRef = useRef(null);
  const lastTickRef = useRef(Date.now());

  // ── Login handler ──────────────────────────────────────────────────
  function handleLogin({ name, session_length, cache: loginCache }) {
    setUser(name);
    setSessionLen(session_length);
    setTimeLeft(session_length * 60);
    if (loginCache) {
      setCache(loginCache);
    }
    startPolling();
    startWebSocket();
  }

  // ── JSON cache polling (real-time sync) ───────────────────────────
  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API}/sessions/cache`, { headers: authHeaders() });
        if (r.ok) {
          const data = await r.json();
          setCache(data);
        }
      } catch {}
    }, 5000); // poll every 5s from JSON layer
  }

  // ── WebSocket for cross-tab sync ───────────────────────────────────
  function startWebSocket() {
    // Would connect to /ws/{user_id} — implement user_id storage if needed
  }

  // ── Fetch weekly report ────────────────────────────────────────────
  async function fetchWeekly() {
    try {
      const r = await fetch(`${API}/sessions/weekly-report`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setWeekly(d.weekly);
        setTotalMinutes(d.total_minutes);
      }
    } catch {}
  }

  useEffect(() => {
    if (view === "report" && user) fetchWeekly();
  }, [view, user, cache]);

  // ── Timer logic ────────────────────────────────────────────────────
  function startTimer() {
    if (running) return;
    setRunning(true);
    setSessionStart(new Date().toISOString());
    setSessionId(crypto.randomUUID());
  }

  function pauseTimer() { setRunning(false); }

  async function stopTimer(completed = false) {
    setRunning(false);
    if (!sessionStart) return;
    const endedAt = new Date().toISOString();
    const elapsed = sessionLen * 60 - timeLeft;
    const durationMin = Math.max(1, Math.round(elapsed / 60));
    const payload = {
      session_id: sessionId || crypto.randomUUID(),
      duration_minutes: durationMin,
      completed,
      stopped_early: !completed,
      subject,
      started_at: sessionStart,
      ended_at: endedAt,
    };
    try {
      await fetch(`${API}/sessions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
    } catch {}
    setSessionStart(null);
    setSessionId(null);
    setTimeLeft(sessionLen * 60);
  }

  useEffect(() => {
    if (running) {
      lastTickRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const now = Date.now();
        const deltaSecs = Math.floor((now - lastTickRef.current) / 1000);
        if (deltaSecs >= 1) {
          lastTickRef.current += deltaSecs * 1000;
          setTimeLeft(prev => {
            const next = prev - deltaSecs;
            if (next <= 0) {
              clearInterval(timerRef.current);
              setRunning(false);
              stopTimer(true);
              return 0;
            }
            return next;
          });
        }
      }, 500);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [running]);

  useEffect(() => {
    if (!running) setTimeLeft(sessionLen * 60);
  }, [sessionLen]);

  // ── Logout ─────────────────────────────────────────────────────────
  function logout() {
    localStorage.removeItem("sf_token");
    setUser(null);
    setCache(null);
    setRunning(false);
    clearInterval(pollRef.current);
    clearInterval(timerRef.current);
  }

  // ── Check for existing token ───────────────────────────────────────
  useEffect(() => {
    const t = token();
    if (t) {
      fetch(`${API}/sessions/cache`, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            setUser(data.name);
            setSessionLen(data.session_length);
            setTimeLeft(data.session_length * 60);
            setCache(data);
            startPolling();
          }
        }).catch(() => {});
    }
  }, []);

  if (!user) return <AuthScreen onLogin={handleLogin} />;

  const totalSecs = sessionLen * 60;
  const pct = timeLeft / totalSecs;
  const sessions = cache?.sessions || [];

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-logo">⏱ StudyFlow</div>
        <nav className="header-nav">
          {["timer", "report", "history", "settings"].map(v => (
            <button key={v} className={`nav-btn${view === v ? " active" : ""}`} onClick={() => setView(v)}>
              {v === "timer" ? "Timer" : v === "report" ? "Report" : v === "history" ? "History" : "Settings"}
            </button>
          ))}
        </nav>
        <button className="btn-ghost" onClick={logout}>Log out</button>
      </header>

      <main className="app-main">
        {/* ── Timer view ── */}
        {view === "timer" && (
          <div className="timer-view">
            <div className="greeting">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {user} 👋</div>
            <div className="subject-row">
              {SUBJECTS.map(s => (
                <button key={s} className={`subject-pill${subject === s ? " active" : ""}`}
                  onClick={() => !running && setSubject(s)}>{s}</button>
              ))}
            </div>
            <TimerRing pct={pct} timeLeft={timeLeft} running={running} subject={subject} />
            <div className="ctrl-row">
              {!running
                ? <button className="btn-start" onClick={startTimer}>Start session</button>
                : <button className="btn-pause" onClick={pauseTimer}>Pause</button>
              }
              {(running || timeLeft < totalSecs) && (
                <button className="btn-stop" onClick={() => stopTimer(false)}>Stop & save</button>
              )}
            </div>
            <div className="session-len-row">
              <span className="sl-label">Session: {sessionLen} min</span>
              {!running && (
                <div className="sl-chips">
                  {[25, 45, 60, 90, 120].map(n => (
                    <button key={n} className={`sl-chip${sessionLen === n ? " active" : ""}`}
                      onClick={() => { setSessionLen(n); setTimeLeft(n * 60); }}>{n}m</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Report view ── */}
        {view === "report" && (
          <div className="report-view">
            <h2 className="view-title">Weekly report</h2>
            <WeeklyChart weekly={weekly} totalMinutes={totalMinutes} />
            <div className="stats-row">
              {[
                { label: "Total hours", val: `${(totalMinutes / 60).toFixed(1)}h` },
                { label: "Sessions", val: Object.values(weekly).reduce((a, d) => a + d.sessions, 0) },
                { label: "Daily avg", val: `${Math.round(totalMinutes / 7)}m` },
                { label: "Best day", val: DAY_ORDER.reduce((best, d) => (weekly[d]?.minutes || 0) > (weekly[best]?.minutes || 0) ? d : best, "Mon") },
              ].map(({ label, val }) => (
                <div key={label} className="stat-card">
                  <span className="stat-label">{label}</span>
                  <span className="stat-val">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── History view ── */}
        {view === "history" && (
          <div className="history-view">
            <h2 className="view-title">Session history</h2>
            <SessionList sessions={sessions} />
          </div>
        )}

        {/* ── Settings view ── */}
        {view === "settings" && (
          <div className="settings-view">
            <h2 className="view-title">Settings</h2>
            <SettingsPanel sessionLength={sessionLen} onSave={n => { setSessionLen(n); setTimeLeft(n * 60); }} />
            <div className="sync-info">
              <p className="sync-label">JSON cache last synced</p>
              <p className="sync-time">{cache?.last_updated ? new Date(cache.last_updated).toLocaleTimeString() : "–"}</p>
              <p className="sync-desc">Your data loads from a local JSON cache on login for instant access, then syncs with MongoDB every 5 seconds.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
