/**
 * The words an estimate is described in — the ONE place purpose-specific
 * wording lives.
 *
 * The same numbers mean different things on different projects (plan
 * `2026-09-19-project-overview-for-business-leaders`, "Design decisions" 1):
 * a `budget` is money the project is expected to spend, so actuals are
 * tracked *against* it; a `comparison` is what conventional delivery would
 * have cost, so actuals are shown *beside* it and the difference is a saving;
 * a `forecast` is a projection with no commitment. No page may show budget
 * language for a comparison estimate, or saving language for a budget.
 *
 * Every overview surface reads its labels from here rather than spelling them
 * inline, so that rule is enforced by construction instead of by review.
 */

export type EstimatePurpose = "budget" | "comparison" | "forecast";

export type LabourBilling = "unbilled" | "day_rates" | "fixed_fee";

export interface EstimateVocabulary {
  purpose: EstimatePurpose;
  /** What this estimate IS, capitalised for a heading: "Budget". */
  noun: string;
  /** The same word mid-sentence: "budget". */
  nounLower: string;
  /** Heading over a priced figure: "Budgeted fee". */
  feeLabel: string;
  /** Heading over the whole: "Total budget". */
  totalLabel: string;
  /** What a recorded actual is called beside it. */
  actualLabel: string;
  /** What the gap between actual and estimate is called. */
  differenceLabel: string;
  /** One sentence saying what these numbers commit the project to. */
  meaning: string;
}

const VOCABULARIES: Record<EstimatePurpose, EstimateVocabulary> = {
  budget: {
    purpose: "budget",
    noun: "Budget",
    nounLower: "budget",
    feeLabel: "Budgeted fee",
    totalLabel: "Total budget",
    actualLabel: "Spent",
    differenceLabel: "Remaining",
    meaning:
      "This is the money the project is expected to spend, so what it actually spends is tracked against it.",
  },
  comparison: {
    purpose: "comparison",
    noun: "Comparison estimate",
    nounLower: "comparison estimate",
    feeLabel: "Fee if delivered conventionally",
    totalLabel: "Total if delivered conventionally",
    actualLabel: "Actual",
    differenceLabel: "Saving",
    meaning:
      "This is what the work would cost delivered conventionally. It is a baseline to compare against, not money this project will spend.",
  },
  forecast: {
    purpose: "forecast",
    noun: "Forecast",
    nounLower: "forecast",
    feeLabel: "Forecast fee",
    totalLabel: "Total forecast",
    actualLabel: "Actual",
    differenceLabel: "Against forecast",
    meaning:
      "This is a projection of what the work is likely to cost. It is not a commitment.",
  },
};

export function estimateVocabulary(
  purpose: EstimatePurpose | string | null | undefined
): EstimateVocabulary {
  // An unrecognised purpose is read as `forecast`: of the three it promises
  // the least, so a mislabelled estimate understates rather than overstates
  // what the project has committed to.
  if (
    purpose === "budget" ||
    purpose === "comparison" ||
    purpose === "forecast"
  ) {
    return VOCABULARIES[purpose];
  }
  return VOCABULARIES.forecast;
}

/**
 * How labour is paid for, said plainly. Under `unbilled` the labour cost is
 * genuinely zero and the page says WHY — the plan's "it is never silently
 * omitted".
 */
export function labourBillingDescription(billing: LabourBilling | string): {
  label: string;
  detail: string;
} {
  switch (billing) {
    case "day_rates":
      return {
        label: "Billed by day rate",
        detail:
          "Time recorded against this project is charged at each role's day rate.",
      };
    case "fixed_fee":
      return {
        label: "Billed as a fixed fee",
        detail:
          "Labour is charged as agreed fee instalments rather than by time recorded.",
      };
    case "unbilled":
      return {
        label: "Not billed",
        detail:
          "Nobody charges this project for their time, so the rates below price the work for comparison only.",
      };
    default:
      return {
        label: "Not known",
        detail:
          "How labour is paid for has not been recorded for this project, so the rates below are not a cost.",
      };
  }
}
