import type { LucideIcon } from "lucide-react";

export interface FirstProjectWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export interface WizardState {
  projectName: string;
  projectDescription: string;
  selectedTemplate: "blank" | "civ6" | "clicker";
  useCase: "testing" | "development" | "productivity" | "exploring";
}

export interface TemplateOption {
  id: "blank" | "civ6" | "clicker";
  name: string;
  description: string;
  icon: LucideIcon;
}

export const TOTAL_STEPS = 5;

export const DEFAULT_WIZARD_STATE: WizardState = {
  projectName: "",
  projectDescription: "",
  selectedTemplate: "blank",
  useCase: "development",
};

export type TutorialPlacement = "top" | "bottom" | "left" | "right" | "auto";

export interface TutorialStep {
  target: string;
  title: string;
  description: string;
  placement?: TutorialPlacement;
}

export interface SpotlightPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TooltipPosition {
  top: number;
  left: number;
  placement: "top" | "bottom" | "left" | "right";
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    target: '[data-tour="projects"]',
    title: "Your Projects",
    description:
      "All your automation projects live here. Click to open or create new ones.",
    placement: "bottom",
  },
  {
    target: '[data-tour="new-project"]',
    title: "Create Project",
    description: "Start by creating your first automation project.",
    placement: "bottom",
  },
  {
    target: '[data-tour="quick-start"]',
    title: "Quick Start Guide",
    description: "Follow this checklist to build your first automation.",
    placement: "left",
  },
  {
    target: '[data-tour="documentation"]',
    title: "Documentation",
    description: "Need help? Access docs and tutorials anytime.",
    placement: "bottom",
  },
  {
    target: '[data-tour="profile"]',
    title: "Your Profile",
    description: "Manage settings, subscription, and account info.",
    placement: "bottom",
  },
];

export const SPOTLIGHT_PADDING = 8;
export const TOOLTIP_OFFSET = 20;
export const ANIMATION_DURATION = 300;
