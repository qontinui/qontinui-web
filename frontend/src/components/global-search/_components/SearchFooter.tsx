interface SearchFooterProps {
  resultCount: number;
}

export function SearchFooter({ resultCount }: SearchFooterProps) {
  return (
    <div className="border-t p-3 bg-muted/30">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium">
              ↑↓
            </kbd>
            <span>Navigate</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium">
              ↵
            </kbd>
            <span>Select</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium">
              ESC
            </kbd>
            <span>Close</span>
          </div>
        </div>
        <div className="text-xs">
          {resultCount > 0 &&
            `${resultCount} result${resultCount === 1 ? "" : "s"}`}
        </div>
      </div>
    </div>
  );
}
