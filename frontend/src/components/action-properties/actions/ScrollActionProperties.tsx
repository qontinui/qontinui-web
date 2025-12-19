"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import type { ScrollActionConfig } from "@/lib/action-schema/configs/mouse-actions";

/**
 * Properties component for SCROLL action.
 */
export function ScrollActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as ScrollActionConfig;

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Direction</Label>
        <Select
          value={(config.direction as string) || "down"}
          onValueChange={(value) => updateConfig("direction", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="up">Up</SelectItem>
            <SelectItem value="down">Down</SelectItem>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="right">Right</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Amount (scroll units)</Label>
        <Input
          type="number"
          min="1"
          value={(config.clicks as number) || 1}
          onChange={(e) =>
            updateConfig("clicks", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-gray-700"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Scroll Duration (ms)</Label>
        <Input
          type="number"
          min="0"
          value={((config as any).scroll_duration as number) || 0}
          onChange={(e) =>
            updateConfig("scroll_duration", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-gray-700"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="smooth_scroll"
          checked={((config as any).smooth_scroll as boolean) || false}
          onCheckedChange={(checked) => updateConfig("smooth_scroll", checked)}
        />
        <Label htmlFor="smooth_scroll" className="text-xs text-gray-400">
          Smooth scroll
        </Label>
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
