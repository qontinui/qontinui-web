"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import {
  useProjects,
  useCreateProject,
  useDeleteProject,
  useUpdateProject,
} from "@/hooks/use-projects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Upload,
  Clock,
  FolderOpen,
  BookTemplate as Template,
  Play,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { getProjectLoader } from "@/lib/project";
import { DeleteConfirmationDialog } from "@/components/delete-confirmation-dialog";
import { WelcomeModal } from "@/components/onboarding/WelcomeModal";
import { QuickStartChecklist } from "@/components/onboarding/QuickStartChecklist";
import { TutorialOverlay } from "@/components/onboarding/TutorialOverlay";
import { FirstProjectWizard } from "@/components/onboarding/FirstProjectWizard";
import { useOnboardingStore } from "@/stores/onboarding-store";
import {
  EarlyAccessBanner,
  EarlyAccessWelcomeModal,
} from "@/components/early-access";
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

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const {
    projectId: contextProjectId,
    setProjectId,
    setProjectName,
  } = useAutomation();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get currently selected project ID from URL or context
  const selectedProjectId =
    searchParams.get("project") ?? contextProjectId ?? null;
  const { data: apiProjects = [], isLoading: projectsLoading } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [showFirstProjectWizard, setShowFirstProjectWizard] = useState(false);
  const [showEarlyAccessWelcome, setShowEarlyAccessWelcome] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Onboarding state
  const { showTutorialOverlay, hasCompletedWelcome, toggleWelcomeModal } =
    useOnboardingStore();

  const isNewUser = () => {
    if (!user?.created_at) return false;
    const createdAt = new Date(user.created_at);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return createdAt > fiveMinutesAgo;
  };

  useEffect(() => {
    // Wait for auth to finish loading before redirecting
    if (!authLoading && !user) {
      router.push("/");
      return undefined;
    }

    // Show welcome modal for new users who haven't completed onboarding
    if (user && !authLoading && isNewUser() && !hasCompletedWelcome) {
      toggleWelcomeModal(true);
    }

    // Show early access welcome for new users (separate from onboarding)
    if (user && !authLoading && isNewUser()) {
      // Small delay to let onboarding modal show first if needed
      const timer = setTimeout(
        () => {
          setShowEarlyAccessWelcome(true);
        },
        hasCompletedWelcome ? 500 : 3000
      ); // Longer delay if showing onboarding first
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [user, authLoading, router, hasCompletedWelcome, toggleWelcomeModal]);

  // Clear old localStorage project data (one-time cleanup)
  useEffect(() => {
    const hasCleared = localStorage.getItem("qontinui-cleanup-done");
    if (!hasCleared) {
      // Clear old project data from localStorage
      localStorage.removeItem("qontinui-project-name");
      localStorage.removeItem("qontinui-lastSaved");
      localStorage.setItem("qontinui-cleanup-done", "true");
      console.log("Cleared old project localStorage data");
    }
  }, []);

  // Transform API projects to match our interface
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
          status: "draft" as const, // Default status since API doesn't have this field yet
        })
      ),
    [apiProjects]
  );

  // Clean up invalid project parameter from URL
  useEffect(() => {
    const projectParam = searchParams.get("project");
    if (!projectParam || projectsLoading) return;

    // Check if the project ID in URL exists in the projects list
    const projectExists = projects.some((p) => p.id === projectParam);
    if (!projectExists && projects.length >= 0) {
      // Project doesn&apos;t exist, clear the parameter
      console.log(`Project ${projectParam} not found, clearing from URL`);
      router.push("/dashboard");
    }
  }, [searchParams, projects, projectsLoading, router]);

  // Generate activities from projects
  const activities = useMemo(
    () =>
      projects.slice(0, 5).map((p, idx: number) => ({
        id: `activity-${idx}`,
        type: idx === 0 ? ("created" as const) : ("modified" as const),
        projectName: p.name,
        timestamp: new Date(p.updated_at),
        projectId: p.id,
      })),
    [projects]
  );

  const loading = projectsLoading;

  const handleNewProject = () => {
    // Show wizard for new users with no projects
    if (projects.length === 0 && isNewUser()) {
      setShowFirstProjectWizard(true);
      return;
    }

    // Show the create project dialog
    setShowCreateDialog(true);
  };

  const handleCreateProjectConfirm = async (
    name: string,
    description?: string
  ) => {
    try {
      console.log("Creating new project...");

      // Create a new project via API
      const newProject = await createProject.mutateAsync({
        name,
        description: description || "A new automation workflow",
        configuration: {},
      });

      console.log("Project created:", newProject);

      // Close the dialog
      setShowCreateDialog(false);

      // Select the newly created project (stays on dashboard)
      // IMPORTANT: Set both projectId AND projectName to ensure data isolation
      setProjectId(newProject.id);
      setProjectName(name);
      router.push(`/dashboard?project=${newProject.id}`);
      toast.success("Project created and selected");
    } catch (error: unknown) {
      console.error("Failed to create project:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create new project";
      toast.error(errorMessage);
      throw error; // Re-throw so the dialog knows it failed
    }
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
      console.error("Failed to update project name:", error);
      const errMsg =
        error instanceof Error
          ? error.message
          : "Failed to update project name";
      toast.error(errMsg);
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
      toast.success("Project deleted successfully");
      setDeleteDialogOpen(false);
      setProjectToDelete(null);

      // If the deleted project matches the current URL parameter, clear it
      const currentProjectId = searchParams.get("project");
      if (currentProjectId === projectToDelete.id) {
        router.push("/dashboard");
      }
    } catch (error) {
      console.error("Failed to delete project:", error);
      toast.error("Failed to delete project");
    }
  };

  const handleImportProject = () => {
    // Create a file input element for importing projects
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.qontinui";

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const projectData = JSON.parse(text);

        // Validate basic structure
        if (!projectData.name || !projectData.workflows) {
          throw new Error("Invalid project file format");
        }

        // Create a new project with imported data
        const newProject = await createProject.mutateAsync({
          name: `${projectData.name} (Imported)`,
          description: projectData.description || "Imported project",
          configuration: {},
        });

        toast.success(`Imported project: ${projectData.name}`);

        // Navigate to the new project
        router.push(`/automation-builder?project=${newProject.id}`);
      } catch (error: unknown) {
        console.error("Import failed:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        toast.error(`Failed to import project: ${errorMessage}`);
      }
    };

    input.click();
  };

  const handleExport = () => {
    // For now, show a helpful message
    toast.info(
      "To export, use the export icon in the sidebar or the Export button at the top of the canvas",
      {
        duration: 5000,
      }
    );
  };

  const handleShowExport = () => {
    // Close welcome modal and show export info
    setShowEarlyAccessWelcome(false);
    handleExport();
  };

  const handleBrowseTemplates = () => {
    // Show template browser
    toast.info(
      "Template library is being curated. Check back soon for workflow templates!",
      {
        description:
          "Templates will include common automation patterns like form filling, data extraction, and web scraping.",
        duration: 7000,
      }
    );
  };

  const getStatusColor = (status: Project["status"]) => {
    switch (status) {
      case "production":
        return "bg-[#00FF88]/20 text-[#00FF88] border-[#00FF88]/30";
      case "testing":
        return "bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30";
      case "draft":
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60)
    );

    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${diffInHours} hours ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return "1 day ago";
    return `${diffInDays} days ago`;
  };

  const handleOpenProject = async (projectId: string, projectName: string) => {
    // Load project data from backend/IndexedDB
    // This hydrates the Zustand store with workflows, states, transitions, images, etc.
    const loader = getProjectLoader();
    const success = await loader.load(projectId, {
      currentProjectId: contextProjectId,
    });

    if (!success) {
      toast.error("Failed to load project");
      return;
    }

    // Select the project without navigating away from the dashboard
    // The project will appear in the sidebar's project switcher
    // IMPORTANT: Set both projectId AND projectName to ensure data isolation
    // The projectName is used by IndexedDB to filter states/workflows by project
    setProjectId(projectId);
    setProjectName(projectName);
    // Update URL to include project parameter (stays on dashboard)
    router.push(`/dashboard?project=${projectId}`);
    toast.success("Project selected");
  };

  const lastActivity = activities.length > 0 ? activities[0] : null;

  // Show loading while auth is checking
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  // Don't render anything if no user (will redirect)
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      {/* Early Access Banner */}
      <EarlyAccessBanner onExport={handleExport} />

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        {/* Welcome Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-3xl font-bold mb-2">
                {isNewUser() ? "Welcome" : "Welcome back"},{" "}
                {user.full_name || user.username}
              </h2>
              <p className="text-gray-400">
                Manage your automation configurations and projects
              </p>
            </div>

            <div className="flex gap-4">
              <div className="flex items-center gap-2 px-4 py-3 bg-[#1A1A1B]/50 border border-gray-800/50 rounded-lg backdrop-blur-sm">
                <FolderOpen className="w-5 h-5 text-[#00D9FF]" />
                <span className="text-sm text-gray-400">Total Projects</span>
                <span className="text-lg font-bold text-[#00D9FF]">
                  {projects.length}
                </span>
              </div>

              <div className="flex items-center gap-2 px-4 py-3 bg-[#1A1A1B]/50 border border-gray-800/50 rounded-lg backdrop-blur-sm">
                <Clock className="w-5 h-5 text-[#BD00FF]" />
                <span className="text-sm text-gray-400">Last Activity</span>
                <span className="text-lg font-bold text-[#BD00FF]">
                  {lastActivity
                    ? getRelativeTime(lastActivity.timestamp.toISOString())
                    : "No activity"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions Section */}
        {projects.length > 0 && (
          <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4">Quick Actions</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card
                className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm hover:border-[#00D9FF]/50 hover:shadow-[0_0_20px_rgba(0,217,255,0.1)] transition-all duration-300 cursor-pointer group"
                onClick={handleNewProject}
              >
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 bg-[#00D9FF]/20 rounded-lg flex items-center justify-center mx-auto mb-3 group-hover:bg-[#00D9FF]/30 transition-colors">
                    <Plus className="w-6 h-6 text-[#00D9FF]" />
                  </div>
                  <h4 className="font-semibold mb-2">Create New Project</h4>
                  <p className="text-sm text-gray-400">
                    Start building a new automation configuration
                  </p>
                </CardContent>
              </Card>

              <Card
                className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm hover:border-[#BD00FF]/50 hover:shadow-[0_0_20px_rgba(189,0,255,0.1)] transition-all duration-300 cursor-pointer group"
                onClick={handleBrowseTemplates}
              >
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 bg-[#BD00FF]/20 rounded-lg flex items-center justify-center mx-auto mb-3 group-hover:bg-[#BD00FF]/30 transition-colors">
                    <Template className="w-6 h-6 text-[#BD00FF]" />
                  </div>
                  <h4 className="font-semibold mb-2">Browse Templates</h4>
                  <p className="text-sm text-gray-400">
                    Explore pre-built automation templates
                  </p>
                </CardContent>
              </Card>

              <Card
                className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm hover:border-[#00FF88]/50 hover:shadow-[0_0_20px_rgba(0,255,136,0.1)] transition-all duration-300 cursor-pointer group"
                onClick={handleImportProject}
              >
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 bg-[#00FF88]/20 rounded-lg flex items-center justify-center mx-auto mb-3 group-hover:bg-[#00FF88]/30 transition-colors">
                    <Upload className="w-6 h-6 text-[#00FF88]" />
                  </div>
                  <h4 className="font-semibold mb-2">Import Configuration</h4>
                  <p className="text-sm text-gray-400">
                    Upload existing automation files
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Projects Section */}
          <div className="lg:col-span-3" data-tour="projects">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold">Your Projects</h3>
              <Button
                onClick={handleNewProject}
                className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
                data-tour="new-project"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Project
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8 text-gray-400">
                Loading projects...
              </div>
            ) : projects.length === 0 ? (
              <Card className="bg-[#1A1A1B]/30 border-gray-800/50 border-dashed backdrop-blur-sm">
                <CardContent className="p-12 text-center">
                  <div className="w-16 h-16 bg-[#00D9FF]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <FolderOpen className="w-8 h-8 text-[#00D9FF]" />
                  </div>
                  <h4 className="text-xl font-semibold mb-2 text-gray-300">
                    No projects yet
                  </h4>
                  <p className="text-gray-500 mb-6">
                    Create your first automation project to get started
                  </p>
                  <Button
                    onClick={handleNewProject}
                    className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
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
                      className={`bg-[#1A1A1B]/50 backdrop-blur-sm transition-all duration-300 group ${
                        isSelected
                          ? "border-[#00D9FF] shadow-[0_0_20px_rgba(0,217,255,0.2)] ring-1 ring-[#00D9FF]/50"
                          : "border-gray-800/50 hover:border-[#00D9FF]/30 hover:shadow-[0_0_20px_rgba(0,217,255,0.05)]"
                      }`}
                    >
                      <CardContent className="p-6">
                        <div className="mb-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {isSelected && (
                                <div className="w-5 h-5 rounded-full bg-[#00D9FF] flex items-center justify-center flex-shrink-0">
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
                          <p className="text-gray-400 text-sm mb-3 line-clamp-2">
                            {project.description}
                          </p>
                          <p className="text-xs text-gray-500">
                            Modified {getRelativeTime(project.updated_at)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              handleOpenProject(project.id, project.name)
                            }
                            className={`flex-1 ${
                              isSelected
                                ? "bg-[#00D9FF]/30 text-[#00D9FF] border border-[#00D9FF]/50"
                                : "bg-[#00D9FF]/10 hover:bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30 hover:border-[#00D9FF]/50"
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
                            className="border-gray-700 hover:border-red-500 hover:text-red-400 bg-transparent"
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

          {/* Recent Activity Sidebar */}
          {projects.length > 0 && (
            <div className="lg:col-span-1">
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Recent Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {activities.slice(0, 5).map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-800/30 transition-colors"
                      >
                        <div className="w-2 h-2 bg-[#00D9FF] rounded-full mt-2 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-200 line-clamp-1">
                            {activity.type === "created"
                              ? "Created"
                              : "Updated"}{" "}
                            {activity.projectName}
                          </p>
                          <p className="text-xs text-gray-500">
                            {getRelativeTime(activity.timestamp.toISOString())}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>

      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onConfirm={handleCreateProjectConfirm}
        isLoading={createProject.isPending}
      />

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

      {/* Onboarding Components */}
      <WelcomeModal />
      {showTutorialOverlay && <TutorialOverlay />}
      <QuickStartChecklist />
      <FirstProjectWizard
        open={showFirstProjectWizard}
        onOpenChange={setShowFirstProjectWizard}
      />

      {/* Early Access Welcome Modal */}
      <EarlyAccessWelcomeModal
        open={showEarlyAccessWelcome}
        onClose={() => setShowEarlyAccessWelcome(false)}
        onShowExport={handleShowExport}
      />
    </div>
  );
}
