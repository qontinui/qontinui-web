"use client";

import { ChevronRight } from "lucide-react";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { CommandRow } from "../types";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

interface CommandListProps {
  rows: CommandRow[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}

/**
 * The command inventory. Every row carries its provenance badge; rows with an
 * override also carry the head version and when it was last written.
 */
export function CommandList({
  rows,
  selectedName,
  onSelect,
}: CommandListProps) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <div className="card-content text-sm text-muted-foreground">
          No agent commands to show.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="agent-command-list">
      {rows.map((row) => {
        const isSelected = row.name === selectedName;
        return (
          <button
            key={row.name}
            type="button"
            onClick={() => onSelect(row.name)}
            aria-current={isSelected}
            data-testid={`agent-command-row-${row.name}`}
            className={`card card-hover w-full text-left ${
              isSelected ? "card-selected" : ""
            }`}
          >
            <div className="card-content flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-medium">/{row.name}</span>
                  <ProvenanceBadge provenance={row.provenance} />
                  {row.override && (
                    <span className="badge badge-secondary">
                      v{row.override.current_version}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.override
                    ? `Last edited ${formatDate(row.override.updated_at)}`
                    : "Served from the runner's embedded copy — nothing stored in this account."}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
