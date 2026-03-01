import type { LogSourceCategory } from "@/lib/runner-api";

export const CATEGORIES: {
  value: LogSourceCategory;
  label: string;
  color: string;
}[] = [
  { value: "frontend", label: "Frontend", color: "#3b82f6" },
  { value: "backend", label: "Backend", color: "#22c55e" },
  { value: "api", label: "API", color: "#06b6d4" },
  { value: "mobile", label: "Mobile", color: "#f97316" },
  { value: "database", label: "Database", color: "#8b5cf6" },
  { value: "build", label: "Build", color: "#eab308" },
  { value: "testing", label: "Testing", color: "#ec4899" },
  { value: "runner", label: "Runner", color: "#f97316" },
  { value: "general", label: "General", color: "#6b7280" },
];

export function getCategoryColor(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.color || "#6b7280";
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
