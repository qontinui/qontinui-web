import { Check, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  SCOPE_VARIANT,
  type ContextScope,
  type IncludedContext,
} from "../context-management-types";

interface IncludedContextListProps {
  items: IncludedContext[];
  onToggle: (contextId: string, isAutoIncluded: boolean) => void;
}

export function IncludedContextList({
  items,
  onToggle,
}: IncludedContextListProps) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {items.map(({ context, isAutoIncluded, autoIncludeReason }) => (
        <div
          key={context.id}
          className="flex items-start gap-2 p-2 rounded-md border border-zinc-800 hover:border-zinc-700 transition-colors group"
        >
          <button
            onClick={() => onToggle(context.id, isAutoIncluded)}
            className="mt-0.5 text-green-500 hover:text-red-400 transition-colors"
            title={
              isAutoIncluded
                ? "Disable this auto-included context"
                : "Remove this context"
            }
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm text-zinc-200 truncate">
                {context.name}
              </span>
              {context.scope && (
                <Badge
                  variant={
                    SCOPE_VARIANT[context.scope as ContextScope] ?? "default"
                  }
                  className="text-[10px] px-1.5 py-0 shrink-0"
                >
                  {context.scope}
                </Badge>
              )}
              {context.category && (
                <span className="text-[10px] text-zinc-500">
                  {context.category}
                </span>
              )}
            </div>
            {autoIncludeReason && (
              <p className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
                <Lightbulb className="w-3 h-3 text-yellow-500 shrink-0" />
                Auto: {autoIncludeReason}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
