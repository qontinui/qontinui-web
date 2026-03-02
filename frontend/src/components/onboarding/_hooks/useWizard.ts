"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCreateProject } from "@/hooks/use-projects";
import { toast } from "sonner";
import { TOTAL_STEPS, DEFAULT_WIZARD_STATE, type WizardState } from "../types";

const STORAGE_KEY = "first-project-wizard-state";

export function useWizard(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onComplete?: () => void
) {
  const router = useRouter();
  const createProject = useCreateProject();

  const [currentStep, setCurrentStep] = useState(1);
  const [wizardState, setWizardState] =
    useState<WizardState>(DEFAULT_WIZARD_STATE);

  useEffect(() => {
    if (open && typeof window !== "undefined") {
      const savedState = localStorage.getItem(STORAGE_KEY);
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState);
          setWizardState(parsed.wizardState || DEFAULT_WIZARD_STATE);
          setCurrentStep(parsed.currentStep || 1);
        } catch (e) {
          console.error("Failed to parse saved wizard state:", e);
        }
      }
    }
  }, [open]);

  useEffect(() => {
    if (open && typeof window !== "undefined") {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ currentStep, wizardState })
      );
    }
  }, [currentStep, wizardState, open]);

  const updateState = useCallback((updates: Partial<WizardState>) => {
    setWizardState((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep === 2 && !wizardState.projectName.trim()) {
      toast.error("Please enter a project name");
      return;
    }
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep, wizardState.projectName]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const handleCreateProject = useCallback(
    async (config?: {
      name: string;
      description: string;
      template: string;
    }) => {
      try {
        const projectConfig = config || {
          name: wizardState.projectName || "My First Automation",
          description:
            wizardState.projectDescription ||
            "Created with First Project Wizard",
          template: wizardState.selectedTemplate,
        };

        const newProject = await createProject.mutateAsync({
          name: projectConfig.name,
          description: projectConfig.description,
          configuration: {
            template: projectConfig.template,
            useCase: wizardState.useCase,
            isFirstProject: true,
          },
        });

        if (typeof window !== "undefined") {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.setItem("hasCreatedFirstProject", "true");
        }

        onOpenChange(false);

        if (onComplete) {
          onComplete();
        }

        toast.success("Project created successfully!");
        router.push(`/automation-builder?project=${newProject.id}`);
      } catch (error: unknown) {
        console.error("Failed to create project:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to create project"
        );
      }
    },
    [wizardState, createProject, onOpenChange, onComplete, router]
  );

  const handleSkip = useCallback(() => {
    handleCreateProject({
      name: "My First Automation",
      description: "Getting started with Qontinui",
      template: "blank",
    });
  }, [handleCreateProject]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleOpenProject = useCallback(() => {
    handleCreateProject();
  }, [handleCreateProject]);

  const handleWatchTutorial = useCallback(() => {
    handleCreateProject();
    toast.info("Tutorial feature coming soon!");
  }, [handleCreateProject]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;

      if (e.key === "Enter" && currentStep !== TOTAL_STEPS) {
        e.preventDefault();
        handleNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, currentStep, handleNext, handleClose]);

  const progressPercentage = (currentStep / TOTAL_STEPS) * 100;

  return {
    currentStep,
    wizardState,
    progressPercentage,
    isCreating: createProject.isPending,
    updateState,
    handleNext,
    handleBack,
    handleSkip,
    handleClose,
    handleOpenProject,
    handleWatchTutorial,
  };
}
