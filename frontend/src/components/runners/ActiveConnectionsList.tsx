"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  XCircle,
  Loader2,
  Monitor,
  MapPin,
  RefreshCw,
  WifiOff,
  Download,
  LogIn,
  Settings,
  ShieldCheck,
  Info,
} from "lucide-react";
import Link from "next/link";
import { useDeleteRunner } from "@/hooks/useRunners";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { formatRelativeTime } from "@/utils/formatDuration";
import { RunnerStatusBadge } from "@/components/server-runners/RunnerStatusBadge";

export function ActiveConnectionsList() {
  const {
    runners,
    isLoading,
    isConnected: _isConnected,
    refetch,
  } = useRealtimeConnections();
  const deleteMutation = useDeleteRunner();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const handleDeregister = async (runnerId: string) => {
    try {
      await deleteMutation.mutateAsync(runnerId);
      setDeletingId(null);
    } catch (err) {
      console.error("Failed to deregister runner:", err);
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
        <span className="ml-3 text-text-muted">Loading online runners...</span>
      </div>
    );
  }

  if (error) {
    const isConnectionError =
      error.message?.includes("fetch failed") ||
      error.message?.includes("proxy") ||
      error.message?.includes("network");
    return (
      <Card className="bg-surface-raised border-border-subtle p-12">
        <div className="text-center">
          <WifiOff className="w-16 h-16 mx-auto text-text-muted mb-4" />
          <h3 className="text-xl font-semibold text-text-muted mb-2">
            {isConnectionError
              ? "Unable to Connect to Server"
              : "Failed to Load Runners"}
          </h3>
          <p className="text-text-muted mb-6 max-w-md mx-auto">
            {isConnectionError
              ? "The backend server appears to be offline or unreachable. Please ensure the server is running and try again."
              : error.message ||
                "An unexpected error occurred while loading online runners."}
          </p>
          <Button
            onClick={() => {
              setError(null);
              refetch();
            }}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        </div>
      </Card>
    );
  }

  if (!runners || runners.length === 0) {
    return (
      <div className="text-center py-12">
        <Monitor className="w-16 h-16 mx-auto text-text-muted mb-4" />
        <h3 className="text-xl font-semibold text-text-muted mb-2">
          No Online Runners
        </h3>
        <p className="text-text-muted mb-8">
          No runners are currently online for your account
        </p>

        <div className="max-w-lg mx-auto space-y-4 text-left mb-8">
          {[
            {
              icon: Download,
              label: "Download the Runner",
              description: "Get the Qontinui Runner app for your platform",
            },
            {
              icon: LogIn,
              label: "Open the Runner and sign in",
              description:
                "Launch the desktop app and sign in with your Qontinui account",
            },
            {
              icon: Settings,
              label: "Settings → Backend Connection",
              description:
                "In the runner, find Backend Connection and connect it to this account",
            },
            {
              icon: ShieldCheck,
              label: "Click Authorize",
              description:
                "Approve the runner in the consent page that opens — it will appear here",
            },
          ].map((step, i) => (
            <div key={step.label} className="flex items-start gap-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-brand-primary/20 text-brand-primary text-xs font-bold shrink-0 mt-0.5">
                {i + 1}
              </div>
              <step.icon className="w-4 h-4 text-text-muted shrink-0 mt-1" />
              <div>
                <p className="text-sm font-medium text-white">{step.label}</p>
                <p className="text-xs text-text-muted">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <Button
          asChild
          className="bg-brand-primary hover:bg-brand-primary/80 text-black"
        >
          <Link href="/download">
            <Download className="w-4 h-4 mr-2" />
            Download Runner
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <Card className="bg-surface-raised/60 border-border-subtle p-4 mb-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-text-muted shrink-0 mt-0.5" aria-hidden />
        <div className="text-sm text-text-muted">
          <span className="font-medium text-white">
            Need to connect another runner?
          </span>{" "}
          Open it on the new machine, then go to{" "}
          <span className="text-white">
            Settings → Backend Connection → Authorize
          </span>
          . It will show up here once it heartbeats.
        </div>
      </Card>
      <div className="grid gap-4">
        {runners.map((runner) => (
          <Card
            key={runner.id}
            className="bg-surface-raised border-border-subtle p-6"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {/* Header with Status */}
                <div className="flex items-center gap-3 mb-4">
                  <Monitor className="w-5 h-5 text-brand-primary" />
                  <h3 className="text-lg font-semibold text-white">
                    {runner.name || "Unknown Runner"}
                  </h3>
                  <RunnerStatusBadge derivedStatus={runner.derivedStatus} />
                  {runner.wsConnected ? (
                    <Badge
                      variant="outline"
                      className="border-brand-success/50 text-brand-success"
                    >
                      WS Connected
                    </Badge>
                  ) : null}
                </div>

                {/* Runner Details */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Hostname / Port */}
                  <div className="flex items-start gap-3">
                    <Monitor className="w-4 h-4 text-text-muted mt-1" />
                    <div>
                      <p className="text-sm text-text-muted">Host</p>
                      <p className="text-white font-medium font-mono text-sm">
                        {runner.hostname || "—"}
                        {runner.port ? `:${runner.port}` : ""}
                      </p>
                    </div>
                  </div>

                  {/* IP Address */}
                  {runner.ipAddress && (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-text-muted mt-1" />
                      <div>
                        <p className="text-sm text-text-muted">IP Address</p>
                        <p className="text-white font-medium font-mono text-sm">
                          {runner.ipAddress}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* OS */}
                  {runner.os && (
                    <div className="flex items-start gap-3">
                      <div className="w-4 h-4 bg-brand-primary rounded mt-1" />
                      <div>
                        <p className="text-sm text-text-muted">OS</p>
                        <p className="text-white font-medium">
                          {runner.os}
                          {runner.osVersion ? ` ${runner.osVersion}` : ""}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Last heartbeat + ID */}
                <div className="mt-4 text-xs text-text-muted">
                  Last heartbeat:{" "}
                  {runner.lastHeartbeat
                    ? formatRelativeTime(runner.lastHeartbeat)
                    : "never"}
                  {" · "}
                  Runner ID:{" "}
                  <span className="font-mono">{runner.id.slice(0, 8)}</span>
                </div>
              </div>

              {/* Deregister Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeletingId(runner.id)}
                className="border-red-500/50 text-red-500 hover:bg-red-500/10"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Deregister
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Deregister Confirmation Dialog */}
      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => !open && setDeletingId(null)}
      >
        <AlertDialogContent className="bg-surface-raised border-border-subtle">
          <AlertDialogHeader>
            <AlertDialogTitle>Deregister Runner?</AlertDialogTitle>
            <AlertDialogDescription>
              This will close the runner&apos;s WebSocket and remove it from
              your fleet. The runner can re-register itself by reconnecting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border-default">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId && handleDeregister(deletingId)}
              className="bg-red-500 hover:bg-red-600 text-white"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deregistering..." : "Deregister"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
