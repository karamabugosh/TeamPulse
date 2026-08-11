import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Loader2, Radio, History } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckInFormDialog } from '@/components/checkins/CheckInFormDialog';
import { DeleteCheckInDialog } from '@/components/checkins/DeleteCheckInDialog';
import { ActiveRunCard } from '@/components/checkins/ActiveRunCard';
import { CheckInCard } from '@/components/checkins/CheckInCard';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { EnrichedRun, normalizeRun } from '@/lib/run-status';

type DeleteTarget = {
  id: string;
  name: string;
  runCount: number;
};

type DeleteResult = {
  deleted: boolean;
  canDelete?: boolean;
  forceDeleted?: boolean;
  runCount?: number;
  message?: string;
};

export const CheckInsPage: React.FC = () => {
  const { toast } = useToast();
  const [checkIns, setCheckIns] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [activeRuns, setActiveRuns] = useState<EnrichedRun[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCheckIn, setEditingCheckIn] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [runsLoading, setRunsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const loadActiveRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await apiFetch<EnrichedRun[]>('/api/check-ins/runs/active');
      setActiveRuns(Array.isArray(data) ? data.map(normalizeRun) : []);
    } catch (error) {
      console.error(error);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [checkInsData, teamsData] = await Promise.all([
        apiFetch<any[]>('/api/check-ins'),
        apiFetch<any[]>('/api/admin/teams'),
      ]);
      setCheckIns(Array.isArray(checkInsData) ? checkInsData : []);
      setTeams(Array.isArray(teamsData) ? teamsData : []);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to load CheckIns';
      toast({ title: 'Could not load data', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
    loadActiveRuns();
  }, [loadData, loadActiveRuns]);

  const filteredCheckIns = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return checkIns;
    return checkIns.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.description && c.description.toLowerCase().includes(query)),
    );
  }, [checkIns, searchTerm]);

  const handleToggleEnabled = async (id: string, currentStatus: boolean) => {
    setTogglingId(id);
    const nextEnabled = !currentStatus;
    try {
      const updated = await apiFetch<any>(`/api/check-ins/${id}/enabled`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      setCheckIns((current) =>
        current.map((checkIn) =>
          checkIn.id === id ? { ...checkIn, ...updated, enabled: nextEnabled } : checkIn,
        ),
      );
      toast({
        title: nextEnabled ? 'CheckIn enabled' : 'CheckIn archived',
        description: nextEnabled
          ? 'Scheduled runs will resume.'
          : 'The CheckIn is disabled but history is preserved.',
        variant: 'success',
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to update status';
      toast({ title: 'Update failed', description: message, variant: 'destructive' });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDuplicate = async (id: string) => {
    setDuplicatingId(id);
    try {
      const created = await apiFetch<any>(`/api/check-ins/${id}/duplicate`, { method: 'POST' });
      setCheckIns((current) => [created, ...current]);
      toast({
        title: 'CheckIn duplicated',
        description: `"${created.name}" was created.`,
        variant: 'success',
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to duplicate';
      toast({ title: 'Duplicate failed', description: message, variant: 'destructive' });
    } finally {
      setDuplicatingId(null);
    }
  };

  const closeDeleteDialog = () => {
    if (!deleting && !archiving) {
      setDeleteTarget(null);
    }
  };

  const handleArchive = async () => {
    if (!deleteTarget) return;
    setArchiving(true);
    try {
      const updated = await apiFetch<any>(`/api/check-ins/${deleteTarget.id}/enabled`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      });
      setCheckIns((current) =>
        current.map((c) =>
          c.id === deleteTarget.id ? { ...c, ...updated, enabled: false } : c,
        ),
      );
      toast({
        title: 'CheckIn archived',
        description: `"${deleteTarget.name}" is disabled. Run history is preserved.`,
        variant: 'success',
      });
      setDeleteTarget(null);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to archive';
      toast({ title: 'Archive failed', description: message, variant: 'destructive' });
    } finally {
      setArchiving(false);
    }
  };

  const handleDelete = async (force: boolean) => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const url = force
        ? `/api/check-ins/${deleteTarget.id}?force=true`
        : `/api/check-ins/${deleteTarget.id}`;
      const result = await apiFetch<DeleteResult>(url, { method: 'DELETE' });

      if (result.deleted) {
        setCheckIns((current) => current.filter((c) => c.id !== deleteTarget.id));
        toast({
          title: result.forceDeleted ? 'CheckIn and history deleted' : 'CheckIn deleted',
          description: `"${deleteTarget.name}" was permanently removed.`,
          variant: 'success',
        });
        setDeleteTarget(null);
        await loadActiveRuns();
      } else if (result.canDelete === false) {
        toast({
          title: 'Cannot delete',
          description: result.message ?? 'This CheckIn has execution history.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to delete';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleStartRun = async (id: string, name: string) => {
    setRunningId(id);
    try {
      const result = await apiFetch<any>(`/api/check-ins/${id}/runs`, { method: 'POST' });
      await loadActiveRuns();
      const delivery = result.delivery;
      toast({
        title: 'Run started',
        description: delivery
          ? `"${name}" — ${delivery.delivered ?? 0} DM(s) sent.`
          : `"${name}" run created.`,
        variant: 'success',
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to start run';
      toast({ title: 'Run failed', description: message, variant: 'destructive' });
    } finally {
      setRunningId(null);
    }
  };

  const handleCheckInSaved = (saved?: any) => {
    if (saved?.id) {
      setCheckIns((current) => {
        const exists = current.some((c) => c.id === saved.id);
        return exists
          ? current.map((c) => (c.id === saved.id ? { ...c, ...saved } : c))
          : [{ ...saved, _count: saved._count ?? { runs: 0 } }, ...current];
      });
    } else {
      loadData();
    }
    loadActiveRuns();
  };

  const openDeleteDialog = (checkIn: any) => {
    setDeleteTarget({
      id: checkIn.id,
      name: checkIn.name,
      runCount: checkIn._count?.runs ?? 0,
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <PageHeader
        title="CheckIns"
        description="Configure standup schedules, questions, and participants."
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/checkins/history">
              <History className="h-4 w-4" />
              Run History
            </Link>
          </Button>
          <Button size="sm" onClick={() => { setEditingCheckIn(null); setIsModalOpen(true); }}>
            <Plus className="h-4 w-4" />
            New CheckIn
          </Button>
        </div>
      </PageHeader>

      {!runsLoading && activeRuns.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-medium text-foreground">Active Runs</h2>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              {activeRuns.length} collecting
            </span>
          </div>
          <div className="space-y-2">
            {activeRuns.map((run) => (
              <ActiveRunCard key={run.id} run={run} compact />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Configurations</h2>
            <p className="text-sm text-muted-foreground">
              Templates that define when and how standups run.
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search CheckIns..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading...
          </div>
        ) : filteredCheckIns.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-base font-medium">
                {searchTerm.trim() ? 'No matches' : 'No CheckIns yet'}
              </CardTitle>
              <CardDescription>
                {searchTerm.trim()
                  ? `Nothing matches "${searchTerm.trim()}".`
                  : 'Create a CheckIn to schedule recurring standups in Slack.'}
              </CardDescription>
            </CardHeader>
            {!searchTerm.trim() && (
              <CardContent className="flex justify-center pb-8">
                <Button onClick={() => { setEditingCheckIn(null); setIsModalOpen(true); }}>
                  <Plus className="h-4 w-4" />
                  New CheckIn
                </Button>
              </CardContent>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {filteredCheckIns.map((checkIn) => (
              <CheckInCard
                key={checkIn.id}
                checkIn={checkIn}
                isToggling={togglingId === checkIn.id}
                isDuplicating={duplicatingId === checkIn.id}
                isRunning={runningId === checkIn.id}
                onToggle={() => handleToggleEnabled(checkIn.id, checkIn.enabled)}
                onRun={() => handleStartRun(checkIn.id, checkIn.name)}
                onEdit={() => { setEditingCheckIn(checkIn); setIsModalOpen(true); }}
                onDuplicate={() => handleDuplicate(checkIn.id)}
                onDelete={() => openDeleteDialog(checkIn)}
              />
            ))}
          </div>
        )}
      </section>

      <CheckInFormDialog
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        editingCheckIn={editingCheckIn}
        teams={teams}
        onSaved={handleCheckInSaved}
      />

      <DeleteCheckInDialog
        open={!!deleteTarget}
        checkInName={deleteTarget?.name ?? ''}
        runCount={deleteTarget?.runCount ?? 0}
        deleting={deleting}
        archiving={archiving}
        onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}
        onDelete={handleDelete}
        onArchive={handleArchive}
      />
    </div>
  );
};

export default CheckInsPage;
