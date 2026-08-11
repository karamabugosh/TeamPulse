import React, { useEffect, useState } from 'react';
import { Users, Plus, Trash2, UserPlus, Search, Shield, X } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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

export const TeamsPage: React.FC = () => {
  const [teams, setTeams] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [manageTeam, setManageTeam] = useState<any | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [name, setName] = useState('');
  const [slackChannelId, setSlackChannelId] = useState('');
  const [timezone, setTimezone] = useState('Asia/Riyadh');

  const loadTeams = () => {
    fetch('/api/admin/teams')
      .then((res) => res.json())
      .then((data) => setTeams(Array.isArray(data) ? data : []))
      .catch(console.error);
  };

  const loadUsers = (search?: string) => {
    fetch(`/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`)
      .then((res) => res.json())
      .then((data) => setAllUsers(Array.isArray(data) ? data : []))
      .catch(console.error);
  };

  useEffect(() => {
    loadTeams();
    loadUsers();
  }, []);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch('/api/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slackChannelId, timezone }),
    });
    setIsCreateOpen(false);
    setName('');
    loadTeams();
  };

  const handleDeleteTeam = async (id: string) => {
    if (!window.confirm('Delete this team?')) return;
    await fetch(`/api/admin/teams/${id}`, { method: 'DELETE' });
    loadTeams();
  };

  const handleAddMember = async (userId: string, role = 'member') => {
    if (!manageTeam) return;
    await fetch(`/api/admin/teams/${manageTeam.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    });
    loadTeams();
    const updated = teams.find((t) => t.id === manageTeam.id);
    if (updated) setManageTeam(updated);
    fetch(`/api/admin/teams`).then((r) => r.json()).then((data) => {
      const team = data.find((t: any) => t.id === manageTeam.id);
      if (team) setManageTeam(team);
    });
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!manageTeam) return;
    await fetch(`/api/admin/teams/${manageTeam.id}/members/${memberId}`, { method: 'DELETE' });
    fetch(`/api/admin/teams`).then((r) => r.json()).then((data) => {
      setTeams(data);
      const team = data.find((t: any) => t.id === manageTeam.id);
      if (team) setManageTeam(team);
    });
  };

  const handleUpdateRole = async (memberId: string, role: string) => {
    if (!manageTeam) return;
    await fetch(`/api/admin/teams/${manageTeam.id}/members/${memberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    fetch(`/api/admin/teams`).then((r) => r.json()).then((data) => {
      setTeams(data);
      const team = data.find((t: any) => t.id === manageTeam.id);
      if (team) setManageTeam(team);
    });
  };

  const availableUsers = allUsers.filter(
    (u) => !manageTeam?.teamMembers?.some((m: any) => m.userId === u.id)
  );

  return (
    <div className="space-y-8">
      <PageHeader title="Teams" description="Create teams, assign team leads, and manage member participation.">
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
                    <Badge variant="success" className="mt-1">Active</Badge>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleDeleteTeam(team.id)} className="hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm space-y-2">
                <p className="text-muted-foreground">Channel: <code className="font-mono text-xs">{team.slackChannelId || 'None'}</code></p>
                <p className="text-muted-foreground">Timezone: {team.timezone || 'Asia/Riyadh'}</p>
                <p className="text-emerald-400 font-medium">{team.teamMembers?.length || 0} members</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {team.teamMembers?.slice(0, 5).map((m: any) => (
                  <Badge key={m.id} variant={m.role === 'lead' ? 'default' : 'secondary'} className="gap-1">
                    {m.role === 'lead' && <Shield className="h-3 w-3" />}
                    {m.user?.slackDisplayName || m.user?.slackUserId}
                  </Badge>
                ))}
                {(team.teamMembers?.length || 0) > 5 && (
                  <Badge variant="outline">+{team.teamMembers.length - 5} more</Badge>
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

      {/* Create Team Dialog */}
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

      {/* Manage Members Dialog */}
      <Dialog open={!!manageTeam} onOpenChange={() => setManageTeam(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Members — {manageTeam?.name}</DialogTitle>
            <DialogDescription>Add, remove, and assign team leads.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="max-h-48 overflow-y-auto space-y-2">
              {manageTeam?.teamMembers?.map((m: any) => (
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
