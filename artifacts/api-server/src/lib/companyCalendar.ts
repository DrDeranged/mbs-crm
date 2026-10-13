export const COMPANY_TIME_ZONE = "America/New_York";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: COMPANY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function parts(now: Date) {
  const values = formatter.formatToParts(now);
  const get = (type: string) => Number(values.find(part => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function companyDate(now = new Date()): string {
  const p = parts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Calendar arithmetic, not elapsed 24-hour arithmetic across DST. */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function companyMidnight(date: string): Date {
  const target = new Date(`${date}T00:00:00.000Z`).getTime();
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = parts(new Date(instant));
    const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    instant += target - local;
  }
  return new Date(instant);
}

export function companyDayWindow(now = new Date()) {
  const date = companyDate(now);
  return { date, start: companyMidnight(date), end: companyMidnight(addCalendarDays(date, 1)) };
}

export function taskDateState(dueDate: string | null, isCompleted: boolean, now = new Date()) {
  const today = companyDate(now);
  return {
    dueToday: !isCompleted && dueDate === today,
    overdue: !isCompleted && dueDate !== null && dueDate < today,
  };
}
