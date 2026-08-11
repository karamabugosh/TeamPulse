import React from 'react';

import { NavLink, useLocation } from 'react-router-dom';

import {

  LayoutDashboard,

  CheckSquare,

  Users,

  FileText,

  Settings,

  Zap,

  History,

} from 'lucide-react';

import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';



const navItems = [

  { name: 'Overview', path: '/overview', icon: LayoutDashboard },

  { name: 'CheckIns', path: '/checkins', icon: CheckSquare },

  { name: 'Run History', path: '/checkins/history', icon: History },

  { name: 'Teams', path: '/teams', icon: Users },

  { name: 'Reports', path: '/reports', icon: FileText },

  { name: 'Settings', path: '/settings', icon: Settings },

];



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
      return location.pathname === '/checkins';
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };



  return (

    <div className="flex h-full flex-col">

      <div className="flex items-center gap-3 px-4 py-6">

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25">

          <Zap className="h-5 w-5 text-primary-foreground" />

        </div>

        <div>

          <h1 className="text-lg font-bold tracking-tight text-foreground">Pulse</h1>

          <p className="text-xs text-muted-foreground">Team Check-ins</p>

        </div>

      </div>



      <nav className="flex-1 space-y-1 px-3">

        {navItems.map((item) => {

          const Icon = item.icon;

          const active = isActive(item.path);



          return (

            <NavLink

              key={item.path}

              to={item.path}

              onClick={onNavigate}

              className={cn(

                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',

                active

                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'

                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'

              )}

            >

              <Icon

                className={cn(

                  'h-[18px] w-[18px] transition-transform duration-200 group-hover:scale-110',

                  active ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'

                )}

              />

              {item.name}

            </NavLink>

          );

        })}

      </nav>



      <div className="border-t border-sidebar-border p-4">

        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5">

          <div className="flex items-center gap-2">

            <span className="relative flex h-2 w-2">

              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />

              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />

            </span>

            <span className="text-xs font-medium text-emerald-400">Slack Bot Active</span>

          </div>

          <Badge variant="secondary" className="text-[10px] font-mono">

            v2.4.0

          </Badge>

        </div>

      </div>

    </div>

  );

};


