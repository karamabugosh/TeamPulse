import React, { useCallback, useEffect, useState } from 'react';
import { Users, Plus, Trash2, UserPlus, Search, X, Hash, Clock, CheckSquare, Radio } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
    user: { slackDisplayName?: string; slackUserId?: string; email?: string };
  }>;
};

export const TeamsPage: React.FC = () => {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [manageTeam, setManageTeam] = useState<TeamSummary | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [name, setName] = useState('');
  const [slackChannelId, setSlackChannelId] = useState('');
  const [timezone, setTimezone] = useState('Asia/Riyadh');

  const loadTeams = useCallback(async () => {
    try {
      const data = await apiFetch<TeamSummary[]>('/api/admin/teams');
      setTeams(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadUsers = useCallback(async (search?: string) => {
    try {
      const data = await apiFetch<any[]>(
        `/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      );
      setAllUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    loadTeams();
    loadUsers();
    const interval = setInterval(loadTeams, 15000);
    return () => clearInterval(interval);
  }, [loadTeams, loadUsers]);

  const refreshManageTeam = async (teamId: string) => {
    const data = await apiFetch<TeamSummary[]>('/api/admin/teams');
    setTeams(Array.isArray(data) ? data : []);
    const team = data.find((t) => t.id === teamId);
    if (team) setManageTeam(team);
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/teams', {
      method: 'POST',
      body: JSON.stringify({ name, slackChannelId, timezone }),
    });
    setIsCreateOpen(false);
    setName('');
    loadTeams();
  };

  const handleDeleteTeam = async (id: string) => {
    if (!window.confirm('Delete this team?')) return;
    await apiFetch(`/api/admin/teams/${id}`, { method: 'DELETE' });
    loadTeams();
  };

  const handleAddMember = async (userId: string, role = 'member') => {
    if (!manageTeam) return;
    await apiFetch(`/api/admin/teams/${manageTeam.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, role }),
    });
    await refreshManageTeam(manageTeam.id);
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!manageTeam) return;
    await apiFetch(`/api/admin/teams/${manageTeam.id}/members/${memberId}`, { method: 'DELETE' });
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

  const availableUsers = allUsers.filter(
    (u) => !manageTeam?.teamMembers?.some((m) => m.userId === u.id),
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
                <Button variant="ghost" size="icon" onClick={() => handleDeleteTeam(team.id)} className="hover:text-destructive">
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
                  <p className="text-sm font-medium truncate">{team.timezone || '—'}</p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Hash className="h-3.5 w-3.5" />
                  Slack: <code className="font-mono text-xs text-foreground">{team.slackChannelId || 'None'}</code>
                </p>
                <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {team.timezone || 'No timezone set'}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Members</p>
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
              <Button variant="outline" className="w-full" onClick={() => { setManageTeam(team); setMemberSearch(''); loadUsers(); }}>
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
              <Input value={slackChannelId} onChange={(e) => setSlackChannelId(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button type="submit">Create Team</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!manageTeam} onOpenChange={() => setManageTeam(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Members — {manageTeam?.name}</DialogTitle>
            <DialogDescription>Add, remove, and assign team leads.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="max-h-48 overflow-y-auto space-y-2">
              {manageTeam?.teamMembers?.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>{(m.user?.slackDisplayName || '?')[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{m.user?.slackDisplayName}</p>
                      <Badge variant={m.role === 'lead' ? 'default' : 'secondary'} className="text-[10px]">
                        {m.role === 'lead' ? 'Team Lead' : 'Member'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">Role</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => handleUpdateRole(m.id, 'lead')}>Team Lead</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUpdateRole(m.id, 'member')}>Member</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button variant="ghost" size="icon" onClick={() => handleRemoveMember(m.id)} className="hover:text-destructive">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search users to add..." value={memberSearch} onChange={(e) => { setMemberSearch(e.target.value); loadUsers(e.target.value); }} className="pl-9" />
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1">
              {availableUsers.slice(0, 10).map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => handleAddMember(user.id)}
                  className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-secondary/50"
                >
                  <UserPlus className="h-4 w-4 text-primary" />
                  <span className="text-sm">{user.slackDisplayName}</span>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TeamsPage;
