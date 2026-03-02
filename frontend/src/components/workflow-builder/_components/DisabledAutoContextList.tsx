import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ContextItem } from "@/lib/runner/types/exploration";

interface DisabledAutoContextListProps {
  items: ContextItem[];
  onReEnable: (contextId: string) => void;
}

export function DisabledAutoContextList({
  items,
  onReEnable,
}: DisabledAutoContextListProps) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-[11px] text-zinc-500 font-medium">
        Disabled auto-include:
      </p>
      {items.map((ctx) => (
        <div
          key={ctx.id}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-zinc-800 border-dashed opacity-60 hover:opacity-100 transition-opacity"
        >
          <button
            onClick={() => onReEnable(ctx.id)}
            className="text-zinc-500 hover:text-green-400 transition-colors"
            title="Re-enable this context"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <span className="text-sm text-zinc-400 truncate">{ctx.name}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
            disabled
          </Badge>
        </div>
      ))}
    </div>
  );
}
