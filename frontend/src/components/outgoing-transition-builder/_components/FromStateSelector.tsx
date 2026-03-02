"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { State } from "@/contexts/automation-context/types";

interface FromStateSelectorProps {
  states: State[];
  fromState: string;
  staysVisible: boolean;
  onFromStateChange: (stateId: string) => void;
  onStaysVisibleChange: (checked: boolean) => void;
}

export function FromStateSelector({
  states,
  fromState,
  staysVisible,
  onFromStateChange,
  onStaysVisibleChange,
}: FromStateSelectorProps) {
  return (
    <>
      <div>
        <Label className="mb-2 block">From State (Origin)</Label>
        <Select value={fromState} onValueChange={onFromStateChange}>
          <SelectTrigger className="bg-transparent border-border-subtle">
            <SelectValue placeholder="Select origin state" />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {states.map((state) => (
              <SelectItem key={state.id} value={state.id}>
                {state.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="stays-visible"
          checked={staysVisible}
          onCheckedChange={onStaysVisibleChange}
        />
        <Label htmlFor="stays-visible" className="text-sm">
          Origin state stays visible after transition
        </Label>
      </div>
    </>
  );
}
