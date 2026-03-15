"use client";

import { cn } from "@/lib/utils";
import { useProductMode, type ProductMode } from "@/contexts/product-mode-context";
import { Bot, Eye } from "lucide-react";

interface ProductModeSwitcherProps {
  isCollapsed: boolean;
}

export function ProductModeSwitcher({ isCollapsed }: ProductModeSwitcherProps) {
  const { mode, setMode } = useProductMode();

  if (isCollapsed) {
    return (
      <button
        onClick={() => setMode(mode === "ai" ? "visual" : "ai")}
        className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-surface-raised transition-colors"
        title={mode === "ai" ? "Switch to Visual Automation" : "Switch to AI Development"}
      >
        {mode === "ai" ? (
          <Bot className="size-4 text-brand-primary" />
        ) : (
          <Eye className="size-4 text-cyan-400" />
        )}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-surface-raised/50 border border-border-subtle">
      <ModeButton
        mode="ai"
        activeMode={mode}
        onClick={() => setMode("ai")}
        icon={<Bot className="size-3.5" />}
        label="AI Dev"
      />
      <ModeButton
        mode="visual"
        activeMode={mode}
        onClick={() => setMode("visual")}
        icon={<Eye className="size-3.5" />}
        label="Visual"
      />
    </div>
  );
}

function ModeButton({
  mode,
  activeMode,
  onClick,
  icon,
  label,
}: {
  mode: ProductMode;
  activeMode: ProductMode;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  const isActive = mode === activeMode;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all duration-150",
        isActive
          ? "bg-surface-overlay text-text-primary shadow-sm"
          : "text-text-tertiary hover:text-text-secondary"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
