"use client";

import { cn } from "@/lib/utils";
import {
  Activity,
  Clock,
  MessageSquare,
  Bug,
  ShieldCheck,
  Gauge,
  Plug,
  Camera,
} from "lucide-react";
import type { WidgetId } from "../_lib";

const TAB_ITEMS: {
  id: "dashboard" | WidgetId;
  label: string;
  icon: typeof Activity;
}[] = [
  { id: "dashboard", label: "Dashboard", icon: Activity },
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "ai-conversation", label: "AI Conversation", icon: MessageSquare },
  { id: "verification", label: "Verification", icon: ShieldCheck },
  { id: "findings", label: "Findings", icon: Bug },
  { id: "mcp-calls", label: "MCP Calls", icon: Plug },
  { id: "screenshots", label: "Screenshots", icon: Camera },
  { id: "status", label: "Status", icon: Gauge },
];

export function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: "dashboard" | WidgetId;
  onTabChange: (tab: "dashboard" | WidgetId) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-4 py-1.5 bg-surface-canvas/60 border-b border-border-subtle/30 overflow-x-auto">
      {TAB_ITEMS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all shrink-0",
              isActive
                ? "bg-brand-primary/10 text-brand-primary border border-brand-primary/30"
                : "text-text-muted hover:text-text-secondary hover:bg-white/[0.02]"
            )}
          >
            <Icon className="size-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
