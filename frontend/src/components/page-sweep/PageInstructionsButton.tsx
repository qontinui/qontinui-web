import { MessageSquare } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

export function PageInstructionsButton({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`p-0.5 rounded transition-colors shrink-0 ${
            value
              ? "text-cyan-400 hover:text-cyan-300"
              : "text-text-muted/40 hover:text-text-muted"
          }`}
          title="Per-page instructions"
        >
          <MessageSquare className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Per-page AI instructions..."
          rows={3}
          className="bg-surface-raised/50 border-border-subtle text-xs resize-none"
        />
      </PopoverContent>
    </Popover>
  );
}
