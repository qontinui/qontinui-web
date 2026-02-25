"use client";

import { useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditorSectionProps {
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function EditorSection({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: EditorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-border-subtle/50 rounded-lg bg-surface-raised/20">
      <button
        type="button"
        data-ui-id={`ui-editor-section-${title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/-+$/, "")}`}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
      >
        {Icon && <Icon className="size-4 text-text-muted" />}
        <span className="flex-1">{title}</span>
        <ChevronDown
          className={cn(
            "size-4 text-text-muted transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border-subtle/30">
          <div className="pt-3">{children}</div>
        </div>
      )}
    </div>
  );
}
