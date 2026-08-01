export type BackupSchedule = {
  enabled: boolean;
  frequency: 'HOURLY' | 'EVERY_6_HOURS' | 'DAILY';
  minute: number;
  dailyHour: number;
};

function zonedParts(date: Date, timeZone = process.env.BACKUP_TIME_ZONE || 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

export function scheduleWindowKey(schedule: BackupSchedule, date = new Date()) {
  const part = zonedParts(date);
  if (schedule.frequency === 'HOURLY') return `${part.year}-${part.month}-${part.day}-${part.hour}`;
  if (schedule.frequency === 'EVERY_6_HOURS') return `${part.year}-${part.month}-${part.day}-${Math.floor(part.hour / 6)}`;
  return `${part.year}-${part.month}-${part.day}`;
}

export function isBackupDue(schedule: BackupSchedule, lastScheduledAt: Date | null, now = new Date()) {
  if (!schedule.enabled) return false;
  const part = zonedParts(now);
  if (part.minute !== schedule.minute) return false;
  if (schedule.frequency === 'EVERY_6_HOURS' && part.hour % 6 !== 0) return false;
  if (schedule.frequency === 'DAILY' && part.hour !== schedule.dailyHour) return false;
  return !lastScheduledAt || scheduleWindowKey(schedule, lastScheduledAt) !== scheduleWindowKey(schedule, now);
}

export function safeEnvironmentName(value = process.env.APP_ENV || 'unknown') {
  const normalized = String(value).trim().toLowerCase();
  return ['local', 'development', 'dev', 'test', 'staging', 'production'].includes(normalized)
    ? normalized
    : 'unknown';
}
