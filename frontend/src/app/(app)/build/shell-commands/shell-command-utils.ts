import type { ShellCommandItem, ShellCommandCreate } from "@/services/library-service";
import type { LucideIcon } from "lucide-react";

export interface CommandTemplate {
  name: string;
  command: string;
  description: string;
}

export interface CommandCategory {
  value: string;
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  commands: CommandTemplate[];
}

export interface ShellCommandForm {
  name: string;
  description: string;
  command: string;
  working_directory: string;
  platform: string;
  timeout_seconds: number;
  fail_on_error: boolean;
  enabled: boolean;
  tags: string[];
}

export function toForm(item: ShellCommandItem): ShellCommandForm {
  return {
    name: item.name,
    description: item.description || "",
    command: item.command,
    working_directory: item.working_directory || "",
    platform: item.platform || "any",
    timeout_seconds: item.timeout_seconds,
    fail_on_error: item.fail_on_error,
    enabled: item.enabled,
    tags: item.tags || [],
  };
}

export function defaultForm(): ShellCommandForm {
  return {
    name: "",
    description: "",
    command: "",
    working_directory: "",
    platform: "any",
    timeout_seconds: 300,
    fail_on_error: true,
    enabled: true,
    tags: [],
  };
}

export function toPayload(form: ShellCommandForm): ShellCommandCreate {
  return {
    name: form.name,
    description: form.description || null,
    command: form.command,
    working_directory: form.working_directory || null,
    platform: form.platform === "any" ? null : form.platform,
    timeout_seconds: form.timeout_seconds,
    fail_on_error: form.fail_on_error,
    enabled: form.enabled,
    tags: form.tags,
  };
}
