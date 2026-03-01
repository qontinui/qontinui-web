import type { LocalStorageItem } from "@/hooks/useLocalStorageCrud";
import type { BuilderItem } from "@/components/builders/BuilderLayout";

export type ExplorationStrategy =
  | "exhaustive"
  | "smoke_test"
  | "regression"
  | "random_walk"
  | "targeted";

export interface ExplorationConfig {
  strategy: ExplorationStrategy;
  max_states: number;
  max_duration_seconds: number;
  target_state_ids: string[];
  target_transition_ids: string[];
  capture_screenshots: boolean;
  capture_transition_screenshots: boolean;
  state_delay_ms: number;
  stop_on_first_failure: boolean;
}

export interface SavedExplorationItem extends LocalStorageItem, BuilderItem {
  tags: string[];
  config: ExplorationConfig;
  run_count: number;
}

export interface ExplorationForm {
  name: string;
  description: string;
  tags: string[];
  strategy: ExplorationStrategy;
  max_states: number;
  max_duration_seconds: number;
  target_state_ids: string;
  target_transition_ids: string;
  capture_screenshots: boolean;
  capture_transition_screenshots: boolean;
  state_delay_ms: number;
  stop_on_first_failure: boolean;
}

export interface AvailableState {
  id: string;
  name: string;
  description?: string;
  is_initial?: boolean;
  is_final?: boolean;
}

export interface AvailableTransition {
  id: string;
  name: string;
  from_state: string;
  to_state: string;
}

export const STRATEGY_OPTIONS: {
  value: ExplorationStrategy;
  label: string;
  description: string;
  color: string;
}[] = [
  {
    value: "smoke_test",
    label: "Smoke Test",
    description: "Quick test of core paths",
    color: "text-yellow-400",
  },
  {
    value: "exhaustive",
    label: "Exhaustive",
    description: "Visit all states and transitions",
    color: "text-red-400",
  },
  {
    value: "regression",
    label: "Regression",
    description: "Focus on previously failing areas",
    color: "text-blue-400",
  },
  {
    value: "random_walk",
    label: "Random Walk",
    description: "Random exploration for edge cases",
    color: "text-purple-400",
  },
  {
    value: "targeted",
    label: "Targeted",
    description: "Focus on specific states/transitions",
    color: "text-emerald-400",
  },
];

export function toForm(item: SavedExplorationItem): ExplorationForm {
  return {
    name: item.name,
    description: item.description || "",
    tags: item.tags || [],
    strategy: item.config.strategy,
    max_states: item.config.max_states,
    max_duration_seconds: item.config.max_duration_seconds,
    target_state_ids: item.config.target_state_ids.join(", "),
    target_transition_ids: item.config.target_transition_ids.join(", "),
    capture_screenshots: item.config.capture_screenshots,
    capture_transition_screenshots: item.config.capture_transition_screenshots,
    state_delay_ms: item.config.state_delay_ms,
    stop_on_first_failure: item.config.stop_on_first_failure,
  };
}

export function defaultForm(): ExplorationForm {
  return {
    name: "",
    description: "",
    tags: [],
    strategy: "smoke_test",
    max_states: 0,
    max_duration_seconds: 300,
    target_state_ids: "",
    target_transition_ids: "",
    capture_screenshots: true,
    capture_transition_screenshots: false,
    state_delay_ms: 500,
    stop_on_first_failure: false,
  };
}

export function toPayload(
  form: ExplorationForm
): Record<string, unknown> {
  return {
    name: form.name,
    description: form.description || undefined,
    tags: form.tags,
    config: {
      strategy: form.strategy,
      max_states: form.max_states,
      max_duration_seconds: form.max_duration_seconds,
      target_state_ids: form.target_state_ids
        ? form.target_state_ids.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      target_transition_ids: form.target_transition_ids
        ? form.target_transition_ids.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      capture_screenshots: form.capture_screenshots,
      capture_transition_screenshots: form.capture_transition_screenshots,
      state_delay_ms: form.state_delay_ms,
      stop_on_first_failure: form.stop_on_first_failure,
    },
    run_count: 0,
  };
}
