import type { CheckItem, CheckCreate, CheckGroupItem, CheckGroupCreate } from "@/services/library-service";

export interface CheckForm {
  name: string;
  description: string;
  check_type: string;
  tool: string;
  command: string;
  working_directory: string;
  config_path: string;
  auto_fix: boolean;
  fail_on_warning: boolean;
  is_critical: boolean;
  timeout_seconds: number;
  enabled: boolean;
  tags: string[];
  ai_generated: boolean;
}

export function toCheckForm(item: CheckItem): CheckForm {
  return {
    name: item.name,
    description: item.description || "",
    check_type: item.check_type,
    tool: item.tool || "custom",
    command: item.command || "",
    working_directory: item.working_directory || "",
    config_path: item.config_path || "",
    auto_fix: item.auto_fix,
    fail_on_warning: item.fail_on_warning,
    is_critical: item.is_critical,
    timeout_seconds: item.timeout_seconds,
    enabled: item.enabled,
    tags: item.tags || [],
    ai_generated: false,
  };
}

export function defaultCheckForm(): CheckForm {
  return {
    name: "",
    description: "",
    check_type: "linter",
    tool: "custom",
    command: "",
    working_directory: "",
    config_path: "",
    auto_fix: false,
    fail_on_warning: false,
    is_critical: false,
    timeout_seconds: 300,
    enabled: true,
    tags: [],
    ai_generated: false,
  };
}

export function toCheckPayload(form: CheckForm): CheckCreate {
  return {
    name: form.name,
    description: form.description || null,
    check_type: form.check_type,
    tool: form.tool || null,
    command: form.command || null,
    working_directory: form.working_directory || null,
    config_path: form.config_path || null,
    auto_fix: form.auto_fix,
    fail_on_warning: form.fail_on_warning,
    is_critical: form.is_critical,
    timeout_seconds: form.timeout_seconds,
    enabled: form.enabled,
    tags: form.tags,
  };
}

export interface CheckGroupForm {
  name: string;
  description: string;
  check_ids: string[];
  stop_on_failure: boolean;
  run_in_parallel: boolean;
  tags: string[];
}

export function toGroupForm(item: CheckGroupItem): CheckGroupForm {
  return {
    name: item.name,
    description: item.description || "",
    check_ids: item.check_ids || [],
    stop_on_failure: item.stop_on_failure,
    run_in_parallel: item.run_in_parallel,
    tags: item.tags || [],
  };
}

export function defaultGroupForm(): CheckGroupForm {
  return {
    name: "",
    description: "",
    check_ids: [],
    stop_on_failure: true,
    run_in_parallel: false,
    tags: [],
  };
}

export function toGroupPayload(form: CheckGroupForm): CheckGroupCreate {
  return {
    name: form.name,
    description: form.description || null,
    check_ids: form.check_ids,
    stop_on_failure: form.stop_on_failure,
    run_in_parallel: form.run_in_parallel,
    tags: form.tags,
  };
}

export interface SuggestedCheck {
  name: string;
  check_type: string;
  tool: string;
  command: string;
  description: string;
  reason?: string;
}

export type TabId = "checks" | "groups";
