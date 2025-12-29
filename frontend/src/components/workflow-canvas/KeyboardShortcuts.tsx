/**
 * Keyboard Shortcuts Panel - Display and customize shortcuts
 *
 * Panel:
 * - List all keyboard shortcuts
 * - Search shortcuts
 * - Categorized by function
 * - Print/export shortcuts
 * - Shortcut: ? or Ctrl+/
 */

"use client";

import React, { useState, useMemo } from "react";

// ============================================================================
// Types
// ============================================================================

export interface Shortcut {
  id: string;
  category: string;
  description: string;
  keys: string[];
  action?: string;
}

export interface KeyboardShortcutsProps {
  onClose?: () => void;
}

// ============================================================================
// Shortcuts Data
// ============================================================================

const SHORTCUTS: Shortcut[] = [
  // Selection
  {
    id: "select-all",
    category: "Selection",
    description: "Select all nodes",
    keys: ["Ctrl", "A"],
  },
  {
    id: "deselect",
    category: "Selection",
    description: "Deselect all",
    keys: ["Esc"],
  },
  {
    id: "invert-selection",
    category: "Selection",
    description: "Invert selection",
    keys: ["Ctrl", "Shift", "I"],
  },

  // Editing
  {
    id: "copy",
    category: "Editing",
    description: "Copy selected nodes",
    keys: ["Ctrl", "C"],
  },
  {
    id: "paste",
    category: "Editing",
    description: "Paste nodes",
    keys: ["Ctrl", "V"],
  },
  {
    id: "cut",
    category: "Editing",
    description: "Cut selected nodes",
    keys: ["Ctrl", "X"],
  },
  {
    id: "duplicate",
    category: "Editing",
    description: "Duplicate selected nodes",
    keys: ["Ctrl", "D"],
  },
  {
    id: "delete",
    category: "Editing",
    description: "Delete selected nodes",
    keys: ["Del"],
  },
  {
    id: "undo",
    category: "Editing",
    description: "Undo last action",
    keys: ["Ctrl", "Z"],
  },
  {
    id: "redo",
    category: "Editing",
    description: "Redo last action",
    keys: ["Ctrl", "Shift", "Z"],
  },

  // Navigation
  { id: "pan-up", category: "Navigation", description: "Pan up", keys: ["↑"] },
  {
    id: "pan-down",
    category: "Navigation",
    description: "Pan down",
    keys: ["↓"],
  },
  {
    id: "pan-left",
    category: "Navigation",
    description: "Pan left",
    keys: ["←"],
  },
  {
    id: "pan-right",
    category: "Navigation",
    description: "Pan right",
    keys: ["→"],
  },
  {
    id: "pan-mode",
    category: "Navigation",
    description: "Pan mode (hold)",
    keys: ["Space"],
  },

  // View
  { id: "zoom-in", category: "View", description: "Zoom in", keys: ["+"] },
  { id: "zoom-out", category: "View", description: "Zoom out", keys: ["-"] },
  {
    id: "reset-zoom",
    category: "View",
    description: "Reset zoom to 100%",
    keys: ["0"],
  },
  {
    id: "fit-view",
    category: "View",
    description: "Fit view to nodes",
    keys: ["Ctrl", "F"],
  },
  {
    id: "toggle-minimap",
    category: "View",
    description: "Toggle minimap",
    keys: ["Ctrl", "M"],
  },
  {
    id: "toggle-grid",
    category: "View",
    description: "Toggle grid",
    keys: ["Ctrl", "G"],
  },

  // Workflow
  {
    id: "auto-layout",
    category: "Workflow",
    description: "Auto layout nodes",
    keys: ["Ctrl", "L"],
  },
  {
    id: "run-workflow",
    category: "Workflow",
    description: "Run workflow",
    keys: ["Ctrl", "Enter"],
  },
  {
    id: "stop-workflow",
    category: "Workflow",
    description: "Stop workflow",
    keys: ["Ctrl", "Shift", "Enter"],
  },
  {
    id: "save-workflow",
    category: "Workflow",
    description: "Save workflow",
    keys: ["Ctrl", "S"],
  },

  // Alignment
  {
    id: "align-left",
    category: "Alignment",
    description: "Align left",
    keys: ["Ctrl", "Shift", "L"],
  },
  {
    id: "align-right",
    category: "Alignment",
    description: "Align right",
    keys: ["Ctrl", "Shift", "R"],
  },
  {
    id: "align-top",
    category: "Alignment",
    description: "Align top",
    keys: ["Ctrl", "Shift", "T"],
  },
  {
    id: "align-bottom",
    category: "Alignment",
    description: "Align bottom",
    keys: ["Ctrl", "Shift", "B"],
  },
  {
    id: "distribute-h",
    category: "Alignment",
    description: "Distribute horizontally",
    keys: ["Ctrl", "Shift", "H"],
  },
  {
    id: "distribute-v",
    category: "Alignment",
    description: "Distribute vertically",
    keys: ["Ctrl", "Shift", "V"],
  },

  // Help
  {
    id: "shortcuts",
    category: "Help",
    description: "Show keyboard shortcuts",
    keys: ["?"],
  },
];

