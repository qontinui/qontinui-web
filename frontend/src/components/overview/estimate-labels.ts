import type { EstimatePurpose } from "@/app/(app)/overview/types";

export function estimateLabels(purpose: EstimatePurpose) {
  switch (purpose) {
    case "budget":
      return {
        estimate: "Budget",
        actual: "Spent",
        remaining: "Remaining",
        overUnder: (over: boolean) => over ? "Over budget by" : "Under budget by",
      };
    case "comparison":
      return {
        estimate: "Estimate (for comparison)",
        actual: "Actual",
        remaining: "Saving vs estimate",
        overUnder: (over: boolean) => over ? "Over estimate by" : "Saving vs estimate",
      };
    case "forecast":
      return {
        estimate: "Forecast",
        actual: "Actual",
        remaining: "Ahead of forecast",
        overUnder: (over: boolean) => over ? "Behind forecast" : "Ahead of forecast",
      };
  }
}
