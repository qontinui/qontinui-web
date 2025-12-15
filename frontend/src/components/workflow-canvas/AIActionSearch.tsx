/**
 * AI Action Search - Natural language action search
 *
 * Features:
 * - Semantic search (not just keyword matching)
 * - Top 5 matches with confidence scores
 * - Preview action configuration
 * - One-click add to canvas
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Search, Plus, X, Loader2, Sparkles } from "lucide-react";
import { getMCPClient } from "../../services/mcp-client";
import type { ActionResult } from "../../services/mcp-client";
import type { Action } from "../../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

interface AIActionSearchProps {
  onAddAction: (action: Action) => void;
  onClose?: () => void;
  placeholder?: string;
  position?: [number, number];
}

// ============================================================================
// Component
// ============================================================================

export function AIActionSearch({
  onAddAction,
  onClose,
  placeholder = "Search actions using natural language...",
  position,
}: AIActionSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ActionResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const mcpClient = getMCPClient();

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search when query changes (with debounce)
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }

    const timer = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      setLoading(true);
      setError(null);

      try {
        const searchResults = await mcpClient.searchActions(searchQuery, {
          limit: 5,
        });
        setResults(searchResults);
        setSelectedIndex(0);
      } catch (err) {
        console.error("Search failed:", err);
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [mcpClient]
  );

  const handleAdd = useCallback(
    (result: ActionResult) => {
      // Create action from result
      const action: Action = {
        id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: result.type,
        name: result.name,
        config: result.parameters || ({} as unknown),
        position: position || [100, 100],
      };

      onAddAction(action);

      if (onClose) {
        onClose();
      } else {
        setQuery("");
        setResults([]);
        inputRef.current?.focus();
      }
    },
    [onAddAction, onClose, position]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            handleAdd(results[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          if (onClose) {
            onClose();
          } else {
            setQuery("");
            setResults([]);
          }
          break;
      }
    },
    [results, selectedIndex, handleAdd, onClose]
  );

  return (
    <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700">
      {/* Search Input */}
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Sparkles className="w-5 h-5" />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-12 pr-12 py-4 text-lg bg-transparent border-b border-gray-200 dark:border-gray-700 focus:outline-none focus:border-purple-500 text-gray-900 dark:text-white"
        />
        {(query || onClose) && (
          <button
            onClick={() => {
              if (onClose) {
                onClose();
              } else {
                setQuery("");
                setResults([]);
                inputRef.current?.focus();
              }
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        )}
      </div>

      {/* Results */}
      <div className="max-h-96 overflow-y-auto">
        {error ? (
          <div className="p-4 text-center text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        ) : results.length > 0 ? (
          <div className="py-2">
            {results.map((result, index) => {
              const isSelected = index === selectedIndex;
              const confidence = result.confidence || 0.8;

              return (
                <button
                  key={result.id}
                  onClick={() => handleAdd(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full px-4 py-3 text-left flex items-center gap-4 transition-colors ${
                    isSelected
                      ? "bg-purple-50 dark:bg-purple-900/20"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  {/* Confidence Bar */}
                  <div className="w-1 h-12 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
                    <div
                      className={`w-full transition-all ${
                        confidence >= 0.9
                          ? "bg-green-500"
                          : confidence >= 0.7
                            ? "bg-yellow-500"
                            : "bg-red-500"
                      }`}
                      style={{ height: `${confidence * 100}%` }}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-gray-900 dark:text-white truncate">
                        {result.name}
                      </h4>
                      <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                        {result.category}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                      {result.description}
                    </p>
                    {result.confidence && (
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                        {Math.round(result.confidence * 100)}% match
                      </div>
                    )}
                  </div>

                  {/* Add Button */}
                  <div
                    className={`p-2 rounded-lg transition-colors ${
                      isSelected
                        ? "bg-purple-600 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    <Plus className="w-5 h-5" />
                  </div>
                </button>
              );
            })}
          </div>
        ) : query.trim() && !loading ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm">No actions found matching "{query}"</p>
            <p className="text-xs mt-2">Try a different search term</p>
          </div>
        ) : !query.trim() ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm font-medium mb-2">AI-Powered Action Search</p>
            <p className="text-xs">
              Try: "click the submit button" or "find an image on screen"
            </p>
          </div>
        ) : null}
      </div>

      {/* Footer with hints */}
      {results.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Use ↑↓ to navigate</span>
          <span>Press Enter to add</span>
          <span>Esc to close</span>
        </div>
      )}
    </div>
  );
}
