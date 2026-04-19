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
import { KeyRound, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  useRunnerTokens,
  useRevokeRunnerToken,
} from "@/hooks/useServerRunners";
import { formatRelativeTime } from "@/utils/formatDuration";
import type { RunnerToken } from "@/types/server-runner";
import { CreateRunnerTokenDialog } from "./CreateRunnerTokenDialog";

export function RunnerTokenList() {
  const { data: tokens, isLoading, error, refetch } = useRunnerTokens();
  const revokeMutation = useRevokeRunnerToken();
  const [createOpen, setCreateOpen] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const handleRevoke = async (tokenId: string) => {
    try {
      await revokeMutation.mutateAsync(tokenId);
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Card className="bg-surface-raised border-border-subtle">
      <div className="flex items-center justify-between p-4 border-b border-border-subtle">
        <div>
          <h3 className="text-sm font-semibold text-white">Runner tokens</h3>
          <p className="text-xs text-text-muted">
            Long-lived bearer tokens used by runners to authenticate.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          size="sm"
          className="bg-brand-primary hover:bg-brand-primary/80 text-black"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Create runner token
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-brand-primary" />
          <span className="ml-3 text-text-muted text-sm">
            Loading tokens...
          </span>
        </div>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="text-text-muted text-sm mb-3">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Try again
          </Button>
        </div>
      ) : !tokens || tokens.length === 0 ? (
        <div className="text-center py-10">
          <KeyRound className="w-10 h-10 mx-auto text-text-muted mb-2" />
          <p className="text-sm text-text-muted">
            No runner tokens yet. Create one to let a runner register.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col">Created</TableHead>
              <TableHead scope="col">Last used</TableHead>
              <TableHead scope="col">Expires</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((token: RunnerToken) => (
              <TableRow key={token.id}>
                <TableCell className="font-medium text-white">
                  {token.name}
                </TableCell>
                <TableCell className="text-xs text-text-muted">
                  {formatRelativeTime(token.created_at)}
                </TableCell>
                <TableCell className="text-xs text-text-muted">
                  {token.last_used_at
                    ? formatRelativeTime(token.last_used_at)
                    : "never"}
                </TableCell>
                <TableCell className="text-xs text-text-muted">
                  {token.expires_at
                    ? new Date(token.expires_at).toLocaleDateString()
                    : "never"}
                </TableCell>
                <TableCell>
                  {token.is_revoked ? (
                    <Badge
                      variant="outline"
                      className="border-red-500/50 text-red-400"
                    >
                      Revoked
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/50 text-emerald-400"
                    >
                      Active
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!token.is_revoked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRevokingId(token.id)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      aria-label={`Revoke token ${token.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateRunnerTokenDialog open={createOpen} onOpenChange={setCreateOpen} />

      <AlertDialog
        open={revokingId !== null}
        onOpenChange={(open) => !open && setRevokingId(null)}
      >
        <AlertDialogContent className="bg-surface-raised border-border-subtle">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke token?</AlertDialogTitle>
            <AlertDialogDescription>
              Revoking this token will immediately disconnect any runner that
              authenticated with it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border-default">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokingId && handleRevoke(revokingId)}
              disabled={revokeMutation.isPending}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {revokeMutation.isPending ? "Revoking..." : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
