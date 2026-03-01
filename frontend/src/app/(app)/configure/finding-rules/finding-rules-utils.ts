import {
  Bug,
  CheckSquare,
  Shield,
  Settings,
  CheckCircle,
  Info,
  Database,
  Activity,
  TestTube,
  Sparkles,
  FileText,
  Zap,
  AlertTriangle,
  Pencil,
  Lock,
  type LucideIcon,
} from "lucide-react";
import type { FindingCategoryActionType } from "@/lib/api-client";

// ─── Icon registry ──────────────────────────────────────────────────────────

export const ICON_MAP: Record<string, LucideIcon> = {
  Bug,
  CheckSquare,
  Shield,
  Settings,
  CheckCircle,
  Info,
  Database,
  Activity,
  TestTube,
  Sparkles,
  FileText,
  Zap,
  AlertTriangle,
  Pencil,
  Lock,
};

export const ICON_OPTIONS = Object.keys(ICON_MAP);

// ─── Color helpers ──────────────────────────────────────────────────────────

export const COLOR_OPTIONS = [
  "red",
  "amber",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "cyan",
  "slate",
];

export function getColorClasses(color: string) {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    red: {
      bg: "bg-red-500/10",
      text: "text-red-400",
      border: "border-red-500/30",
    },
    amber: {
      bg: "bg-amber-500/10",
      text: "text-amber-400",
      border: "border-amber-500/30",
    },
    orange: {
      bg: "bg-orange-500/10",
      text: "text-orange-400",
      border: "border-orange-500/30",
    },
    yellow: {
      bg: "bg-yellow-500/10",
      text: "text-yellow-400",
      border: "border-yellow-500/30",
    },
    green: {
      bg: "bg-green-500/10",
      text: "text-green-400",
      border: "border-green-500/30",
    },
    blue: {
      bg: "bg-blue-500/10",
      text: "text-blue-400",
      border: "border-blue-500/30",
    },
    purple: {
      bg: "bg-purple-500/10",
      text: "text-purple-400",
      border: "border-purple-500/30",
    },
    cyan: {
      bg: "bg-cyan-500/10",
      text: "text-cyan-400",
      border: "border-cyan-500/30",
    },
    slate: {
      bg: "bg-slate-500/10",
      text: "text-slate-400",
      border: "border-slate-500/30",
    },
  };
  return (
    map[color] || {
      bg: "bg-muted",
      text: "text-muted-foreground",
      border: "border-border",
    }
  );
}

// ─── Action type helpers ────────────────────────────────────────────────────

export const ACTION_TYPE_OPTIONS: {
  value: FindingCategoryActionType;
  label: string;
  description: string;
}[] = [
  {
    value: "auto_fix",
    label: "Auto Fix",
    description: "AI will attempt to fix automatically",
  },
  {
    value: "needs_user_input",
    label: "Needs User Input",
    description: "Requires user decision before acting",
  },
  { value: "manual", label: "Manual", description: "User must fix manually" },
  {
    value: "informational",
    label: "Informational",
    description: "Logged for awareness, no action needed",
  },
];

export function getActionTypeBadge(actionType: string) {
  switch (actionType) {
    case "auto_fix":
      return { label: "Auto Fix", variant: "success" as const };
    case "needs_user_input":
      return { label: "User Input", variant: "warning" as const };
    case "manual":
      return { label: "Manual", variant: "info" as const };
    case "informational":
      return { label: "Info", variant: "secondary" as const };
    default:
      return { label: actionType, variant: "outline" as const };
  }
}

// ─── Slug generator ─────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
