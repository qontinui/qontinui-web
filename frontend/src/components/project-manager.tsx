"use client";

import { useState } from "react";
import {
  useProjects,
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
} from "@/hooks/use-projects";
import type { Project } from "@/lib/schemas";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Save,
  FolderOpen,
  Plus,
  Trash2,
  FileText,
  ChevronDown,
  Globe,
} from "lucide-react";
import { DeleteConfirmationDialog } from "@/components/delete-confirmation-dialog";

interface ProjectManagerProps {
  currentConfiguration: unknown;
  onLoadConfiguration: (config: unknown) => void;
}

export function ProjectManager({
  currentConfiguration,
  onLoadConfiguration,
}: ProjectManagerProps) {
  const { user } = useAuth();
  const { data: projects = [] } = useProjects();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  // Dialog states
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  const loading =
    createProject.isPending ||
    updateProject.isPending ||
    deleteProject.isPending;

  const handleSaveNew = async () => {
    if (!newProjectName.trim()) {
      toast.error("Please enter a project name");
      return;
    }

    try {
      const project = await createProject.mutateAsync({
        name: newProjectName,
        description: newProjectDescription,
        configuration: currentConfiguration as Record<string, unknown>,
      });
      setSelectedProject({
        ...project,
        configuration: (project.configuration ?? {}) as Record<string, unknown>,
      } as Project);
      setSaveDialogOpen(false);
      setNewProjectName("");
      setNewProjectDescription("");
      setIsPublic(false);
      toast.success("Project saved successfully");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save project"
      );
    }
  };

  const handleSaveExisting = async () => {
    if (!selectedProject) return;

    try {
      const updated = await updateProject.mutateAsync({
        id: selectedProject.id,
        data: {
          configuration: currentConfiguration as Record<string, unknown>,
        },
      });
      setSelectedProject({
        ...updated,
        configuration: updated.configuration as Record<string, unknown>,
      } as Project);
      toast.success("Project updated successfully");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update project"
      );
    }
  };

  const handleLoad = async (project: Project) => {
    try {
      // Query is cached, so this will be fast
      const config = project.configuration ?? {};
      onLoadConfiguration(config);
      setSelectedProject({ ...project, configuration: config } as Project);
      setLoadDialogOpen(false);
      toast.success(`Loaded project: ${project.name}`);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load project"
      );
    }
  };

  const handleDelete = (project: Project) => {
    setProjectToDelete({
      ...project,
      configuration: project.configuration ?? {},
    } as Project);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;

    try {
      await deleteProject.mutateAsync(projectToDelete.id);
      if (selectedProject?.id === projectToDelete.id) {
        setSelectedProject(null);
      }
      toast.success("Project deleted successfully");
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete project"
      );
    }
  };

  if (!user) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="text-text-secondary">
            <FileText className="w-4 h-4 mr-2" />
            Project
            <ChevronDown className="w-4 h-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setSaveDialogOpen(true)}>
            <Save className="w-4 h-4 mr-2" />
            Save Project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLoadDialogOpen(true)}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Load Project
          </DropdownMenuItem>
          {selectedProject && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs text-zinc-500">
                Current: {selectedProject.name}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Project</DialogTitle>
            <DialogDescription>
              Save your current automation configuration as a project
            </DialogDescription>
          </DialogHeader>

          {selectedProject ? (
            <div className="space-y-4">
              <div className="p-3 bg-zinc-100 dark:bg-zinc-800 rounded-md">
                <p className="text-sm font-medium">{selectedProject.name}</p>
                {selectedProject.description && (
                  <p className="text-xs text-zinc-500 mt-1">
                    {selectedProject.description}
                  </p>
                )}
              </div>
              <p className="text-sm text-zinc-500">
                Update the existing project with current configuration?
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="My Automation"
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-description">
                  Description (optional)
                </Label>
                <Textarea
                  id="project-description"
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder="Describe what this automation does..."
                  disabled={loading}
                  rows={3}
                />
              </div>
              <div className="flex items-center justify-between space-x-2 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-md border border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center space-x-2">
                  <Globe className="w-4 h-4 text-zinc-500" />
                  <div className="flex flex-col">
                    <Label
                      htmlFor="is-public"
                      className="text-sm font-medium cursor-pointer"
                    >
                      Make Public
                    </Label>
                    <p className="text-xs text-zinc-500">
                      Allow anyone to view this project as a demo
                    </p>
                  </div>
                </div>
                <Switch
                  id="is-public"
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            {selectedProject ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedProject(null);
                    setNewProjectName("");
                    setNewProjectDescription("");
                    setIsPublic(false);
                  }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Save as New
                </Button>
                <Button onClick={handleSaveExisting} disabled={loading}>
                  {loading ? "Updating..." : "Update"}
                </Button>
              </>
            ) : (
              <Button onClick={handleSaveNew} disabled={loading}>
                {loading ? "Saving..." : "Save"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Dialog */}
      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Project</DialogTitle>
            <DialogDescription>
              Select a project to load its configuration
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[300px] w-full rounded-md border p-4">
            {projects.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">
                No saved projects yet
              </p>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between p-3 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-sm">{project.name}</p>
                      {project.description && (
                        <p className="text-xs text-zinc-500 mt-1">
                          {project.description}
                        </p>
                      )}
                      <p className="text-xs text-zinc-400 mt-1">
                        Updated:{" "}
                        {new Date(project.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          handleLoad({
                            ...project,
                            configuration: project.configuration || {},
                          })
                        }
                      >
                        Load
                      </Button>
                      <DestructiveButton
                        size="sm"
                        onClick={() =>
                          handleDelete({
                            ...project,
                            configuration: project.configuration || {},
                          })
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </DestructiveButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        title="Delete Project"
        itemName={projectToDelete?.name || ""}
        description={`Are you sure you want to delete "${projectToDelete?.name}"? This will permanently delete the project and all its configuration. This action cannot be undone.`}
        onClose={() => {
          setDeleteDialogOpen(false);
          setProjectToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
