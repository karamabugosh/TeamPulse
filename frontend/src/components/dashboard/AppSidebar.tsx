import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Zap,
  LayoutDashboard,
  ClipboardList,
  FileText,
  Target,
  AlertTriangle,
  Sparkles,
  Settings,
  History,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

type ModuleAccent = 'default' | 'ai' | 'jira' | 'slack' | 'reports' | 'blockers';

type NavItem = {
  name: string;
  path: string;
  icon: LucideIcon;
  accent?: ModuleAccent;
};

const primaryNav: NavItem[] = [
  { name: 'Overview', path: '/overview', icon: LayoutDashboard },
  { name: 'Check-ins', path: '/checkins', icon: ClipboardList, accent: 'slack' },
  { name: 'Reports', path: '/reports', icon: FileText, accent: 'reports' },
  { name: 'Jira', path: '/jira', icon: Target, accent: 'jira' },
  { name: 'Blockers', path: '/blockers', icon: AlertTriangle, accent: 'blockers' },
  { name: 'AI Workspace', path: '/ai-workspace', icon: Sparkles, accent: 'ai' },
  { name: 'Settings', path: '/settings', icon: Settings },
];

const secondaryNav: NavItem[] = [
  { name: 'Run History', path: '/checkins/history', icon: History, accent: 'slack' },
  { name: 'Teams', path: '/teams', icon: Users },
];

const ACTIVE_STYLES: Record<ModuleAccent, string> = {
  default: 'bg-primary/15 text-primary nav-active-glow',
  ai: 'bg-module-ai/15 text-violet-300 module-glow-ai',
  jira: 'bg-[#4F46E5]/15 text-[#60A5FA] module-glow-jira',
  slack: 'bg-module-slack/15 text-emerald-300 module-glow-slack',
  reports: 'bg-module-reports/15 text-orange-300 module-glow-reports',
  blockers: 'bg-module-blockers/15 text-red-300 module-glow-blockers',
};

const ICON_IDLE: Record<ModuleAccent, string> = {
  default: 'text-muted-foreground group-hover:text-foreground',
  ai: 'text-muted-foreground group-hover:text-violet-300',
  jira: 'text-muted-foreground group-hover:text-blue-300',
  slack: 'text-muted-foreground group-hover:text-emerald-300',
  reports: 'text-muted-foreground group-hover:text-orange-300',
  blockers: 'text-muted-foreground group-hover:text-red-300',
};

interface AppSidebarProps {
  onNavigate?: () => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ onNavigate }) => {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/overview') {
      return location.pathname === '/' || location.pathname === '/overview';
    }
    if (path === '/checkins') {
      return location.pathname === '/checkins' || location.pathname.startsWith('/checkins/standup');
    }
    if (path === '/checkins/history') {
      return location.pathname === '/checkins/history';
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const renderLink = (item: NavItem) => {
    const active = isActive(item.path);
    const accent = item.accent ?? 'default';
    const Icon = item.icon;

    return (
      <NavLink
        key={item.path}
        to={item.path}
        onClick={onNavigate}
        className={cn(
          'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-250',
          active
            ? ACTIVE_STYLES[accent]
            : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 shrink-0 transition-colors',
            active ? 'opacity-100' : ICON_IDLE[accent],
          )}
        />
        <span className="truncate">{item.name}</span>
      </NavLink>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-[hsl(263_70%_64%)] to-[hsl(263_70%_52%)] shadow-glow-sm">
          <Zap className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <p className="text-base font-semibold tracking-tight text-foreground">Pulse</p>
          <p className="text-[11px] text-muted-foreground">Team intelligence</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        <div className="space-y-0.5">{primaryNav.map(renderLink)}</div>
        <div>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
            More
          </p>
          <div className="space-y-0.5">{secondaryNav.map(renderLink)}</div>
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-module-slack" />
            </span>
            <span className="text-xs font-medium text-emerald-400">Slack Bot Active</span>
          </div>
          <Badge variant="secondary" className="font-mono text-[10px]">
            v2.4.0
          </Badge>
        </div>
      </div>
    </div>
  );
};

export default AppSidebar;
