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
  Clock,
  MapPin,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useDisconnectRunner } from "@/hooks/useRunners";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { formatRelativeTime } from "@/utils/formatDuration";
import { StatusIndicator } from "./StatusIndicator";

export function ActiveConnectionsList() {
  const {
    connections,
    isLoading,
    isConnected: _isConnected,
    refetch,
  } = useRealtimeConnections();
  const disconnectMutation = useDisconnectRunner();
  const [disconnectingId, setDisconnectingId] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const handleDisconnect = async (connectionId: number) => {
    try {
      await disconnectMutation.mutateAsync(connectionId);
      setDisconnectingId(null);
    } catch (error) {
      console.error("Failed to disconnect runner:", error);
      setDisconnectingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-[#00D9FF]" />
        <span className="ml-3 text-gray-400">
          Loading active connections...
        </span>
      </div>
    );
  }

  if (error) {
    const isConnectionError =
      error.message?.includes("fetch failed") ||
      error.message?.includes("proxy") ||
      error.message?.includes("network");
    return (
      <Card className="bg-[#1A1A1B] border-gray-800 p-12">
        <div className="text-center">
          <WifiOff className="w-16 h-16 mx-auto text-gray-600 mb-4" />
          <h3 className="text-xl font-semibold text-gray-300 mb-2">
            {isConnectionError
              ? "Unable to Connect to Server"
              : "Failed to Load Connections"}
          </h3>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            {isConnectionError
              ? "The backend server appears to be offline or unreachable. Please ensure the server is running and try again."
              : error.message ||
                "An unexpected error occurred while loading active connections."}
          </p>
          <Button
            onClick={() => {
              setError(null);
              refetch();
            }}
            className="bg-[#00D9FF] hover:bg-[#00B8DB] text-black"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        </div>
      </Card>
    );
  }

  if (!connections || connections.length === 0) {
    return (
      <div className="text-center py-12">
        <Monitor className="w-16 h-16 mx-auto text-gray-600 mb-4" />
        <h3 className="text-xl font-semibold text-gray-300 mb-2">
          No Active Connections
        </h3>
        <p className="text-gray-400">
          No runners are currently connected to your account
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4">
        {connections.map((connection) => (
          <Card
            key={connection.id}
            className="bg-[#1A1A1B] border-gray-800 p-6"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {/* Header with Status */}
                <div className="flex items-center gap-3 mb-4">
                  <Monitor className="w-5 h-5 text-[#00D9FF]" />
                  <h3 className="text-lg font-semibold text-white">
                    {connection.runner_name || "Unknown Runner"}
                  </h3>
                  <StatusIndicator status="active" showLabel={false} />
                  <Badge
                    variant="outline"
                    className="border-green-500/50 text-green-500"
                  >
                    Connected
                  </Badge>
                </div>

                {/* Connection Details */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Connected Since */}
                  <div className="flex items-start gap-3">
                    <Clock className="w-4 h-4 text-gray-400 mt-1" />
                    <div>
                      <p className="text-sm text-gray-400">Connected</p>
                      <p className="text-white font-medium">
                        {formatRelativeTime(connection.connected_at)}
                      </p>
                    </div>
                  </div>

                  {/* IP Address */}
                  {connection.ip_address && (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-gray-400 mt-1" />
                      <div>
                        <p className="text-sm text-gray-400">IP Address</p>
                        <p className="text-white font-medium font-mono text-sm">
                          {connection.ip_address}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Project */}
                  {connection.project_name && (
                    <div className="flex items-start gap-3">
                      <div className="w-4 h-4 bg-[#00D9FF] rounded mt-1" />
                      <div>
                        <p className="text-sm text-gray-400">Project</p>
                        <p className="text-white font-medium">
                          {connection.project_name}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Session ID */}
                <div className="mt-4 text-xs text-gray-500">
                  Session ID: {connection.id}
                </div>
              </div>

              {/* Disconnect Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDisconnectingId(connection.id)}
                className="border-red-500/50 text-red-500 hover:bg-red-500/10"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog
        open={disconnectingId !== null}
        onOpenChange={(open) => !open && setDisconnectingId(null)}
      >
        <AlertDialogContent className="bg-[#1A1A1B] border-gray-800">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Runner?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately terminate the connection to this runner. The
              runner can reconnect by logging in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                disconnectingId && handleDisconnect(disconnectingId)
              }
              className="bg-red-500 hover:bg-red-600 text-white"
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
