"use client";

import { useProjects } from "@/hooks/use-projects";
import { useAutomation } from "@/contexts/automation-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FolderOpen, Plus, Loader2, MousePointerClick } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface RequireProjectProps {
  children: React.ReactNode;
  /** Page name to show in the message (e.g., "Workflows", "States") */
  pageName?: string;
}

/**
 * Wrapper component that shows appropriate messages when:
 * 1. User has no projects - shows "create first project" message
 * 2. User has projects but none selected - shows "select a project" message
 * 3. User has a project selected (via context or URL param) - renders the children
 * 4. User has imported local data (states exist without projectId) - renders the children
 *
 * Styled to match the dashboard's empty state design.
 */
export function RequireProject({
  children,
  pageName = "this page",
}: RequireProjectProps) {
  const { data: projects, isLoading, error } = useProjects();
  const { projectId, states } = useAutomation();
  const searchParams = useSearchParams();

  // Check for project ID in URL (used when navigating from dashboard)
  // searchParams can be null during SSR, so handle that case
  const urlProjectId = searchParams?.get("project") ?? null;

  // Check if there's locally imported data (states exist without a backend project ID)
  // This happens when a user imports a config file
  const hasLocalImportedData = states && states.length > 0;

  // Consider project selected if either context has it, URL has it, or local data was imported
  const hasProjectSelected = Boolean(
    projectId || urlProjectId || hasLocalImportedData,
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
      </div>
    );
  }

  if (error) {
    // If there&apos;s an error (including auth errors), treat it as "no projects"
    // This handles the case where the user isn&apos;t logged in or their session expired
    return (
      <div className="flex items-center justify-center min-h-[400px] p-4">
        <Card className="bg-surface-raised/30 border-border-subtle/50 border-dashed backdrop-blur-sm max-w-md">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 bg-brand-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-brand-primary" />
            </div>
            <h4 className="text-xl font-semibold mb-2 text-text-muted">
              No projects yet
            </h4>
            <p className="text-text-muted mb-6">
              Create your first project to access {pageName}
            </p>
            <Button
              asChild
              className="bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
            >
              <Link href="/build/workflows">
                <Plus className="w-4 h-4 mr-2" />
                Create First Project
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No projects exist - show "create first project" message
  if (!projects || projects.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-4">
        <Card className="bg-surface-raised/30 border-border-subtle/50 border-dashed backdrop-blur-sm max-w-md">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 bg-brand-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-brand-primary" />
            </div>
            <h4 className="text-xl font-semibold mb-2 text-text-muted">
              No projects yet
            </h4>
            <p className="text-text-muted mb-6">
              Create your first project to access {pageName}
            </p>
            <Button
              asChild
              className="bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
            >
              <Link href="/build/workflows">
                <Plus className="w-4 h-4 mr-2" />
                Create First Project
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Projects exist but none selected - show "select a project" message
  if (!hasProjectSelected) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-4">
        <Card className="bg-surface-raised/30 border-border-subtle/50 border-dashed backdrop-blur-sm max-w-md">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 bg-brand-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <MousePointerClick className="w-8 h-8 text-brand-primary" />
            </div>
            <h4 className="text-xl font-semibold mb-2 text-text-muted">
              No project selected
            </h4>
            <p className="text-text-muted mb-6">
              Select or create a project from the dashboard to access {pageName}
            </p>
            <Button
              asChild
              className="bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
            >
              <Link href="/build/workflows">
                <FolderOpen className="w-4 h-4 mr-2" />
                Go to Dashboard
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
