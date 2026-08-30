import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Loader2, Radio, History, ClipboardList } from 'lucide-react';
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
import { useWorkspace } from '@/lib/workspace-context';
import { EnrichedRun, normalizeRun } from '@/lib/run-status';

type DeleteTarget = {
  id: string;
  name: string;
};

export const CheckInsPage: React.FC = () => {
  const { toast } = useToast();
  const { workspaceId } = useWorkspace();
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

  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      // Load independently so a teams failure cannot blank the CheckIns list.
      const checkInsResult = await apiFetch<any[]>('/api/check-ins');
      setCheckIns(Array.isArray(checkInsResult) ? checkInsResult : []);

      try {
        const teamsResult = await apiFetch<any[]>('/api/admin/teams');
        setTeams(Array.isArray(teamsResult) ? teamsResult : []);
      } catch (teamsError) {
        console.error(teamsError);
        toast({
          title: 'Could not load teams',
          description:
            teamsError instanceof ApiError
              ? teamsError.message
              : 'Team list failed — create/edit may be unavailable until this is fixed.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to load CheckIns';
      toast({ title: 'Could not load data', description: message, variant: 'destructive' });
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!workspaceId) return;
    void loadData();
    void loadActiveRuns();
    const runsInterval = setInterval(loadActiveRuns, 10000);
    const dataInterval = setInterval(() => loadData({ silent: true }), 30000);
    return () => {
      clearInterval(runsInterval);
      clearInterval(dataInterval);
    };
  }, [loadData, loadActiveRuns, workspaceId]);

  const filteredCheckIns = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return checkIns;
    return checkIns.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.description && c.description.toLowerCase().includes(query)),
    );
  }, [checkIns, searchTerm]);

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

  const closeDeleteDialog = () => {
    if (!deleting) setDeleteTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/check-ins/${deleteTarget.id}`, { method: 'DELETE' });
      setCheckIns((current) => current.filter((c) => c.id !== deleteTarget.id));
      toast({
        title: 'CheckIn deleted',
        description: `"${deleteTarget.name}" and all related data were removed.`,
        variant: 'success',
      });
      setDeleteTarget(null);
      await loadActiveRuns();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to delete';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleCheckInSaved = (_saved?: any) => {
    // Always reload from PostgreSQL so the UI matches persisted data.
    void loadData({ silent: true });
    void loadActiveRuns();
  };

  const openDeleteDialog = (checkIn: any) => {
    setDeleteTarget({ id: checkIn.id, name: checkIn.name });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-10 accent-slack">
      <PageHeader
        title="CheckIns"
        description="Configure standup schedules, questions, and participants."
        accent="slack"
        badge={
          <span className="inline-flex items-center rounded-full border border-module-slack/25 bg-module-slack/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
            Slack standups
          </span>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/checkins/standup">
              <ClipboardList className="h-4 w-4" />
              Daily Standup Form
            </Link>
          </Button>
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
            <Radio className="h-4 w-4 text-module-slack" />
            <h2 className="text-sm font-medium text-foreground">Active Runs</h2>
            <span className="rounded-full border border-module-slack/25 bg-module-slack/12 px-2 py-0.5 text-xs font-medium text-emerald-300">
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
                isRunning={runningId === checkIn.id}
                onRun={() => handleStartRun(checkIn.id, checkIn.name)}
                onEdit={() => { setEditingCheckIn(checkIn); setIsModalOpen(true); }}
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
        deleting={deleting}
        onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}
        onConfirm={handleDelete}
      />
    </div>
  );
};

export default CheckInsPage;
