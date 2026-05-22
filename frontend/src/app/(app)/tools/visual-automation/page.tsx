"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAutomation } from "@/contexts/automation-context";
import {
  useProjects,
  useCreateProject,
  useDeleteProject,
  useUpdateProject,
} from "@/hooks/use-projects";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Upload,
  Clock,
  FolderOpen,
  Play,
  Check,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { getProjectLoader } from "@/lib/project";
import { DeleteConfirmationDialog } from "@/components/delete-confirmation-dialog";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { EditableProjectName } from "@/components/editable-project-name";

interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  status: "draft" | "testing" | "production";
}

export default function VisualAutomationDashboard() {
  const {
    projectId: contextProjectId,
    setProjectId,
    setProjectName,
  } = useAutomation();
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedProjectId =
    searchParams.get("project") ?? contextProjectId ?? null;
  const { data: apiProjects = [], isLoading: projectsLoading } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const projects = useMemo(
    () =>
      apiProjects.map(
        (p: {
          id: string;
          name: string;
          description?: string | null;
          created_at: string;
          updated_at: string;
        }) => ({
          id: p.id.toString(),
          name: p.name,
          description: p.description || "No description",
          created_at: p.created_at,
          updated_at: p.updated_at,
          status: "draft" as const,
        })
      ),
    [apiProjects]
  );

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60)
    );
    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return "1 day ago";
    return `${diffInDays} days ago`;
  };

  const getStatusColor = (status: Project["status"]) => {
    switch (status) {
      case "production":
        return "bg-brand-success/20 text-brand-success border-brand-success/30";
      case "testing":
        return "bg-brand-primary/20 text-brand-primary border-brand-primary/30";
      case "draft":
        return "bg-surface-raised/20 text-text-muted border-border-subtle/30";
    }
  };

  const handleCreateProject = async (name: string, description?: string) => {
    try {
      const newProject = await createProject.mutateAsync({
        name,
        description: description || "A new automation project",
        configuration: {},
      });
      setShowCreateDialog(false);
      setProjectId(newProject.id);
      setProjectName(name);
      router.push(`/tools/visual-automation?project=${newProject.id}`);
      toast.success("Project created");
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Failed to create project";
      toast.error(msg);
      throw error;
    }
  };

  const handleSelectProject = async (
    projectId: string,
    projectName: string
  ) => {
    const loader = getProjectLoader();
    const success = await loader.load(projectId, {
      currentProjectId: contextProjectId,
    });
    if (!success) {
      toast.error("Failed to load project");
      return;
    }
    setProjectId(projectId);
    setProjectName(projectName);
    router.push(`/tools/visual-automation?project=${projectId}`);
    toast.success("Project selected");
  };

  const handleUpdateProjectName = async (
    projectId: string,
    newName: string
  ) => {
    try {
      await updateProject.mutateAsync({
        id: projectId,
        data: { name: newName },
      });
      toast.success("Project name updated");
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Failed to update name";
      toast.error(msg);
      throw error;
    }
  };

  const handleDeleteProject = (project: Project) => {
    setProjectToDelete(project);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    try {
      await deleteProject.mutateAsync(projectToDelete.id);
      toast.success("Project deleted");
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
      if (selectedProjectId === projectToDelete.id) {
        router.push("/tools/visual-automation");
      }
    } catch {
      toast.error("Failed to delete project");
    }
  };

  const handleImportProject = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.qontinui";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const projectData = JSON.parse(text);
        if (!projectData.name) {
          throw new Error("Invalid project file format");
        }
        const newProject = await createProject.mutateAsync({
          name: `${projectData.name} (Imported)`,
          description: projectData.description || "Imported project",
          configuration: {},
        });
        toast.success(`Imported project: ${projectData.name}`);
        router.push(`/tools/visual-automation?project=${newProject.id}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        toast.error(`Failed to import: ${msg}`);
      }
    };
    input.click();
  };

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Eye className="w-5 h-5 text-cyan-400" />
          <div>
            <h1 className="text-lg font-semibold">Visual Automation</h1>
            <p className="text-sm text-text-muted">
              Manage your GUI automation projects
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-subtle/50 rounded-lg">
            <FolderOpen className="w-4 h-4 text-brand-primary" />
            <span className="text-sm text-text-muted">Projects</span>
            <span className="text-sm font-semibold text-brand-primary">
              {projects.length}
            </span>
          </div>
          {projects.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-subtle/50 rounded-lg">
              <Clock className="w-4 h-4 text-brand-secondary" />
              <span className="text-sm text-text-muted">Last updated</span>
              <span className="text-sm font-semibold text-brand-secondary">
                {getRelativeTime(projects[0]!.updated_at)}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto">
          {/* Quick Actions */}
          {projects.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <Card
                className="bg-surface-raised/50 border-border-subtle/50 hover:border-brand-primary/50 hover:shadow-[0_0_20px_var(--glow-primary)] transition-all duration-300 cursor-pointer group"
                onClick={() => setShowCreateDialog(true)}
              >
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-10 h-10 bg-brand-primary/20 rounded-lg flex items-center justify-center group-hover:bg-brand-primary/30 transition-colors shrink-0">
                    <Plus className="w-5 h-5 text-brand-primary" />
                  </div>
                  <div>
                    <h4 className="font-medium">New Project</h4>
                    <p className="text-sm text-text-muted">
                      Create a new automation project
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card
                className="bg-surface-raised/50 border-border-subtle/50 hover:border-brand-secondary/50 hover:shadow-[0_0_20px_var(--glow-secondary)] transition-all duration-300 cursor-pointer group"
                onClick={handleImportProject}
              >
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-10 h-10 bg-brand-secondary/20 rounded-lg flex items-center justify-center group-hover:bg-brand-secondary/30 transition-colors shrink-0">
                    <Upload className="w-5 h-5 text-brand-secondary" />
                  </div>
                  <div>
                    <h4 className="font-medium">Import Configuration</h4>
                    <p className="text-sm text-text-muted">
                      Upload existing automation files
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Projects Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Your Projects</h3>
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </div>

          {/* Projects Grid */}
          {projectsLoading ? (
            <div className="text-center py-12 text-text-muted">
              Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <Card className="bg-surface-raised/30 border-border-subtle/50 border-dashed">
              <CardContent className="p-12 text-center">
                <div className="w-16 h-16 bg-brand-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FolderOpen className="w-8 h-8 text-brand-primary" />
                </div>
                <h4 className="text-xl font-semibold mb-2 text-text-secondary">
                  No projects yet
                </h4>
                <p className="text-text-muted mb-6">
                  Create your first visual automation project to get started
                </p>
                <Button
                  onClick={() => setShowCreateDialog(true)}
                  className="bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Project
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {projects.map((project) => {
                const isSelected = selectedProjectId === project.id;
                return (
                  <Card
                    key={project.id}
                    className={`bg-surface-raised/50 transition-all duration-300 group ${
                      isSelected
                        ? "border-brand-primary shadow-[0_0_20px_var(--glow-primary)] ring-1 ring-brand-primary/50"
                        : "border-border-subtle/50 hover:border-brand-primary/30 hover:shadow-[0_0_20px_var(--glow-primary)]"
                    }`}
                  >
                    <CardContent className="p-5">
                      <div className="mb-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {isSelected && (
                              <div className="w-5 h-5 rounded-full bg-brand-primary flex items-center justify-center shrink-0">
                                <Check className="w-3 h-3 text-black" />
                              </div>
                            )}
                            <EditableProjectName
                              name={project.name}
                              onSave={(newName) =>
                                handleUpdateProjectName(project.id, newName)
                              }
                              isSelected={isSelected}
                            />
                          </div>
                          <Badge
                            className={`${getStatusColor(project.status)} text-xs`}
                          >
                            {project.status}
                          </Badge>
                        </div>
                        <p className="text-text-muted text-sm mb-3 line-clamp-2">
                          {project.description}
                        </p>
                        <p className="text-xs text-text-muted">
                          Modified {getRelativeTime(project.updated_at)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            handleSelectProject(project.id, project.name)
                          }
                          className={`flex-1 ${
                            isSelected
                              ? "bg-brand-primary/30 text-brand-primary border border-brand-primary/50"
                              : "bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/30 hover:border-brand-primary/50"
                          }`}
                        >
                          {isSelected ? (
                            <>
                              <Check className="w-4 h-4 mr-1" />
                              Selected
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 mr-1" />
                              Select
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProject(project);
                          }}
                          className="border-border-default hover:border-red-500 hover:text-red-400 bg-transparent"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Dialogs */}
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onConfirm={handleCreateProject}
        isLoading={createProject.isPending}
      />

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
    </div>
  );
}
