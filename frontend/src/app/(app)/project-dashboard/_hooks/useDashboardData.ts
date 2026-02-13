import { useMemo } from "react";
import { generateMockProjectData } from "../_lib";
import type { ProjectData } from "../_lib/types";

export interface DashboardDataResult {
  data: ProjectData;
}

export function useDashboardData(): DashboardDataResult {
  const data = useMemo(() => generateMockProjectData(), []);

  return { data };
}
