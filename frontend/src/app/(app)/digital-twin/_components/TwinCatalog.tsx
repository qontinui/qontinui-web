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
import { useTwinCatalog } from "../_hooks/useTwinCatalog";

/**
 * Queryable surface — coord's authoritative catalog of the `coord_query_*` twin
 * observers. This is the single source of truth for *which* surfaces are
 * queryable (the same list the agent Q&A meta-answer expands into its
 * `{{twin-catalog}}` token); the completeness matrix above joins the live
 * per-tenant probe onto the checked-in taxonomy for the research denominator.
 */
export function TwinCatalog() {
  const { data, isLoading, isError, error } = useTwinCatalog();

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
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load the catalog
          {error instanceof Error ? `: ${error.message}` : "."}
        </div>
      ) : data?.coord_error ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          Coord is unavailable — catalog can&apos;t be read right now (
          {data.coord_error}).
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
                <TableHead className="w-[6rem]">Status</TableHead>
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
                    {entry.params.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <code className="text-xs">{entry.params.join(", ")}</code>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        entry.kind === "snapshot" ? "secondary" : "outline"
                      }
                    >
                      {entry.kind}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={entry.status === "live" ? "default" : "outline"}
                    >
                      {entry.status}
                    </Badge>
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
