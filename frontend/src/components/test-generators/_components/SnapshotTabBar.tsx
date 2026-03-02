import { Layers, Tag, TestTube2, FileOutput } from "lucide-react";
import type { SpecGroup } from "../types";

export type Tab = "elements" | "annotations" | "specs" | "output";

const TAB_DEFINITIONS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "elements", label: "Elements", icon: <Layers className="w-4 h-4" /> },
  {
    id: "annotations",
    label: "Annotations",
    icon: <Tag className="w-4 h-4" />,
  },
  { id: "specs", label: "Test Specs", icon: <TestTube2 className="w-4 h-4" /> },
  { id: "output", label: "Output", icon: <FileOutput className="w-4 h-4" /> },
];

interface SnapshotTabBarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  specs: SpecGroup[];
}

export function SnapshotTabBar({
  activeTab,
  onTabChange,
  specs,
}: SnapshotTabBarProps) {
  return (
    <div className="flex border-b border-neutral-700 bg-neutral-800/50">
      {TAB_DEFINITIONS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
            activeTab === tab.id
              ? "text-emerald-400 border-emerald-400 bg-neutral-900/50"
              : "text-neutral-400 border-transparent hover:text-neutral-200 hover:bg-neutral-700/30"
          }`}
        >
          {tab.icon}
          {tab.label}
          {tab.id === "specs" && specs.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded">
              {specs.length}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
