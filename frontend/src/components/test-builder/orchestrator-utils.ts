import type { OrchestratorPhase } from "./_types/orchestrator-types";

export const PHASES: {
  key: OrchestratorPhase;
  label: string;
  number: number;
}[] = [
  { key: "selection", label: "Select", number: 1 },
  { key: "planning", label: "Plan", number: 2 },
  { key: "execution", label: "Execute", number: 3 },
  { key: "generation", label: "Generate", number: 4 },
];

export function formatValue(value: unknown, maxLength: number): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  let str: string;
  if (typeof value === "string") {
    str = `"${value}"`;
  } else if (typeof value === "object") {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }

  if (str.length > maxLength) {
    return str.slice(0, maxLength) + "...";
  }
  return str;
}

export function formatJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}
