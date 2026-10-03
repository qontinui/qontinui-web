"use client";

/**
 * The shipped-plans lane as text — what the list view, a phone and a screen
 * reader get. The same plans as the chart's lane, in the order they shipped,
 * each with its day. A read under way or one that failed is said, never shown
 * as an empty list.
 */

import type { ShippedPlansState } from "../../_hooks/useShippedPlans";
import { formatDay, shipDay } from "../../_lib/timeline";

export function ShippedPlansList({ shipped }: { shipped: ShippedPlansState }) {
  const id = "overview.timeline.list.shipped";
  let body: React.ReactNode;
  if (shipped.state === "loading") {
    body = <p className="text-sm text-muted-foreground">Reading…</p>;
  } else if (shipped.state === "error") {
    body = (
      <p className="text-sm text-muted-foreground">
        The shipped plans could not be read: {shipped.message}
      </p>
    );
  } else {
    const { items, undated, truncated } = shipped.shipped;
    body = (
      <>
        {items.length === 0 && undated === 0 && !truncated && (
          <p className="text-sm text-muted-foreground">
            No plan has shipped yet.
          </p>
        )}
        {items.length > 0 && (
          <ul className="space-y-1 text-sm" data-ui-bridge-id={`${id}.items`}>
            {items.map((plan) => {
              const day = formatDay(shipDay(plan.shippedAt));
              return (
                <li key={plan.slug} data-ui-bridge-id={`${id}.${plan.slug}`}>
                  <span className="text-foreground">{plan.title}</span>{" "}
                  <span className="text-muted-foreground">
                    · {day ? `shipped ${day}` : "ship date unreadable"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {(undated > 0 || truncated) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {undated > 0 &&
              `${undated} more shipped with no ship date recorded. `}
            {truncated &&
              "Only the first plans read are listed; there may be more."}
          </p>
        )}
      </>
    );
  }
  return (
    <div data-ui-bridge-id={id} data-state={shipped.state}>
      <h3 className="font-[family-name:var(--font-overview-serif)] text-xl leading-snug text-foreground">
        Shipped plans
      </h3>
      <div className="mt-2 border-l-2 border-border pl-4">{body}</div>
    </div>
  );
}
