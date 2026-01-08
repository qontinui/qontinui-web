/**
 * Node Search Component
 *
 * Fuzzy search for nodes with keyboard navigation, quick add,
 * and search history. Supports Ctrl+K / Cmd+K shortcut.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { ActionType } from "@/lib/action-schema/action-types";
import { searchNodes, NODE_METADATA } from "./palette-config";
import { PaletteItem } from "./PaletteItem";
import { Search, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface NodeSearchProps {
  onSelect?: (nodeType: ActionType) => void;
  onClose?: () => void;
  autoFocus?: boolean;
  showHistory?: boolean;
  maxResults?: number;
  placeholder?: string;
  className?: string;
}

interface SearchHistoryEntry {
  query: string;
  timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_HISTORY_ITEMS = 10;
const SEARCH_DEBOUNCE_MS = 100;

// ============================================================================
// Local Storage Keys
// ============================================================================

const SEARCH_HISTORY_KEY = "qontinui-node-search-history";

// ============================================================================
// Component
// ============================================================================

export const NodeSearch: React.FC<NodeSearchProps> = ({
  onSelect,
  onClose,
  autoFocus = true,
  showHistory = true,
  maxResults = 20,
  placeholder = "Search nodes...",
  className,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(Object.values(NODE_METADATA));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Load search history from localStorage
  useEffect(() => {
    if (!showHistory) return;

    try {
      const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (stored) {
        const history: SearchHistoryEntry[] = JSON.parse(stored);
        setSearchHistory(history);
      }
    } catch (error) {
      console.error("Failed to load search history:", error);
    }
  }, [showHistory]);

  // Save to history
  const saveToHistory = useCallback(
    (searchQuery: string) => {
      if (!searchQuery.trim() || !showHistory) return;

      setSearchHistory((prev) => {
        // Remove existing entry if present
        const filtered = prev.filter((entry) => entry.query !== searchQuery);

        // Add to front
        const newHistory = [
          { query: searchQuery, timestamp: Date.now() },
          ...filtered,
        ].slice(0, MAX_HISTORY_ITEMS);

        // Persist to localStorage
        try {
          localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
        } catch (error) {
          console.error("Failed to save search history:", error);
        }

        return newHistory;
      });
    },
    [showHistory]
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      const searchResults = searchNodes(query).slice(0, maxResults);
      setResults(searchResults);
      setSelectedIndex(0);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, maxResults]);

  // Auto-focus input
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;

        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;

        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex].type);
          }
          break;

        case "Escape":
          e.preventDefault();
          if (query) {
            setQuery("");
          } else if (onClose) {
            onClose();
          }
          break;

        case "Tab":
          // Allow tab to cycle through results
          e.preventDefault();
          if (e.shiftKey) {
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
          } else {
            setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [results, selectedIndex, query, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selectedElement = resultsRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      );
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [selectedIndex]);

  const handleSelect = (nodeType: ActionType) => {
    if (query.trim()) {
      saveToHistory(query);
    }
    if (onSelect) {
      onSelect(nodeType);
    }
    setQuery("");
    setSelectedIndex(0);
  };

  const handleHistorySelect = (historyQuery: string) => {
    setQuery(historyQuery);
    setShowHistoryDropdown(false);
    inputRef.current?.focus();
  };

  const clearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem(SEARCH_HISTORY_KEY);
  };

  const handleInputFocus = () => {
    if (!query && searchHistory.length > 0) {
      setShowHistoryDropdown(true);
    }
  };

  const handleInputBlur = () => {
    // Delay to allow clicking on history items
    setTimeout(() => setShowHistoryDropdown(false), 200);
  };

  return (
    <div className={cn("node-search", className)}>
      {/* Search Input */}
      <div className="node-search__input-wrapper">
        <Search className="node-search__search-icon h-5 w-5 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          className="node-search__input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
        />
        {query && (
          <button
            className="node-search__clear-btn"
            onClick={() => setQuery("")}
            title="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Search History Dropdown */}
      {showHistoryDropdown && searchHistory.length > 0 && (
        <div className="node-search__history-dropdown">
          <div className="node-search__history-header">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-text-muted" />
              <span className="text-sm font-medium text-text-secondary">
                Recent Searches
              </span>
            </div>
            <button
              className="text-xs text-text-muted hover:text-text-secondary"
              onClick={clearHistory}
            >
              Clear
            </button>
          </div>
          <div className="node-search__history-list">
            {searchHistory.map((entry, index) => (
              <button
                key={`${entry.query}-${index}`}
                className="node-search__history-item"
                onClick={() => handleHistorySelect(entry.query)}
              >
                <Search className="h-3 w-3 text-text-muted" />
                <span>{entry.query}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      <div className="node-search__results" ref={resultsRef}>
        {results.length > 0 ? (
          <>
            <div className="node-search__results-header">
              <span className="text-sm text-text-muted">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
              {query && (
                <span className="text-xs text-text-muted">
                  for &quot;{query}&quot;
                </span>
              )}
            </div>
            <div className="node-search__results-list">
              {results.map((metadata, index) => (
                <div
                  key={metadata.type}
                  data-index={index}
                  className={cn(
                    "node-search__result-item",
                    selectedIndex === index &&
                      "node-search__result-item--selected"
                  )}
                  onClick={() => handleSelect(metadata.type)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <PaletteItem
                    metadata={metadata}
                    onAdd={handleSelect}
                    showCategory={true}
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="node-search__empty">
            <Search className="h-12 w-12 text-text-secondary" />
            <p className="text-text-muted">No nodes found</p>
            {query && (
              <p className="text-sm text-text-muted">
                Try a different search term
              </p>
            )}
          </div>
        )}
      </div>

      {/* Keyboard Hints */}
      <div className="node-search__hints">
        <div className="node-search__hint">
          <kbd>↑↓</kbd> Navigate
        </div>
        <div className="node-search__hint">
          <kbd>Enter</kbd> Select
        </div>
        <div className="node-search__hint">
          <kbd>Esc</kbd> {query ? "Clear" : "Close"}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Quick Search Modal
// ============================================================================

interface QuickSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (nodeType: ActionType) => void;
}

export const QuickSearchModal: React.FC<QuickSearchModalProps> = ({
  isOpen,
  onClose,
  onSelect,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K to open
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (!isOpen) {
          // Would trigger open in parent
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="quick-search-modal" onClick={onClose}>
      <div
        className="quick-search-modal__content"
        onClick={(e) => e.stopPropagation()}
      >
        <NodeSearch
          onSelect={(nodeType) => {
            onSelect(nodeType);
            onClose();
          }}
          onClose={onClose}
          autoFocus={true}
          showHistory={true}
          maxResults={30}
        />
      </div>
    </div>
  );
};

// ============================================================================
// Global Search Shortcut Hook
// ============================================================================

export function useNodeSearchShortcut(
  onOpen: () => void,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        onOpen();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onOpen, enabled]);
}

export default NodeSearch;
