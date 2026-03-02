import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import type { RecentSearch } from "@/services/global-search-service";
import { RESOURCE_LABELS } from "../types";

interface RecentSearchesListProps {
  recentSearches: RecentSearch[];
  onRecentClick: (recent: RecentSearch) => void;
  onClear: () => void;
}

export function RecentSearchesList({
  recentSearches,
  onRecentClick,
  onClear,
}: RecentSearchesListProps) {
  if (recentSearches.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-3 py-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Recent Searches
        </h3>
        <button
          onClick={onClear}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="space-y-1">
        {recentSearches.map((recent, index) => (
          <button
            key={index}
            onClick={() => onRecentClick(recent)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent transition-colors text-left"
          >
            <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm flex-1">{recent.query}</span>
            {recent.filters.types && recent.filters.types.length > 0 && (
              <div className="flex gap-1">
                {recent.filters.types.map((type) => (
                  <Badge key={type} variant="outline" className="text-xs">
                    {RESOURCE_LABELS[type]}
                  </Badge>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
