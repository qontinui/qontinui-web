import { Lightbulb } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AutoIncludeToggleProps {
  enabled: boolean;
  onChange: (value: boolean) => void;
}

export function AutoIncludeToggle({
  enabled,
  onChange,
}: AutoIncludeToggleProps) {
  return (
    <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
      <div className="flex items-center gap-2">
        <label
          htmlFor="cm-auto-include"
          className="flex items-center gap-2 cursor-pointer"
        >
          <Checkbox
            id="cm-auto-include"
            checked={enabled}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <span className="text-sm text-zinc-400">Auto-include contexts</span>
        </label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-zinc-500 hover:text-zinc-300 cursor-help">
                <Lightbulb className="w-3.5 h-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[260px] text-xs">
              Automatically includes contexts based on keywords in your workflow
              description. Disable to only use manually added contexts.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
