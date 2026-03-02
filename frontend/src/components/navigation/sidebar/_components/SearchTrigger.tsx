import { Search } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SearchTrigger({ isCollapsed }: { isCollapsed: boolean }) {
  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary">
            <Search className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Search</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      data-tutorial-id="sidebar-search"
      className="flex h-8 w-full items-center gap-2 rounded-md border border-border-subtle bg-surface-canvas px-2.5 text-sm text-text-muted transition-colors hover:border-border-default hover:bg-surface-hover"
    >
      <Search className="size-3.5" />
      <span className="text-xs">Search...</span>
      <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border border-border-subtle bg-surface-canvas px-1.5 font-mono text-[10px] font-medium text-text-muted sm:flex">
        <span className="text-xs">&#8984;</span>K
      </kbd>
    </button>
  );
}
