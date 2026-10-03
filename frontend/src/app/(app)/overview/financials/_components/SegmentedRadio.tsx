"use client";

/**
 * A segmented choice built from REAL radio inputs, so the keyboard behaves
 * as a radio group does with nothing hand-rolled: Tab enters the group at
 * the checked option, the arrow keys move and select, and a screen reader
 * hears "radio, 1 of 2". The inputs are visually hidden; each segment is the
 * input's label.
 */

import { useId } from "react";

export function SegmentedRadio<T extends string>({
  legend,
  legendVisible = false,
  value,
  options,
  onChange,
  uiBridgeId,
}: {
  /** What the choice is about — the group's accessible name. */
  legend: string;
  /** Show the legend as text before the segments. */
  legendVisible?: boolean;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  uiBridgeId: string;
}) {
  const name = useId();
  return (
    <fieldset
      className="flex min-w-0 flex-wrap items-center gap-2 text-sm"
      data-ui-bridge-id={uiBridgeId}
    >
      {/* A <legend> cannot be a flex item, so it stays the group's name for
          assistive tech while a visible twin (aria-hidden) sits in the row
          and wraps with it at narrow widths — no float to collide with. */}
      <legend className="sr-only">{legend}</legend>
      {legendVisible && (
        <span aria-hidden className="text-muted-foreground">
          {legend}
        </span>
      )}
      <div className="inline-flex rounded-md border border-border p-0.5">
        {options.map(([option, label]) => (
          <label key={option} className="relative">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="peer sr-only"
              data-ui-bridge-id={`${uiBridgeId}.${option}`}
            />
            <span className="inline-flex min-h-8 cursor-pointer items-center rounded px-3 text-muted-foreground hover:text-foreground peer-checked:bg-muted peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
              {label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
