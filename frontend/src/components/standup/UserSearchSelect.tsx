import React, { useMemo, useState } from 'react';
import { ChevronsUpDown, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { MOCK_STANDUP_USERS, StandupUserOption } from './standup-form.types';

interface UserSearchSelectProps {
  value: StandupUserOption | null;
  onChange: (user: StandupUserOption | null) => void;
  placeholder?: string;
  users?: StandupUserOption[];
}

export const UserSearchSelect: React.FC<UserSearchSelectProps> = ({
  value,
  onChange,
  placeholder = 'Search teammate…',
  users = MOCK_STANDUP_USERS,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((user) => user.name.toLowerCase().includes(q));
  }, [users, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className={cn(
            'h-11 w-full justify-between rounded-xl border-border/70 bg-background px-3 font-normal',
            !value && 'text-muted-foreground',
          )}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {value ? (
              <>
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px]">{value.initials}</AvatarFallback>
                </Avatar>
                {value.name}
              </>
            ) : (
              placeholder
            )}
          </span>
          <span className="ml-2 flex items-center gap-1">
            {value ? (
              <span
                role="button"
                tabIndex={0}
                className="rounded-md p-1 hover:bg-secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onChange(null);
                  }
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a name…"
            className="h-9 pl-9"
          />
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No teammates found.</p>
          ) : (
            filtered.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  onChange(user);
                  setOpen(false);
                  setQuery('');
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-secondary"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-[10px]">{user.initials}</AvatarFallback>
                </Avatar>
                {user.name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default UserSearchSelect;
