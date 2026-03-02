import { useEffect, useState } from "react";
import {
  workflowRepository,
  stateRepository,
  transitionRepository,
  imageRepository,
} from "@/lib/repositories";
import type {
  State,
  Transition,
  ImageAsset,
} from "@/contexts/automation-context/types";
import type { WorkflowWithProject } from "../types";
import { toast } from "sonner";

export function useWorkflowData(user: unknown) {
  const [workflows, setWorkflows] = useState<WorkflowWithProject[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [, setTransitions] = useState<Transition[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null
  );
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [loadedWorkflows, loadedStates, loadedTransitions, loadedImages] =
          await Promise.all([
            workflowRepository.getAll(),
            stateRepository.getAll(),
            transitionRepository.getAll(),
            imageRepository.getAll(),
          ]);

        setWorkflows(loadedWorkflows as Array<WorkflowWithProject>);
        setStates(loadedStates);
        setTransitions(loadedTransitions);
        setImages(loadedImages);

        const projectNames = Array.from(
          new Set([
            ...loadedWorkflows
              .map((w: unknown) => (w as { projectName?: string }).projectName)
              .filter(Boolean),
            ...loadedStates.map((s) => s.projectName).filter(Boolean),
            ...loadedImages
              .map((img) => (img as { projectName?: string }).projectName)
              .filter(Boolean),
          ])
        ) as string[];
        setProjects(projectNames);

        if (loadedWorkflows.length > 0 && !selectedWorkflowId) {
          setSelectedWorkflowId(loadedWorkflows[0]?.id || null);
        }

        toast.success(`Loaded ${loadedWorkflows.length} workflow(s)`);
      } catch (error) {
        console.error("Error loading data:", error);
        toast.error("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const filteredWorkflows =
    selectedProject === "all"
      ? workflows
      : workflows.filter((w) => w.projectName === selectedProject);

  const selectedWorkflow = filteredWorkflows.find(
    (w) => w.id === selectedWorkflowId
  );

  return {
    workflows: filteredWorkflows,
    states,
    images,
    projects,
    selectedWorkflowId,
    setSelectedWorkflowId,
    selectedProject,
    setSelectedProject,
    selectedWorkflow,
    loading,
  };
}
