"use client";

import { Badge } from "@/components/ui/badge";

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  count?: number;
}

export function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
        active
          ? "bg-muted text-foreground border border-border"
          : "text-muted-foreground hover:text-muted-foreground hover:bg-muted"
      }`}
    >
      <Icon className="size-3.5" />
      {label}
      {count != null && (
        <Badge variant="secondary" className="text-[10px] px-1.5 ml-0.5">
          {count}
        </Badge>
      )}
    </button>
  );
}
