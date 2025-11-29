"use client";

import * as React from "react";
import {
  FolderOpen,
  Check,
  ChevronsUpDown,
  Plus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Define a minimal project interface for the switcher
// This is intentionally flexible to handle different project data shapes
interface ProjectItem {
  id: string;
  name: string;
  description?: string | null;
}

interface ProjectSwitcherProps {
  projects: ProjectItem[];
  currentProject: ProjectItem | null;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  loading?: boolean;
  className?: string;
}

export function ProjectSwitcher({
  projects,
  currentProject,
  onProjectChange,
  onCreateProject,
  loading = false,
  className,
}: ProjectSwitcherProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select project"
          className={cn("w-full justify-between", className)}
          disabled={loading}
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading...</span>
            </div>
          ) : currentProject ? (
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="h-4 w-4 text-[#00D9FF] flex-shrink-0" />
              <span className="truncate">{currentProject.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <span className="text-muted-foreground">Select project</span>
            </div>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[280px]" align="start">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {projects.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No projects yet
          </div>
        ) : (
          <div className="max-h-[300px] overflow-y-auto">
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onSelect={() => {
                  onProjectChange(project.id);
                  setOpen(false);
                }}
                className="cursor-pointer"
              >
                <div className="flex items-center justify-between w-full gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FolderOpen className="h-4 w-4 text-[#00D9FF] flex-shrink-0" />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate font-medium">
                        {project.name}
                      </span>
                      {project.description && (
                        <span className="text-xs text-muted-foreground truncate">
                          {project.description}
                        </span>
                      )}
                    </div>
                  </div>
                  {currentProject?.id === project.id && (
                    <Check className="h-4 w-4 shrink-0" />
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            onCreateProject();
            setOpen(false);
          }}
          className="cursor-pointer"
        >
          <Plus className="mr-2 h-4 w-4" />
          <span>Create New Project</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
