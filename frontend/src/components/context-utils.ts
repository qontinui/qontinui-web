import type { Context, ContextAutoInclude } from "@qontinui/schemas/config";
import { Eye, FormInput, GitBranch, MessageSquare } from "lucide-react";

// Predefined categories for contexts
export const CONTEXT_CATEGORIES = [
  "architecture",
  "debugging",
  "philosophy",
  "domain",
  "workflow",
  "testing",
  "security",
  "performance",
  "other",
] as const;

// Helper to generate context category colors using CSS variables
export function getCategoryColor(category: string | null | undefined): string {
  switch (category) {
    case "architecture":
      return "hsl(var(--brand-primary))";
    case "debugging":
      return "#FF6B6B";
    case "philosophy":
      return "hsl(var(--brand-secondary))";
    case "domain":
      return "hsl(var(--brand-success))";
    case "workflow":
      return "#FFB800";
    case "testing":
      return "#00BFFF";
    case "security":
      return "#FF4757";
    case "performance":
      return "#2ED573";
    default:
      return "#6B7280";
  }
}

// Helper to truncate content for preview
export function truncateContent(
  content: string,
  maxLength: number = 150
): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength).trim() + "...";
}

// Helper to count auto-include rules
export function countAutoIncludeRules(
  autoInclude: ContextAutoInclude | null | undefined
): number {
  if (!autoInclude) return 0;
  let count = 0;
  if (autoInclude.taskMentions?.length)
    count += autoInclude.taskMentions.length;
  if (autoInclude.actionTypes?.length) count += autoInclude.actionTypes.length;
  if (autoInclude.errorPatterns?.length)
    count += autoInclude.errorPatterns.length;
  if (autoInclude.filePatterns?.length)
    count += autoInclude.filePatterns.length;
  return count;
}

export interface ContextFormData {
  name: string;
  content: string;
  category: string;
  tags: string;
  taskMentions: string;
  actionTypes: string;
  errorPatterns: string;
  filePatterns: string;
}

export const emptyFormData: ContextFormData = {
  name: "",
  content: "",
  category: "",
  tags: "",
  taskMentions: "",
  actionTypes: "",
  errorPatterns: "",
  filePatterns: "",
};

export function contextToFormData(context: Context): ContextFormData {
  return {
    name: context.name,
    content: context.content,
    category: context.category || "",
    tags: context.tags?.join(", ") || "",
    taskMentions: context.autoInclude?.taskMentions?.join(", ") || "",
    actionTypes: context.autoInclude?.actionTypes?.join(", ") || "",
    errorPatterns: context.autoInclude?.errorPatterns?.join(", ") || "",
    filePatterns: context.autoInclude?.filePatterns?.join(", ") || "",
  };
}

export function formDataToContext(
  formData: ContextFormData,
  existingContext?: Context
): Context {
  const now = new Date().toISOString();
  const parseCommaSeparated = (value: string): string[] | undefined => {
    const items = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  };

  const autoInclude: ContextAutoInclude | undefined = {
    taskMentions: parseCommaSeparated(formData.taskMentions) ?? null,
    actionTypes: parseCommaSeparated(formData.actionTypes) ?? null,
    errorPatterns: parseCommaSeparated(formData.errorPatterns) ?? null,
    filePatterns: parseCommaSeparated(formData.filePatterns) ?? null,
  };

  // Only include autoInclude if at least one field has values
  const hasAutoIncludeRules =
    autoInclude.taskMentions ||
    autoInclude.actionTypes ||
    autoInclude.errorPatterns ||
    autoInclude.filePatterns;

  return {
    id: existingContext?.id || crypto.randomUUID(),
    name: formData.name.trim(),
    content: formData.content,
    category: formData.category || null,
    tags: parseCommaSeparated(formData.tags),
    autoInclude: hasAutoIncludeRules ? autoInclude : null,
    createdAt: existingContext?.createdAt || now,
    modifiedAt: now,
  };
}

// Use cases for inline AI actions in GUI automation
export const AI_ACTION_USE_CASES = [
  {
    icon: GitBranch,
    title: "Dynamic Decision Making",
    description:
      "AI decides the next action based on current screen state (e.g., handling different dialog types, choosing branches).",
    example:
      "If there's a captcha, solve it. If there's an error, extract the message and decide how to proceed.",
  },
  {
    icon: Eye,
    title: "Unstructured Data Extraction",
    description:
      "Read and interpret variable text from the screen that can't be captured with fixed selectors.",
    example:
      "Extract order confirmation number, shipping date, and total from a receipt screenshot.",
  },
  {
    icon: MessageSquare,
    title: "Handling Unpredictable UI States",
    description:
      "When the application can be in many possible states and model-based navigation isn't practical.",
    example:
      "Navigate to user settings by analyzing the current screen and determining what to click.",
  },
  {
    icon: FormInput,
    title: "Context-Aware Form Filling",
    description:
      "Fill forms where field values require understanding context from the screen or external data.",
    example:
      "Based on customer data and visible form fields, determine appropriate values considering labels and validation hints.",
  },
];
