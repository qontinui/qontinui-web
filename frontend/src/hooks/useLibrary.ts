"use client";

/**
 * React Query hooks for library CRUD operations.
 *
 * Each library type gets: useXxxList, useXxx, useCreateXxx, useUpdateXxx, useDeleteXxx.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LibraryListParams, Pagination } from "@/services/library-service";
import {
  checksApi,
  checkGroupsApi,
  shellCommandsApi,
  apiRequestsApi,
  contextsApi,
  macrosApi,
  scriptletsApi,
} from "@/services/library-service";

// =============================================================================
// Query Key Factory
// =============================================================================

export const libraryKeys = {
  all: ["library"] as const,
  type: (t: string) => [...libraryKeys.all, t] as const,
  list: (t: string, params?: LibraryListParams) => [...libraryKeys.type(t), "list", params] as const,
  detail: (t: string, id: string) => [...libraryKeys.type(t), "detail", id] as const,
};

// =============================================================================
// Generic hook factory
// =============================================================================

interface CrudApi<T, TCreate, TUpdate, TList extends { items: T[]; pagination: Pagination }> {
  list: (params?: LibraryListParams) => Promise<TList>;
  get: (id: string) => Promise<T>;
  create: (data: TCreate) => Promise<T>;
  update: (id: string, data: TUpdate) => Promise<T>;
  delete: (id: string) => Promise<unknown>;
}

function useLibraryList<T, TCreate, TUpdate, TList extends { items: T[]; pagination: Pagination }>(
  type: string,
  api: CrudApi<T, TCreate, TUpdate, TList>,
  params?: LibraryListParams,
) {
  return useQuery({
    queryKey: libraryKeys.list(type, params),
    queryFn: async () => {
      const res = await api.list(params);
      return res.items;
    },
    staleTime: 30000,
  });
}

function useLibraryDetail<T, TCreate, TUpdate, TList extends { items: T[]; pagination: Pagination }>(
  type: string,
  api: CrudApi<T, TCreate, TUpdate, TList>,
  id: string | null,
) {
  return useQuery({
    queryKey: libraryKeys.detail(type, id ?? ""),
    queryFn: () => api.get(id!),
    enabled: !!id,
    staleTime: 10000,
  });
}

function useLibraryCreate<T, TCreate, TUpdate, TList extends { items: T[]; pagination: Pagination }>(
  type: string,
  api: CrudApi<T, TCreate, TUpdate, TList>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TCreate) => api.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.type(type) });
    },
  });
}

function useLibraryUpdate<T, TCreate, TUpdate, TList extends { items: T[]; pagination: Pagination }>(
  type: string,
  api: CrudApi<T, TCreate, TUpdate, TList>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TUpdate }) => api.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.type(type) });
    },
  });
}

function useLibraryDelete<T, TCreate, TUpdate, TList extends { items: T[]; pagination: Pagination }>(
  type: string,
  api: CrudApi<T, TCreate, TUpdate, TList>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.type(type) });
    },
  });
}

// =============================================================================
// Checks
// =============================================================================

export const useChecksList = (params?: LibraryListParams) =>
  useLibraryList("checks", checksApi, params);
export const useCheck = (id: string | null) =>
  useLibraryDetail("checks", checksApi, id);
export const useCreateCheck = () =>
  useLibraryCreate("checks", checksApi);
export const useUpdateCheck = () =>
  useLibraryUpdate("checks", checksApi);
export const useDeleteCheck = () =>
  useLibraryDelete("checks", checksApi);

// =============================================================================
// Check Groups
// =============================================================================

export const useCheckGroupsList = (params?: LibraryListParams) =>
  useLibraryList("check-groups", checkGroupsApi, params);
export const useCheckGroup = (id: string | null) =>
  useLibraryDetail("check-groups", checkGroupsApi, id);
export const useCreateCheckGroup = () =>
  useLibraryCreate("check-groups", checkGroupsApi);
export const useUpdateCheckGroup = () =>
  useLibraryUpdate("check-groups", checkGroupsApi);
export const useDeleteCheckGroup = () =>
  useLibraryDelete("check-groups", checkGroupsApi);

// =============================================================================
// Shell Commands
// =============================================================================

export const useShellCommandsList = (params?: LibraryListParams) =>
  useLibraryList("shell-commands", shellCommandsApi, params);
export const useShellCommand = (id: string | null) =>
  useLibraryDetail("shell-commands", shellCommandsApi, id);
export const useCreateShellCommand = () =>
  useLibraryCreate("shell-commands", shellCommandsApi);
export const useUpdateShellCommand = () =>
  useLibraryUpdate("shell-commands", shellCommandsApi);
export const useDeleteShellCommand = () =>
  useLibraryDelete("shell-commands", shellCommandsApi);

// =============================================================================
// Saved API Requests
// =============================================================================

export const useApiRequestsList = (params?: LibraryListParams) =>
  useLibraryList("api-requests", apiRequestsApi, params);
export const useApiRequest = (id: string | null) =>
  useLibraryDetail("api-requests", apiRequestsApi, id);
export const useCreateApiRequest = () =>
  useLibraryCreate("api-requests", apiRequestsApi);
export const useUpdateApiRequest = () =>
  useLibraryUpdate("api-requests", apiRequestsApi);
export const useDeleteApiRequest = () =>
  useLibraryDelete("api-requests", apiRequestsApi);

// =============================================================================
// Contexts
// =============================================================================

export const useContextsList = (params?: LibraryListParams) =>
  useLibraryList("contexts", contextsApi, params);
export const useContext = (id: string | null) =>
  useLibraryDetail("contexts", contextsApi, id);
export const useCreateContext = () =>
  useLibraryCreate("contexts", contextsApi);
export const useUpdateContext = () =>
  useLibraryUpdate("contexts", contextsApi);
export const useDeleteContext = () =>
  useLibraryDelete("contexts", contextsApi);

// =============================================================================
// Macros
// =============================================================================

export const useMacrosList = (params?: LibraryListParams) =>
  useLibraryList("macros", macrosApi, params);
export const useMacro = (id: string | null) =>
  useLibraryDetail("macros", macrosApi, id);
export const useCreateMacro = () =>
  useLibraryCreate("macros", macrosApi);
export const useUpdateMacro = () =>
  useLibraryUpdate("macros", macrosApi);
export const useDeleteMacro = () =>
  useLibraryDelete("macros", macrosApi);

// =============================================================================
// Scriptlets
// =============================================================================

export const useScriptletsList = (params?: LibraryListParams) =>
  useLibraryList("scriptlets", scriptletsApi, params);
export const useScriptlet = (id: string | null) =>
  useLibraryDetail("scriptlets", scriptletsApi, id);
export const useCreateScriptlet = () =>
  useLibraryCreate("scriptlets", scriptletsApi);
export const useUpdateScriptlet = () =>
  useLibraryUpdate("scriptlets", scriptletsApi);
export const useDeleteScriptlet = () =>
  useLibraryDelete("scriptlets", scriptletsApi);
