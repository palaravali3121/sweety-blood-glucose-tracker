import React from "react";
import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const SLOTS = [
  ["morning", "Morning (fasting)"],
  ["after_breakfast", "After breakfast"],
  ["after_lunch", "After lunch"],
  ["after_dinner", "After dinner"],
];
const GOALS = [
  ["build_consistency", "Build a steady routine"],
  ["understand_patterns", "Notice my patterns"],
  ["share_with_clinician", "Keep a record to discuss with my care team"],
];
const utcToday = () => new Date().toISOString().slice(0, 10);
async function api(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}
const dateLabel = (s) =>
  new Date(`${s}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function App() {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("sweety-session"));
    } catch {
      return null;
    }
  });
  const [mode, setMode] = useState("login");
  const [auth, setAuth] = useState({ name: "", email: "", password: "" });
  const [profile, setProfile] = useState(null);
  const [onboarding, setOnboarding] = useState(false);
  const [goal, setGoal] = useState("build_consistency");
  const [preferredSlot, setPreferredSlot] = useState("morning");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [date, setDate] = useState(utcToday());
  const [readings, setReadings] = useState([]);
  const [report, setReport] = useState(null);
  const [entry, setEntry] = useState({
    date: utcToday(),
    slot: "morning",
    value: "",
  });
  const [editing, setEditing] = useState(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadProfile(token, signal) {
    const me = await api("/me", token, { signal });
    setProfile(me);
    setGoal(me.tracking_goal || "build_consistency");
    setPreferredSlot(me.preferred_slot || "morning");
    setReminderEnabled(Boolean(me.reminder_enabled));
    setPhoneVerified(Boolean(me.phone_verified_at));
    setPhone(me.phone || "");
    if (!me.tracking_goal) setOnboarding(true);
  }
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    loadProfile(session.token, controller.signal).catch((e) => {
      if (!controller.signal.aborted) {
        setError(e.message);
        if (/expired|invalid/i.test(e.message)) logout();
      }
    });
    return () => controller.abort();
  }, [session]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    Promise.all([
      api("/readings", session.token, { signal: controller.signal }),
      api(`/readings/reports?date=${encodeURIComponent(date)}`, session.token, {
        signal: controller.signal,
      }),
    ])
      .then(([items, r]) => {
        setReadings(items);
        setReport(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [date, session?.token]);

  async function submitAuth(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api(`/auth/${mode}`, null, {
        method: "POST",
        body: JSON.stringify(auth),
      });
      localStorage.setItem("sweety-session", JSON.stringify(result));
      setSession(result);
      setAuth({ name: "", email: "", password: "" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveOnboarding(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const me = await api("/me", session.token, {
        method: "PATCH",
        body: JSON.stringify({ goal, preferredSlot, reminderEnabled }),
      });
      setProfile(me);
      setOnboarding(false);
      setNotice("Your preferences are saved. You can update them anytime.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveReading(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const selectedDate = entry.date;
      const body = JSON.stringify(entry);
      if (editing)
        await api(`/readings/${editing}`, session.token, {
          method: "PUT",
          body,
        });
      else await api("/readings", session.token, { method: "POST", body });
      setEditing(null);
      setEntry({ date: selectedDate, slot: "morning", value: "" });
      setDate(selectedDate);
      const [items, r] = await Promise.all([
        api("/readings", session.token),
        api(
          `/readings/reports?date=${encodeURIComponent(selectedDate)}`,
          session.token,
        ),
      ]);
      setReadings(items);
      setReport(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id) {
    if (!window.confirm("Delete this reading?")) return;
    try {
      await api(`/readings/${id}`, session.token, { method: "DELETE" });
      const [items, r] = await Promise.all([
        api("/readings", session.token),
        api(
          `/readings/reports?date=${encodeURIComponent(date)}`,
          session.token,
        ),
      ]);
      setReadings(items);
      setReport(r);
    } catch (e) {
      setError(e.message);
    }
  }
  function logout() {
    localStorage.removeItem("sweety-session");
    setSession(null);
    setProfile(null);
    setReadings([]);
    setReport(null);
    setOnboarding(false);
    setError("");
    setNotice("");
  }
  async function requestOtp(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await api("/otp/request", session.token, {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      setOtpSent(true);
      setNotice(result.message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function verifyOtp(value = code) {
    setError("");
    setBusy(true);
    try {
      await api("/otp/verify", session.token, {
        method: "POST",
        body: JSON.stringify({ phone, code: value }),
      });
      setPhoneVerified(true);
      setOtpSent(false);
      setNotice("Phone number verified.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !otpSent ||
      !session ||
      !("OTPCredential" in window) ||
      !window.isSecureContext
    )
      return;
    const controller = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ["sms"] }, signal: controller.signal })
      .then((credential) => {
        if (credential?.code) {
          setCode(credential.code);
          verifyOtp(credential.code);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [otpSent, session]);

  if (!session)
    return (
      <main className="auth-wrap">
        <section className="auth-card enter">
          <a className="brand" href="#home">
            <span className="brand-heart">♥</span>Sweety
          </a>
          <p className="eyebrow">A GENTLER WAY TO KEEP TRACK</p>
          <h1>
            {mode === "login"
              ? "Welcome back"
              : "Your wellness, one day at a time"}
          </h1>
          <p className="muted">
            A simple place to record your glucose readings and view your
            patterns.
          </p>
          <form className="form-stack" onSubmit={submitAuth}>
            {mode === "register" && (
              <label>
                Name
                <input
                  autoComplete="name"
                  maxLength="100"
                  required
                  value={auth.name}
                  onChange={(e) => setAuth({ ...auth, name: e.target.value })}
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={auth.email}
                onChange={(e) => setAuth({ ...auth, email: e.target.value })}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength="8"
                maxLength="72"
                required
                value={auth.password}
                onChange={(e) => setAuth({ ...auth, password: e.target.value })}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Log in"
                  : "Create account"}
            </button>
          </form>
          <p className="switch">
            {mode === "login" ? "New to Sweety?" : "Already have an account?"}{" "}
            <button
              className="text-button"
              onClick={() => {
                setError("");
                setMode(mode === "login" ? "register" : "login");
              }}
            >
              {" "}
              {mode === "login" ? "Create an account" : "Log in"}
            </button>
          </p>
        </section>
      </main>
    );

  if (onboarding)
    return (
      <main className="onboard-wrap">
        <section className="onboard-card enter">
          <div className="brand">
            <span className="brand-heart">♥</span>Sweety
          </div>
          <div className="progress">
            <span />
          </div>
          <p className="eyebrow">A FEW THINGS ABOUT YOU</p>
          <h1>Make Sweety feel like yours.</h1>
          <p className="muted">
            These preferences help shape your tracking experience. You can skip
            them or change them later.
          </p>
          <form onSubmit={saveOnboarding} className="form-stack">
            <fieldset>
              <legend>What would you like help with?</legend>
              {GOALS.map(([value, label]) => (
                <label
                  className={`choice ${goal === value ? "selected" : ""}`}
                  key={value}
                >
                  <input
                    type="radio"
                    name="goal"
                    value={value}
                    checked={goal === value}
                    onChange={() => setGoal(value)}
                  />
                  <span className="radio-dot" />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <label>
              When do you usually like to log a reading?
              <select
                value={preferredSlot}
                onChange={(e) => setPreferredSlot(e.target.value)}
              >
                {SLOTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle-row">
              <span>
                <b>Reminder preference</b>
                <small>
                  This saves your preference only. Sweety does not send
                  reminders yet.
                </small>
              </span>
              <input
                type="checkbox"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
              />
            </label>
            <div className="divider" />
            <div>
              <p className="otp-title">Optional: verify your phone</p>
              <p className="hint">
                Useful for confirming your number. Email and password remain
                your sign-in method.
              </p>
              {phoneVerified ? (
                <p className="verified">✓ Phone verified</p>
              ) : (
                <>
                  <div className="phone-row">
                    <input
                      type="tel"
                      autoComplete="tel"
                      placeholder="+1 415 555 2671"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={requestOtp}
                    >
                      {otpSent ? "Send again" : "Text me a code"}
                    </button>
                  </div>
                  {otpSent && (
                    <div className="phone-row otp-row">
                      <input
                        aria-label="Six-digit verification code"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength="6"
                        placeholder="6-digit code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (code.length === 6) verifyOtp();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || code.length !== 6}
                        onClick={() => verifyOtp()}
                      >
                        Verify
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="success" role="status">
                {notice}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => saveOnboarding({ preventDefault() {} })}
              >
                Skip for now
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Finish setup"}
              </button>
            </div>
          </form>
        </section>
      </main>
    );

  const dayRows = report?.daily?.readings || [];
  const cards = [
    ["Today", report?.daily],
    ["Month to date", report?.monthToDate],
    ["Previous month", report?.previousMonth],
  ];
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home">
          <span className="brand-heart">♥</span>Sweety
        </a>
        <div className="top-actions">
          <span>Hi, {profile?.name}</span>
          <button className="quiet-button" onClick={() => setOnboarding(true)}>
            Preferences
          </button>
          <button className="quiet-button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">YOUR GLUCOSE JOURNAL</p>
          <h1>A little care, every day.</h1>
          <p className="muted">Your readings, organized in one calm place.</p>
        </div>
        <div className="flower" aria-hidden="true">
          ✿
        </div>
      </section>
      {error && (
        <div className="error page-error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="success page-error" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <section className="summary-grid" aria-label="Reports">
        {cards.map(([title, item]) => (
          <article className="card summary enter" key={title}>
            <p className="card-label">{title}</p>
            <p className="date-range">
              {item
                ? `${dateLabel(item.from)}${item.from !== item.to ? ` – ${dateLabel(item.to)}` : ""}`
                : "Select a date"}
            </p>
            {item?.count ? (
              <>
                <div className="average">
                  {item.average}
                  <small>mg/dL average</small>
                </div>
                <div className="high-low">
                  <span>
                    Highest <b>{item.highest}</b>
                  </span>
                  <span>
                    Lowest <b>{item.lowest}</b>
                  </span>
                </div>
                <p className="count">
                  {item.count} {item.count === 1 ? "reading" : "readings"}
                </p>
              </>
            ) : (
              <p className="empty-small">No readings for this period.</p>
            )}
          </article>
        ))}
      </section>
      <div className="work-grid">
        <section className="card form-card">
          <div className="card-heading">
            <div>
              <p className="card-label">DAILY LOG</p>
              <h2>{editing ? "Edit reading" : "Add a reading"}</h2>
            </div>
            <span className="badge-icon">＋</span>
          </div>
          <form className="form-stack" onSubmit={saveReading}>
            <label>
              Date
              <input
                type="date"
                max={utcToday()}
                required
                value={entry.date}
                onChange={(e) => setEntry({ ...entry, date: e.target.value })}
              />
            </label>
            <label>
              Time slot
              <select
                required
                value={entry.slot}
                onChange={(e) => setEntry({ ...entry, slot: e.target.value })}
              >
                {SLOTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Glucose value <small className="unit">mg/dL</small>
              <input
                type="number"
                min="40"
                max="600"
                step="1"
                required
                placeholder="For example, 105"
                value={entry.value}
                onChange={(e) => setEntry({ ...entry, value: e.target.value })}
              />
            </label>
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : editing ? "Save changes" : "Save reading"}
              </button>
              {editing && (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => {
                    setEditing(null);
                    setEntry({ date, slot: "morning", value: "" });
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          <p className="hint">
            One reading per time slot, up to four each day.
          </p>
        </section>
        <section className="card history-card">
          <div className="card-heading">
            <div>
              <p className="card-label">READING HISTORY</p>
              <h2>Your readings</h2>
            </div>
            <label className="date-input">
              <span className="sr-only">Report date</span>
              <input
                type="date"
                max={utcToday()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          {dayRows.length ? (
            <div className="reading-list">
              {dayRows.map((r) => (
                <article className="reading" key={r.id}>
                  <span className="reading-marker" />
                  <div className="reading-name">
                    <b>
                      {SLOTS.find(([key]) => key === r.slot)?.[1] || r.slot}
                    </b>
                    <small>{dateLabel(r.date)}</small>
                  </div>
                  <strong>
                    {r.value}
                    <small> mg/dL</small>
                  </strong>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      onClick={() => {
                        setEditing(r.id);
                        setEntry({
                          date: r.date,
                          slot: r.slot,
                          value: String(r.value),
                        });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => remove(r.id)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span>♡</span>
              <b>No readings on this date</b>
              <p>Choose a date or add your first reading.</p>
            </div>
          )}
        </section>
      </div>
      <footer>
        Made for mindful tracking <span>·</span> Your health data belongs to you
      </footer>
    </main>
  );
}
