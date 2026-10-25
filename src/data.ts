export type Subject = {
  subjectName: string;
  present: number;
  numberOfClasses: number;
  percentage: number;
};
export type Slot = {
  subjectName?: string;
  subjectCode?: string;
  facultyName?: string;
  isSuspended?: boolean;
  subject?: {
    id?: string | number;
    name?: string;
    subjectName?: string;
    subjectCode?: string;
  };
  fromTime?: string;
  toTime?: string;
  orderNumber?: number;
  [key: string]: unknown;
};
export type Bundle = {
  timetable: Slot[];
  attendance: Slot[];
  hasRecord: boolean;
};
export type Student = {
  fullName?: string;
  email?: string;
  rollNo?: string;
  branchCode?: string;
  semNo?: string | number;
};
export type Dashboard = {
  primary?: {
    student?: Student;
    classroom?: { name?: string };
    attendancePercentage?: number;
    primaryAttendance?: {
      present?: number;
      absent?: number;
      totalSessionsIncludingActivity?: number;
    };
  };
  subjectWise?: { overallAttendance?: number; subjects?: Subject[] };
  monthlyCalendar?: Record<string, string>;
  dailyBundle?: Record<string, Bundle>;
  dynamicContext?: {
    classroomId: string;
    semNo: string;
    currentMonth: number;
    currentYear: number;
  };
};
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const monthKey = (d: Date) => dayKey(d).slice(0, 7);
export const emptyBundle: Bundle = {
  timetable: [],
  attendance: [],
  hasRecord: false,
};
export function readTheme() {
  try {
    return (
      localStorage.getItem("vl-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    );
  } catch {
    return "dark";
  }
}
