import type { McpServer } from "@/lib/runner-api";

export interface ServerFormData {
  name: string;
  description: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  cwd: string;
  url: string;
  headers: string;
  timeout_seconds: number;
  enabled: boolean;
  auto_start: boolean;
}

export const EMPTY_FORM: ServerFormData = {
  name: "",
  description: "",
  transport: "stdio",
  command: "",
  args: "",
  cwd: "",
  url: "",
  headers: "",
  timeout_seconds: 30,
  enabled: true,
  auto_start: false,
};

export function serverToFormData(server: McpServer): ServerFormData {
  return {
    name: server.name,
    description: server.description ?? "",
    transport: server.transport,
    command: server.command ?? "",
    args: (server.args ?? []).join("\n"),
    cwd: server.cwd ?? "",
    url: server.url ?? "",
    headers:
      Object.keys(server.headers ?? {}).length > 0
        ? JSON.stringify(server.headers, null, 2)
        : "",
    timeout_seconds: server.timeout_seconds ?? 30,
    enabled: server.enabled,
    auto_start: server.auto_start,
  };
}

export function formDataToPayload(form: ServerFormData): Omit<McpServer, "id"> {
  const args = form.args
    .split("\n")
    .map((a) => a.trim())
    .filter(Boolean);

  let headers: Record<string, string> = {};
  if (form.headers.trim()) {
    try {
      headers = JSON.parse(form.headers);
    } catch {
      // Try key:value per line format
      headers = {};
      for (const line of form.headers.split("\n")) {
        const idx = line.indexOf(":");
        if (idx > 0) {
          headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
    }
  }

  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    transport: form.transport,
    command: form.transport === "stdio" ? form.command.trim() || null : null,
    args: form.transport === "stdio" ? args : [],
    cwd: form.transport === "stdio" ? form.cwd.trim() || null : null,
    url: form.transport === "http" ? form.url.trim() || null : null,
    headers: form.transport === "http" ? headers : {},
    timeout_seconds: form.timeout_seconds,
    enabled: form.enabled,
    auto_start: form.auto_start,
  };
}
