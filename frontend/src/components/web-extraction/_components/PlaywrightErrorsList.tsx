import { AlertTriangle } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";

export function PlaywrightErrorsList({ errors }: { errors: string[] }) {
  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-2">
        {errors.map((error, i) => (
          <div
            key={i}
            className="p-2 rounded-md bg-red-500/10 border border-red-500/30"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
