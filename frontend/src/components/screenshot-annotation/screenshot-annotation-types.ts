import { State } from "../../contexts/automation-context/types";

export interface ScreenshotAnnotationTabProps {
  states: State[];
}

export interface MonitorInfo {
  index: number;
  width: number;
  height: number;
  is_primary: boolean;
}
