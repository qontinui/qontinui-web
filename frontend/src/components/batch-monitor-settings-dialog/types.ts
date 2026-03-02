import type { State } from "@/contexts/automation-context";

export interface BatchMonitorSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  states: State[];
  onApplyMonitors: (stateIds: string[], monitors: number[]) => Promise<void>;
}
