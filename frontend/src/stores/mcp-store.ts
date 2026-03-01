/**
 * MCP Store - State management for AI workflow generation
 *
 * Manages:
 * - Generation state and history
 * - Suggestions
 * - Action search
 * - MCP server connection
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  getMCPClient,
  type ActionResult,
  type GeneratedWorkflow,
  type GenerationContext,
  type RefinementFeedback,
  type WorkflowSuggestion,
} from "../services/mcp-client";
import type { Workflow } from "../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface MCPState {
  // Connection
  isConnected: boolean;
  serverVersion: string | null;
  capabilities: string[];

  // Generation
  isGenerating: boolean;
  generatedWorkflow: GeneratedWorkflow | null;
  generationHistory: GeneratedWorkflow[];
  generationError: string | null;

  // Refinement
  isRefining: boolean;
  refinementError: string | null;

  // Suggestions
  suggestions: WorkflowSuggestion[];
  activeSuggestion: WorkflowSuggestion | null;
  isFetchingSuggestions: boolean;
  suggestionsError: string | null;

  // Search
  searchResults: ActionResult[];
  isSearching: boolean;
  searchError: string | null;
  lastSearchQuery: string;

  // UI State
  showGenerationDialog: boolean;
  showSuggestionsPanel: boolean;
  showExplanationPanel: boolean;
  showActionSearch: boolean;
}

export interface MCPActions {
  // Connection
  checkConnection: () => Promise<void>;
  disconnect: () => void;

  // Generation
  generateWorkflow: (
    description: string,
    context?: GenerationContext
  ) => Promise<void>;
  refineWorkflow: (
    workflow: Workflow,
    feedback: string | RefinementFeedback
  ) => Promise<void>;
  acceptGenerated: () => Workflow | null;
  rejectGenerated: () => void;
  clearGeneration: () => void;

  // Suggestions
  getSuggestions: (workflow: Workflow) => Promise<void>;
  applySuggestion: (
    workflow: Workflow,
    suggestion: WorkflowSuggestion
  ) => Promise<Workflow>;
  dismissSuggestion: (suggestionId: string) => void;
  clearSuggestions: () => void;

  // Search
  searchActions: (query: string, limit?: number) => Promise<void>;
  clearSearch: () => void;

  // UI
  openGenerationDialog: () => void;
  closeGenerationDialog: () => void;
  toggleSuggestionsPanel: () => void;
  toggleExplanationPanel: () => void;
  toggleActionSearch: () => void;
}

export type MCPStore = MCPState & MCPActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: MCPState = {
  // Connection
  isConnected: false,
  serverVersion: null,
  capabilities: [],

  // Generation
  isGenerating: false,
  generatedWorkflow: null,
  generationHistory: [],
  generationError: null,

  // Refinement
  isRefining: false,
  refinementError: null,

  // Suggestions
  suggestions: [],
  activeSuggestion: null,
  isFetchingSuggestions: false,
  suggestionsError: null,

  // Search
  searchResults: [],
  isSearching: false,
  searchError: null,
  lastSearchQuery: "",

  // UI State
  showGenerationDialog: false,
  showSuggestionsPanel: false,
  showExplanationPanel: false,
  showActionSearch: false,
};

// ============================================================================
// Store
// ============================================================================

export const useMCPStore = create<MCPStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ======================================================================
      // Connection
      // ======================================================================

      checkConnection: async () => {
        try {
          const mcpClient = getMCPClient();
          const health = await mcpClient.healthCheck();

          set({
            isConnected: health.available,
            serverVersion: health.version || null,
            capabilities: health.capabilities || [],
          });
        } catch (error) {
          console.error("MCP health check failed:", error);
          set({
            isConnected: false,
            serverVersion: null,
            capabilities: [],
          });
        }
      },

      disconnect: () => {
        set({
          isConnected: false,
          serverVersion: null,
          capabilities: [],
        });
      },

      // ======================================================================
      // Generation
      // ======================================================================

      generateWorkflow: async (
        description: string,
        context?: GenerationContext
      ) => {
        set({
          isGenerating: true,
          generationError: null,
          generatedWorkflow: null,
        });

        try {
          const mcpClient = getMCPClient();
          const result = await mcpClient.generateWorkflow(description, context);

          set((state) => ({
            isGenerating: false,
            generatedWorkflow: result,
            generationHistory: [result, ...state.generationHistory].slice(
              0,
              10
            ), // Keep last 10
          }));
        } catch (error) {
          console.error("Workflow generation failed:", error);
          set({
            isGenerating: false,
            generationError:
              error instanceof Error ? error.message : "Generation failed",
          });
        }
      },

      refineWorkflow: async (
        workflow: Workflow,
        feedback: string | RefinementFeedback
      ) => {
        set({
          isRefining: true,
          refinementError: null,
        });

        try {
          const mcpClient = getMCPClient();
          const result = await mcpClient.refineWorkflow(workflow, feedback);

          set((state) => ({
            isRefining: false,
            generatedWorkflow: result,
            generationHistory: [result, ...state.generationHistory].slice(
              0,
              10
            ),
          }));
        } catch (error) {
          console.error("Workflow refinement failed:", error);
          set({
            isRefining: false,
            refinementError:
              error instanceof Error ? error.message : "Refinement failed",
          });
        }
      },

      acceptGenerated: () => {
        const { generatedWorkflow } = get();
        if (!generatedWorkflow) return null;

        set({
          generatedWorkflow: null,
          showGenerationDialog: false,
        });

        return generatedWorkflow.workflow;
      },

      rejectGenerated: () => {
        set({
          generatedWorkflow: null,
          generationError: null,
        });
      },

      clearGeneration: () => {
        set({
          generatedWorkflow: null,
          generationHistory: [],
          generationError: null,
          isGenerating: false,
          isRefining: false,
          refinementError: null,
        });
      },

      // ======================================================================
      // Suggestions
      // ======================================================================

      getSuggestions: async (workflow: Workflow) => {
        set({
          isFetchingSuggestions: true,
          suggestionsError: null,
        });

        try {
          const mcpClient = getMCPClient();
          const results = await mcpClient.getSuggestions(workflow);

          set({
            isFetchingSuggestions: false,
            suggestions: results,
          });
        } catch (error) {
          console.error("Failed to fetch suggestions:", error);
          set({
            isFetchingSuggestions: false,
            suggestionsError:
              error instanceof Error
                ? error.message
                : "Failed to fetch suggestions",
          });
        }
      },

      applySuggestion: async (
        workflow: Workflow,
        suggestion: WorkflowSuggestion
      ) => {
        try {
          const mcpClient = getMCPClient();
          const updatedWorkflow = await mcpClient.applySuggestion(
            workflow,
            suggestion
          );

          // Remove applied suggestion
          set((state) => ({
            suggestions: state.suggestions.filter(
              (s) => s.id !== suggestion.id
            ),
          }));

          return updatedWorkflow;
        } catch (error) {
          console.error("Failed to apply suggestion:", error);
          throw error;
        }
      },

      dismissSuggestion: (suggestionId: string) => {
        set((state) => ({
          suggestions: state.suggestions.filter((s) => s.id !== suggestionId),
        }));
      },

      clearSuggestions: () => {
        set({
          suggestions: [],
          activeSuggestion: null,
          suggestionsError: null,
        });
      },

      // ======================================================================
      // Search
      // ======================================================================

      searchActions: async (query: string, limit = 10) => {
        set({
          isSearching: true,
          searchError: null,
          lastSearchQuery: query,
        });

        try {
          const mcpClient = getMCPClient();
          const results = await mcpClient.searchActions(query, { limit });

          set({
            isSearching: false,
            searchResults: results,
          });
        } catch (error) {
          console.error("Action search failed:", error);
          set({
            isSearching: false,
            searchError:
              error instanceof Error ? error.message : "Search failed",
            searchResults: [],
          });
        }
      },

      clearSearch: () => {
        set({
          searchResults: [],
          searchError: null,
          lastSearchQuery: "",
        });
      },

      // ======================================================================
      // UI
      // ======================================================================

      openGenerationDialog: () => {
        set({ showGenerationDialog: true });
      },

      closeGenerationDialog: () => {
        set({ showGenerationDialog: false });
      },

      toggleSuggestionsPanel: () => {
        set((state) => ({ showSuggestionsPanel: !state.showSuggestionsPanel }));
      },

      toggleExplanationPanel: () => {
        set((state) => ({ showExplanationPanel: !state.showExplanationPanel }));
      },

      toggleActionSearch: () => {
        set((state) => ({ showActionSearch: !state.showActionSearch }));
      },
    }),
    { name: "MCPStore" }
  )
);

// ============================================================================
// Selectors
// ============================================================================

/**
 * Check if MCP features are available
 */
export const useMCPAvailable = () => {
  const isConnected = useMCPStore((state) => state.isConnected);
  return isConnected;
};

/**
 * Get current generation state
 */
export const useGenerationState = () => {
  return useMCPStore((state) => ({
    isGenerating: state.isGenerating,
    isRefining: state.isRefining,
    result: state.generatedWorkflow,
    error: state.generationError || state.refinementError,
  }));
};

/**
 * Get suggestions count
 */
export const useSuggestionsCount = () => {
  return useMCPStore((state) => state.suggestions.length);
};

/**
 * Get high-impact suggestions
 */
export const useHighImpactSuggestions = () => {
  return useMCPStore((state) =>
    state.suggestions.filter((s) => s.impact === "high")
  );
};
