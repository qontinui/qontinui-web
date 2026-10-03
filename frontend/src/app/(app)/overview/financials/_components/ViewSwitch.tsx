"use client";

/** "Monthly figures: amortized | as charged" (plan decision 12). Amortized
 *  spreads a yearly cost over the months it covers; as charged puts it on
 *  its renewal date. */

import type { SpendView } from "../_lib/spend-api";
import { SegmentedRadio } from "./SegmentedRadio";

const OPTIONS = [
  ["amortized", "amortized"],
  ["charged", "as charged"],
] as const;

export function ViewSwitch({
  view,
  onChange,
}: {
  view: SpendView;
  onChange: (view: SpendView) => void;
}) {
  return (
    <SegmentedRadio<SpendView>
      legend="Monthly figures:"
      legendVisible
      value={view}
      options={OPTIONS}
      onChange={onChange}
      uiBridgeId="overview.costs.view"
    />
  );
}
