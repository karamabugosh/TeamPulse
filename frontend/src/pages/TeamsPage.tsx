import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  Plus,
  Trash2,
  UserPlus,
  Search,
  X,
  Hash,
  Clock,
  CheckSquare,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { apiFetch } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';

type TeamSummary = {
  id: string;
  name: string;
  slackChannelId: string | null;
  timezone: string | null;
  teamLead: { id: string; userId: string; name: string } | null;
  memberCount: number;
  memberNames: string[];
  checkInCount: number;
  activeRunCount: number;
  teamMembers: Array<{
    id: string;
    userId: string;
    role: string;
    user: {
      slackDisplayName?: string;
      slackRealName?: string | null;
      slackUserId?: string;
      email?: string | null;
      slackAvatarUrl?: string | null;
    };
  }>;
};

type WorkspaceMember = {
  id: string;
  slackUserId: string;
  fullName: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  timezone: string | null;
  alreadyOnTeam: boolean;
  currentRole: string | null;
};

type WorkspaceMembersResponse = {
  members: WorkspaceMember[];
  source: 'slack_api' | 'database' | 'none';
  synced: boolean;
  total: number;
  slackWorkspaceName?: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export const TeamsPage: React.FC = () => {
  const { workspaceId } = useWorkspace();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [membersSource, setMembersSource] = useState<string>('database');
  const [membersLoading, setMembersLoading] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [manageTeam, setManageTeam] = useState<TeamSummary | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [name, setName] = useState('');
  const [slackChannelId, setSlackChannelId] = useState('');
  const [timezone, setTimezone] = useState('Asia/Riyadh');

  const loadTeams = useCallback(async () => {
    try {
      const data = await apiFetch<TeamSummary[]>('/api/admin/teams');
      setTeams(Array.isArray(data) ? data : []);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error(error);
      return [];
    }
  }, []);

  const loadWorkspaceMembers = useCallback(
    async (opts?: { teamId?: string; search?: string; sync?: boolean }) => {
      setMembersLoading(true);
      try {
        const params = new URLSearchParams();
        if (opts?.teamId) params.set('teamId', opts.teamId);
        if (opts?.search) params.set('search', opts.search);
        if (opts?.sync === false) params.set('sync', 'false');
        const query = params.toString();
        const data = await apiFetch<WorkspaceMembersResponse>(
          `/api/admin/workspace-members${query ? `?${query}` : ''}`,
        );
        setWorkspaceMembers(Array.isArray(data.members) ? data.members : []);
        setMembersSource(data.source ?? 'database');
      } catch (error) {
        console.error(error);
        setWorkspaceMembers([]);
      } finally {
        setMembersLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadTeams();
    const interval = setInterval(() => void loadTeams(), 15000);
    return () => clearInterval(interval);
  }, [loadTeams, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(memberSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [memberSearch]);

  useEffect(() => {
    if (!manageTeam) return;
    void loadWorkspaceMembers({
      teamId: manageTeam.id,
      search: debouncedSearch || undefined,
      sync: true,
    });
  }, [manageTeam?.id, debouncedSearch, loadWorkspaceMembers, workspaceId]);

  const refreshManageTeam = async (teamId: string) => {
    const data = await loadTeams();
    const team = data.find((t) => t.id === teamId);
    if (team) setManageTeam(team);
    await loadWorkspaceMembers({
      teamId,
      search: debouncedSearch || undefined,
      sync: false,
    });
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/teams', {
      method: 'POST',
      body: JSON.stringify({ name, slackChannelId, timezone }),
    });
    setIsCreateOpen(false);
    setName('');
    void loadTeams();
  };

  const handleDeleteTeam = async (id: string) => {
    if (!window.confirm('Delete this team?')) return;
    await apiFetch(`/api/admin/teams/${id}`, { method: 'DELETE' });
    void loadTeams();
  };

  const handleAddMember = async (userId: string, role = 'member') => {
    if (!manageTeam) return;
    setAddingUserId(userId);
    try {
      await apiFetch(`/api/admin/teams/${manageTeam.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId, role }),
      });
      await refreshManageTeam(manageTeam.id);
    } catch (error) {
      console.error(error);
    } finally {
      setAddingUserId(null);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!manageTeam) return;
    await apiFetch(`/api/admin/teams/${manageTeam.id}/members/${memberId}`, {
      method: 'DELETE',
    });
    await refreshManageTeam(manageTeam.id);
  };

  const handleUpdateRole = async (memberId: string, role: string) => {
    if (!manageTeam) return;
    await apiFetch(`/api/admin/teams/${manageTeam.id}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    await refreshManageTeam(manageTeam.id);
  };

  const availableMembers = useMemo(
    () => workspaceMembers.filter((member) => !member.alreadyOnTeam),
    [workspaceMembers],
  );

  return (
    <div className="space-y-8">
      <PageHeader title="Teams" description="Teams, members, and standup activity from your workspace.">
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create Team
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {teams.map((team) => (
          <Card key={team.id} className="card-lift flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{team.name}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Lead: {team.teamLead?.name ?? 'Not assigned'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteTeam(team.id)}
                  className="hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground">Members</p>
                  <p className="text-lg font-semibold">{team.memberCount}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground">CheckIns</p>
                  <p className="text-lg font-semibold">{team.checkInCount}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground">Active Runs</p>
                  <p className="text-lg font-semibold">{team.activeRunCount}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground">Timezone</p>
                  <p className="truncate text-sm font-medium">{team.timezone || '—'}</p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Hash className="h-3.5 w-3.5" />
                  Slack:{' '}
                  <code className="font-mono text-xs text-foreground">
                    {team.slackChannelId || 'None'}
                  </code>
                </p>
                <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {team.timezone || 'No timezone set'}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Members
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {team.memberNames.length === 0 ? (
                    <span className="text-sm text-muted-foreground">No members yet</span>
                  ) : (
                    team.memberNames.map((memberName, index) => (
                      <Badge key={`${team.id}-${memberName}-${index}`} variant="secondary">
                        {memberName}
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Badge variant="outline" className="gap-1">
                  <CheckSquare className="h-3 w-3" />
                  {team.checkInCount} CheckIn{team.checkInCount !== 1 ? 's' : ''}
                </Badge>
                {team.activeRunCount > 0 && (
                  <Badge variant="success" className="gap-1">
                    <Radio className="h-3 w-3" />
                    {team.activeRunCount} active
                  </Badge>
                )}
              </div>
            </CardContent>
            <CardFooter className="mt-auto border-t border-border pt-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setManageTeam(team);
                  setMemberSearch('');
                  setDebouncedSearch('');
                }}
              >
                Manage Members
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Team</DialogTitle>
            <DialogDescription>Add a new team to your workspace.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateTeam} className="space-y-4">
            <div className="space-y-2">
              <Label>Team Name *</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Slack Channel ID</Label>
              <Input
                value={slackChannelId}
                onChange={(e) => setSlackChannelId(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Create Team</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!manageTeam} onOpenChange={(open) => !open && setManageTeam(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Manage Members — {manageTeam?.name}</DialogTitle>
            <DialogDescription>
              Members from the connected Slack workspace. Source:{' '}
              {membersSource === 'slack_api' ? 'Slack API sync' : 'Pulse synced database'}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="max-h-52 space-y-2 overflow-y-auto">
              {manageTeam?.teamMembers?.length ? (
                manageTeam.teamMembers.map((m) => {
                  const label =
                    m.user?.slackRealName ||
                    m.user?.slackDisplayName ||
                    m.user?.slackUserId ||
                    'Unknown';
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-lg border border-border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          {m.user?.slackAvatarUrl ? (
                            <AvatarImage src={m.user.slackAvatarUrl} alt={label} />
                          ) : null}
                          <AvatarFallback>{initials(label)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{label}</p>
                          {m.user?.email ? (
                            <p className="text-xs text-muted-foreground">{m.user.email}</p>
                          ) : null}
                          <Badge
                            variant={m.role === 'lead' ? 'default' : 'secondary'}
                            className="mt-1 text-[10px]"
                          >
                            {m.role === 'lead' ? 'Team Lead' : 'Member'}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              Role
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => handleUpdateRole(m.id, 'lead')}>
                              Team Lead
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleUpdateRole(m.id, 'member')}>
                              Member
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveMember(m.id)}
                          className="hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No members on this team yet.
                </p>
              )}
            </div>

            <Separator />

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name, display name, or email…"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Refresh Slack members"
                disabled={membersLoading}
                onClick={() =>
                  manageTeam &&
                  void loadWorkspaceMembers({
                    teamId: manageTeam.id,
                    search: debouncedSearch || undefined,
                    sync: true,
                  })
                }
              >
                <RefreshCw className={`h-4 w-4 ${membersLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <div className="max-h-56 space-y-1 overflow-y-auto">
              {membersLoading && availableMembers.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Loading Slack members…
                </p>
              ) : availableMembers.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {debouncedSearch
                    ? 'No matching Slack members.'
                    : 'All workspace members are already on this team.'}
                </p>
              ) : (
                availableMembers.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    disabled={addingUserId === user.id}
                    onClick={() => handleAddMember(user.id)}
                    className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-secondary/50 disabled:opacity-60"
                  >
                    <Avatar className="h-9 w-9">
                      {user.avatarUrl ? (
                        <AvatarImage src={user.avatarUrl} alt={user.fullName} />
                      ) : null}
                      <AvatarFallback>{initials(user.fullName)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{user.fullName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[
                          user.displayName && user.displayName !== user.fullName
                            ? `@${user.displayName}`
                            : null,
                          user.email,
                        ]
                          .filter(Boolean)
                          .join(' · ') || user.slackUserId}
                      </p>
                    </div>
                    <UserPlus className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TeamsPage;
