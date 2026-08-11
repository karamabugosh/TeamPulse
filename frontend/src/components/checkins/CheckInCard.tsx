import React from 'react';
import {
  Calendar,
  Clock,
  Copy,
  Edit,
  Loader2,
  MoreHorizontal,
  Play,
  Trash2,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { parseCronToSchedule, formatScheduleLabel, formatNextRun } from '@/lib/schedule';

interface CheckInCardProps {
  checkIn: any;
  isToggling: boolean;
  isDuplicating: boolean;
  isRunning: boolean;
  onToggle: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export const CheckInCard: React.FC<CheckInCardProps> = ({
  checkIn,
  isToggling,
  isDuplicating,
  isRunning,
  onToggle,
  onRun,
  onEdit,
  onDuplicate,
  onDelete,
}) => {
  const sched = parseCronToSchedule(checkIn.collectionCron || '0 9 * * 1-5');
  const nextRun =
    checkIn.scheduleEnabled && checkIn.enabled
      ? formatNextRun(checkIn.collectionCron, checkIn.timezone)
      : null;
  const runCount = checkIn._count?.runs ?? 0;
  const participantCount = checkIn.participants?.length ?? 0;
  const questionCount = checkIn.questions?.length ?? 0;

  return (
    <Card className="flex h-full flex-col border-border/60 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="space-y-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="truncate text-base font-semibold">{checkIn.name}</CardTitle>
              {checkIn.publishStatus === 'draft' && (
                <Badge variant="warning" className="text-[10px]">
                  Draft
                </Badge>
              )}
              {!checkIn.enabled && (
                <Badge variant="secondary" className="text-[10px]">
                  Archived
                </Badge>
              )}
            </div>
            {checkIn.description && (
              <CardDescription className="line-clamp-2 text-sm">
                {checkIn.description}
              </CardDescription>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={!!checkIn.enabled}
              disabled={isToggling}
              onCheckedChange={onToggle}
              aria-label={checkIn.enabled ? 'Disable CheckIn' : 'Enable CheckIn'}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Edit className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate} disabled={isDuplicating}>
                  {isDuplicating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 pb-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            {formatScheduleLabel(sched)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {participantCount} participant{participantCount !== 1 ? 's' : ''}
          </span>
          <span>{questionCount} question{questionCount !== 1 ? 's' : ''}</span>
          {runCount > 0 && (
            <span>{runCount} past run{runCount !== 1 ? 's' : ''}</span>
          )}
        </div>

        {nextRun && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Next: {nextRun}
          </p>
        )}
      </CardContent>

      <CardFooter className="mt-auto border-t border-border/60 pt-3">
        <Button
          size="sm"
          disabled={isRunning}
          onClick={onRun}
          className="w-full"
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run Now
        </Button>
      </CardFooter>
    </Card>
  );
};

export default CheckInCard;
