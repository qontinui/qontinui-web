"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  ServerOff,
  Trash2,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useRunners, useDeregisterRunner } from "@/hooks/useServerRunners";
import { formatRelativeTime } from "@/utils/formatDuration";
import type { ServerRunner } from "@/types/server-runner";
import { RunnerStatusBadge } from "./RunnerStatusBadge";

export function RunnerFleetTable() {
  const {
    data: runners,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useRunners();
  const deregisterMutation = useDeregisterRunner();
  const [deregisteringId, setDeregisteringId] = useState<string | null>(null);

  const handleDeregister = async (runnerId: string) => {
    try {
      await deregisterMutation.mutateAsync(runnerId);
    } finally {
      setDeregisteringId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
        <span className="ml-3 text-text-muted">Loading runner fleet...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-surface-raised border-border-subtle p-8">
        <div className="text-center">
          <ServerOff className="w-12 h-12 mx-auto text-text-muted mb-3" />
          <h3 className="text-lg font-semibold text-white mb-1">
            Failed to load runners
          </h3>
          <p className="text-text-muted text-sm mb-4">{error.message}</p>
          <Button onClick={() => refetch()} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  if (!runners || runners.length === 0) {
    return (
      <Card className="bg-surface-raised border-border-subtle p-10">
        <div className="text-center">
          <ServerOff className="w-12 h-12 mx-auto text-text-muted mb-3" />
          <h3 className="text-lg font-semibold text-white mb-1">
            No server-mode runners
          </h3>
          <p className="text-text-muted text-sm max-w-md mx-auto">
            No runners are currently registered. Create a runner token below and
            launch a runner with the environment variables shown above to
            register one.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-surface-raised border-border-subtle">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Registered runners
            </h3>
            <p className="text-xs text-text-muted">
              {runners.length} {runners.length === 1 ? "runner" : "runners"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="border-border-default"
            aria-label="Refresh runner list"
          >
            {isRefetching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-2" />
            )}
            Refresh
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col">Host</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col">Last heartbeat</TableHead>
              <TableHead scope="col">Capabilities</TableHead>
              <TableHead scope="col">Restate</TableHead>
              <TableHead scope="col" className="text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runners.map((runner: ServerRunner) => (
              <TableRow key={runner.id}>
                <TableCell>
                  <div className="font-medium text-white">{runner.name}</div>
                  <div className="text-xs text-text-muted font-mono">
                    {runner.id.slice(0, 8)}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-text-muted">
                  {runner.hostname}:{runner.port}
                </TableCell>
                <TableCell>
                  <RunnerStatusBadge status={runner.status} />
                </TableCell>
                <TableCell className="text-xs text-text-muted">
                  {runner.last_heartbeat
                    ? formatRelativeTime(runner.last_heartbeat)
                    : "never"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[220px]">
                    {runner.capabilities.length === 0 ? (
                      <span className="text-xs text-text-muted">none</span>
                    ) : (
                      runner.capabilities.map((cap) => (
                        <Badge
                          key={cap}
                          variant="outline"
                          className="text-[10px] px-1.5 border-border-default"
                        >
                          {cap}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {runner.restate_enabled ? (
                    <div
                      className="flex items-center gap-1.5 text-xs"
                      aria-label={
                        runner.restate_healthy
                          ? "Restate healthy"
                          : "Restate unhealthy"
                      }
                    >
                      {runner.restate_healthy ? (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">healthy</span>
                        </>
                      ) : (
                        <>
                          <ShieldOff className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-amber-400">unhealthy</span>
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-text-muted">disabled</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeregisteringId(runner.id)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    aria-label={`Deregister runner ${runner.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog
        open={deregisteringId !== null}
        onOpenChange={(open) => !open && setDeregisteringId(null)}
      >
        <AlertDialogContent className="bg-surface-raised border-border-subtle">
          <AlertDialogHeader>
            <AlertDialogTitle>Deregister runner?</AlertDialogTitle>
            <AlertDialogDescription>
              The runner will be removed from the fleet and any in-flight
              dispatches to it will fail. The runner can re-register itself by
              restarting with a valid token.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border-default">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deregisteringId && handleDeregister(deregisteringId)
              }
              disabled={deregisterMutation.isPending}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deregisterMutation.isPending ? "Deregistering..." : "Deregister"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
