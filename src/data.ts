import { campusDateKey } from "./schedule";
export type Subject = {
  subjectName: string;
  present: number;
  numberOfClasses: number;
  percentage: number;
};
export type Slot = {
  subjectName?: string;
  subject?: { id?: string | number; name?: string; subjectName?: string };
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
export type Dashboard = {
  primary?: {
    student?: {
      fullName?: string;
      rollNo?: string;
      branchCode?: string;
      semNo?: string;
    };
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
export function demoData(): Dashboard {
  const today = new Date(),
    dates: Record<string, Bundle> = {},
    statuses: Record<string, string> = {};
  const subjects: Subject[] = [
    {
      subjectName: "Machine Learning",
      present: 28,
      numberOfClasses: 32,
      percentage: 87.5,
    },
    {
      subjectName: "Cloud Computing",
      present: 25,
      numberOfClasses: 30,
      percentage: 83.3,
    },
    {
      subjectName: "Data Analytics",
      present: 22,
      numberOfClasses: 29,
      percentage: 75.9,
    },
    {
      subjectName: "Internet of Things",
      present: 26,
      numberOfClasses: 30,
      percentage: 86.7,
    },
    {
      subjectName: "Software Engineering",
      present: 25,
      numberOfClasses: 31,
      percentage: 80.6,
    },
  ];
  for (let n = 1; n <= today.getDate(); n++) {
    const d = new Date(today.getFullYear(), today.getMonth(), n);
    if (d.getDay() !== 0)
      statuses[dayKey(d)] = n % 7 === 0 ? "absent" : "present";
  }
  dates[campusDateKey(today)] = {
    hasRecord: true,
    timetable: [
      {
        subjectId: "ml",
        subjectName: "Machine Learning",
        fromTime: "09:00",
        toTime: "10:00",
      },
      {
        subjectId: "cloud",
        subjectName: "Cloud Computing",
        fromTime: "10:00",
        toTime: "11:00",
      },
      {
        subjectId: "data",
        subjectName: "Data Analytics",
        fromTime: "11:15",
        toTime: "12:15",
      },
      {
        subjectId: "iot",
        subjectName: "Internet of Things",
        fromTime: "13:00",
        toTime: "14:00",
      },
    ],
    attendance: [
      { subjectId: "ml", isAbsent: 0 },
      { subjectId: "cloud", isAbsent: 1 },
    ],
  };
  return {
    primary: {
      student: {
        fullName: "Alex Morgan",
        rollNo: "DEMO STUDENT",
        branchCode: "CSE",
        semNo: "7",
      },
      classroom: { name: "Section B" },
      primaryAttendance: {
        present: 126,
        absent: 26,
        totalSessionsIncludingActivity: 152,
      },
    },
    subjectWise: { overallAttendance: 82.9, subjects },
    monthlyCalendar: statuses,
    dailyBundle: dates,
    dynamicContext: {
      classroomId: "demo",
      semNo: "7",
      currentMonth: today.getMonth() + 1,
      currentYear: today.getFullYear(),
    },
  };
}
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
