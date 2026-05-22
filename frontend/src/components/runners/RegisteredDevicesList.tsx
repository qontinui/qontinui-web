"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import Link from "next/link";
import type { Runner } from "@qontinui/shared-types";
import { runnerService } from "@/services/service-factory";
import { useDeleteRunner, runnerKeys } from "@/hooks/useRunners";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { formatRelativeTime } from "@/utils/formatDuration";
import { RunnerStatusBadge } from "@/components/server-runners/RunnerStatusBadge";

const REGISTERED_REFETCH_MS = 30000;

interface RegisteredDevicesListProps {
  showOnlyOnline: boolean;
}

export function RegisteredDevicesList({
  showOnlyOnline,
}: RegisteredDevicesListProps) {
  const {
    data: devices,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery<Runner[], Error>({
    queryKey: [...runnerKeys.all, "registered"],
    queryFn: () => runnerService.getRunners(),
    refetchInterval: (query) => (query.state.error ? false : REGISTERED_REFETCH_MS),
    refetchIntervalInBackground: false,
    retry: 1,
    retryDelay: 1000,
  });

  const { runners: onlineRunners } = useRealtimeConnections();
  const onlineIds = new Set(onlineRunners.map((r) => r.id));

  const deleteMutation = useDeleteRunner();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeregister = async (deviceId: string) => {
    try {
      await deleteMutation.mutateAsync(deviceId);
      setDeletingId(null);
    } catch (err) {
      console.error("Failed to deregister device:", err);
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
        <span className="ml-3 text-text-muted">Loading devices...</span>
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
              : "Failed to Load Devices"}
          </h3>
          <p className="text-text-muted mb-6 max-w-md mx-auto">
            {isConnectionError
              ? "The backend server appears to be offline or unreachable. Please ensure the server is running and try again."
              : error.message ||
                "An unexpected error occurred while loading devices."}
          </p>
          <Button
            onClick={() => refetch()}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        </div>
      </Card>
    );
  }

  const allDevices = devices ?? [];
  const visibleDevices = showOnlyOnline
    ? allDevices.filter((d) => onlineIds.has(d.id) || d.wsConnected)
    : allDevices;

  if (visibleDevices.length === 0) {
    if (showOnlyOnline && allDevices.length > 0) {
      return (
        <div className="text-center py-12">
          <Monitor className="w-16 h-16 mx-auto text-text-muted mb-4" />
          <h3 className="text-xl font-semibold text-text-muted mb-2">
            No Online Devices
          </h3>
          <p className="text-text-muted">
            You have {allDevices.length} registered{" "}
            {allDevices.length === 1 ? "device" : "devices"} but none are
            online right now. Turn off <span className="text-white">Online only</span>{" "}
            to see them all.
          </p>
        </div>
      );
    }

    return (
      <div className="text-center py-12">
        <Monitor className="w-16 h-16 mx-auto text-text-muted mb-4" />
        <h3 className="text-xl font-semibold text-text-muted mb-2">
          No Registered Devices
        </h3>
        <p className="text-text-muted mb-8">
          You haven&apos;t paired any devices with this account yet.
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
      <div className="grid gap-4">
        {visibleDevices.map((device) => {
          const isOnline = onlineIds.has(device.id) || device.wsConnected;
          return (
            <Card
              key={device.id}
              className="bg-surface-raised border-border-subtle p-6"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <Monitor className="w-5 h-5 text-brand-primary" />
                    <h3 className="text-lg font-semibold text-white">
                      {device.name || "Unknown Device"}
                    </h3>
                    <RunnerStatusBadge derivedStatus={device.derivedStatus} />
                    {isOnline ? (
                      <Badge
                        variant="outline"
                        className="border-brand-success/50 text-brand-success"
                      >
                        Online
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-text-muted/50 text-text-muted"
                      >
                        Offline
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex items-start gap-3">
                      <Monitor className="w-4 h-4 text-text-muted mt-1" />
                      <div>
                        <p className="text-sm text-text-muted">Host</p>
                        <p className="text-white font-medium font-mono text-sm">
                          {device.hostname || "—"}
                          {device.port ? `:${device.port}` : ""}
                        </p>
                      </div>
                    </div>

                    {device.ipAddress && (
                      <div className="flex items-start gap-3">
                        <MapPin className="w-4 h-4 text-text-muted mt-1" />
                        <div>
                          <p className="text-sm text-text-muted">IP Address</p>
                          <p className="text-white font-medium font-mono text-sm">
                            {device.ipAddress}
                          </p>
                        </div>
                      </div>
                    )}

                    {device.os && (
                      <div className="flex items-start gap-3">
                        <div className="w-4 h-4 bg-brand-primary rounded mt-1" />
                        <div>
                          <p className="text-sm text-text-muted">OS</p>
                          <p className="text-white font-medium">
                            {device.os}
                            {device.osVersion ? ` ${device.osVersion}` : ""}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 text-xs text-text-muted">
                    Last seen:{" "}
                    {device.lastHeartbeat
                      ? formatRelativeTime(device.lastHeartbeat)
                      : "never"}
                    {" · "}
                    Device ID:{" "}
                    <span className="font-mono">{device.id.slice(0, 8)}</span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeletingId(device.id)}
                  className="border-red-500/50 text-red-500 hover:bg-red-500/10"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Deregister
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {isRefetching && (
        <div className="flex items-center justify-center pt-4 text-xs text-text-muted">
          <Loader2 className="w-3 h-3 animate-spin mr-2" />
          Refreshing...
        </div>
      )}

      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => !open && setDeletingId(null)}
      >
        <AlertDialogContent className="bg-surface-raised border-border-subtle">
          <AlertDialogHeader>
            <AlertDialogTitle>Deregister Device?</AlertDialogTitle>
            <AlertDialogDescription>
              This will close the device&apos;s WebSocket and remove it from
              your fleet. The device can re-register itself by reconnecting.
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
