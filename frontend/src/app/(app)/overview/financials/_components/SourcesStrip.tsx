"use client";

/**
 * One card per provider: whether its figures can be trusted right now, why
 * not when they cannot, when it was last fetched, where its numbers come
 * from, and its prepaid balance where one is known (a balance, never spend).
 *
 * Each card offers "Add a recurring cost" — the authoring kit's create form
 * for the `recurring_costs` resource, shown only when the server says this
 * viewer may write it. For a provider with no billing API that is the whole
 * setup, and the card says so.
 */

import { useRef, useState } from "react";
import { formatMicros } from "@/components/overview/money";
import {
  createResource,
  describeWriteFailure,
  isRefusal,
} from "@/components/overview/editing/api";
import {
  EditGate,
  useResourceDescriptor,
} from "@/components/overview/editing/permissions";
import { RecordForm } from "@/components/overview/editing/RecordForm";
import {
  RECURRING_COST_FORM,
  blankRecurringCost,
  type RecurringCostWrite,
} from "@/components/overview/editing/registry";
import type { SaveResult } from "@/components/overview/editing/useResource";
import {
  formatDay,
  formatFetched,
  isVendorUnknown,
  statusLabel,
  unavailableSentence,
} from "../_lib/spend";
import type { SpendSummary, SpendVendor } from "../_lib/spend-api";
import { StatusBadge } from "./StatusBadge";

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Optional text left empty is sent as `null`, not as an empty string; a
 *  quantity left empty is omitted, so the server's default (1) applies. */
function tidy(row: RecurringCostWrite): Record<string, unknown> {
  const body: Record<string, unknown> = { ...row };
  for (const key of ["source_note", "external_ref", "end_date", "renews_on"]) {
    if (body[key] === "") body[key] = null;
  }
  if (body.quantity === null || body.quantity === "") delete body.quantity;
  return body;
}

/** What a card says about how this provider's spend gets here. */
function setupNote(vendor: SpendVendor): string | null {
  if (vendor.connector === null || vendor.status === "manual") {
    return "This provider has no billing API we read. Its spend is the invoice amount, entered here as a recurring cost — that is the whole setup.";
  }
  if (vendor.status === "not_linked") {
    return vendor.connector === "google_play_earnings"
      ? "Not linked — optional, only needed once the app earns revenue."
      : "Not linked yet, so nothing is read from this provider. Fixed fees can still be added as recurring costs.";
  }
  return null;
}

function SourceCard({
  vendor,
  currency,
  onAdd,
  adding,
}: {
  vendor: SpendVendor;
  currency: string;
  onAdd: () => void;
  adding: boolean;
}) {
  const id = `overview.costs.source.${vendor.id}`;
  const status = statusLabel(vendor.status);
  const unknown = isVendorUnknown(vendor);
  const note = setupNote(vendor);
  const balance = formatMicros(vendor.balance_micros, currency, {
    maximumFractionDigits: 2,
  });
  const fetched = formatFetched(vendor.last_ok_at);
  return (
    <li
      className="flex min-w-0 flex-col rounded-md border border-border p-4"
      data-ui-bridge-id={id}
      data-status={vendor.status}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-foreground">
            {vendor.name}
          </p>
          <p className="text-xs text-muted-foreground">{vendor.category}</p>
        </div>
        <StatusBadge
          label={status.label}
          tone={status.tone}
          uiBridgeId={`${id}.status`}
        />
      </div>

      {unknown && (
        <p
          className="mt-2 text-sm text-foreground"
          data-ui-bridge-id={`${id}.unavailable`}
        >
          {unavailableSentence(vendor)}
        </p>
      )}
      {!unknown && vendor.status_reason && (
        <p className="mt-2 text-sm text-muted-foreground">
          {vendor.status_reason}
        </p>
      )}
      {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}

      <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
        {vendor.connector !== null && (
          <div>
            <dt className="inline">Last fetched: </dt>
            <dd className="inline text-foreground">{fetched ?? "never"}</dd>
          </div>
        )}
        {vendor.newest_complete_day && (
          <div>
            <dt className="inline">Complete through: </dt>
            <dd className="inline text-foreground">
              {formatDay(vendor.newest_complete_day)}
            </dd>
          </div>
        )}
        {vendor.provenance && (
          <div data-ui-bridge-id={`${id}.provenance`}>
            <dt className="sr-only">Source</dt>
            <dd>{vendor.provenance}</dd>
          </div>
        )}
        {balance !== null && (
          <div data-ui-bridge-id={`${id}.balance`}>
            <dt className="inline">Prepaid balance: </dt>
            <dd className="inline text-foreground">
              {balance}{" "}
              <span className="text-muted-foreground">
                (a balance, not spend)
              </span>
            </dd>
          </div>
        )}
      </dl>

      <EditGate resource={RECURRING_COST_FORM.resource}>
        <div className="mt-auto pt-3">
          <button
            type="button"
            onClick={onAdd}
            disabled={adding}
            className="inline-flex min-h-9 items-center rounded-md px-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground disabled:no-underline"
            data-ui-bridge-id={`${id}.add-recurring`}
          >
            Add a recurring cost
          </button>
        </div>
      </EditGate>
    </li>
  );
}

