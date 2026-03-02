/**
 * TestSpecEditor
 *
 * Shared component for viewing and editing test specifications.
 * Groups assertions by category with collapsible sections.
 * Used by both Snapshot Test Generator (Tier 1) and Navigation Test Generator (Tier 2).
 */

import { useState, useMemo, useCallback } from "react";
import { useExpandableSet } from "@/hooks/useExpandableSet";
import {
  ChevronDown,
  ChevronRight,
  Filter,
  CheckCircle2,
  XCircle,
  Sparkles,
} from "lucide-react";
import { CATEGORY_LABELS, type SpecCategory, type SpecGroup } from "../types";
import { TestSpecAssertionRow } from "./TestSpecAssertionRow";

interface TestSpecEditorProps {
  specs: SpecGroup[];
  onSpecsChange: (specs: SpecGroup[]) => void;
  onGenerate?: () => void;
  generateLabel?: string;
  additionalActions?: React.ReactNode;
  isGenerating?: boolean;
}

export function TestSpecEditor({
  specs,
  onSpecsChange,
  onGenerate,
  generateLabel = "Generate Specs",
  additionalActions,
  isGenerating = false,
}: TestSpecEditorProps) {
  const { expanded: expandedSpecs, toggle: toggleSpec } = useExpandableSet();
  const [categoryFilter, setCategoryFilter] = useState<SpecCategory | "all">(
    "all"
  );
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const filteredSpecs = useMemo(() => {
    if (categoryFilter === "all") return specs;
    return specs.filter((s) => s.category === categoryFilter);
  }, [specs, categoryFilter]);

  const totalAssertions = useMemo(
    () => specs.reduce((sum, s) => sum + s.assertions.length, 0),
    [specs]
  );
  const enabledAssertions = useMemo(
    () =>
      specs.reduce(
        (sum, s) => sum + s.assertions.filter((a) => a.enabled).length,
        0
      ),
    [specs]
  );

  const toggleAssertion = useCallback(
    (specId: string, assertionId: string) => {
      const updated = specs.map((s) => {
        if (s.id !== specId) return s;
        return {
          ...s,
          assertions: s.assertions.map((a) =>
            a.id === assertionId ? { ...a, enabled: !a.enabled } : a
          ),
        };
      });
      onSpecsChange(updated);
    },
    [specs, onSpecsChange]
  );

  const reviewAssertion = useCallback(
    (specId: string, assertionId: string) => {
      const updated = specs.map((s) => {
        if (s.id !== specId) return s;
        return {
          ...s,
          assertions: s.assertions.map((a) =>
            a.id === assertionId ? { ...a, reviewed: !a.reviewed } : a
          ),
        };
      });
      onSpecsChange(updated);
    },
    [specs, onSpecsChange]
  );

  const editAssertionNotes = useCallback(
    (specId: string, assertionId: string, notes: string) => {
      const updated = specs.map((s) => {
        if (s.id !== specId) return s;
        return {
          ...s,
          assertions: s.assertions.map((a) =>
            a.id === assertionId ? { ...a, notes } : a
          ),
        };
      });
      onSpecsChange(updated);
    },
    [specs, onSpecsChange]
  );

  const enableAll = useCallback(() => {
    const updated = specs.map((s) => ({
      ...s,
      assertions: s.assertions.map((a) => ({ ...a, enabled: true })),
    }));
    onSpecsChange(updated);
  }, [specs, onSpecsChange]);

  const disableAll = useCallback(() => {
    const updated = specs.map((s) => ({
      ...s,
      assertions: s.assertions.map((a) => ({ ...a, enabled: false })),
    }));
    onSpecsChange(updated);
  }, [specs, onSpecsChange]);

  const categories = useMemo(() => {
    const cats = new Set<SpecCategory>();
    specs.forEach((s) => cats.add(s.category));
    return Array.from(cats);
  }, [specs]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-700 bg-neutral-800/50">
        {onGenerate && (
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {isGenerating ? "Generating..." : generateLabel}
          </button>
        )}

        {additionalActions}

        {/* Filter */}
        <div className="relative ml-auto">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
              categoryFilter !== "all"
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
            }`}
          >
            <Filter className="w-3 h-3" />
            {categoryFilter === "all"
              ? "Filter"
              : CATEGORY_LABELS[categoryFilter]}
          </button>
          {showFilterMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-neutral-800 border border-neutral-600 rounded-md shadow-lg py-1 min-w-[180px]">
              <button
                onClick={() => {
                  setCategoryFilter("all");
                  setShowFilterMenu(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-700 ${categoryFilter === "all" ? "text-blue-400" : "text-neutral-300"}`}
              >
                All Categories
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    setCategoryFilter(cat);
                    setShowFilterMenu(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-700 ${categoryFilter === cat ? "text-blue-400" : "text-neutral-300"}`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={enableAll}
          className="flex items-center gap-1 px-2 py-1.5 text-xs bg-neutral-700 text-neutral-300 rounded-md hover:bg-neutral-600"
        >
          <CheckCircle2 className="w-3 h-3" /> Enable All
        </button>
        <button
          onClick={disableAll}
          className="flex items-center gap-1 px-2 py-1.5 text-xs bg-neutral-700 text-neutral-300 rounded-md hover:bg-neutral-600"
        >
          <XCircle className="w-3 h-3" /> Disable All
        </button>
      </div>

      {/* Stats bar */}
      <div className="px-4 py-2 text-xs text-neutral-400 border-b border-neutral-700/50 bg-neutral-900/30">
        {specs.length} specs, {enabledAssertions}/{totalAssertions} assertions
        enabled
      </div>

      {/* Spec list */}
      <div className="flex-1 overflow-auto">
        {filteredSpecs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            {specs.length === 0
              ? "No test specifications yet. Click Generate to create specs."
              : "No specs match the current filter."}
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filteredSpecs.map((spec) => {
              const isExpanded = expandedSpecs.has(spec.id);
              const enabledCount = spec.assertions.filter(
                (a) => a.enabled
              ).length;
              return (
                <div
                  key={spec.id}
                  className="rounded-lg border border-neutral-700/50 overflow-hidden"
                >
                  {/* Spec header */}
                  <button
                    onClick={() => toggleSpec(spec.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left bg-neutral-800/70 hover:bg-neutral-800 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                    )}
                    <span className="text-sm font-medium text-neutral-200 flex-1">
                      {spec.name}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {enabledCount}/{spec.assertions.length} assertions
                    </span>
                  </button>

                  {/* Assertion list */}
                  {isExpanded && (
                    <div className="px-2 py-1 space-y-0.5">
                      {spec.assertions.map((assertion) => (
                        <TestSpecAssertionRow
                          key={assertion.id}
                          assertion={assertion}
                          onToggle={(id) => toggleAssertion(spec.id, id)}
                          onReview={(id) => reviewAssertion(spec.id, id)}
                          onEditNotes={(id, notes) =>
                            editAssertionNotes(spec.id, id, notes)
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
