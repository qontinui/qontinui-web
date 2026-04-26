/**
 * React Query hooks for the wrapper marketplace.
 *
 * Mirrors the pattern used by useCodePackages.ts: a single query-key factory,
 * one hook per query, mutations that invalidate the right slices of the cache
 * after they succeed.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteRating,
  fetchWrapper,
  fetchWrappers,
  submitComment,
  submitRating,
  type ListWrappersParams,
  type WrapperComment,
  type WrapperEntryWithComments,
  type WrapperListResponse,
  type WrapperRatingResponse,
} from "./_api";

export const wrapperKeys = {
  all: ["wrappers"] as const,
  lists: () => [...wrapperKeys.all, "list"] as const,
  list: (params: ListWrappersParams | undefined) =>
    [...wrapperKeys.lists(), { params: params ?? {} }] as const,
  details: () => [...wrapperKeys.all, "detail"] as const,
  detail: (id: string) => [...wrapperKeys.details(), id] as const,
};

export function useWrappers(params?: ListWrappersParams) {
  return useQuery<WrapperListResponse>({
    queryKey: wrapperKeys.list(params),
    queryFn: () => fetchWrappers(params),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useWrapper(id: string, enabled = true) {
  return useQuery<WrapperEntryWithComments>({
    queryKey: wrapperKeys.detail(id),
    queryFn: () => fetchWrapper(id),
    enabled: enabled && !!id,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useSubmitWrapperRating(id: string) {
  const qc = useQueryClient();
  return useMutation<WrapperRatingResponse, Error, number>({
    mutationFn: (stars: number) => submitRating(id, stars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wrapperKeys.detail(id) });
      qc.invalidateQueries({ queryKey: wrapperKeys.lists() });
    },
  });
}

export function useDeleteWrapperRating(id: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => deleteRating(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wrapperKeys.detail(id) });
      qc.invalidateQueries({ queryKey: wrapperKeys.lists() });
    },
  });
}

export interface SubmitCommentVars {
  body: string;
  parentId?: number;
}

export function useSubmitWrapperComment(id: string) {
  const qc = useQueryClient();
  return useMutation<WrapperComment, Error, SubmitCommentVars>({
    mutationFn: ({ body, parentId }) => submitComment(id, body, parentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wrapperKeys.detail(id) });
    },
  });
}
