"use client";

/**
 * "The roles this project needs" — code, name, responsibility and day rate.
 *
 * A role with no rate is shown as "not priced", never as a rate of zero, and
 * the client's own (unpriced) roles are listed in their own table below so
 * they are never read as part of what this project is paying for.
 */

import { formatMicros } from "@/components/overview/money";
import { NotAvailable } from "@/components/overview/UnavailableNotes";
import type { RollupRole } from "../../_lib/estimate-api";

function RoleRows({
  roles,
  showRate,
  uiBridgeId,
}: {
  roles: RollupRole[];
  showRate: boolean;
  uiBridgeId: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-[34rem] border-collapse text-sm"
        data-ui-bridge-id={uiBridgeId}
      >
        <thead>
          <tr className="border-b border-border text-left">
            <th
              scope="col"
              className="py-2 pr-4 font-medium text-muted-foreground"
            >
              Code
            </th>
            <th
              scope="col"
              className="py-2 pr-4 font-medium text-muted-foreground"
            >
              Role
            </th>
            <th
              scope="col"
              className="py-2 pr-4 font-medium text-muted-foreground"
            >
              What they do
            </th>
            {showRate && (
              <th
                scope="col"
                className="py-2 text-right font-medium text-muted-foreground"
              >
                Day rate
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr
              key={role.id}
              className="border-b border-border/60 last:border-b-0"
              data-ui-bridge-id={`${uiBridgeId}.${role.code}`}
            >
              <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                {role.code}
              </td>
              <td className="py-2 pr-4 text-foreground">{role.name}</td>
              <td className="py-2 pr-4 leading-relaxed text-muted-foreground">
                {role.responsibility || <NotAvailable label="not described" />}
              </td>
              {showRate && (
                <td className="py-2 text-right tabular-nums text-foreground">
                  {formatMicros(role.day_rate_micros, role.currency) ?? (
                    <NotAvailable label="not priced" />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RolesTable({ roles }: { roles: RollupRole[] }) {
  const ours = roles.filter((r) => !r.client_side);
  const theirs = roles.filter((r) => r.client_side);

  if (roles.length === 0) {
    return (
      <p
        className="text-[15px] leading-relaxed text-muted-foreground"
        data-ui-bridge-id="overview.team.roles.empty"
      >
        No roles have been entered for this estimate yet, so there is nothing to
        price the work with.
      </p>
    );
  }

  return (
    <div className="space-y-8" data-ui-bridge-id="overview.team.roles">
      {ours.length > 0 && (
        <RoleRows
          roles={ours}
          showRate
          uiBridgeId="overview.team.roles.delivery"
        />
      )}
      {theirs.length > 0 && (
        <div data-ui-bridge-id="overview.team.roles.client-side-section">
          <h3 className="font-[family-name:var(--font-overview-serif)] text-lg text-foreground">
            The client&rsquo;s own people
          </h3>
          <p className="mb-3 mt-1 text-sm leading-relaxed text-muted-foreground">
            These roles are needed for the work to happen but are not priced by
            this estimate, so their effort is counted separately and never
            appears in a fee.
          </p>
          <RoleRows
            roles={theirs}
            showRate={false}
            uiBridgeId="overview.team.roles.client-side"
          />
        </div>
      )}
    </div>
  );
}
