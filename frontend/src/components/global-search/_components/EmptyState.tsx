import { Search } from "lucide-react";
import { EmptyState as BaseEmptyState } from "@/components/common/_components/EmptyState";

export function EmptyState() {
  return (
    <BaseEmptyState
      icon={Search}
      message="No results found"
      detail="Try different keywords or filters"
      iconClassName="text-muted-foreground/50"
    />
  );
}
