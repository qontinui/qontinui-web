import { ExternalLink } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";

export function PlaywrightPagesVisitedList({ pages }: { pages: string[] }) {
  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-1">
        {pages.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-500 hover:underline truncate"
            >
              {url}
            </a>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
