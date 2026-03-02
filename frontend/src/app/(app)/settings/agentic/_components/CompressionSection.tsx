"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Brain, ChevronDown, ChevronRight, Info } from "lucide-react";
import type { CompressionSettings } from "../types";

interface CompressionSectionProps {
  value: CompressionSettings;
  onChange: (value: CompressionSettings) => void;
}

export function CompressionSection({
  value,
  onChange,
}: CompressionSectionProps) {
  const [open, setOpen] = useState(true);

  const update = (patch: Partial<CompressionSettings>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="rounded-lg border border-border">
      <div
        className="px-4 py-3 border-b border-border bg-muted/50 cursor-pointer select-none"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            {open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <Brain className="size-4" />
            Memory Compression
          </h3>
          <Switch
            checked={value.enabled}
            onCheckedChange={(checked) => update({ enabled: checked })}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      {open && (
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <Info className="size-4 mt-0.5 text-blue-500 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Memory compression automatically summarizes older context when the
              conversation grows too long, keeping recent items intact while
              reducing token usage.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Threshold Tokens</Label>
            <Input
              type="number"
              min={10000}
              max={200000}
              step={5000}
              value={value.threshold_tokens}
              onChange={(e) =>
                update({ threshold_tokens: Number(e.target.value) })
              }
              disabled={!value.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Compression triggers when context exceeds this token count
            </p>
          </div>

          <div className="space-y-2">
            <Label>Target Tokens</Label>
            <Input
              type="number"
              min={5000}
              max={150000}
              step={5000}
              value={value.target_tokens}
              onChange={(e) =>
                update({ target_tokens: Number(e.target.value) })
              }
              disabled={!value.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Compress context down to this token count
            </p>
          </div>

          <div className="space-y-2">
            <Label>Keep Recent Items</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={value.keep_recent_items}
              onChange={(e) =>
                update({ keep_recent_items: Number(e.target.value) })
              }
              disabled={!value.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Number of recent context items to keep uncompressed
            </p>
          </div>

          <div className="space-y-2">
            <Label>Summarize Batch Size</Label>
            <Input
              type="number"
              min={5}
              max={50}
              value={value.summarize_batch_size}
              onChange={(e) =>
                update({ summarize_batch_size: Number(e.target.value) })
              }
              disabled={!value.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Number of items to summarize in each batch
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
