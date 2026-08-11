import React, { useEffect, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface TeamMember {
  id: string;
  role: string;
  user: {
    id: string;
    slackDisplayName: string;
    slackUserId: string;
  };
}

interface ParticipantPickerProps {
  teamId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export const ParticipantPicker: React.FC<ParticipantPickerProps> = ({
  teamId,
  selectedIds,
  onChange,
}) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    setLoading(true);
    fetch(`/api/admin/teams/${teamId}/members${search ? `?search=${encodeURIComponent(search)}` : ''}`)
      .then((res) => res.json())
      .then((data) => {
        setMembers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [teamId, search]);

  const toggleMember = (memberId: string) => {
    if (selectedIds.includes(memberId)) {
      onChange(selectedIds.filter((id) => id !== memberId));
    } else {
      onChange([...selectedIds, memberId]);
    }
  };

  const selectedMembers = members.filter((m) => selectedIds.includes(m.id));

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search team members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedMembers.map((m) => (
            <Badge key={m.id} variant="secondary" className="gap-1.5 py-1.5 pl-1.5 pr-2">
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-[10px]">
                  {m.user.slackDisplayName[0]}
                </AvatarFallback>
              </Avatar>
              {m.user.slackDisplayName}
              <button type="button" onClick={() => toggleMember(m.id)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading members...</p>
        ) : members.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No members found for this team.</p>
        ) : (
          members.map((member) => {
            const selected = selectedIds.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => toggleMember(member.id)}
                className={cn(
                  'flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-secondary/50',
                  selected && 'bg-primary/10'
                )}
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{member.user.slackDisplayName[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="text-sm font-medium">{member.user.slackDisplayName}</p>
                  <p className="text-xs text-muted-foreground">{member.role}</p>
                </div>
                {selected ? (
                  <Badge variant="default">Selected</Badge>
                ) : (
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            );
          })
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {selectedIds.length} participant{selectedIds.length !== 1 ? 's' : ''} selected
      </p>
    </div>
  );
};

export default ParticipantPicker;
