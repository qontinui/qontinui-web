"use client";

/** "Monthly figures: amortized | as charged" (plan decision 12). Amortized
 *  spreads a yearly cost over the months it covers; as charged puts it on
 *  its renewal date. */

import type { SpendView } from "../_lib/spend-api";

export function ViewSwitch({
  view,
  onChange,
}: {
  view: SpendView;
  onChange: (view: SpendView) => void;
}) {
  const options: [SpendView, string][] = [
    ["amortized", "amortized"],
    ["charged", "as charged"],
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-sm"
      data-ui-bridge-id="overview.costs.view"
    >
      <span id="overview-costs-view-label" className="text-muted-foreground">
        Monthly figures:
      </span>
      <div
        role="radiogroup"
        aria-labelledby="overview-costs-view-label"
        className="inline-flex rounded-md border border-border p-0.5"
      >
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={view === value}
            onClick={() => onChange(value)}
            className={`min-h-8 rounded px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              view === value
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-ui-bridge-id={`overview.costs.view.${value}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
