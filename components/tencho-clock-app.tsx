"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { AdminAttendanceRow, AttendanceRecord, AttendanceStatus, Profile } from "@/lib/types";
import {
  formatDuration,
  formatTime,
  getRecordsStatus,
  monthStartKey,
  recordMinutes,
  recordsMinutes,
  statusLabel,
  todayKey,
} from "@/lib/time";

type View = "manager" | "admin";
type AuthMode = "login" | "signup";

export function TenchoClockApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([]);
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([]);
  const [adminRows, setAdminRows] = useState<AdminAttendanceRow[]>([]);
  const [view, setView] = useState<View>("manager");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [filter, setFilter] = useState<AttendanceStatus | "all">("all");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupStoreName, setSignupStoreName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [memo, setMemo] = useState("");
  const [isEditingAttendance, setIsEditingAttendance] = useState(false);
  const [manualClockIn, setManualClockIn] = useState("");
  const [manualClockOut, setManualClockOut] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setError("Supabaseの環境変数が未設定です");
      setLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setTodayRecords([]);
        setMonthRecords([]);
        setAdminRows([]);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadDashboard();
  }, [session]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  async function loadDashboard() {
    if (!session?.user.id) return;
    setLoading(true);
    setError("");

    try {
      const loadedProfile = await fetchProfile(session.user.id, session.user.email ?? null);
      setProfile(loadedProfile);
      setStoreName(loadedProfile.store_name ?? "");

      const [today, month] = await Promise.all([
        fetchTodayRecords(session.user.id),
        fetchMonthRecords(session.user.id),
      ]);

      const targetRecord = getEditableRecord(today);
      setTodayRecords(today);
      setMonthRecords(month);
      setMemo(targetRecord?.memo ?? "");
      if (isEditingAttendance) {
        setManualClockIn(toDateTimeInputValue(targetRecord?.clock_in));
        setManualClockOut(toDateTimeInputValue(targetRecord?.clock_out));
      }

      if (loadedProfile.role === "admin") {
        setView("admin");
        await loadAdminRows();
      } else {
        setView("manager");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function fetchProfile(userId: string, userEmail: string | null) {
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle<Profile>();

    if (profileError) throw profileError;
    if (data) return data;

    const fallbackProfile = {
      id: userId,
      email: userEmail,
      name: userEmail?.split("@")[0] ?? "店長",
      role: "manager",
      store_name: "",
    };

    const { data: created, error: createError } = await supabase
      .from("profiles")
      .insert(fallbackProfile)
      .select("*")
      .single<Profile>();

    if (createError) throw createError;
    return created;
  }

  async function fetchTodayRecords(userId: string) {
    const { data, error: recordError } = await supabase
      .from("attendance_records")
      .select("*")
      .eq("user_id", userId)
      .eq("work_date", todayKey())
      .order("clock_in", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .returns<AttendanceRecord[]>();

    if (recordError) throw recordError;
    return data ?? [];
  }

  async function fetchMonthRecords(userId: string) {
    const { data, error: monthError } = await supabase
      .from("attendance_records")
      .select("*")
      .eq("user_id", userId)
      .gte("work_date", monthStartKey())
      .lte("work_date", todayKey())
      .order("work_date", { ascending: true })
      .returns<AttendanceRecord[]>();

    if (monthError) throw monthError;
    return data ?? [];
  }

  async function loadAdminRows() {
    const [{ data: profiles, error: profilesError }, { data: records, error: recordsError }] =
      await Promise.all([
        supabase.from("profiles").select("*").order("name", { ascending: true }).returns<Profile[]>(),
        supabase
          .from("attendance_records")
          .select("*")
          .eq("work_date", todayKey())
          .order("clock_in", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
          .returns<AttendanceRecord[]>(),
      ]);

    if (profilesError) throw profilesError;
    if (recordsError) throw recordsError;

    const recordsByUser = new Map<string, AttendanceRecord[]>();
    for (const record of records ?? []) {
      recordsByUser.set(record.user_id, [...(recordsByUser.get(record.user_id) ?? []), record]);
    }

    setAdminRows(
      (profiles ?? [])
        .filter((item) => item.role === "manager")
        .map((item) => {
          const userRecords = recordsByUser.get(item.id) ?? [];
          const record = getEditableRecord(userRecords);
          return {
            profile: item,
            record,
            records: userRecords,
            status: getRecordsStatus(userRecords),
            todayMinutes: recordsMinutes(userRecords, now),
          };
        }),
    );
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) setError(loginError.message);
    setSaving(false);
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    const name = signupName.trim();
    const signupStore = signupStoreName.trim();

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          store_name: signupStore,
        },
      },
    });

    if (signupError) {
      setError(signupError.message);
      setSaving(false);
      return;
    }

    if (data.session && data.user) {
      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          id: data.user.id,
          email: data.user.email ?? email,
          name,
          role: "manager",
          store_name: signupStore,
        },
        { onConflict: "id" },
      );

      if (profileError) {
        setError(profileError.message);
      } else {
        setSession(data.session);
        setMessage("アカウントを作成しました");
      }
    } else {
      setAuthMode("login");
      setMessage("アカウントを作成しました。メール確認後にログインしてください。");
    }

    setSaving(false);
  }

  async function handleLogout() {
    setSaving(true);
    await supabase.auth.signOut();
    setSaving(false);
  }

  async function handleClockIn() {
    if (!session?.user.id) return;
    setSaving(true);
    setError("");
    const payload = {
      user_id: session.user.id,
      work_date: todayKey(),
      store_name: storeName.trim() || profile?.store_name || null,
      clock_in: new Date().toISOString(),
      clock_out: null,
      memo: memo.trim() || null,
    };

    const { error: insertError } = await supabase.from("attendance_records").insert(payload);

    if (insertError) {
      setError(insertError.message);
    } else {
      await loadDashboard();
    }
    setSaving(false);
  }

  async function handleClockOut() {
    if (!openRecord) return;
    setSaving(true);
    setError("");
    const { error: updateError } = await supabase
      .from("attendance_records")
      .update({
        store_name: storeName.trim() || openRecord.store_name,
        clock_out: new Date().toISOString(),
        memo: memo.trim() || null,
      })
      .eq("id", openRecord.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      await loadDashboard();
    }
    setSaving(false);
  }

  function openAttendanceEdit() {
    setManualClockIn(toDateTimeInputValue(editableRecord?.clock_in));
    setManualClockOut(toDateTimeInputValue(editableRecord?.clock_out));
    setError("");
    setMessage("");
    setIsEditingAttendance(true);
  }

  async function handleManualCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.user.id) return;

    const clockInIso = manualClockIn ? dateTimeInputToIso(manualClockIn) : null;
    const clockOutIso = manualClockOut ? dateTimeInputToIso(manualClockOut) : null;

    if (!clockInIso && !clockOutIso) {
      setError("出勤時刻または退勤時刻を入力してください");
      return;
    }

    if (!clockInIso && clockOutIso) {
      setError("退勤時刻を保存する場合は出勤時刻も入力してください");
      return;
    }

    if (clockInIso && clockOutIso && new Date(clockOutIso).getTime() < new Date(clockInIso).getTime()) {
      setError("退勤時刻は出勤時刻より後にしてください");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    const correctionPayload = {
      store_name: storeName.trim() || profile?.store_name || editableRecord?.store_name || null,
      clock_in: clockInIso,
      clock_out: clockOutIso,
      memo: memo.trim() || editableRecord?.memo || null,
    };

    const { error: correctionError } = editableRecord
      ? await supabase
          .from("attendance_records")
          .update(correctionPayload)
          .eq("id", editableRecord.id)
          .eq("user_id", session.user.id)
      : await supabase.from("attendance_records").insert({
          ...correctionPayload,
          user_id: session.user.id,
          work_date: todayKey(),
        });

    if (correctionError) {
      console.error("Manual attendance correction failed", correctionError);
      setError(correctionError.message);
    } else {
      setIsEditingAttendance(false);
      setMessage("打刻を修正しました");
      await loadDashboard();
    }

    setSaving(false);
  }

  const openRecord = getOpenRecord(todayRecords);
  const editableRecord = getEditableRecord(todayRecords);
  const firstTodayRecord = todayRecords[0] ?? null;
  const latestClockOutRecord = getLatestClockOutRecord(todayRecords);
  const status = getRecordsStatus(todayRecords);
  const todayMinutes = recordsMinutes(todayRecords, now);
  const monthMinutes = useMemo(
    () => monthRecords.reduce((sum, record) => sum + recordMinutes(record, now), 0),
    [monthRecords, now],
  );
  const visibleAdminRows = adminRows.filter((row) => filter === "all" || row.status === filter);
  const storeOptions = Array.from(
    new Set([profile?.store_name, editableRecord?.store_name, storeName].filter(Boolean) as string[]),
  );

  if (loading) {
    return (
      <main className="app-shell">
        <div className="loading">読み込み中</div>
      </main>
    );
  }

  if (!session) {
    const isSignup = authMode === "signup";

    return (
      <main className="app-shell">
        <div className="container">
          <form className="panel login-panel stack" onSubmit={isSignup ? handleSignup : handleLogin}>
            <div>
              <h1 className="brand">Tencho Clock</h1>
              <p className="subtle">{isSignup ? "店長アカウントを作成" : "メールアドレスでログイン"}</p>
            </div>
            {error ? <div className="error">{error}</div> : null}
            {message ? <div className="subtle">{message}</div> : null}
            <div className="field">
              <label htmlFor="email">メールアドレス</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            {isSignup ? (
              <>
                <div className="field">
                  <label htmlFor="signup-name">名前</label>
                  <input
                    id="signup-name"
                    className="input"
                    type="text"
                    autoComplete="name"
                    value={signupName}
                    onChange={(event) => setSignupName(event.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="signup-store">店舗名</label>
                  <input
                    id="signup-store"
                    className="input"
                    type="text"
                    value={signupStoreName}
                    onChange={(event) => setSignupStoreName(event.target.value)}
                    required
                  />
                </div>
              </>
            ) : null}
            <div className="field">
              <label htmlFor="password">パスワード</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <button className="button" type="submit" disabled={saving}>
              {saving ? "処理中" : isSignup ? "アカウント作成" : "ログイン"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={saving}
              onClick={() => {
                setAuthMode(isSignup ? "login" : "signup");
                setError("");
                setMessage("");
              }}
            >
              {isSignup ? "ログインへ戻る" : "アカウント作成"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="container stack">
        <header className="topbar">
          <div>
            <h1 className="brand">Tencho Clock</h1>
            <div className="subtle">{profile?.name ?? profile?.email ?? "店長"}</div>
          </div>
          <button className="button secondary" type="button" onClick={handleLogout} disabled={saving}>
            ログアウト
          </button>
        </header>

        {profile?.role === "admin" ? (
          <div className="tabs">
            <button
              className={`tab ${view === "admin" ? "active" : ""}`}
              type="button"
              onClick={() => {
                setView("admin");
                void loadAdminRows();
              }}
            >
              管理者
            </button>
            <button
              className={`tab ${view === "manager" ? "active" : ""}`}
              type="button"
              onClick={() => setView("manager")}
            >
              自分の打刻
            </button>
          </div>
        ) : null}

        {error ? <div className="error">{error}</div> : null}

        {view === "admin" && profile?.role === "admin" ? (
          <section className="panel stack">
            <div className="hero-status">
              <div>
                <span className="subtle">全店長の現在状況</span>
                <h2>{visibleAdminRows.length}人</h2>
              </div>
              <button
                className="button secondary"
                type="button"
                onClick={() => void loadAdminRows()}
                disabled={saving}
              >
                更新
              </button>
            </div>
            <div className="filter-row">
              <button
                className={`filter ${filter === "working" ? "active" : ""}`}
                onClick={() => setFilter("working")}
                type="button"
              >
                出勤中
              </button>
              <button
                className={`filter ${filter === "not-started" ? "active" : ""}`}
                onClick={() => setFilter("not-started")}
                type="button"
              >
                未出勤
              </button>
              <button
                className={`filter ${filter === "done" ? "active" : ""}`}
                onClick={() => setFilter("done")}
                type="button"
              >
                退勤済み
              </button>
            </div>
            <button className="filter" type="button" onClick={() => setFilter("all")}>
              全員表示
            </button>
            <div className="manager-list">
              {visibleAdminRows.map((row) => (
                <article className="manager-row" key={row.profile.id}>
                  <div className="row-head">
                    <div>
                      <div className="row-title">{row.profile.name ?? row.profile.email ?? "未設定"}</div>
                      <div className="subtle">{row.record?.store_name ?? row.profile.store_name ?? "-"}</div>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="row-details">
                    <span>出勤 {formatTime(row.records[0]?.clock_in)}</span>
                    <span>退勤 {formatTime(getLatestClockOutRecord(row.records)?.clock_out)}</span>
                    <span>勤務 {formatDuration(row.todayMinutes)}</span>
                    <span>メモ {row.record?.memo || "-"}</span>
                  </div>
                </article>
              ))}
              {visibleAdminRows.length === 0 ? <div className="subtle">該当する店長はいません</div> : null}
            </div>
          </section>
        ) : (
          <section className="panel stack">
            <div className="hero-status">
              <div>
                <StatusBadge status={status} />
                <h2>{statusLabel(status)}</h2>
              </div>
              <div className="subtle">{todayKey()}</div>
            </div>

            <div className="grid">
              <Metric label="今日の出勤" value={formatTime(firstTodayRecord?.clock_in)} />
              <Metric label="今日の退勤" value={formatTime(latestClockOutRecord?.clock_out)} />
              <Metric label="今日の勤務時間" value={formatDuration(todayMinutes)} />
              <Metric label="今月の勤務時間" value={formatDuration(monthMinutes)} />
            </div>

            <div className="field">
              <label htmlFor="store">勤務店舗</label>
              <input
                id="store"
                className="input"
                list="store-options"
                value={storeName}
                onChange={(event) => setStoreName(event.target.value)}
                placeholder="店舗名"
              />
              <datalist id="store-options">
                {storeOptions.map((option) => (
                  <option value={option} key={option} />
                ))}
              </datalist>
            </div>

            <div className="field">
              <label htmlFor="memo">一言メモ</label>
              <textarea
                id="memo"
                className="textarea"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="共有したいこと"
              />
            </div>

            <div className="actions">
              <button
                className="button"
                type="button"
                onClick={handleClockIn}
                disabled={saving || status === "working"}
              >
                出勤
              </button>
              <button
                className="button danger"
                type="button"
                onClick={handleClockOut}
                disabled={saving || status !== "working"}
              >
                退勤
              </button>
            </div>
            <button className="button secondary" type="button" onClick={openAttendanceEdit} disabled={saving}>
              打刻を修正
            </button>
            {message ? <div className="subtle">{message}</div> : null}
            {isEditingAttendance ? (
              <form className="stack" onSubmit={handleManualCorrection}>
                <div className="field">
                  <label htmlFor="manual-clock-in">出勤時刻</label>
                  <input
                    id="manual-clock-in"
                    className="input"
                    type="datetime-local"
                    value={manualClockIn}
                    onChange={(event) => setManualClockIn(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="manual-clock-out">退勤時刻</label>
                  <input
                    id="manual-clock-out"
                    className="input"
                    type="datetime-local"
                    value={manualClockOut}
                    onChange={(event) => setManualClockOut(event.target.value)}
                  />
                </div>
                <div className="actions">
                  <button className="button" type="submit" disabled={saving}>
                    {saving ? "保存中" : "保存"}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setIsEditingAttendance(false)}
                    disabled={saving}
                  >
                    キャンセル
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
  return <span className={`status ${status}`}>{statusLabel(status)}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <dl className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </dl>
  );
}

function toDateTimeInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function dateTimeInputToIso(value: string) {
  return new Date(value).toISOString();
}

function getOpenRecord(records: AttendanceRecord[]) {
  return records.find((record) => record.clock_in && !record.clock_out) ?? null;
}

function getEditableRecord(records: AttendanceRecord[]) {
  return getOpenRecord(records) ?? [...records].reverse()[0] ?? null;
}

function getLatestClockOutRecord(records: AttendanceRecord[]) {
  return [...records].reverse().find((record) => record.clock_out) ?? null;
}
