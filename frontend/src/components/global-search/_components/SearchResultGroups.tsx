import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import type {
  SearchResultItem,
  ResourceType,
} from "@/services/global-search-service";
import { cn } from "@/lib/utils";
import { RESOURCE_ICONS, RESOURCE_LABELS } from "../types";

interface SearchResultGroupsProps {
  groupedResults: Map<ResourceType, SearchResultItem[]>;
  results: SearchResultItem[];
  selectedIndex: number;
  resultRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  onResultClick: (result: SearchResultItem) => void;
  onResultHover: (index: number) => void;
}

export function SearchResultGroups({
  groupedResults,
  results,
  selectedIndex,
  resultRefs,
  onResultClick,
  onResultHover,
}: SearchResultGroupsProps) {
  return (
    <>
      {Array.from(groupedResults.entries()).map(([type, items], groupIndex) => {
        const Icon = RESOURCE_ICONS[type];

        return (
          <div key={type} className={groupIndex > 0 ? "mt-6" : ""}>
            <div className="flex items-center gap-2 px-3 py-2 sticky top-0 bg-background z-10">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {RESOURCE_LABELS[type]}
              </h3>
              <Badge variant="secondary" className="ml-auto text-xs">
                {items.length}
              </Badge>
            </div>

            <div className="space-y-1">
              {items.map((result) => {
                const globalIndex = results.indexOf(result);
                const isSelected = globalIndex === selectedIndex;

                return (
                  <div
                    key={result.id}
                    role="option"
                    tabIndex={0}
                    aria-selected={isSelected}
                    ref={(el) => {
                      resultRefs.current[globalIndex] = el;
                    }}
                    onClick={() => onResultClick(result)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onResultClick(result); } }}
                    onMouseEnter={() => onResultHover(globalIndex)}
                    className={cn(
                      "px-3 py-2.5 rounded-md cursor-pointer transition-colors",
                      isSelected ? "bg-accent" : "hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm truncate">
                            {result.name}
                          </span>
                          {result.breadcrumb &&
                            result.breadcrumb.length > 0 && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                {result.breadcrumb.map((crumb, i) => (
                                  <span
                                    key={i}
                                    className="flex items-center gap-1"
                                  >
                                    <ChevronRight className="w-3 h-3" />
                                    {crumb}
                                  </span>
                                ))}
                              </div>
                            )}
                        </div>

                        {result.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {result.description}
                          </p>
                        )}

                        {result.matches.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-1.5">
                            {result.matches.slice(0, 3).map((match, i) => (
                              <Badge
                                key={i}
                                variant="outline"
                                className="text-xs font-normal"
                              >
                                {match.field}: {match.matchedText}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      {isSelected && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                            ↵
                          </kbd>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
