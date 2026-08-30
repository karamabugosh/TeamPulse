import React from 'react';
import { History, MessageSquarePlus, Search, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type AiConversationListItem = {
  id: string;
  title: string;
  preview: string | null;
  updatedAt: string;
  messageCount: number;
};

type Props = {
  conversations: AiConversationListItem[];
  activeId: string | null;
  loading?: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export const AiConversationHistory: React.FC<Props> = ({
  conversations,
  activeId,
  loading,
  searchQuery,
  onSearchChange,
  onSelect,
  onNewChat,
  onDelete,
}) => {
  return (
    <aside className="flex h-full min-h-[280px] w-full flex-col rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 sm:min-h-[420px]">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <History className="h-4 w-4 text-muted-foreground" />
          History
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 border-white/10 bg-transparent"
          onClick={onNewChat}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search conversations…"
          className="h-9 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-violet-500/40"
          aria-label="Search conversations"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {loading ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Loading conversations…
          </p>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {searchQuery.trim()
              ? 'No conversations match that search.'
              : 'No previous conversations in this workspace.'}
          </p>
        ) : (
          conversations.map((item) => (
            <div
              key={item.id}
              className={cn(
                'group relative rounded-xl border border-transparent px-2.5 py-2 transition-colors',
                activeId === item.id
                  ? 'border-violet-500/30 bg-violet-500/10'
                  : 'hover:bg-white/[0.04]',
              )}
            >
              <button
                type="button"
                className="w-full pr-7 text-left"
                onClick={() => onSelect(item.id)}
              >
                <p className="line-clamp-2 text-sm font-medium text-foreground">
                  {item.title}
                </p>
                {item.preview ? (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/80">
                    {item.preview}
                  </p>
                ) : null}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatWhen(item.updatedAt)} · {item.messageCount} messages
                </p>
              </button>
              <button
                type="button"
                title="Delete conversation"
                className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-white/10 hover:text-destructive group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};

export default AiConversationHistory;
