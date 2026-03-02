"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Route, ChevronDown, ChevronRight } from "lucide-react";
import { ROUTING_MODELS, type RoutingSettings } from "../types";

interface RoutingSectionProps {
  value: RoutingSettings;
  onChange: (value: RoutingSettings) => void;
}

export function RoutingSection({ value, onChange }: RoutingSectionProps) {
  const [open, setOpen] = useState(false);

  const update = (patch: Partial<RoutingSettings>) =>
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
            <Route className="size-4" />
            Intelligent Task Routing
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
          <div className="space-y-2">
            <Label>Simple Tasks Model</Label>
            <Select
              value={value.simple_model}
              onValueChange={(v) => update({ simple_model: v })}
              disabled={!value.enabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUTING_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Medium Tasks Model</Label>
            <Select
              value={value.medium_model}
              onValueChange={(v) => update({ medium_model: v })}
              disabled={!value.enabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUTING_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Complex Tasks Model</Label>
            <Select
              value={value.complex_model}
              onValueChange={(v) => update({ complex_model: v })}
              disabled={!value.enabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUTING_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Simple Threshold (files)</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={value.file_threshold_simple}
              onChange={(e) =>
                update({ file_threshold_simple: Number(e.target.value) })
              }
              disabled={!value.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Tasks touching this many files or fewer use the simple model
            </p>
          </div>

          <div className="space-y-2">
            <Label>Medium Threshold (files)</Label>
            <Input
              type="number"
              min={2}
              max={50}
              value={value.file_threshold_medium}
              onChange={(e) =>
                update({ file_threshold_medium: Number(e.target.value) })
              }
              disabled={!value.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Tasks touching this many files or fewer use the medium model; more
              uses the complex model
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
