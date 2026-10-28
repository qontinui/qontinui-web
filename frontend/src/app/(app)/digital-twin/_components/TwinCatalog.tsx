"use client";

import { Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePresentationMode } from "@/components/presentation";
import { useTwinCatalog } from "../_hooks/useTwinCatalog";
import { failureTail } from "../_lib/failure-text";
import type { TwinCatalogEntry } from "../_lib/types";

/**
 * The computed `observed` bit, from coord's newest twin-fidelity report.
 * `null` is UNKNOWN — no report yet, or the report does not measure this
 * row — and renders as such, never as "no".
 */
function ObservedBadge({
  observed,
}: {
  observed: TwinCatalogEntry["observed"];
}) {
  if (observed === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        UNKNOWN
      </Badge>
    );
  }
  return (
    <Badge variant={observed ? "default" : "destructive"}>
      {observed ? "observed" : "blind"}
    </Badge>
  );
}

/**
 * Queryable surface — coord's authoritative catalog of the `coord_query_*` twin
 * observers. This is the single source of truth for *which* surfaces are
 * queryable (the same list the agent Q&A meta-answer expands into its
 * `{{twin-catalog}}` token) and for which of them the matrix above probes.
 *
 * Two availability columns, never one: `declared_status` is what the catalog
 * DECLARES ("live" for a wired observer — a declaration, not an observation),
 * and `observed` is what coord's newest twin-fidelity report COMPUTED. A row
 * the report does not measure, or any row before a report exists, reads
 * UNKNOWN.
 */
export function TwinCatalog() {
  const { data, isLoading, isError, error } = useTwinCatalog();
  const { presenting } = usePresentationMode();

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Boxes className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">
          Queryable surface (coord-served)
        </h2>
        {data && (
          <span className="text-xs text-muted-foreground">
            {data.total} observer{data.total === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        The authoritative index of the fleet-wide twin observers an agent (or
        the decision-delegation meta-answer) can query. Served by coord.
      </p>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading catalog…
        </div>
      ) : isError ? (
        <div
          data-testid="twin-catalog-error"
          className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground"
        >
          {/* The message quotes the upstream body: the operator's alone. */}
          Couldn&apos;t load the catalog{failureTail(error, presenting)}.
        </div>
      ) : data?.coord_error ? (
        <div
          data-testid="twin-catalog-coord-error"
          className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground"
        >
          Coord is unavailable — catalog can&apos;t be read right now
          {/* coord's own error text can name a host: the operator's alone. */}
          {presenting ? "" : ` (${data.coord_error})`}.
        </div>
      ) : !data || data.entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          No queryable surfaces reported.
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[12rem]">Surface</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[14rem]">Query tool</TableHead>
                <TableHead className="w-[10rem]">Params</TableHead>
                <TableHead className="w-[7rem]">Kind</TableHead>
                <TableHead className="w-[6rem]">Declared</TableHead>
                <TableHead className="w-[6rem]">Observed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  data-testid={`catalog-row-${entry.id}`}
                >
                  <TableCell className="font-medium">{entry.id}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.description}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{entry.query_tool}</code>
                  </TableCell>
                  <TableCell>
                    {!entry.params || entry.params.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <code className="text-xs">{entry.params.join(", ")}</code>
                    )}
                  </TableCell>
                  <TableCell>
                    {entry.kind === null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Badge
                        variant={
                          entry.kind === "snapshot" ? "secondary" : "outline"
                        }
                      >
                        {entry.kind}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        entry.declared_status === "live"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {entry.declared_status}
                    </Badge>
                  </TableCell>
                  <TableCell data-testid={`catalog-observed-${entry.id}`}>
                    <ObservedBadge observed={entry.observed} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
