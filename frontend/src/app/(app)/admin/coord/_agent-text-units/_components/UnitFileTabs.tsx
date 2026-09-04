"use client";

/**
 * The `files` map as an editable tab strip.
 *
 * This is what makes a skill editable at all. A command is the degenerate
 * single-file case — one tab, nothing to add or remove — while a skill is
 * `SKILL.md` plus siblings it invokes by relative path (the largest real one,
 * `coord-revive`, is `SKILL.md` + a 58 KB `coord-revive.sh`). Both are the same
 * corpus shape, so both get the same strip and single-file kinds simply hide
 * the add control.
 *
 * The **entrypoint is not removable or renamable**: `validate_files` refuses a
 * unit that does not carry it, so offering the action would only produce a
 * server refusal. Every other path is validated here against the same rules
 * the backend applies (`validateRelativePath`), so a bad path is refused while
 * the operator is typing rather than on save.
 */

import { useState } from "react";
import { FilePlus2, Pencil, Trash2, X } from "lucide-react";
import type { UnitFiles } from "@/lib/api/agent-text-units";
import type { UnitKindConfig } from "../types";

interface UnitFileTabsProps {
  config: UnitKindConfig;
  files: UnitFiles;
  activePath: string | null;
  entrypoint: string;
  onSelect: (path: string) => void;
  onAdd: (path: string) => string | null;
  onRename: (from: string, to: string) => string | null;
  onDelete: (path: string) => string | null;
  disabled: boolean;
}

export function UnitFileTabs({
  config,
  files,
  activePath,
  entrypoint,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  disabled,
}: UnitFileTabsProps) {
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const paths = Object.keys(files).sort();

  const commitAdd = () => {
    const message = onAdd(newPath);
    setError(message);
    if (!message) {
      setNewPath("");
      setAdding(false);
    }
  };

  const commitRename = (from: string) => {
    const message = onRename(from, renameTo);
    setError(message);
    if (!message) {
      setRenaming(null);
      setRenameTo("");
    }
  };

  return (
    <div className="space-y-2" data-testid="unit-file-tabs">
      <div className="flex flex-wrap items-center gap-1.5">
        {paths.length === 0 && (
          <p className="text-xs italic text-muted-foreground">
            No files yet. Add {entrypoint} to start this {config.singular}.
          </p>
        )}

        {paths.map((path) => {
          const isEntrypoint = path === entrypoint;
          const isActive = path === activePath;
          if (renaming === path) {
            return (
              <span key={path} className="inline-flex items-center gap-1">
                <input
                  className="input h-7 w-48 font-mono text-xs"
                  value={renameTo}
                  autoFocus
                  onChange={(e) => setRenameTo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(path);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  data-testid="unit-file-rename-input"
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => commitRename(path)}
                  data-testid="unit-file-rename-confirm"
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setRenaming(null)}
                  aria-label="Cancel rename"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            );
          }
          return (
            <span
              key={path}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                isActive
                  ? "border-primary/50 bg-accent text-foreground"
                  : "border-border bg-card/30 text-muted-foreground"
              }`}
            >
              <button
                type="button"
                className="font-mono"
                onClick={() => onSelect(path)}
                data-testid={`unit-file-tab-${path}`}
                title={
                  isEntrypoint
                    ? `${path} — this ${config.singular}'s entrypoint`
                    : path
                }
              >
                {path}
                {isEntrypoint && (
                  <span className="ml-1 text-[10px] uppercase tracking-wide opacity-60">
                    entry
                  </span>
                )}
              </button>
              {!isEntrypoint && !disabled && (
                <>
                  <button
                    type="button"
                    className="opacity-60 hover:opacity-100"
                    onClick={() => {
                      setRenaming(path);
                      setRenameTo(path);
                      setError(null);
                    }}
                    aria-label={`Rename ${path}`}
                    data-testid={`unit-file-rename-${path}`}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    className="opacity-60 hover:opacity-100"
                    onClick={() => setError(onDelete(path))}
                    aria-label={`Remove ${path}`}
                    data-testid={`unit-file-delete-${path}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </>
              )}
            </span>
          );
        })}

        {!disabled && (config.multiFile || paths.length === 0) && (
          <>
            {adding ? (
              <span className="inline-flex items-center gap-1">
                <input
                  className="input h-7 w-48 font-mono text-xs"
                  value={newPath}
                  autoFocus
                  placeholder={
                    paths.includes(entrypoint)
                      ? config.newFilePlaceholder
                      : entrypoint
                  }
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitAdd();
                    if (e.key === "Escape") setAdding(false);
                  }}
                  data-testid="unit-file-add-input"
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={commitAdd}
                  data-testid="unit-file-add-confirm"
                >
                  Add
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setAdding(false)}
                  aria-label="Cancel add"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setAdding(true);
                  setNewPath(paths.includes(entrypoint) ? "" : entrypoint);
                  setError(null);
                }}
                data-testid="unit-file-add-btn"
              >
                <FilePlus2 className="size-3.5" />
                Add file
              </button>
            )}
          </>
        )}
      </div>

      {error && (
        <p className="form-error" data-testid="unit-file-error">
          {error}
        </p>
      )}
    </div>
  );
}
