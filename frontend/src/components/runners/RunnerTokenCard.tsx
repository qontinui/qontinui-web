"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  MoreVertical,
  XCircle,
  Trash2,
  Eye,
  AlertTriangle,
} from "lucide-react";
import { StatusIndicator } from "./StatusIndicator";
import {
  formatRelativeTime,
  isExpired,
  isExpiringSoon,
} from "@/utils/formatDuration";
import type { RunnerToken, TokenStatus } from "@/types/runner";

interface RunnerTokenCardProps {
  token: RunnerToken;
  onRevoke: (tokenId: string) => void;
  onDelete: (tokenId: string) => void;
  onViewConnections: (tokenId: string) => void;
}

export function RunnerTokenCard({
  token,
  onRevoke,
  onDelete,
  onViewConnections,
}: RunnerTokenCardProps) {
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const getTokenStatus = (): TokenStatus => {
    if (token.is_revoked) return "revoked";
    if (isExpired(token.expires_at)) return "expired";
    return "active";
  };

  const status = getTokenStatus();
  const showExpiryWarning =
    !token.is_revoked && isExpiringSoon(token.expires_at);

  const handleRevoke = () => {
    onRevoke(token.id);
    setShowRevokeDialog(false);
  };

  const handleDelete = () => {
    onDelete(token.id);
    setShowDeleteDialog(false);
  };

  return (
    <>
      <Card
        className={`bg-[#1A1A1B] border-gray-800 p-6 transition-all hover:border-gray-700 ${
          status === "revoked" ? "opacity-60" : ""
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {/* Header */}
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-lg font-semibold text-white">{token.name}</h3>
              <StatusIndicator status={status} showLabel={false} />
              {status !== "revoked" && (
                <Badge
                  variant="outline"
                  className={
                    status === "active"
                      ? "border-green-500/50 text-green-500"
                      : "border-orange-500/50 text-orange-500"
                  }
                >
                  {status === "active" ? "Active" : "Expired"}
                </Badge>
              )}
              {status === "revoked" && (
                <Badge
                  variant="outline"
                  className="border-red-500/50 text-red-500"
                >
                  Revoked
                </Badge>
              )}
            </div>

            {/* Warning for expiring soon */}
            {showExpiryWarning && (
              <div className="flex items-center gap-2 mb-3 text-amber-500 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>Expires soon</span>
              </div>
            )}

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Created:</span>
                <p className="text-white mt-1">
                  {formatRelativeTime(token.created_at)}
                </p>
              </div>

              <div>
                <span className="text-gray-400">Expires:</span>
                <p className="text-white mt-1">
                  {token.expires_at
                    ? formatRelativeTime(token.expires_at)
                    : "Never"}
                </p>
              </div>

              <div>
                <span className="text-gray-400">Last Used:</span>
                <p className="text-white mt-1">
                  {token.last_used_at
                    ? formatRelativeTime(token.last_used_at)
                    : "Never"}
                </p>
              </div>

              <div>
                <span className="text-gray-400">Connections:</span>
                <p className="text-white mt-1">
                  <Badge
                    variant="outline"
                    className="border-[#00D9FF]/50 text-[#00D9FF]"
                  >
                    {token.connection_count}
                  </Badge>
                </p>
              </div>

              {token.last_ip_address && (
                <div className="col-span-2">
                  <span className="text-gray-400">Last IP:</span>
                  <p className="text-white mt-1 font-mono text-xs">
                    {token.last_ip_address}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Actions Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-[#1A1A1B] border-gray-800"
            >
              <DropdownMenuItem
                onClick={() => onViewConnections(token.id)}
                className="cursor-pointer"
              >
                <Eye className="w-4 h-4 mr-2" />
                View Connections
              </DropdownMenuItem>
              {status !== "revoked" && (
                <DropdownMenuItem
                  onClick={() => setShowRevokeDialog(true)}
                  className="cursor-pointer text-orange-500"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Revoke Token
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => setShowDeleteDialog(true)}
                className="cursor-pointer text-red-500"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Token
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <AlertDialogContent className="bg-[#1A1A1B] border-gray-800">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Runner Token?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately disconnect any active runners using this
              token and prevent future connections. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              Revoke Token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-[#1A1A1B] border-gray-800">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Runner Token?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this token and all its connection
              history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              Delete Token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