function AddRecurringCost({
  vendor,
  onDone,
}: {
  vendor: SpendVendor;
  onDone: (saved: boolean) => void;
}) {
  const descriptor = useResourceDescriptor(RECURRING_COST_FORM.resource);
  // One key per cost the reader means to add: kept across a LOST attempt so a
  // retry answers with what that attempt made, replaced after a refusal or
  // when the values change.
  const key = useRef<{ value: string; body: string } | null>(null);

  const submit = async (
    row: RecurringCostWrite
  ): Promise<SaveResult<unknown>> => {
    const body = tidy(row);
    const fingerprint = JSON.stringify(body);
    if (key.current?.body !== fingerprint) {
      key.current = { value: newKey(), body: fingerprint };
    }
    try {
      const item = await createResource<unknown>(
        "spend/recurring-costs",
        body,
        key.current.value
      );
      return { ok: true, item };
    } catch (err) {
      if (isRefusal(err)) key.current = null;
      return { ok: false, error: describeWriteFailure(err) };
    }
  };

  return (
    <RecordForm
      form={RECURRING_COST_FORM}
      initial={blankRecurringCost(vendor.id)}
      schema={descriptor?.schemas.create}
      onSubmit={submit}
      onDone={onDone}
      uiBridgeId="overview.costs.add-recurring"
      intro={
        <p className="mb-3 text-sm text-foreground">
          A recurring cost for <strong>{vendor.name}</strong>, entered from the
          provider&rsquo;s invoice. It is shown as &ldquo;entered manually —
          from the provider&rsquo;s invoice&rdquo;, never as a figure the
          provider reported.
        </p>
      }
    />
  );
}

export function SourcesStrip({
  summary,
  onChanged,
}: {
  summary: SpendSummary;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const addingVendor = summary.vendors.find((v) => v.id === adding) ?? null;

  if (summary.vendors.length === 0) {
    return (
      <p
        className="text-[15px] text-muted-foreground"
        data-ui-bridge-id="overview.costs.sources.empty"
      >
        No providers are set up for this project yet, so there is nothing to
        show — which is not the same as nothing spent.
      </p>
    );
  }

  return (
    <div data-ui-bridge-id="overview.costs.sources">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {summary.vendors.map((v) => (
          <SourceCard
            key={v.id}
            vendor={v}
            currency={summary.currency}
            adding={adding === v.id}
            onAdd={() => setAdding(v.id)}
          />
        ))}
      </ul>
      {addingVendor && (
        <div className="mt-5">
          <AddRecurringCost
            key={addingVendor.id}
            vendor={addingVendor}
            onDone={(saved) => {
              setAdding(null);
              if (saved) onChanged();
            }}
          />
        </div>
      )}
    </div>
  );
}
