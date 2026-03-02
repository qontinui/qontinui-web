/**
 * SnapshotElementBrowser
 *
 * Left column of the Elements tab. Shows elements grouped by type
 * (buttons, inputs, links, forms, modals) with annotation and spec badges.
 */

import { useState, useMemo } from "react";
import { useExpandableSet } from "@/hooks/useExpandableSet";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Tag,
  TestTube2,
} from "lucide-react";

export interface BrowsableElement {
  id: string;
  type: string;
  label: string;
  isInteractive: boolean;
  isAnnotated: boolean;
  hasSpecs: boolean;
}

interface SnapshotElementBrowserProps {
  elements: BrowsableElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const TYPE_ORDER = [
  "button",
  "input",
  "link",
  "select",
  "textarea",
  "form",
  "modal",
  "other",
];

function getTypeGroup(type: string): string {
  if (TYPE_ORDER.includes(type)) return type;
  return "other";
}

export function SnapshotElementBrowser({
  elements,
  selectedId,
  onSelect,
}: SnapshotElementBrowserProps) {
  const [search, setSearch] = useState("");
  const { expanded: expandedGroups, toggle: toggleGroup } =
    useExpandableSet(TYPE_ORDER);

  const filtered = useMemo(() => {
    if (!search) return elements;
    const q = search.toLowerCase();
    return elements.filter(
      (e) => e.label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)
    );
  }, [elements, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, BrowsableElement[]>();
    for (const el of filtered) {
      const group = getTypeGroup(el.type);
      const list = groups.get(group) || [];
      list.push(el);
      groups.set(group, list);
    }
    return Array.from(groups.entries()).sort(
      (a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0])
    );
  }, [filtered]);

  return (
    <div className="flex flex-col h-full border-r border-neutral-700">
      {/* Search */}
      <div className="px-3 py-2 border-b border-neutral-700/50">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-500" />
          <input
            id="search-elements"
            type="text"
            placeholder="Search elements..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-md text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Element groups */}
      <div className="flex-1 overflow-auto">
        {grouped.map(([group, items]) => {
          const isExpanded = expandedGroups.has(group);
          return (
            <div key={group}>
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-neutral-800/50"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-neutral-400" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-neutral-400" />
                )}
                <span className="text-xs font-medium text-neutral-300 capitalize">
                  {group}s
                </span>
                <span className="text-xs text-neutral-500 ml-auto">
                  {items.length}
                </span>
              </button>
              {isExpanded && (
                <div className="pb-1">
                  {items.map((el) => (
                    <button
                      key={el.id}
                      onClick={() => onSelect(el.id)}
                      className={`w-full flex items-center gap-2 px-5 py-1.5 text-left transition-colors ${
                        selectedId === el.id
                          ? "bg-blue-500/10 border-l-2 border-blue-500"
                          : "hover:bg-neutral-800/30 border-l-2 border-transparent"
                      }`}
                    >
                      <span className="text-xs text-neutral-200 truncate flex-1">
                        {el.label}
                      </span>
                      <div className="flex items-center gap-1">
                        {el.isAnnotated && (
                          <span title="Annotated">
                            <Tag className="w-3 h-3 text-emerald-400" />
                          </span>
                        )}
                        {el.hasSpecs && (
                          <span title="Has specs">
                            <TestTube2 className="w-3 h-3 text-blue-400" />
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {grouped.length === 0 && (
          <div
            className="p-4 text-xs text-neutral-500 text-center"
            data-ui-element
          >
            {search
              ? "No elements match your search."
              : "No elements captured yet."}
          </div>
        )}
      </div>
    </div>
  );
}
