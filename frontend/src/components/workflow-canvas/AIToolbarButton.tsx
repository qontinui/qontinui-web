/**
 * AI Toolbar Button - Quick access to AI features
 *
 * Features:
 * - Magic wand icon
 * - Dropdown menu with AI actions
 * - Keyboard shortcuts
 * - Badge showing suggestion count
 */

import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  ChevronDown,
  Lightbulb,
  FileText,
  Search,
  Zap,
} from "lucide-react";
import { useMCPStore, useSuggestionsCount } from "../../stores/mcp-store";

// ============================================================================
// Types
// ============================================================================

interface AIToolbarButtonProps {
  onGenerateWorkflow: () => void;
  onShowSuggestions: () => void;
  onShowExplanation: () => void;
  onShowSearch: () => void;
  onOptimizeWorkflow: () => void;
  disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function AIToolbarButton({
  onGenerateWorkflow,
  onShowSuggestions,
  onShowExplanation,
  onShowSearch,
  onOptimizeWorkflow,
  disabled = false,
}: AIToolbarButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isConnected = useMCPStore((state) => state.isConnected);
  const suggestionsCount = useSuggestionsCount();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+G - Generate Workflow
      if (e.ctrlKey && e.shiftKey && e.key === "G") {
        e.preventDefault();
        onGenerateWorkflow();
      }
      // Ctrl+Shift+S - Show Suggestions
      else if (e.ctrlKey && e.shiftKey && e.key === "S") {
        e.preventDefault();
        onShowSuggestions();
      }
      // Ctrl+Shift+E - Show Explanation
      else if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        onShowExplanation();
      }
      // Ctrl+Shift+F - Show Search
      else if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        onShowSearch();
      }
      // Ctrl+Shift+O - Optimize
      else if (e.ctrlKey && e.shiftKey && e.key === "O") {
        e.preventDefault();
        onOptimizeWorkflow();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    onGenerateWorkflow,
    onShowSuggestions,
    onShowExplanation,
    onShowSearch,
    onOptimizeWorkflow,
  ]);

  const menuItems = [
    {
      label: "Generate Workflow",
      icon: Sparkles,
      shortcut: "Ctrl+Shift+G",
      onClick: onGenerateWorkflow,
      description: "Create workflow from natural language",
    },
    {
      label: "Get Suggestions",
      icon: Lightbulb,
      shortcut: "Ctrl+Shift+S",
      onClick: onShowSuggestions,
      description: "AI-powered workflow improvements",
      badge: suggestionsCount > 0 ? suggestionsCount : undefined,
    },
    {
      label: "Explain Workflow",
      icon: FileText,
      shortcut: "Ctrl+Shift+E",
      onClick: onShowExplanation,
      description: "Get natural language explanation",
    },
    {
      label: "AI Search",
      icon: Search,
      shortcut: "Ctrl+Shift+F",
      onClick: onShowSearch,
      description: "Search actions semantically",
    },
    {
      label: "Optimize Workflow",
      icon: Zap,
      shortcut: "Ctrl+Shift+O",
      onClick: onOptimizeWorkflow,
      description: "Improve performance and reliability",
    },
  ];

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Main Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || !isConnected}
        className={`relative flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
          disabled || !isConnected
            ? "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
            : "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-lg hover:shadow-xl"
        }`}
        title={
          !isConnected
            ? "MCP server not connected"
            : "AI Features (Ctrl+Shift+G)"
        }
      >
        <Sparkles className="w-5 h-5" />
        <span>AI</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />

        {/* Suggestion Badge */}
        {suggestionsCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {suggestionsCount > 9 ? "9+" : suggestionsCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-50">
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-5 h-5" />
              <h3 className="font-semibold">AI Features</h3>
            </div>
            <p className="text-xs text-purple-100">
              {isConnected ? "Connected to MCP server" : "Disconnected"}
            </p>
          </div>

          {/* Menu Items */}
          <div className="py-2">
            {menuItems.map((item, index) => {
              const Icon = item.icon;

              return (
                <button
                  key={index}
                  onClick={() => {
                    item.onClick();
                    setIsOpen(false);
                  }}
                  disabled={disabled || !isConnected}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg group-hover:bg-purple-100 dark:group-hover:bg-purple-900/30 transition-colors">
                      <Icon className="w-4 h-4 text-gray-600 dark:text-gray-400 group-hover:text-purple-600 dark:group-hover:text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm text-gray-900 dark:text-white">
                          {item.label}
                        </span>
                        {item.badge !== undefined && (
                          <span className="px-2 py-0.5 text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        {item.description}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                        {item.shortcut}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer */}
          {!isConnected && (
            <div className="px-4 py-3 bg-yellow-50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800">
              <p className="text-xs text-yellow-800 dark:text-yellow-300">
                MCP server is not connected. AI features are unavailable.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
