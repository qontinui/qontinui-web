import type { LucideIcon } from "lucide-react";

export interface TestForm {
  name: string;
  description: string;
  test_type: string;
  code: string;
  url: string;
  tags: string[];
}

export type EditorTab = "editor" | "analyzer" | "orchestrator" | "spec";

export interface TestTypeConfig {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly language: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly badgeClasses: string;
  readonly dotClass: string;
  readonly devOnly?: boolean;
}

export interface AiTemplate {
  label: string;
  prompt: string;
}

export interface EditorTabConfig {
  id: EditorTab;
  label: string;
  icon: LucideIcon;
}
