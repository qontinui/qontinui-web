"use client";

import { useRunnerQuery } from "../api-client";
import { useRunnerTarget } from "@/contexts/active-runner-context";
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
  return useRunnerQuery<LibraryItem[]>(useRunnerTarget(), "/library/items");
}

export function usePlaywrightScripts() {
  return useRunnerQuery<LibraryItem[]>(
    useRunnerTarget(),
    "/playwright-scripts"
  );
}

export function useSavedApiRequests() {
  return useRunnerQuery<LibraryItem[]>(
    useRunnerTarget(),
    "/saved-api-requests"
  );
}

export function useChecks() {
  return useRunnerQuery<Check[]>(useRunnerTarget(), "/checks");
}

export function useContexts() {
  return useRunnerQuery<LibraryItem[]>(useRunnerTarget(), "/contexts");
}

export function useContextsDetailed() {
  return useRunnerQuery<ContextItem[]>(useRunnerTarget(), "/contexts");
}

export function useScripts() {
  return useRunnerQuery<LibraryItem[]>(useRunnerTarget(), "/scripts");
}

export function useShellCommands() {
  return useRunnerQuery<ShellCommand[]>(useRunnerTarget(), "/shell-commands");
}

export function usePlaywrightScriptsDetailed() {
  return useRunnerQuery<PlaywrightScript[]>(
    useRunnerTarget(),
    "/playwright/tests"
  );
}

export function useSavedApiRequestsDetailed() {
  return useRunnerQuery<SavedApiRequest[]>(
    useRunnerTarget(),
    "/saved-api-requests"
  );
}

export function usePromptsDetailed() {
  return useRunnerQuery<SavedPrompt[]>(useRunnerTarget(), "/prompts");
}

export function useCheckGroups() {
  return useRunnerQuery<CheckGroup[]>(useRunnerTarget(), "/check-groups");
}

export function useCheck(id: string | null) {
  return useRunnerQuery<Check>(useRunnerTarget(), id ? `/checks/${id}` : null, {
    enabled: !!id,
  });
}

export function useCheckGroup(id: string | null) {
  return useRunnerQuery<CheckGroup>(
    useRunnerTarget(),
    id ? `/check-groups/${id}` : null,
    {
      enabled: !!id,
    }
  );
}

export function useShellCommand(id: string | null) {
  return useRunnerQuery<ShellCommand>(
    useRunnerTarget(),
    id ? `/shell-commands/${id}` : null,
    {
      enabled: !!id,
    }
  );
}

export function useMacros() {
  return useRunnerQuery<LibraryItem[]>(useRunnerTarget(), "/macros");
}

export function useTests() {
  return useRunnerQuery<LibraryItem[]>(useRunnerTarget(), "/tests");
}

export function usePrompts() {
  return useRunnerQuery<LibraryItem[]>(useRunnerTarget(), "/prompts");
}

export function usePromptSnippets() {
  return useRunnerQuery<LibraryItem[]>(useRunnerTarget(), "/prompt-snippets");
}

export function useMacrosDetailed() {
  return useRunnerQuery<Macro[]>(useRunnerTarget(), "/macros");
}

export function useMacro(id: string | null) {
  return useRunnerQuery<Macro>(useRunnerTarget(), id ? `/macros/${id}` : null, {
    enabled: !!id,
  });
}

export function usePromptSnippetsDetailed() {
  return useRunnerQuery<PromptSnippet[]>(useRunnerTarget(), "/prompt-snippets");
}

export function usePromptSnippetDetailed(id: string | null) {
  return useRunnerQuery<PromptSnippet>(
    useRunnerTarget(),
    id ? `/prompt-snippets/${id}` : null,
    {
      enabled: !!id,
    }
  );
}

export function useCheckGroupChecks(groupId: string | null) {
  return useRunnerQuery<Check[]>(
    useRunnerTarget(),
    groupId ? `/check-groups/${groupId}/checks` : null,
    {
      enabled: !!groupId,
    }
  );
}
