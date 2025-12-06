/**
 * Global Search Service
 *
 * Provides comprehensive search functionality across all resources in the application.
 * Supports fuzzy matching, search operators, filtering, and recent search history.
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  State,
  Transition,
  ImageAsset,
} from "@/contexts/automation-context/types";
import type { WorkflowFolder } from "@/types/workflow-organization/types";

// ============================================================================
// Search Types
// ============================================================================

export type ResourceType =
  | "workflow"
  | "state"
  | "image"
  | "transition"
  | "folder"
  | "action"
  | "component"
  | "test"
  | "documentation";

export interface SearchFilter {
  types?: ResourceType[];
  folders?: string[];
  tags?: string[];
  dateRange?: {
    from: Date;
    to: Date;
  };
}

export interface SearchMatch {
  field: string;
  value: string;
  matchedText: string;
  score: number;
}

export interface SearchResultItem {
  id: string;
  type: ResourceType;
  name: string;
  description?: string;
  icon?: string;
  breadcrumb?: string[];
  matches: SearchMatch[];
  score: number;
  metadata?: Record<string, any>;
  resource?: any; // Original resource object
}

export interface SearchResults {
  items: SearchResultItem[];
  totalCount: number;
  countByType: Record<ResourceType, number>;
  query: string;
  filters: SearchFilter;
}

export interface RecentSearch {
  query: string;
  filters: SearchFilter;
  timestamp: Date;
}

export interface SearchOperator {
  key: string;
  value: string;
}

// ============================================================================
// Search Index
// ============================================================================

class SearchIndex {
  private workflows: Map<string, Workflow> = new Map();
  private states: Map<string, State> = new Map();
  private images: Map<string, ImageAsset> = new Map();
  private transitions: Map<string, Transition> = new Map();
  private folders: Map<string, WorkflowFolder> = new Map();

  updateWorkflows(workflows: Workflow[]): void {
    this.workflows.clear();
    workflows.forEach((wf) => this.workflows.set(wf.id, wf));
  }

  updateStates(states: State[]): void {
    this.states.clear();
    states.forEach((s) => this.states.set(s.id, s));
  }

  updateImages(images: ImageAsset[]): void {
    this.images.clear();
    images.forEach((img) => this.images.set(img.id, img));
  }

  updateTransitions(transitions: Transition[]): void {
    this.transitions.clear();
    transitions.forEach((t) => this.transitions.set(t.id, t));
  }

  updateFolders(folders: WorkflowFolder[]): void {
    this.folders.clear();
    folders.forEach((f) => this.folders.set(f.id, f));
  }

  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  getAllStates(): State[] {
    return Array.from(this.states.values());
  }

  getAllImages(): ImageAsset[] {
    return Array.from(this.images.values());
  }

  getAllTransitions(): Transition[] {
    return Array.from(this.transitions.values());
  }

  getAllFolders(): WorkflowFolder[] {
    return Array.from(this.folders.values());
  }

  clear(): void {
    this.workflows.clear();
    this.states.clear();
    this.images.clear();
    this.transitions.clear();
    this.folders.clear();
  }
}

// ============================================================================
// Search Service
// ============================================================================

class GlobalSearchService {
  private index = new SearchIndex();
  private recentSearches: RecentSearch[] = [];
  private readonly RECENT_SEARCHES_KEY = "qontinui-recent-searches";
  private readonly MAX_RECENT_SEARCHES = 10;
  private readonly MAX_RESULTS_PER_TYPE = 20;

  constructor() {
    this.loadRecentSearches();
  }

  // ============================================================================
  // Index Management
  // ============================================================================

  updateIndex(data: {
    workflows?: Workflow[];
    states?: State[];
    images?: ImageAsset[];
    transitions?: Transition[];
    folders?: WorkflowFolder[];
  }): void {
    if (data.workflows) this.index.updateWorkflows(data.workflows);
    if (data.states) this.index.updateStates(data.states);
    if (data.images) this.index.updateImages(data.images);
    if (data.transitions) this.index.updateTransitions(data.transitions);
    if (data.folders) this.index.updateFolders(data.folders);
  }

  clearIndex(): void {
    this.index.clear();
  }

  // ============================================================================
  // Search Methods
  // ============================================================================

  async searchAll(
    query: string,
    filters: SearchFilter = {}
  ): Promise<SearchResults> {
    const { operators, cleanQuery } = this.parseSearchQuery(query);

    // Apply operators to filters
    const mergedFilters = this.applyOperators(operators, filters);

    const allResults: SearchResultItem[] = [];
    const countByType: Record<ResourceType, number> = {
      workflow: 0,
      state: 0,
      image: 0,
      transition: 0,
      folder: 0,
      action: 0,
      component: 0,
      test: 0,
      documentation: 0,
    };

    // Determine which types to search
    const typesToSearch =
      mergedFilters.types && mergedFilters.types.length > 0
        ? mergedFilters.types
        : ([
            "workflow",
            "state",
            "image",
            "transition",
            "folder",
          ] as ResourceType[]);

    // Search each enabled type
    for (const type of typesToSearch) {
      let results: SearchResultItem[] = [];

      switch (type) {
        case "workflow":
          results = await this.searchWorkflows(cleanQuery);
          break;
        case "state":
          results = await this.searchStates(cleanQuery);
          break;
        case "image":
          results = await this.searchImages(cleanQuery);
          break;
        case "transition":
          results = await this.searchTransitions(cleanQuery);
          break;
        case "folder":
          results = await this.searchFolders(cleanQuery);
          break;
        case "action":
          results = await this.searchActions(cleanQuery);
          break;
      }

      allResults.push(...results);
      countByType[type] = results.length;
    }

    // Sort by score
    allResults.sort((a, b) => b.score - a.score);

    return {
      items: allResults,
      totalCount: allResults.length,
      countByType,
      query,
      filters: mergedFilters,
    };
  }

  async searchWorkflows(
    query: string
  ): Promise<SearchResultItem[]> {
    const workflows = this.index.getAllWorkflows();
    const results: SearchResultItem[] = [];

    for (const workflow of workflows) {
      const matches: SearchMatch[] = [];
      let score = 0;

      // Search in name
      const nameMatch = this.fuzzyMatch(query, workflow.name);
      if (nameMatch.score > 0) {
        matches.push({
          field: "name",
          value: workflow.name,
          matchedText: nameMatch.matchedText,
          score: nameMatch.score * 2, // Name matches weighted higher
        });
        score += nameMatch.score * 2;
      }

      // Search in description
      if (workflow.description) {
        const descMatch = this.fuzzyMatch(query, workflow.description);
        if (descMatch.score > 0) {
          matches.push({
            field: "description",
            value: workflow.description,
            matchedText: descMatch.matchedText,
            score: descMatch.score,
          });
          score += descMatch.score;
        }
      }

      // Search in category
      if (workflow.category) {
        const catMatch = this.fuzzyMatch(query, workflow.category);
        if (catMatch.score > 0) {
          matches.push({
            field: "category",
            value: workflow.category,
            matchedText: catMatch.matchedText,
            score: catMatch.score,
          });
          score += catMatch.score;
        }
      }

      // Search in action names
      for (const action of workflow.actions) {
        if (action.name) {
          const actionMatch = this.fuzzyMatch(query, action.name);
          if (actionMatch.score > 0) {
            matches.push({
              field: "action",
              value: action.name,
              matchedText: actionMatch.matchedText,
              score: actionMatch.score * 0.5,
            });
            score += actionMatch.score * 0.5;
          }
        }
      }

      // Search by ID (exact match)
      if (workflow.id.toLowerCase().includes(query.toLowerCase())) {
        matches.push({
          field: "id",
          value: workflow.id,
          matchedText: workflow.id,
          score: 10,
        });
        score += 10;
      }

      if (matches.length > 0) {
        results.push({
          id: workflow.id,
          type: "workflow",
          name: workflow.name,
          description: workflow.description,
          breadcrumb: workflow.category ? [workflow.category] : undefined,
          matches,
          score,
          metadata: {
            category: workflow.category,
            actionCount: workflow.actions.length,
            version: workflow.version,
          },
          resource: workflow,
        });
      }
    }

    // Sort by score and limit results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, this.MAX_RESULTS_PER_TYPE);
  }

  async searchStates(
    query: string
  ): Promise<SearchResultItem[]> {
    const states = this.index.getAllStates();
    const results: SearchResultItem[] = [];

    for (const state of states) {
      const matches: SearchMatch[] = [];
      let score = 0;

      // Search in name
      const nameMatch = this.fuzzyMatch(query, state.name);
      if (nameMatch.score > 0) {
        matches.push({
          field: "name",
          value: state.name,
          matchedText: nameMatch.matchedText,
          score: nameMatch.score * 2,
        });
        score += nameMatch.score * 2;
      }

      // Search in description
      if (state.description) {
        const descMatch = this.fuzzyMatch(query, state.description);
        if (descMatch.score > 0) {
          matches.push({
            field: "description",
            value: state.description,
            matchedText: descMatch.matchedText,
            score: descMatch.score,
          });
          score += descMatch.score;
        }
      }

      // Search in ID
      if (state.id.toLowerCase().includes(query.toLowerCase())) {
        matches.push({
          field: "id",
          value: state.id,
          matchedText: state.id,
          score: 10,
        });
        score += 10;
      }

      if (matches.length > 0) {
        results.push({
          id: state.id,
          type: "state",
          name: state.name,
          description: state.description,
          matches,
          score,
          metadata: {
            imageCount: state.stateImages.length,
            regionCount: state.regions.length,
            isInitial: state.initial,
          },
          resource: state,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, this.MAX_RESULTS_PER_TYPE);
  }

  async searchImages(
    query: string
  ): Promise<SearchResultItem[]> {
    const images = this.index.getAllImages();
    const results: SearchResultItem[] = [];

    for (const image of images) {
      const matches: SearchMatch[] = [];
      let score = 0;

      // Search in name/filename
      const nameMatch = this.fuzzyMatch(query, image.name);
      if (nameMatch.score > 0) {
        matches.push({
          field: "name",
          value: image.name,
          matchedText: nameMatch.matchedText,
          score: nameMatch.score * 2,
        });
        score += nameMatch.score * 2;
      }

      // Search in ID
      if (image.id.toLowerCase().includes(query.toLowerCase())) {
        matches.push({
          field: "id",
          value: image.id,
          matchedText: image.id,
          score: 10,
        });
        score += 10;
      }

      // Search in source
      if (image.source) {
        const sourceMatch = this.fuzzyMatch(query, image.source);
        if (sourceMatch.score > 0) {
          matches.push({
            field: "source",
            value: image.source,
            matchedText: sourceMatch.matchedText,
            score: sourceMatch.score * 0.5,
          });
          score += sourceMatch.score * 0.5;
        }
      }

      if (matches.length > 0) {
        results.push({
          id: image.id,
          type: "image",
          name: image.name,
          matches,
          score,
          metadata: {
            source: image.source,
            usageCount: image.usageCount,
            size: image.size,
            createdAt: image.createdAt,
          },
          resource: image,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, this.MAX_RESULTS_PER_TYPE);
  }

  async searchTransitions(
    query: string
  ): Promise<SearchResultItem[]> {
    const transitions = this.index.getAllTransitions();
    const results: SearchResultItem[] = [];

    for (const transition of transitions) {
      const matches: SearchMatch[] = [];
      let score = 0;

      // Search in ID
      if (transition.id.toLowerCase().includes(query.toLowerCase())) {
        matches.push({
          field: "id",
          value: transition.id,
          matchedText: transition.id,
          score: 10,
        });
        score += 10;
      }

      // Search in state names
      if (transition.type === "OutgoingTransition") {
        const fromMatch = this.fuzzyMatch(query, transition.fromState);
        if (fromMatch.score > 0) {
          matches.push({
            field: "fromState",
            value: transition.fromState,
            matchedText: fromMatch.matchedText,
            score: fromMatch.score,
          });
          score += fromMatch.score;
        }

        if (transition.toState) {
          const toMatch = this.fuzzyMatch(query, transition.toState);
          if (toMatch.score > 0) {
            matches.push({
              field: "toState",
              value: transition.toState,
              matchedText: toMatch.matchedText,
              score: toMatch.score,
            });
            score += toMatch.score;
          }
        }
      } else if (transition.type === "IncomingTransition") {
        const toMatch = this.fuzzyMatch(query, transition.toState);
        if (toMatch.score > 0) {
          matches.push({
            field: "toState",
            value: transition.toState,
            matchedText: toMatch.matchedText,
            score: toMatch.score,
          });
          score += toMatch.score;
        }
      }

      if (matches.length > 0) {
        const name =
          transition.type === "OutgoingTransition"
            ? `${transition.fromState} → ${transition.toState || "Unknown"}`
            : `→ ${transition.toState}`;

        results.push({
          id: transition.id,
          type: "transition",
          name,
          matches,
          score,
          metadata: {
            type: transition.type,
            workflowCount: transition.workflows.length,
          },
          resource: transition,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, this.MAX_RESULTS_PER_TYPE);
  }

  async searchFolders(
    query: string
  ): Promise<SearchResultItem[]> {
    const folders = this.index.getAllFolders();
    const results: SearchResultItem[] = [];

    for (const folder of folders) {
      const matches: SearchMatch[] = [];
      let score = 0;

      // Search in name
      const nameMatch = this.fuzzyMatch(query, folder.name);
      if (nameMatch.score > 0) {
        matches.push({
          field: "name",
          value: folder.name,
          matchedText: nameMatch.matchedText,
          score: nameMatch.score * 2,
        });
        score += nameMatch.score * 2;
      }

      // Search in description
      if (folder.description) {
        const descMatch = this.fuzzyMatch(query, folder.description);
        if (descMatch.score > 0) {
          matches.push({
            field: "description",
            value: folder.description,
            matchedText: descMatch.matchedText,
            score: descMatch.score,
          });
          score += descMatch.score;
        }
      }

      if (matches.length > 0) {
        results.push({
          id: folder.id,
          type: "folder",
          name: folder.name,
          description: folder.description,
          icon: folder.icon,
          matches,
          score,
          metadata: {
            workflowCount: folder.metadata.workflowCount,
            color: folder.color,
          },
          resource: folder,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, this.MAX_RESULTS_PER_TYPE);
  }

  async searchActions(
    query: string
  ): Promise<SearchResultItem[]> {
    const workflows = this.index.getAllWorkflows();
    const results: SearchResultItem[] = [];

    for (const workflow of workflows) {
      for (const action of workflow.actions) {
        const matches: SearchMatch[] = [];
        let score = 0;

        // Search in action name
        if (action.name) {
          const nameMatch = this.fuzzyMatch(query, action.name);
          if (nameMatch.score > 0) {
            matches.push({
              field: "name",
              value: action.name,
              matchedText: nameMatch.matchedText,
              score: nameMatch.score * 2,
            });
            score += nameMatch.score * 2;
          }
        }

        // Search in action type
        const typeMatch = this.fuzzyMatch(query, action.type);
        if (typeMatch.score > 0) {
          matches.push({
            field: "type",
            value: action.type,
            matchedText: typeMatch.matchedText,
            score: typeMatch.score,
          });
          score += typeMatch.score;
        }

        if (matches.length > 0) {
          results.push({
            id: action.id,
            type: "action",
            name: action.name || action.type,
            breadcrumb: [workflow.name],
            matches,
            score,
            metadata: {
              actionType: action.type,
              workflowId: workflow.id,
              workflowName: workflow.name,
            },
            resource: action,
          });
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, this.MAX_RESULTS_PER_TYPE);
  }

  async searchComponents(
    query: string,
    filters: SearchFilter = {}
  ): Promise<SearchResultItem[]> {
    // Placeholder for component search
    // This would search through reusable workflow components
    return [];
  }

  async searchTests(
    query: string,
    filters: SearchFilter = {}
  ): Promise<SearchResultItem[]> {
    // Placeholder for test search
    // This would search through test cases
    return [];
  }

  async searchDocumentation(
    query: string,
    filters: SearchFilter = {}
  ): Promise<SearchResultItem[]> {
    // Placeholder for documentation search
    // This would search through markdown documentation files
    return [];
  }

  // ============================================================================
  // Recent Searches
  // ============================================================================

  saveRecentSearch(query: string, filters: SearchFilter = {}): void {
    // Remove existing entry if it exists
    this.recentSearches = this.recentSearches.filter(
      (s) =>
        s.query !== query ||
        JSON.stringify(s.filters) !== JSON.stringify(filters)
    );

    // Add new entry at the beginning
    this.recentSearches.unshift({
      query,
      filters,
      timestamp: new Date(),
    });

    // Limit to max recent searches
    this.recentSearches = this.recentSearches.slice(
      0,
      this.MAX_RECENT_SEARCHES
    );

    // Save to localStorage
    this.persistRecentSearches();
  }

  getRecentSearches(): RecentSearch[] {
    return this.recentSearches;
  }

  clearRecentSearches(): void {
    this.recentSearches = [];
    this.persistRecentSearches();
  }

  private loadRecentSearches(): void {
    if (typeof window === "undefined") return;

    try {
      const stored = localStorage.getItem(this.RECENT_SEARCHES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.recentSearches = parsed.map((s: any) => ({
          ...s,
          timestamp: new Date(s.timestamp),
        }));
      }
    } catch (error) {
      console.error("Failed to load recent searches:", error);
    }
  }

  private persistRecentSearches(): void {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(
        this.RECENT_SEARCHES_KEY,
        JSON.stringify(this.recentSearches)
      );
    } catch (error) {
      console.error("Failed to persist recent searches:", error);
    }
  }

  // ============================================================================
  // Search Operators & Syntax
  // ============================================================================

  private parseSearchQuery(query: string): {
    operators: SearchOperator[];
    cleanQuery: string;
  } {
    const operators: SearchOperator[] = [];
    let cleanQuery = query;

    // Match patterns like "type:workflow", "tag:login", "folder:Main"
    const operatorPattern = /(\w+):("([^"]+)"|(\S+))/g;
    const matches = Array.from(query.matchAll(operatorPattern));

    for (const match of matches) {
      const key = match[1] ?? "";
      const value = match[3] || match[4] || ""; // Quoted or unquoted value

      if (key && value) {
        operators.push({ key, value });
      }

      // Remove operator from clean query
      cleanQuery = cleanQuery.replace(match[0], "").trim();
    }

    return { operators, cleanQuery };
  }

  private applyOperators(
    operators: SearchOperator[],
    baseFilters: SearchFilter
  ): SearchFilter {
    const filters = { ...baseFilters };

    for (const op of operators) {
      switch (op.key) {
        case "type":
          filters.types = filters.types || [];
          if (!filters.types.includes(op.value as ResourceType)) {
            filters.types.push(op.value as ResourceType);
          }
          break;

        case "folder":
          filters.folders = filters.folders || [];
          if (!filters.folders.includes(op.value)) {
            filters.folders.push(op.value);
          }
          break;

        case "tag":
          filters.tags = filters.tags || [];
          if (!filters.tags.includes(op.value)) {
            filters.tags.push(op.value);
          }
          break;
      }
    }

    return filters;
  }

  // ============================================================================
  // Fuzzy Matching
  // ============================================================================

  private fuzzyMatch(
    query: string,
    text: string
  ): { score: number; matchedText: string } {
    if (!query || !text) {
      return { score: 0, matchedText: "" };
    }

    const lowerQuery = query.toLowerCase();
    const lowerText = text.toLowerCase();

    // Exact match (highest score)
    if (lowerText === lowerQuery) {
      return { score: 100, matchedText: text };
    }

    // Starts with query (high score)
    if (lowerText.startsWith(lowerQuery)) {
      return { score: 80, matchedText: text.substring(0, query.length) };
    }

    // Contains query as substring (medium score)
    if (lowerText.includes(lowerQuery)) {
      const index = lowerText.indexOf(lowerQuery);
      return {
        score: 60,
        matchedText: text.substring(index, index + query.length),
      };
    }

    // Fuzzy match (character by character)
    let score = 0;
    let textIndex = 0;
    let matchedText = "";
    let matchStart = -1;

    for (let queryIndex = 0; queryIndex < lowerQuery.length; queryIndex++) {
      const queryChar = lowerQuery[queryIndex];
      let found = false;

      while (textIndex < lowerText.length) {
        if (lowerText[textIndex] === queryChar) {
          if (matchStart === -1) matchStart = textIndex;
          found = true;
          textIndex++;

          // Award points for consecutive matches
          if (queryIndex > 0 && textIndex === matchStart + queryIndex + 1) {
            score += 2;
          } else {
            score += 1;
          }
          break;
        }
        textIndex++;
      }

      if (!found) {
        return { score: 0, matchedText: "" };
      }
    }

    // Calculate final score based on match quality
    if (matchStart === 0) {
      score *= 2; // Bonus for matching at start
    }

    const matchLength = textIndex - matchStart;
    const matchRatio = query.length / matchLength;
    score *= matchRatio;

    // Normalize score to 0-100
    score = Math.min(Math.max(score * 2, 1), 50);

    matchedText = text.substring(matchStart, textIndex);

    return { score, matchedText };
  }

  // ============================================================================
  // Search Aliases
  // ============================================================================

  private expandAlias(query: string): string {
    const aliases: Record<string, string> = {
      wf: "workflow",
      st: "state",
      img: "image",
      tr: "transition",
      fl: "folder",
    };

    const words = query.split(" ");
    return words.map((word) => aliases[word.toLowerCase()] || word).join(" ");
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const globalSearchService = new GlobalSearchService();