// ============================================================================
// Keyboard Shortcuts Panel Component
// ============================================================================

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter and group shortcuts
  const { categories, filteredShortcuts } = useMemo(() => {
    const filtered = SHORTCUTS.filter(
      (shortcut) =>
        shortcut.description
          .toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        shortcut.keys.some((key) =>
          key.toLowerCase().includes(searchQuery.toLowerCase())
        )
    );

    const cats = Array.from(new Set(filtered.map((s) => s.category))).sort();

    return { categories: cats, filteredShortcuts: filtered };
  }, [searchQuery]);

  const handlePrint = () => {
    window.print();
  };

  const handleExport = () => {
    const text = SHORTCUTS.map(
      (s) => `${s.description}: ${s.keys.join(" + ")}`
    ).join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "keyboard-shortcuts.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">
            Keyboard Shortcuts
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
              title="Print shortcuts"
            >
              Print
            </button>
            <button
              onClick={handleExport}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
              title="Export shortcuts"
            >
              Export
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-700">
          <div className="relative">
            <input
              type="text"
              placeholder="Search shortcuts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 pl-10 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {/* Shortcuts List */}
        <div className="flex-1 overflow-y-auto p-4">
          {categories.map((category) => (
            <div key={category} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                {category}
              </h3>
              <div className="space-y-2">
                {filteredShortcuts
                  .filter((s) => s.category === category)
                  .map((shortcut) => (
                    <div
                      key={shortcut.id}
                      className="flex items-center justify-between p-3 bg-gray-900 rounded-lg"
                    >
                      <span className="text-gray-300">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, index) => (
                          <React.Fragment key={index}>
                            {index > 0 && (
                              <span className="text-gray-600 mx-1">+</span>
                            )}
                            <kbd className="px-2 py-1 text-xs font-mono bg-gray-800 border border-gray-700 rounded text-gray-300">
                              {key}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}

          {filteredShortcuts.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No shortcuts found matching &quot;{searchQuery}&quot;
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 text-sm text-gray-400">
          <p>
            <strong className="text-white">Tip:</strong> Press{" "}
            <kbd className="px-2 py-1 bg-gray-900 border border-gray-700 rounded">
              ?
            </kbd>{" "}
            anytime to show this panel
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Keyboard Shortcuts Hook
// ============================================================================

export function useKeyboardShortcuts() {
  const [isOpen, setIsOpen] = useState(false);

  // Listen for ? key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" || (e.key === "/" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        setIsOpen(true);
      }

      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((prev) => !prev),
  };
}

// ============================================================================
// Keyboard Shortcuts Container
// ============================================================================

export function KeyboardShortcutsContainer() {
  const { isOpen, close } = useKeyboardShortcuts();

  if (!isOpen) return null;

  return <KeyboardShortcuts onClose={close} />;
}

export default KeyboardShortcuts;
