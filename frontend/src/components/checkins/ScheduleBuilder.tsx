import React from 'react';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  DAY_LABELS,
  ScheduleConfig,
  formatScheduleLabel,
  formatTime12h,
  to12h,
  to24h,
} from '@/lib/schedule';

interface ScheduleBuilderProps {
  value: ScheduleConfig;
  onChange: (config: ScheduleConfig) => void;
  cronPreview: string;
  timezone?: string;
}

export const ScheduleBuilder: React.FC<ScheduleBuilderProps> = ({
  value,
  onChange,
  cronPreview,
  timezone,
}) => {
  const time12 = to12h(value.hour, value.minute);

  const toggleDay = (day: number) => {
    const days = value.days.includes(day)
      ? value.days.filter((d) => d !== day)
      : [...value.days, day].sort((a, b) => a - b);
    onChange({ ...value, days });
  };

  const updateTime = (field: 'hour12' | 'minute' | 'period', val: number | 'AM' | 'PM') => {
    const next = { ...time12, [field]: val };
    const { hour, minute } = to24h(next.hour12, next.minute, next.period);
    onChange({ ...value, hour, minute });
  };

  return (
    <div className="space-y-6">
      <div>
        <Label className="mb-3 block">Days of the week</Label>
        <div className="flex flex-wrap gap-2">
          {DAY_LABELS.map((label, dayIndex) => (
            <button
              key={dayIndex}
              type="button"
              onClick={() => toggleDay(dayIndex)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                value.days.includes(dayIndex)
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-secondary/50 text-muted-foreground hover:bg-secondary'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label className="mb-3 block">Scheduled time</Label>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={time12.hour12}
            onChange={(e) => updateTime('hour12', parseInt(e.target.value, 10))}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <span className="text-muted-foreground">:</span>
          <select
            value={time12.minute}
            onChange={(e) => updateTime('minute', parseInt(e.target.value, 10))}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
          >
            {Array.from({ length: 60 }, (_, i) => i).map((m) => (
              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
            ))}
          </select>
          <select
            value={time12.period}
            onChange={(e) => updateTime('period', e.target.value as 'AM' | 'PM')}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-secondary/30 p-4 space-y-2">
        <p className="text-sm text-muted-foreground">Schedule preview</p>
        <p className="font-medium">
          {formatScheduleLabel(value)}
          {timezone && <span className="text-muted-foreground"> · {timezone}</span>}
        </p>
        <Badge variant="secondary" className="font-mono text-xs">
          cron: {cronPreview}
        </Badge>
      </div>
    </div>
  );
};

export default ScheduleBuilder;
