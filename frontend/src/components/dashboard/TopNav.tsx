import React, { useState } from 'react';
import {
  Search,
  Bell,
  Moon,
  Sun,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface TopNavProps {
  onMenuClick?: () => void;
}

const workspaces = [
  { id: '1', name: 'TeamPulse Workspace', plan: 'Pro' },
  { id: '2', name: 'Engineering Hub', plan: 'Team' },
  { id: '3', name: 'Product Squad', plan: 'Starter' },
];

const notifications = [
  { id: '1', title: 'Daily standup completed', time: '5m ago', unread: true },
  { id: '2', title: 'New blocker reported', time: '1h ago', unread: true },
  { id: '3', title: 'Weekly report generated', time: '3h ago', unread: false },
];

export const TopNav: React.FC<TopNavProps> = ({ onMenuClick }) => {
  const [darkMode, setDarkMode] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState(workspaces[0]);

  return (
    <TooltipProvider>
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card/50 px-4 backdrop-blur-sm lg:px-8">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Workspace Switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2 border-border bg-secondary/50">
                <Building2 className="h-4 w-4 text-primary" />
                <span className="hidden sm:inline max-w-[160px] truncate">{activeWorkspace.name}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {workspaces.map((ws) => (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => setActiveWorkspace(ws)}
                  className="flex items-center justify-between"
                >
                  <div className="flex flex-col">
                    <span>{ws.name}</span>
                    <span className="text-xs text-muted-foreground">{ws.plan} plan</span>
                  </div>
                  {activeWorkspace.id === ws.id && <Check className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
          {/* Search */}
          <div className="relative hidden md:block md:w-72 lg:w-96">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search check-ins, reports, teams..."
              className="pl-9 bg-secondary/50 border-border"
            />
          </div>

          {/* Timezone */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="hidden lg:flex gap-1.5 px-3 py-1.5 cursor-default">
                <Clock className="h-3.5 w-3.5 text-primary" />
                Asia/Riyadh (UTC+3)
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Workspace timezone</TooltipContent>
          </Tooltip>

          {/* Dark Mode Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDarkMode(!darkMode)}
                className="text-muted-foreground hover:text-foreground"
              >
                {darkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{darkMode ? 'Dark mode' : 'Light mode'}</TooltipContent>
          </Tooltip>

          {/* Notifications */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
                <Bell className="h-4 w-4" />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="border-b border-border px-4 py-3">
                <h4 className="font-semibold">Notifications</h4>
                <p className="text-xs text-muted-foreground">You have 2 unread notifications</p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-secondary/50 transition-colors cursor-pointer"
                  >
                    {n.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    {!n.unread && <span className="mt-1.5 h-2 w-2 shrink-0" />}
                    <div>
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="text-xs text-muted-foreground">{n.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Profile Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 pl-2 pr-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>K</AvatarFallback>
                </Avatar>
                <div className="hidden md:flex flex-col items-start text-left">
                  <span className="text-sm font-medium">Karam</span>
                  <span className="text-xs text-muted-foreground">Admin</span>
                </div>
                <ChevronDown className="hidden md:block h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span>Karam</span>
                  <span className="text-xs font-normal text-muted-foreground">karam@teampulse.io</span>
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
