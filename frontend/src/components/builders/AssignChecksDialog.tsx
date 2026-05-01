"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useChecksList } from "@/hooks/useLibrary";
import { Search } from "lucide-react";

interface AssignChecksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  selectedCheckIds: string[];
  onSave: (checkIds: string[]) => void;
}

export function AssignChecksDialog({
  open,
  onOpenChange,
  groupId: _groupId,
  selectedCheckIds,
  onSave,
}: AssignChecksDialogProps) {
  const { data: checks } = useChecksList();
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Sync local state when dialog opens or selectedCheckIds changes
  useEffect(() => {
    if (open) {
      setLocalSelected(new Set(selectedCheckIds));
      setSearchQuery("");
    }
  }, [open, selectedCheckIds]);

  const filteredChecks = useMemo(() => {
    if (!checks) return [];
    if (!searchQuery.trim()) return checks;
    const q = searchQuery.toLowerCase();
    return checks.filter(
      (check) =>
        check.name.toLowerCase().includes(q) ||
        (check.check_type && check.check_type.toLowerCase().includes(q)) ||
        (check.description && check.description.toLowerCase().includes(q))
    );
  }, [checks, searchQuery]);

  const toggleCheck = (id: string) => {
    const next = new Set(localSelected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setLocalSelected(next);
  };

  const selectAll = () => {
    const allIds = new Set(localSelected);
    for (const check of filteredChecks) {
      allIds.add(check.id);
    }
    setLocalSelected(allIds);
  };

  const deselectAll = () => {
    const remaining = new Set(localSelected);
    for (const check of filteredChecks) {
      remaining.delete(check.id);
    }
    setLocalSelected(remaining);
  };

  const handleSave = () => {
    onSave(Array.from(localSelected));
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Checks to Group</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
            <Input
              placeholder="Search checks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm bg-surface-raised/50 border-border-subtle"
            />
          </div>

          {/* Select All / Deselect All */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">
              {localSelected.size} of {checks?.length ?? 0} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={selectAll}
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={deselectAll}
              >
                Deselect All
              </Button>
            </div>
          </div>

          {/* Check List */}
          <div className="max-h-64 overflow-y-auto space-y-1 border border-border-subtle rounded-lg p-2">
            {!checks || checks.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-4">
                No checks available. Create checks first.
              </p>
            ) : filteredChecks.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-4">
                No checks match your search.
              </p>
            ) : (
              filteredChecks.map((check) => (
                <div
                  key={check.id}
                  role="option"
                  tabIndex={0}
                  aria-selected={localSelected.has(check.id)}
                  className={`flex items-center gap-3 rounded-md px-2 py-2 cursor-pointer transition-colors hover:bg-surface-raised/60 ${
                    localSelected.has(check.id) ? "bg-blue-500/10" : ""
                  }`}
                  onClick={() => toggleCheck(check.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleCheck(check.id);
                    }
                  }}
                >
                  <Checkbox
                    checked={localSelected.has(check.id)}
                    onCheckedChange={() => toggleCheck(check.id)}
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">
                        {check.name}
                      </span>
                      {check.check_type && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 shrink-0"
                        >
                          {check.check_type}
                        </Badge>
                      )}
                    </div>
                    {check.description && (
                      <p className="text-xs text-text-muted truncate mt-0.5">
                        {check.description}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="brand-primary" size="sm" onClick={handleSave}>
            Save ({localSelected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
