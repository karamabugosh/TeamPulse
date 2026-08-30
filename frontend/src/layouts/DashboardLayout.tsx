import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AppSidebar } from '@/components/dashboard/AppSidebar';
import { TopNav } from '@/components/dashboard/TopNav';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const DashboardLayout: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <aside className="hidden border-r border-sidebar-border bg-sidebar lg:flex lg:w-[260px] lg:shrink-0 lg:flex-col">
          <AppSidebar />
        </aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-full w-[280px] border-r border-sidebar-border bg-sidebar shadow-elevated animate-in slide-in-from-left duration-300">
              <div className="flex items-center justify-end p-3">
                <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <AppSidebar onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopNav onMenuClick={() => setMobileOpen(true)} />

          <main className="flex-1 overflow-y-auto">
            <div
              className={cn(
                'mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-6 lg:px-10 lg:py-10 animate-fade-in',
              )}
            >
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default DashboardLayout;
