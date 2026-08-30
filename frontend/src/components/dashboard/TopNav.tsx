import React from 'react';
import {
  Search,
  Bell,
  Clock,
  ChevronDown,
  Menu,
  Check,
  Building2,
  Settings,
  LogOut,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useWorkspace } from '@/lib/workspace-context';

interface TopNavProps {
  onMenuClick?: () => void;
}

const notifications = [
  { id: '1', title: 'Daily standup completed', time: '5m ago', unread: true },
  { id: '2', title: 'New blocker reported', time: '1h ago', unread: true },
  { id: '3', title: 'Weekly report generated', time: '3h ago', unread: false },
];

export const TopNav: React.FC<TopNavProps> = ({ onMenuClick }) => {
  const { workspaces, activeWorkspace, setActiveWorkspaceId, loading } = useWorkspace();

  return (
    <TooltipProvider>
      <header className="glass-panel flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] px-4 lg:h-16 lg:px-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
            <Menu className="h-5 w-5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="gap-2 border-white/[0.08] bg-white/[0.03] backdrop-blur-md"
                disabled={loading || workspaces.length === 0}
              >
                <Building2 className="h-4 w-4 text-primary" />
                <span className="hidden max-w-[180px] truncate sm:inline">
                  {activeWorkspace?.name ?? (loading ? 'Loading…' : 'Select workspace')}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-72 border-white/[0.08] bg-popover/95 backdrop-blur-xl"
            >
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {workspaces.map((ws) => (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => {
                    setActiveWorkspaceId(ws.id);
                    // Reload so pages refetch scoped data for the new tenant
                    window.location.reload();
                  }}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{ws.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {ws.plan} · {ws.userCount} members · {ws.teamCount} teams
                    </span>
                  </div>
                  {activeWorkspace?.id === ws.id ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
          <div className="relative hidden md:block md:w-72 lg:w-[22rem]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search check-ins, reports, teams..."
              className="h-10 rounded-xl border-white/[0.08] bg-white/[0.03] pl-9"
            />
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="hidden cursor-default gap-1.5 border-white/[0.08] bg-white/[0.03] px-3 py-1.5 lg:flex"
              >
                <Clock className="h-3.5 w-3.5 text-cyan-brand" />
                Asia/Riyadh (UTC+3)
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Workspace timezone</TooltipContent>
          </Tooltip>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative text-muted-foreground hover:text-foreground"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary shadow-glow-sm" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80 border-white/[0.08] bg-popover/95 p-0 backdrop-blur-xl"
            >
              <div className="border-b border-white/[0.06] px-4 py-3">
                <h4 className="font-semibold">Notifications</h4>
                <p className="text-xs text-muted-foreground">You have 2 unread notifications</p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="flex cursor-pointer items-start gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors last:border-0 hover:bg-white/[0.03]"
                  >
                    {n.unread ? (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    ) : (
                      <span className="mt-1.5 h-2 w-2 shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="text-xs text-muted-foreground">{n.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="gap-2 rounded-xl border border-transparent pl-2 pr-3 hover:border-white/[0.08] hover:bg-white/[0.03]"
              >
                <Avatar className="h-8 w-8 ring-2 ring-primary/25">
                  <AvatarFallback className="bg-primary/15 text-primary">K</AvatarFallback>
                </Avatar>
                <div className="hidden flex-col items-start text-left md:flex">
                  <span className="text-sm font-medium">Karam</span>
                  <span className="text-xs text-muted-foreground">Admin</span>
                </div>
                <ChevronDown className="hidden h-4 w-4 text-muted-foreground md:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 border-white/[0.08] bg-popover/95 backdrop-blur-xl"
            >
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span>Karam</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    karam@teampulse.io
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </TooltipProvider>
  );
};

export default TopNav;
