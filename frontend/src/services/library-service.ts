/**
 * Library service for backend CRUD operations on library items.
 *
 * Covers: checks, check groups, shell commands, saved API requests,
 * contexts, macros, and scriptlets.
 */

import { httpClient } from "@/services/service-factory";

const BASE = "/api/v1/library";

// =============================================================================
// Types
// =============================================================================

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface LibraryListParams {
  project_id?: string;
  search?: string;
  offset?: number;
  limit?: number;
}

// --- Check ---

export interface CheckItem {
  id: string;
  created_by_user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  check_type: string;
  tool: string | null;
  command: string | null;
  working_directory: string | null;
  config_path: string | null;
  auto_fix: boolean;
  fail_on_warning: boolean;
  is_critical: boolean;
  timeout_seconds: number;
  enabled: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface CheckListResponse {
  items: CheckItem[];
  pagination: Pagination;
}

export interface CheckCreate {
  name: string;
  description?: string | null;
  check_type?: string;
  tool?: string | null;
  command?: string | null;
  working_directory?: string | null;
  config_path?: string | null;
  auto_fix?: boolean;
  fail_on_warning?: boolean;
  is_critical?: boolean;
  timeout_seconds?: number;
  enabled?: boolean;
  tags?: string[];
  project_id?: string | null;
}
export type CheckUpdate = Partial<Omit<CheckCreate, "project_id">>;

// --- CheckGroup ---

export interface CheckGroupItem {
  id: string;
  created_by_user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  check_ids: string[];
  stop_on_failure: boolean;
  run_in_parallel: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface CheckGroupListResponse {
  items: CheckGroupItem[];
  pagination: Pagination;
}

export interface CheckGroupCreate {
  name: string;
  description?: string | null;
  check_ids?: string[];
  stop_on_failure?: boolean;
  run_in_parallel?: boolean;
  tags?: string[];
  project_id?: string | null;
}
export type CheckGroupUpdate = Partial<Omit<CheckGroupCreate, "project_id">>;

// --- ShellCommand ---

export interface ShellCommandItem {
  id: string;
  created_by_user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  command: string;
  working_directory: string | null;
  platform: string | null;
  timeout_seconds: number;
  fail_on_error: boolean;
  enabled: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ShellCommandListResponse {
  items: ShellCommandItem[];
  pagination: Pagination;
}

export interface ShellCommandCreate {
  name: string;
  description?: string | null;
  command: string;
  working_directory?: string | null;
  platform?: string | null;
  timeout_seconds?: number;
  fail_on_error?: boolean;
  enabled?: boolean;
  tags?: string[];
  project_id?: string | null;
}
export type ShellCommandUpdate = Partial<Omit<ShellCommandCreate, "project_id">>;

// --- SavedApiRequest ---

export interface SavedApiRequestItem {
  id: string;
  created_by_user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  content_type: string | null;
  follow_redirects: boolean;
  auth_config: Record<string, unknown> | null;
  variables: Record<string, string>;
  timeout_ms: number;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface SavedApiRequestListResponse {
  items: SavedApiRequestItem[];
  pagination: Pagination;
}

export interface SavedApiRequestCreate {
  name: string;
  description?: string | null;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  content_type?: string | null;
  follow_redirects?: boolean;
  auth_config?: Record<string, unknown> | null;
  variables?: Record<string, string>;
  timeout_ms?: number;
  tags?: string[];
  project_id?: string | null;
}
export type SavedApiRequestUpdate = Partial<Omit<SavedApiRequestCreate, "project_id">>;

// --- Context ---

export interface ContextItem {
  id: string;
  created_by_user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  content: string;
  category: string | null;
  scope: string | null;
  enabled: boolean;
  auto_include: Record<string, unknown> | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ContextListResponse {
  items: ContextItem[];
  pagination: Pagination;
}

export interface ContextCreate {
  name: string;
  description?: string | null;
  content: string;
  category?: string | null;
  scope?: string | null;
  enabled?: boolean;
  auto_include?: Record<string, unknown> | null;
  tags?: string[];
  project_id?: string | null;
}
export type ContextUpdate = Partial<Omit<ContextCreate, "project_id">>;

// --- Macro ---

export interface MacroStep {
  action_type: string;
  name?: string | null;
  target_image_ids?: string[];
  target_image_names?: string[];
  text_input?: string | null;
  hotkey?: string | null;
  target_state_ids?: string[];
  target_state_names?: string[];
  pause_after_ms?: number | null;
  timeout_seconds?: number | null;
}

export interface MacroItem {
  id: string;
  created_by_user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  category: string | null;
  steps: MacroStep[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface MacroListResponse {
  items: MacroItem[];
  pagination: Pagination;
}

export interface MacroCreate {
  name: string;
  description?: string | null;
  category?: string | null;
  steps?: MacroStep[];
  tags?: string[];
  project_id?: string | null;
}
export type MacroUpdate = Partial<Omit<MacroCreate, "project_id">>;

// --- Scriptlet ---

export interface ScriptletItem {
  id: string;
  created_by_user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  language: string;
  code: string;
  category: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ScriptletListResponse {
  items: ScriptletItem[];
  pagination: Pagination;
}

export interface ScriptletCreate {
  name: string;
  description?: string | null;
  language: string;
  code: string;
  category?: string | null;
  tags?: string[];
  project_id?: string | null;
}
export type ScriptletUpdate = Partial<Omit<ScriptletCreate, "project_id">>;

// =============================================================================
// Helper
// =============================================================================

function buildQuery(params?: LibraryListParams): string {
  if (!params) return "";
  const q = new URLSearchParams();
  if (params.project_id) q.set("project_id", params.project_id);
  if (params.search) q.set("search", params.search);
  if (params.offset !== undefined) q.set("offset", String(params.offset));
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

// =============================================================================
// Generic CRUD factory
// =============================================================================

function createCrud<T, TCreate, TUpdate, TList extends { items: T[]; pagination: Pagination }>(
  resource: string
) {
  return {
    list: (params?: LibraryListParams) =>
      httpClient.get<TList>(`${BASE}/${resource}${buildQuery(params)}`),
    get: (id: string) =>
      httpClient.get<T>(`${BASE}/${resource}/${id}`),
    create: (data: TCreate) =>
      httpClient.post<T>(`${BASE}/${resource}`, data),
    update: (id: string, data: TUpdate) =>
      httpClient.put<T>(`${BASE}/${resource}/${id}`, data),
    delete: (id: string) =>
      httpClient.delete(`${BASE}/${resource}/${id}`),
  };
}

// =============================================================================
// Exports
// =============================================================================

export const checksApi = createCrud<CheckItem, CheckCreate, CheckUpdate, CheckListResponse>("checks");
export const checkGroupsApi = createCrud<CheckGroupItem, CheckGroupCreate, CheckGroupUpdate, CheckGroupListResponse>("check-groups");
export const shellCommandsApi = createCrud<ShellCommandItem, ShellCommandCreate, ShellCommandUpdate, ShellCommandListResponse>("shell-commands");
export const apiRequestsApi = createCrud<SavedApiRequestItem, SavedApiRequestCreate, SavedApiRequestUpdate, SavedApiRequestListResponse>("api-requests");
export const contextsApi = createCrud<ContextItem, ContextCreate, ContextUpdate, ContextListResponse>("contexts");
export const macrosApi = createCrud<MacroItem, MacroCreate, MacroUpdate, MacroListResponse>("macros");
export const scriptletsApi = createCrud<ScriptletItem, ScriptletCreate, ScriptletUpdate, ScriptletListResponse>("scriptlets");
