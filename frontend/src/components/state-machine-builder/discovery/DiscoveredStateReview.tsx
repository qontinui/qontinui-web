"use client";

import { Check, X, Globe, Maximize2, Fingerprint, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { UIBridgeState } from "@/lib/state-machine-builder/types";

interface DiscoveredStateReviewProps {
  pendingStates: UIBridgeState[];
  onAccept: (stateId: string) => void;
  onReject: (stateId: string) => void;
  onAcceptAll: () => void;
}

export function DiscoveredStateReview({
  pendingStates,
  onAccept,
  onReject,
  onAcceptAll,
}: DiscoveredStateReviewProps) {
  if (pendingStates.length === 0) {
    return (
      <Card className="border-border-subtle bg-surface-raised">
        <CardContent className="py-10">
          <div className="flex flex-col items-center gap-3 text-text-muted">
            <Inbox className="h-10 w-10" />
            <p className="text-sm">No pending states to review.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border-subtle bg-surface-raised">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-text-primary text-base">
            Discovered States
            <Badge variant="secondary" className="ml-2">
              {pendingStates.length}
            </Badge>
          </CardTitle>
          <Button variant="brand-success" size="sm" onClick={onAcceptAll}>
            <Check className="h-3.5 w-3.5" />
            Accept All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-2 px-6 pb-6">
            {pendingStates.map((state) => (
              <StateReviewCard
                key={state.id}
                state={state}
                onAccept={() => onAccept(state.id)}
                onReject={() => onReject(state.id)}
              />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function StateReviewCard({
  state,
  onAccept,
  onReject,
}: {
  state: UIBridgeState;
  onAccept: () => void;
  onReject: () => void;
}) {
  const confidencePct =
    state.confidence != null ? Math.round(state.confidence * 100) : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-canvas p-3 transition-colors hover:border-border-default">
      <div className="flex-1 min-w-0 space-y-2">
        {/* Name and badges row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary truncate">
            {state.name}
          </span>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Fingerprint className="h-3 w-3" />
            {state.fingerprints.length}
          </Badge>
          {state.isGlobal && (
            <Badge variant="info" className="gap-1 text-[10px]">
              <Globe className="h-3 w-3" />
              global
            </Badge>
          )}
          {state.isModal && (
            <Badge variant="warning" className="gap-1 text-[10px]">
              <Maximize2 className="h-3 w-3" />
              modal
            </Badge>
          )}
        </div>

        {/* Details row */}
        <div className="flex items-center gap-3 text-xs text-text-muted">
          {state.positionZone && (
            <span className="capitalize">{state.positionZone}</span>
          )}
          {confidencePct != null && (
            <div className="flex items-center gap-1.5">
              <div className="w-12 h-1 rounded-full bg-surface-raised border border-border-subtle overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--brand-primary)]"
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
              <span className="tabular-nums">{confidencePct}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-green-500 hover:text-green-400 hover:bg-green-500/10"
          onClick={onAccept}
          title="Accept state"
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-red-500 hover:text-red-400 hover:bg-red-500/10"
          onClick={onReject}
          title="Reject state"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
