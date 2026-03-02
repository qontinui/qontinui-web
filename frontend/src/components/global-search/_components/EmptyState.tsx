import { Search } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Search className="w-12 h-12 text-muted-foreground/50 mb-3" />
      <p className="text-sm text-muted-foreground">No results found</p>
      <p className="text-xs text-muted-foreground mt-1">
        Try different keywords or filters
      </p>
    </div>
  );
}
