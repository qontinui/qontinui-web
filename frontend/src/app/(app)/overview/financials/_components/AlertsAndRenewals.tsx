"use client";

/**
 * Recent spend alerts with how each push was actually delivered (accepted by
 * the push service is not delivered), and the yearly charges coming up in
 * the next 60 days — each "charged on renewal".
 */

import { formatMicros } from "@/components/overview/money";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { Skeleton } from "@/components/ui/skeleton";
import {
  coordLabel,
  formatDay,
  formatFetched,
  pushLabel,
  ruleLabel,
} from "../_lib/spend";
import type { Renewal, SpendSummary } from "../_lib/spend-api";
import type { Loadable } from "../_lib/useSpend";
import { StatusBadge } from "./StatusBadge";

export function AlertsList({ summary }: { summary: SpendSummary }) {
  const id = "overview.costs.alerts";
  const names = new Map(summary.vendors.map((v) => [v.id, v.name]));
  if (summary.alerts.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-ui-bridge-id={`${id}.empty`}
      >
        No spend alerts have fired in this period.
      </p>
    );
  }
  const alerts = [...summary.alerts].sort((a, b) =>
    b.fired_at.localeCompare(a.fired_at)
  );
  return (
    <ul className="divide-y divide-border/60" data-ui-bridge-id={id}>
      {alerts.map((alert) => {
        const push = pushLabel(alert.push_status);
        const observed = formatMicros(alert.observed_micros, summary.currency, {
          maximumFractionDigits: 2,
        });
        const threshold = formatMicros(
          alert.threshold_micros,
          summary.currency,
          { maximumFractionDigits: 2 }
        );
        const vendor = alert.vendor_id ? names.get(alert.vendor_id) : null;
        return (
          <li
            key={alert.id}
            className="py-3"
            data-ui-bridge-id={`${id}.${alert.id}`}
            data-rule={alert.rule}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[15px] text-foreground">
                {ruleLabel(alert.rule)}
                {vendor ? ` — ${vendor}` : ""}
                {alert.scope_key && alert.scope_key !== "org"
                  ? ` · ${alert.scope_key}`
                  : ""}
              </p>
              <StatusBadge
                label={push.label}
                tone={push.tone}
                uiBridgeId={`${id}.${alert.id}.push`}
              />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {alert.period_key.length === 7
                ? `Month ${alert.period_key}`
                : formatDay(alert.period_key)}
              {observed ? ` · ${observed}` : ""}
              {threshold ? ` against ${threshold}` : ""}
              {" · fired "}
              {formatFetched(alert.fired_at)}
              {alert.resolved_at
                ? ` · resolved ${formatFetched(alert.resolved_at)}`
                : ""}
            </p>
            <p
              className="mt-0.5 text-xs text-muted-foreground"
              data-ui-bridge-id={`${id}.${alert.id}.coord`}
            >
              Agents: {coordLabel(alert.coord_status)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function RenewalsList({ renewals }: { renewals: Loadable<Renewal[]> }) {
  const id = "overview.costs.renewals";
  if (renewals.state === "loading") {
    return (
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-10/12" />
      </div>
    );
  }
  if (renewals.state === "error") {
    return (
      <LoadFailure
        what="the upcoming renewals"
        message={renewals.message}
        uiBridgeId={`${id}.error`}
        announce={false}
      />
    );
  }
  if (renewals.data.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-ui-bridge-id={`${id}.empty`}
      >
        No yearly charges are due in the next 60 days.
      </p>
    );
  }
  const rows = [...renewals.data].sort((a, b) =>
    a.renews_on.localeCompare(b.renews_on)
  );
  return (
    <ul className="divide-y divide-border/60" data-ui-bridge-id={id}>
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex flex-wrap items-baseline justify-between gap-2 py-3"
          data-ui-bridge-id={`${id}.${r.id}`}
        >
          <div className="min-w-0">
            <p className="text-[15px] text-foreground">
              {r.vendor_name} — {r.description}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatDay(r.renews_on)} · charged on renewal
              {r.auto_renew === true ? " · renews automatically" : ""}
              {r.auto_renew === false ? " · auto-renew is off" : ""}
            </p>
          </div>
          <p className="text-[15px] tabular-nums text-foreground">
            {formatMicros(r.amount_micros, r.currency, {
              maximumFractionDigits: 2,
            }) ?? (
              <span className="text-muted-foreground">Amount not entered</span>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
