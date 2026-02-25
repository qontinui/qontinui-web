"use client";

import { useRunnerQuery } from "../api-client";
import type {
  LibraryItem,
  Check,
  CheckGroup,
  Macro,
  PromptSnippet,
  PlaywrightScript,
  SavedApiRequest,
  SavedPrompt,
} from "../types/library";
import type { ContextItem } from "../types/exploration";
import type { ShellCommand } from "../types/execution";

export function useLibraryItems() {
  return useRunnerQuery<LibraryItem[]>("/library/items");
}

export function usePlaywrightScripts() {
  return useRunnerQuery<LibraryItem[]>("/playwright-scripts");
}

export function useSavedApiRequests() {
  return useRunnerQuery<LibraryItem[]>("/saved-api-requests");
}

export function useChecks() {
  return useRunnerQuery<Check[]>("/checks");
}

export function useContexts() {
  return useRunnerQuery<LibraryItem[]>("/contexts");
}

export function useContextsDetailed() {
  return useRunnerQuery<ContextItem[]>("/contexts");
}

export function useScripts() {
  return useRunnerQuery<LibraryItem[]>("/scripts");
}

export function useShellCommands() {
  return useRunnerQuery<ShellCommand[]>("/shell-commands");
}

export function usePlaywrightScriptsDetailed() {
  return useRunnerQuery<PlaywrightScript[]>("/playwright/tests");
}

export function useSavedApiRequestsDetailed() {
  return useRunnerQuery<SavedApiRequest[]>("/saved-api-requests");
}

export function usePromptsDetailed() {
  return useRunnerQuery<SavedPrompt[]>("/prompts");
}

export function useCheckGroups() {
  return useRunnerQuery<CheckGroup[]>("/check-groups");
}

export function useCheck(id: string | null) {
  return useRunnerQuery<Check>(id ? `/checks/${id}` : null, { enabled: !!id });
}

export function useCheckGroup(id: string | null) {
  return useRunnerQuery<CheckGroup>(id ? `/check-groups/${id}` : null, {
    enabled: !!id,
  });
}

export function useShellCommand(id: string | null) {
  return useRunnerQuery<ShellCommand>(id ? `/shell-commands/${id}` : null, {
    enabled: !!id,
  });
}

export function useMacros() {
  return useRunnerQuery<LibraryItem[]>("/macros");
}

export function useTests() {
  return useRunnerQuery<LibraryItem[]>("/tests");
}

export function usePrompts() {
  return useRunnerQuery<LibraryItem[]>("/prompts");
}

export function usePromptSnippets() {
  return useRunnerQuery<LibraryItem[]>("/prompt-snippets");
}

export function useMacrosDetailed() {
  return useRunnerQuery<Macro[]>("/macros");
}

export function useMacro(id: string | null) {
  return useRunnerQuery<Macro>(id ? `/macros/${id}` : null, { enabled: !!id });
}

export function usePromptSnippetsDetailed() {
  return useRunnerQuery<PromptSnippet[]>("/prompt-snippets");
}

export function usePromptSnippetDetailed(id: string | null) {
  return useRunnerQuery<PromptSnippet>(id ? `/prompt-snippets/${id}` : null, {
    enabled: !!id,
  });
}

export function useCheckGroupChecks(groupId: string | null) {
  return useRunnerQuery<Check[]>(
    groupId ? `/check-groups/${groupId}/checks` : null,
    {
      enabled: !!groupId,
    }
  );
}
