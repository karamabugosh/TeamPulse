import React, { useState } from 'react';
import { AlertTriangle, Archive, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface DeleteCheckInDialogProps {
  open: boolean;
  checkInName: string;
  runCount: number;
  deleting?: boolean;
  archiving?: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (force: boolean) => void;
  onArchive: () => void;
}

export const DeleteCheckInDialog: React.FC<DeleteCheckInDialogProps> = ({
  open,
  checkInName,
  runCount,
  deleting = false,
  archiving = false,
  onOpenChange,
  onDelete,
  onArchive,
}) => {
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const busy = deleting || archiving;
  const hasHistory = runCount > 0;
  const canForceDelete = confirmName.trim() === checkInName.trim();

  const handleOpenChange = (next: boolean) => {
    if (!next && !busy) {
      setShowForceConfirm(false);
      setConfirmName('');
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <DialogTitle>
              {hasHistory ? 'Cannot delete CheckIn' : 'Delete CheckIn?'}
            </DialogTitle>
          </div>
          <DialogDescription asChild>
            <div className="space-y-3 pt-2 text-left text-sm text-muted-foreground">
              {hasHistory ? (
                <>
                  <p>
                    <span className="font-medium text-foreground">{checkInName}</span> has{' '}
                    <span className="font-medium text-foreground">
                      {runCount} historical run{runCount !== 1 ? 's' : ''}
                    </span>
                    . Deleting it would remove standup records, Slack thread references, and AI reports.
                  </p>
                  <p>
                    We recommend <strong className="text-foreground">archiving</strong> instead — the
                    CheckIn stops running but history stays intact.
                  </p>
                  {showForceConfirm && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                      <p className="text-foreground font-medium text-sm">
                        Permanently delete everything
                      </p>
                      <p className="text-xs">
                        This removes the CheckIn, all {runCount} run{runCount !== 1 ? 's' : ''}, submissions,
                        and reports. This cannot be undone.
                      </p>
                      <Input
                        placeholder={`Type "${checkInName}" to confirm`}
                        value={confirmName}
                        onChange={(e) => setConfirmName(e.target.value)}
                        disabled={busy}
                        className="h-9"
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p>
                    Permanently delete{' '}
                    <span className="font-medium text-foreground">{checkInName}</span>?
                  </p>
                  <p>This removes questions, participants, schedule settings, and intro/outro messages.</p>
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          {hasHistory ? (
            <>
              <Button
                type="button"
                onClick={onArchive}
                disabled={busy}
                className="w-full"
              >
                {archiving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Archiving...
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4" />
                    Archive CheckIn (recommended)
                  </>
                )}
              </Button>
              {!showForceConfirm ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForceConfirm(true)}
                  disabled={busy}
                  className="w-full text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete everything permanently
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => onDelete(true)}
                  disabled={busy || !canForceDelete}
                  className="w-full"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deleting all data...
                    </>
                  ) : (
                    'Confirm permanent deletion'
                  )}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
                className="w-full"
              >
                Cancel
              </Button>
            </>
          ) : (
            <div className="flex w-full gap-2 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => onDelete(false)}
                disabled={busy}
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete CheckIn'
                )}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteCheckInDialog;
