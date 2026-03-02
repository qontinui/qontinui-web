import type { GroupingMethod } from "@/services/template-capture-service";

export interface GroupingMethodOption {
  value: GroupingMethod;
  label: string;
  description: string;
  requiresConfig: boolean;
}

export const GROUPING_METHODS: GroupingMethodOption[] = [
  {
    value: "state_hints",
    label: "State Hints",
    description:
      "Group templates by their assigned state hints (set during review)",
    requiresConfig: false,
  },
  {
    value: "co_occurrence",
    label: "Co-Occurrence Analysis",
    description:
      "Group templates that appear together in the same video frames",
    requiresConfig: true,
  },
  {
    value: "single_state",
    label: "Single State",
    description: "Put all templates into a single state",
    requiresConfig: true,
  },
  {
    value: "one_per_template",
    label: "One State per Template",
    description: "Create a separate state for each template",
    requiresConfig: false,
  },
  {
    value: "user_assignments",
    label: "Manual Assignments",
    description: "Manually assign templates to states",
    requiresConfig: true,
  },
];
