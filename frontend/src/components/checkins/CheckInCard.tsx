import React from 'react';
import { Calendar, Edit, Loader2, Play, Trash2 } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { parseCronToSchedule, formatScheduleLabel } from '@/lib/schedule';

interface CheckInCardProps {
  checkIn: any;
  isRunning: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export const CheckInCard: React.FC<CheckInCardProps> = ({
  checkIn,
  isRunning,
  onRun,
  onEdit,
  onDelete,
}) => {
  const sched = parseCronToSchedule(checkIn.collectionCron || '0 9 * * 1-5');
  const participantCount = checkIn.participants?.length ?? 0;
  const questionCount = checkIn.questions?.length ?? 0;

  return (
    <Card className="flex h-full flex-col border-border/60 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{checkIn.name}</CardTitle>
      </CardHeader>

      <CardContent className="flex-1 space-y-2 pb-2 text-sm text-muted-foreground">
        <p>
          <span className="text-foreground">Participants:</span> {participantCount}
        </p>
        <p>
          <span className="text-foreground">Questions:</span> {questionCount}
        </p>
        <p className="inline-flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5" />
          <span className="text-foreground">Schedule:</span> {formatScheduleLabel(sched)}
        </p>
      </CardContent>

      <CardFooter className="mt-auto flex gap-2 border-t border-border/60 pt-3">
        <Button size="sm" disabled={isRunning} onClick={onRun} className="flex-1">
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run Now
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Edit className="h-4 w-4" />
          Edit
        </Button>
        <Button size="sm" variant="outline" onClick={onDelete} className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
};

export default CheckInCard;
