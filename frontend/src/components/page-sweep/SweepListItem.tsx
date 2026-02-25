import { Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PageSweepItem } from "@/lib/page-sweep-generator";

export function SweepListItem({
  item,
  isSelected,
}: {
  item: PageSweepItem;
  isSelected: boolean;
}) {
  const selectedPages = item.pages?.filter((p) => p.selected).length ?? 0;
  const totalPages = item.pages?.length ?? 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Globe
          className={`size-4 shrink-0 ${isSelected ? "text-cyan-400" : "text-text-muted"}`}
        />
        <span
          className={`text-sm font-medium truncate ${isSelected ? "text-text-primary" : "text-text-secondary"}`}
        >
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        {totalPages > 0 && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
          >
            {selectedPages}/{totalPages} page{totalPages !== 1 ? "s" : ""}
          </Badge>
        )}
        {item.last_generated_at && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 bg-surface-raised text-text-muted"
          >
            generated
          </Badge>
        )}
      </div>
      {item.description && (
        <p className="text-xs text-text-muted truncate pl-6">
          {item.description}
        </p>
      )}
    </div>
  );
}
