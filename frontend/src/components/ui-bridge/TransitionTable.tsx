"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  X,
  Search,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import type { SuggestedTransition } from "@/hooks/useUIBridgeExploration";

interface TransitionTableProps {
  transitions: SuggestedTransition[];
  onAccept?: (transition: SuggestedTransition) => void;
  onReject?: (transition: SuggestedTransition) => void;
  acceptedIds?: Set<string>;
  rejectedIds?: Set<string>;
}

function getConfidenceBadgeVariant(
  confidence: number
): "default" | "secondary" | "outline" {
  if (confidence >= 0.7) return "default";
  if (confidence >= 0.4) return "secondary";
  return "outline";
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return "text-green-500";
  if (confidence >= 0.4) return "text-yellow-500";
  return "text-red-500";
}

export function TransitionTable({
  transitions,
  onAccept,
  onReject,
  acceptedIds = new Set(),
  rejectedIds = new Set(),
}: TransitionTableProps) {
  const [search, setSearch] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const filteredTransitions = useMemo(() => {
    if (!search) return transitions;
    const searchLower = search.toLowerCase();
    return transitions.filter(
      (t) =>
        t.triggerElementId.toLowerCase().includes(searchLower) ||
        t.fromStateHash.toLowerCase().includes(searchLower) ||
        t.toStateHash.toLowerCase().includes(searchLower) ||
        t.fromStateName?.toLowerCase().includes(searchLower) ||
        t.toStateName?.toLowerCase().includes(searchLower) ||
        t.triggerAction.toLowerCase().includes(searchLower)
    );
  }, [transitions, search]);

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search transitions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <ScrollArea className="h-[400px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>From State</TableHead>
              <TableHead className="w-8"></TableHead>
              <TableHead>To State</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead className="w-24">Confidence</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransitions.map((transition) => {
              const isExpanded = expandedRows.has(transition.id);
              const isAccepted = acceptedIds.has(transition.id);
              const isRejected = rejectedIds.has(transition.id);

              return (
                <Collapsible
                  key={transition.id}
                  open={isExpanded}
                  onOpenChange={() => toggleRow(transition.id)}
                  asChild
                >
                  <>
                    <TableRow
                      className={
                        isAccepted
                          ? "bg-green-500/10"
                          : isRejected
                            ? "bg-red-500/10 opacity-50"
                            : ""
                      }
                    >
                      <TableCell>
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium truncate max-w-[150px]">
                            {transition.fromStateName || "State"}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {transition.fromStateHash}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium truncate max-w-[150px]">
                            {transition.toStateName || "State"}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {transition.toStateHash}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="outline">{transition.triggerAction}</Badge>
                          <p className="text-xs text-muted-foreground font-mono truncate max-w-[150px]">
                            {transition.triggerElementId}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getConfidenceBadgeVariant(transition.confidence)}
                          className={getConfidenceColor(transition.confidence)}
                        >
                          {(transition.confidence * 100).toFixed(0)}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {!isAccepted && !isRejected && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-green-500 hover:text-green-600 hover:bg-green-500/10"
                                onClick={() => onAccept?.(transition)}
                                title="Accept transition"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                onClick={() => onReject?.(transition)}
                                title="Reject transition"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {isAccepted && (
                            <Badge variant="default" className="bg-green-500">
                              Accepted
                            </Badge>
                          )}
                          {isRejected && (
                            <Badge variant="destructive">Rejected</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    <CollapsibleContent asChild>
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={7}>
                          <div className="p-3 space-y-3">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  Elements Added ({transition.activateElements.length})
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {transition.activateElements.length > 0 ? (
                                    transition.activateElements.slice(0, 10).map((el) => (
                                      <Badge
                                        key={el}
                                        variant="outline"
                                        className="text-xs bg-green-500/10 text-green-500"
                                      >
                                        + {el}
                                      </Badge>
                                    ))
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      None
                                    </span>
                                  )}
                                  {transition.activateElements.length > 10 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{transition.activateElements.length - 10} more
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  Elements Removed ({transition.deactivateElements.length})
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {transition.deactivateElements.length > 0 ? (
                                    transition.deactivateElements.slice(0, 10).map((el) => (
                                      <Badge
                                        key={el}
                                        variant="outline"
                                        className="text-xs bg-red-500/10 text-red-500"
                                      >
                                        - {el}
                                      </Badge>
                                    ))
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      None
                                    </span>
                                  )}
                                  {transition.deactivateElements.length > 10 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{transition.deactivateElements.length - 10} more
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                Observed in {transition.stepIds.length} step(s)
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {transition.stepIds.slice(0, 5).map((stepId) => (
                                  <Badge key={stepId} variant="secondary" className="text-xs font-mono">
                                    {stepId.slice(0, 8)}
                                  </Badge>
                                ))}
                                {transition.stepIds.length > 5 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{transition.stepIds.length - 5} more
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    </CollapsibleContent>
                  </>
                </Collapsible>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>

      <p className="text-xs text-muted-foreground text-center">
        Showing {filteredTransitions.length} of {transitions.length} transitions
      </p>
    </div>
  );
}
