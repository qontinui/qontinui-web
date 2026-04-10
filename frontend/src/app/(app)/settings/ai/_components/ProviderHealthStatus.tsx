"use client";

import { Activity, AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProviderHealth } from "@/lib/runner/hooks/settings-hooks";
import { runnerFetch } from "@/lib/runner/api-client";
import { toast } from "sonner";
import type { ProviderCircuitState } from "@/lib/runner/types/settings";

const PROVIDER_LABELS: Record<string, string> = {
  claude_cli: "Claude CLI",
  claude_api: "Claude API",
  gemini_cli: "Gemini CLI",
  gemini_api: "Gemini API",
};

function badgeVariant(state: ProviderCircuitState["state"]) {
  switch (state) {
    case "Closed":
      return "success" as const;
    case "HalfOpen":
      return "warning" as const;
    case "Open":
      return "destructive" as const;
  }
}

function StateIcon({ state }: { state: ProviderCircuitState["state"] }) {
  switch (state) {
    case "Closed":
      return <CheckCircle2 className="size-3.5" aria-hidden="true" />;
    case "HalfOpen":
      return <Activity className="size-3.5" aria-hidden="true" />;
    case "Open":
      return <AlertTriangle className="size-3.5" aria-hidden="true" />;
  }
}

export function ProviderHealthStatus() {
  const { data: states, isLoading, error, refetch } = useProviderHealth();

  if (isLoading || error) {
    return null;
  }

  if (!states || states.length === 0) {
    return null;
  }

  const handleReset = async (providerKey: string) => {
    try {
      await runnerFetch(`/provider-health/${providerKey}/reset`, {
        method: "POST",
      });
      toast.success(
        `Reset ${PROVIDER_LABELS[providerKey] ?? providerKey} circuit breaker`
      );
      refetch();
    } catch {
      toast.error("Failed to reset circuit breaker");
    }
  };

  return (
    <div className="rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Activity className="size-4" aria-hidden="true" />
          Provider Health
        </h3>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap gap-2">
          {states.map((s) => {
            const label = PROVIDER_LABELS[s.provider_key] ?? s.provider_key;
            return (
              <Badge
                key={s.provider_key}
                variant={badgeVariant(s.state)}
                className="gap-1.5 py-1"
              >
                <StateIcon state={s.state} />
                <span>{label}</span>
                <span className="opacity-75">{s.state}</span>
                {s.state === "Open" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-4 ml-0.5 p-0 hover:bg-transparent"
                    onClick={() => handleReset(s.provider_key)}
                    aria-label={`Reset ${PROVIDER_LABELS[s.provider_key] ?? s.provider_key} circuit breaker`}
                  >
                    <RotateCcw className="size-3" aria-hidden="true" />
                  </Button>
                )}
              </Badge>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Circuit breaker status for each AI provider. Green = healthy, yellow =
          recovering, red = tripped.
        </p>
      </div>
    </div>
  );
}
