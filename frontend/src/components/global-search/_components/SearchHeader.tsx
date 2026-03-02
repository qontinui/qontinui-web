import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import type {
  ResourceType,
  SearchFilter,
} from "@/services/global-search-service";
import { cn } from "@/lib/utils";
import { RESOURCE_ICONS, RESOURCE_LABELS } from "../types";

const FILTER_TYPES: ResourceType[] = [
  "workflow",
  "state",
  "image",
  "transition",
  "folder",
];

interface SearchHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  loading: boolean;
  activeFilters: SearchFilter;
  onToggleFilter: (type: ResourceType) => void;
}

export function SearchHeader({
  query,
  onQueryChange,
  onKeyDown,
  loading,
  activeFilters,
  onToggleFilter,
}: SearchHeaderProps) {
  return (
    <div className="p-4 border-b">
      <div className="flex items-center gap-3 mb-3">
        <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        <Input
          type="text"
          placeholder="Search workflows, states, images, transitions..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="border-0 focus-visible:ring-0 shadow-none px-0 h-auto text-base"
        />
        {loading && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
        <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          ESC
        </kbd>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTER_TYPES.map((type) => {
          const Icon = RESOURCE_ICONS[type];
          const isActive = activeFilters.types?.includes(type);

          return (
            <button
              key={type}
              onClick={() => onToggleFilter(type)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              )}
            >
              <Icon className="w-3 h-3" />
              {RESOURCE_LABELS[type]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
