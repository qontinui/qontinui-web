import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAutomation } from "@/contexts/automation-context";
import { useProjects, useCreateProject } from "@/hooks/use-projects";
import { getProjectLoader } from "@/lib/project";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";

const logger = createLogger("UnifiedSidebar");

export function useSidebarProjects(propProjectId?: string | null) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    projectId: contextProjectId,
    setProjectId: setContextProjectId,
    setProjectName,
  } = useAutomation();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const createProject = useCreateProject();

  const projectId =
    propProjectId ?? searchParams?.get("project") ?? contextProjectId ?? null;

  const currentProject = projects.find((p) => p.id === projectId) ?? null;

  const handleProjectChange = useCallback(
    async (newProjectId: string) => {
      const loader = getProjectLoader();
      const success = await loader.load(newProjectId, {
        currentProjectId: contextProjectId,
      });

      if (!success) {
        toast.error("Failed to load project");
        return;
      }

      const newProject = projects.find((p) => p.id === newProjectId);
      setContextProjectId(newProjectId);
      if (newProject) {
        setProjectName(newProject.name);
      }
      const url = new URL(window.location.href);
      url.searchParams.set("project", newProjectId);
      router.push(url.pathname + url.search);
    },
    [contextProjectId, projects, setContextProjectId, setProjectName, router]
  );

  const handleCreateProject = useCallback(async () => {
    try {
      const newProject = await createProject.mutateAsync({
        name: `New Automation ${new Date().toLocaleDateString()}`,
        description: "A new automation workflow",
        configuration: {},
      });
      handleProjectChange(newProject.id);
      toast.success("Project created successfully");
    } catch (error: unknown) {
      logger.error("Failed to create project:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to create project"
      );
    }
  }, [createProject, handleProjectChange]);

  return {
    projectId,
    projects,
    currentProject,
    projectsLoading,
    handleProjectChange,
    handleCreateProject,
  };
}
