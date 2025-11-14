'use client';

import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Menu, X, ChevronLeft, Home } from 'lucide-react';
import { automationBuilderRoutes, getActiveRoute } from '@/lib/automation-navigation';

export default function AutomationBuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeRoute = getActiveRoute(pathname);

  // Breadcrumb logic
  const breadcrumbs = [
    { name: 'Home', path: '/' },
    { name: 'Automation Builder', path: '/automation-builder/overview' },
  ];

  if (activeRoute && activeRoute.path !== '/automation-builder/overview') {
    breadcrumbs.push({ name: activeRoute.name, path: activeRoute.path });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col border-r bg-background transition-all duration-300',
          sidebarOpen ? 'w-64' : 'w-16'
        )}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-4 border-b">
          {sidebarOpen && (
            <h2 className="text-lg font-semibold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              Automation
            </h2>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={cn('flex-shrink-0', !sidebarOpen && 'mx-auto')}
          >
            {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>

        {/* Navigation Links */}
        <ScrollArea className="flex-1 px-2 py-4">
          <TooltipProvider delayDuration={0}>
            <nav className="space-y-1">
              {automationBuilderRoutes.map((route) => {
                const isActive = pathname === route.path ||
                  (route.path === '/automation-builder' && pathname === '/automation-builder');
                const Icon = route.icon;

                const content = (
                  <Link
                    href={route.path}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      isActive && 'bg-accent text-accent-foreground font-medium',
                      !sidebarOpen && 'justify-center'
                    )}
                  >
                    <Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-[#00D9FF]')} />
                    {sidebarOpen && (
                      <>
                        <span className="flex-1 truncate">{route.name}</span>
                        {route.badge !== undefined && route.badge > 0 && (
                          <Badge variant="destructive" className="ml-auto">
                            {route.badge}
                          </Badge>
                        )}
                      </>
                    )}
                  </Link>
                );

                if (!sidebarOpen) {
                  return (
                    <Tooltip key={route.path}>
                      <TooltipTrigger asChild>{content}</TooltipTrigger>
                      <TooltipContent side="right">
                        <p className="font-medium">{route.name}</p>
                        {route.description && (
                          <p className="text-xs text-muted-foreground">{route.description}</p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return <div key={route.path}>{content}</div>;
              })}
            </nav>
          </TooltipProvider>
        </ScrollArea>

        {/* Sidebar Footer */}
        <div className="border-t p-4">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  className={cn('w-full', !sidebarOpen && 'px-2')}
                  onClick={() => router.push('/')}
                >
                  <Home className="h-4 w-4" />
                  {sidebarOpen && <span className="ml-2">Back to Home</span>}
                </Button>
              </TooltipTrigger>
              {!sidebarOpen && (
                <TooltipContent side="right">
                  <p>Back to Home</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </aside>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Menu */}
      <aside
        className={cn(
          'fixed left-0 top-0 bottom-0 w-64 bg-background border-r z-50 md:hidden',
          'transform transition-transform duration-300',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Mobile Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
            Automation
          </h2>
          <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Mobile Navigation */}
        <ScrollArea className="flex-1 px-2 py-4">
          <nav className="space-y-1">
            {automationBuilderRoutes.map((route) => {
              const isActive = pathname === route.path ||
                (route.path === '/automation-builder' && pathname === '/automation-builder');
              const Icon = route.icon;

              return (
                <Link
                  key={route.path}
                  href={route.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    isActive && 'bg-accent text-accent-foreground font-medium'
                  )}
                >
                  <Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-[#00D9FF]')} />
                  <span className="flex-1 truncate">{route.name}</span>
                  {route.badge !== undefined && route.badge > 0 && (
                    <Badge variant="destructive">{route.badge}</Badge>
                  )}
                </Link>
              );
            })}
          </nav>
        </ScrollArea>

        {/* Mobile Footer */}
        <div className="border-t p-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setMobileMenuOpen(false);
              router.push('/');
            }}
          >
            <Home className="h-4 w-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="border-b bg-background px-4 py-3 flex items-center gap-4">
          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Breadcrumbs */}
          <nav className="flex items-center gap-2 text-sm">
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={crumb.path}>
                {index > 0 && <span className="text-muted-foreground">/</span>}
                <Link
                  href={crumb.path}
                  className={cn(
                    'hover:text-foreground transition-colors',
                    index === breadcrumbs.length - 1
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground'
                  )}
                >
                  {crumb.name}
                </Link>
              </React.Fragment>
            ))}
          </nav>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
