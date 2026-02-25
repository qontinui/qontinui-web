"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Activity,
  Clock,
  MessageSquare,
  Bug,
  ShieldCheck,
  Gauge,
  Terminal,
  Monitor,
  GitBranch,
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
  { id: "command", label: "Commands", icon: Terminal },
  { id: "ui-bridge", label: "UI Bridge", icon: Monitor },
  { id: "verification", label: "Verification", icon: ShieldCheck },
  { id: "findings", label: "Findings", icon: Bug },
  { id: "flow-execution", label: "Flow", icon: GitBranch },
  { id: "status", label: "Status", icon: Gauge },
];

export function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: "dashboard" | WidgetId;
  onTabChange: (tab: "dashboard" | WidgetId) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  const updateFadeIndicators = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeftFade(el.scrollLeft > 0);
    setShowRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateFadeIndicators();
    el.addEventListener("scroll", updateFadeIndicators, { passive: true });
    window.addEventListener("resize", updateFadeIndicators);
    return () => {
      el.removeEventListener("scroll", updateFadeIndicators);
      window.removeEventListener("resize", updateFadeIndicators);
    };
  }, [updateFadeIndicators]);

  return (
    <div className="relative overflow-hidden bg-surface-canvas/60 border-b border-border-subtle/30">
      {/* Left fade indicator */}
      {showLeftFade && (
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-surface-canvas/60 to-transparent pointer-events-none z-10" />
      )}
      <div
        ref={scrollRef}
        className="flex items-center gap-1 px-4 py-1.5 overflow-x-auto scrollbar-hide"
      >
        {TAB_ITEMS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              title={tab.label}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all shrink-0",
                isActive
                  ? "bg-brand-primary/10 text-brand-primary border border-brand-primary/30"
                  : "text-text-muted hover:text-text-secondary hover:bg-white/[0.02]"
              )}
            >
              <Icon className="size-3.5" />
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>
      {/* Right fade indicator */}
      {showRightFade && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface-canvas/60 to-transparent pointer-events-none z-10" />
      )}
    </div>
  );
}
