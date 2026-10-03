"use client";

/**
 * The headline figures — month to date, today so far, yesterday, last month —
 * and, for each vendor with a ceiling, a month-to-date meter against it.
 *
 * Each figure adds the vendors' provider-reported amounts. A vendor whose
 * figure is not available adds nothing and the figure says so: "at least $X
 * (GitHub not available)", never a bare total. Each figure names where its
 * numbers came from and which view (amortized / charged) it is in.
 */

import { formatMicros } from "@/components/overview/money";
import {
  combineFigure,
  combinedText,
  meterTone,
  monthKey,
  provenanceLine,
  unavailableSentence,
  viewLabel,
  isVendorUnknown,
  type VendorFigure,
} from "../_lib/spend";
import type { SpendSummary, SpendVendor } from "../_lib/spend-api";

const FIGURES: { figure: VendorFigure; label: string; id: string }[] = [
  { figure: "month_to_date_micros", label: "This month so far", id: "mtd" },
  { figure: "today_micros", label: "Today so far", id: "today" },
  { figure: "yesterday_micros", label: "Yesterday", id: "yesterday" },
  { figure: "last_month_micros", label: "Last month", id: "last-month" },
];

function missingReason(vendor: SpendVendor): string {
  return isVendorUnknown(vendor) || vendor.status === "not_linked"
    ? `${vendor.name}: ${unavailableSentence(vendor)}`
    : `${vendor.name}: no figure reported for this period`;
}

function Figure({
  summary,
  figure,
  label,
  uiBridgeId,
}: {
  summary: SpendSummary;
  figure: VendorFigure;
  label: string;
  uiBridgeId: string;
}) {
  const combined = combineFigure(summary.vendors, figure);
  const { text, partial } = combinedText(combined, summary.currency);
  const provenance = provenanceLine(combined);
  return (
    <div data-ui-bridge-id={uiBridgeId} data-partial={partial || undefined}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className="mt-1 font-[family-name:var(--font-overview-serif)] text-2xl leading-tight text-foreground"
        data-ui-bridge-id={`${uiBridgeId}.value`}
      >
        {text ?? (
          <span className="text-lg text-muted-foreground">Not available</span>
        )}
      </dd>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {viewLabel(summary.view)}.
      </p>
      {provenance && (
        <p
          className="mt-1 text-xs leading-relaxed text-muted-foreground"
          data-ui-bridge-id={`${uiBridgeId}.provenance`}
        >
          {provenance}
        </p>
      )}
      {combined.missing.length > 0 && (
        <ul
          className="mt-1 space-y-0.5 text-xs leading-relaxed text-muted-foreground"
          data-ui-bridge-id={`${uiBridgeId}.missing`}
        >
          {combined.missing.map((v) => (
            <li key={v.id}>{missingReason(v)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const METER_FILL = {
  normal: "bg-primary",
  warning: "bg-warning",
  over: "bg-error",
} as const;

const METER_WORD = {
  normal: "Within the ceiling",
  warning: "Past a warning threshold",
  over: "At or over the ceiling",
} as const;

function CeilingMeter({
  vendor,
  summary,
}: {
  vendor: SpendVendor;
  summary: SpendSummary;
}) {
  const id = `overview.costs.meter.${vendor.id}`;
  const spent = formatMicros(vendor.month_to_date_micros, summary.currency, {
    maximumFractionDigits: 2,
  });
  const ceiling = formatMicros(vendor.ceiling_micros, summary.currency);
  if (vendor.month_to_date_micros === null || vendor.ceiling_pct === null) {
    return (
      <div data-ui-bridge-id={id}>
        <p className="text-sm text-foreground">
          {vendor.name} — ceiling {ceiling}
        </p>
        <p
          className="mt-1 text-xs text-muted-foreground"
          data-ui-bridge-id={`${id}.unavailable`}
        >
          {unavailableSentence(vendor)}
        </p>
      </div>
    );
  }
  const tone = meterTone(vendor, summary.alerts, monthKey(summary.to));
  const pct = vendor.ceiling_pct;
  return (
    <div data-ui-bridge-id={id} data-tone={tone}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-foreground">
          {vendor.name}: {spent} of {ceiling} this month
        </p>
        <p className="text-sm tabular-nums text-foreground">
          {Math.round(pct)}%
        </p>
      </div>
      <div
        role="meter"
        aria-label={`${vendor.name} month to date against its ceiling`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(pct, 100)}
        aria-valuetext={`${Math.round(pct)}% of the ceiling — ${METER_WORD[tone]}`}
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full ${METER_FILL[tone]}`}
          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {METER_WORD[tone]}. {vendor.provenance ?? ""}
        {isVendorUnknown(vendor) ? ` ${unavailableSentence(vendor)}.` : ""}
      </p>
    </div>
  );
}

export function SpendFigures({ summary }: { summary: SpendSummary }) {
  const withCeiling = summary.vendors.filter((v) => v.ceiling_micros !== null);
  return (
    <div className="space-y-8">
      <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {FIGURES.map((f) => (
          <Figure
            key={f.id}
            summary={summary}
            figure={f.figure}
            label={f.label}
            uiBridgeId={`overview.costs.figure.${f.id}`}
          />
        ))}
      </dl>
      {withCeiling.length > 0 && (
        <div className="space-y-5" data-ui-bridge-id="overview.costs.meters">
          {withCeiling.map((v) => (
            <CeilingMeter key={v.id} vendor={v} summary={summary} />
          ))}
        </div>
      )}
    </div>
  );
}
