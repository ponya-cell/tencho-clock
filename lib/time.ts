import type { AttendanceRecord, AttendanceStatus } from "./types";

export function todayKey() {
  return localDateKey(new Date());
}

export function monthStartKey() {
  const now = new Date();
  return localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
}

export function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getStatus(record: AttendanceRecord | null): AttendanceStatus {
  if (!record?.clock_in) return "not-started";
  if (!record.clock_out) return "working";
  return "done";
}

export function getRecordsStatus(records: AttendanceRecord[]): AttendanceStatus {
  if (records.length === 0) return "not-started";
  if (records.some((record) => record.clock_in && !record.clock_out)) return "working";
  return "done";
}

export function statusLabel(status: AttendanceStatus) {
  if (status === "working") return "出勤中";
  if (status === "done") return "退勤済み";
  return "未出勤";
}

export function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function minutesBetween(start: string | null, end: string | null, fallbackEnd = new Date()) {
  if (!start) return 0;
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : fallbackEnd.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return Math.floor((endMs - startMs) / 60000);
}

export function recordMinutes(record: AttendanceRecord | null, now = new Date()) {
  if (!record?.clock_in) return 0;
  return minutesBetween(record.clock_in, record.clock_out, now);
}

export function recordsMinutes(records: AttendanceRecord[], now = new Date()) {
  return records.reduce((sum, record) => sum + recordMinutes(record, now), 0);
}

export function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}時間${String(minutes).padStart(2, "0")}分`;
}
