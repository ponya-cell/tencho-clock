export type Role = "admin" | "manager";

export type Profile = {
  id: string;
  email: string | null;
  name: string | null;
  role: Role;
  store_name: string | null;
  created_at: string;
};

export type AttendanceRecord = {
  id: string;
  user_id: string;
  work_date: string;
  store_name: string | null;
  clock_in: string | null;
  clock_out: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

export type AttendanceStatus = "not-started" | "working" | "done";

export type AdminAttendanceRow = {
  profile: Profile;
  record: AttendanceRecord | null;
  status: AttendanceStatus;
  todayMinutes: number;
};
