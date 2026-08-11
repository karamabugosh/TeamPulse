const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type ScheduleConfig = {
  days: number[];
  hour: number;
  minute: number;
};

export type Time12h = {
  hour12: number;
  minute: number;
  period: 'AM' | 'PM';
};

export function to12h(hour24: number, minute: number): Time12h {
  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return { hour12, minute, period };
}

export function to24h(hour12: number, minute: number, period: 'AM' | 'PM'): { hour: number; minute: number } {
  let hour = hour12 % 12;
  if (period === 'PM') hour += 12;
  return { hour, minute };
}

export function formatTime12h(hour24: number, minute: number): string {
  const t = to12h(hour24, minute);
  return `${t.hour12}:${String(t.minute).padStart(2, '0')} ${t.period}`;
}

export function parseCronToSchedule(cron: string): ScheduleConfig {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return { days: [1, 2, 3, 4, 5], hour: 9, minute: 0 };
  }

  const [minuteStr, hourStr, , , dayOfWeek] = parts;
  const minute = parseInt(minuteStr, 10) || 0;
  const hour = parseInt(hourStr, 10) || 9;

  let days: number[] = [];
  if (dayOfWeek === '*') {
    days = [0, 1, 2, 3, 4, 5, 6];
  } else if (dayOfWeek.includes('-')) {
    const [start, end] = dayOfWeek.split('-').map(Number);
    for (let d = start; d <= end; d++) days.push(d);
  } else if (dayOfWeek.includes(',')) {
    days = dayOfWeek.split(',').map(Number);
  } else {
    days = [parseInt(dayOfWeek, 10)];
  }

  return { days, hour, minute };
}

export function scheduleToCron(config: ScheduleConfig): string {
  const sortedDays = [...config.days].sort((a, b) => a - b);
  let dayPart = '*';

  if (sortedDays.length === 7) {
    dayPart = '*';
  } else if (sortedDays.length === 5 && sortedDays.join(',') === '1,2,3,4,5') {
    dayPart = '1-5';
  } else if (sortedDays.length === 1) {
    dayPart = String(sortedDays[0]);
  } else {
    dayPart = sortedDays.join(',');
  }

  return `${config.minute} ${config.hour} * * ${dayPart}`;
}

export function formatScheduleLabel(config: ScheduleConfig): string {
  const dayNames = config.days.map((d) => DAY_LABELS[d]).join(', ');
  return `${dayNames} at ${formatTime12h(config.hour, config.minute)}`;
}

/** Estimates the next scheduled occurrence from a cron + IANA timezone. */
export function getNextScheduledRun(
  cron: string,
  timezone: string,
  from: Date = new Date(),
): Date | null {
  const sched = parseCronToSchedule(cron);

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + offset);

    let weekday: number;
    try {
      const weekdayStr = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
      }).format(candidate);
      weekday = DAY_LABELS.indexOf(weekdayStr);
    } catch {
      weekday = candidate.getDay();
    }

    if (!sched.days.includes(weekday)) continue;

    try {
      const dateParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(candidate);

      const y = dateParts.find((p) => p.type === 'year')?.value;
      const m = dateParts.find((p) => p.type === 'month')?.value;
      const d = dateParts.find((p) => p.type === 'day')?.value;
      if (!y || !m || !d) continue;

      const localIso = `${y}-${m}-${d}T${String(sched.hour).padStart(2, '0')}:${String(sched.minute).padStart(2, '0')}:00`;
      const utcGuess = new Date(localIso + 'Z');

      const tzHour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          hour12: false,
        }).format(utcGuess),
        10,
      );

      const adjusted = new Date(utcGuess);
      adjusted.setUTCHours(adjusted.getUTCHours() + (sched.hour - tzHour));

      if (adjusted > from) return adjusted;
    } catch {
      continue;
    }
  }

  return null;
}

export function formatNextRun(cron: string, timezone: string): string {
  const next = getNextScheduledRun(cron, timezone);
  if (!next) return 'Not scheduled';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    }).format(next);
  } catch {
    return next.toLocaleString();
  }
}

export { DAY_LABELS };

export const TIMEZONE_OPTIONS = [
  { value: 'Asia/Hebron', label: 'Asia/Hebron (Ramallah)' },
  { value: 'Asia/Riyadh', label: 'Asia/Riyadh (UTC+3)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (UTC+4)' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
  { value: 'America/New_York', label: 'America/New_York (EST)' },
  { value: 'UTC', label: 'UTC' },
];
