"use client";

import { useState } from "react";
import { Workflow, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ProjectSwitcherProps {
  isCollapsed: boolean;
  projects: Array<{ id: string; name: string }>;
  currentProject: { id: string; name: string } | null;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  loading?: boolean;
}

export function ProjectSwitcher({
  isCollapsed,
  projects,
  currentProject,
  onProjectChange,
  onCreateProject,
  loading,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2 py-1.5",
          isCollapsed && "justify-center px-0"
        )}
      >
        <div className="flex size-7 shrink-0 animate-pulse items-center justify-center rounded-md bg-surface-hover" />
        {!isCollapsed && (
          <div className="flex flex-1 flex-col gap-1">
            <div className="h-3.5 w-24 animate-pulse rounded bg-surface-hover" />
            <div className="h-3 w-16 animate-pulse rounded bg-surface-hover" />
          </div>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          data-tutorial-id="sidebar-project-switcher"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 h-auto text-sm font-medium transition-colors hover:bg-surface-hover",
            isCollapsed && "justify-center px-0"
          )}
        >
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-md"
            style={{
              backgroundColor: "var(--brand-secondary)",
              color: "white",
            }}
          >
            <Workflow className="size-3.5" />
          </div>
          {!isCollapsed && (
            <>
              <div className="flex flex-1 flex-col items-start text-left">
                <span className="text-xs font-semibold text-text-primary">
                  {currentProject?.name || "Select Project"}
                </span>
                <span className="text-[11px] text-text-muted">
                  {projects.length} project{projects.length !== 1 ? "s" : ""}
                </span>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 text-text-muted" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() => {
              onProjectChange(project.id);
              setOpen(false);
            }}
            className={cn(
              "cursor-pointer",
              currentProject?.id === project.id && "bg-surface-hover"
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex size-8 items-center justify-center rounded-md"
                style={{
                  backgroundColor: "var(--brand-secondary)",
                  color: "white",
                }}
              >
                <Workflow className="size-4" />
              </div>
              <span className="font-medium">{project.name}</span>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            onCreateProject();
            setOpen(false);
          }}
          data-tutorial-id="sidebar-create-project"
          className="cursor-pointer"
        >
          <div className="flex items-center gap-2 text-text-muted">
            <span>+ Create new project</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
