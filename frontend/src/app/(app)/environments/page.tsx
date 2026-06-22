"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AppWindow,
  Boxes,
  ChevronRight,
  Crown,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import {
  createEnvironment,
  deleteEnvironment,
  DevenvApiError,
  listApplications,
  listEnvironments,
  type Application,
  type Environment,
} from "@/services/devenv-api";

const NONE_APPLICATION = "__none__";

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof DevenvApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function EnvironmentsPage() {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [applicationId, setApplicationId] = useState<string>(NONE_APPLICATION);
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [envs, apps] = await Promise.all([
        listEnvironments(),
        listApplications(),
      ]);
      setEnvironments(envs);
      setApplications(apps);
    } catch (err) {
      toast.error(errMessage(err, "Failed to load environments"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Environment name is required");
      return;
    }
    setCreating(true);
    try {
      await createEnvironment({
        name: trimmedName,
        description: description.trim() || null,
        application_id:
          applicationId === NONE_APPLICATION ? null : applicationId,
      });
      toast.success(`Created ${trimmedName}`);
      setName("");
      setDescription("");
      setApplicationId(NONE_APPLICATION);
      setDialogOpen(false);
      await fetchData();
    } catch (err) {
      toast.error(errMessage(err, "Failed to create environment"));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (env: Environment) => {
    try {
      await deleteEnvironment(env.id);
      toast.success(`Removed ${env.name}`);
      await fetchData();
    } catch (err) {
      toast.error(errMessage(err, `Failed to remove ${env.name}`));
    }
  };

  const appName = (id: string | null): string | null => {
    if (!id) return null;
    return applications.find((a) => a.id === id)?.name ?? null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Boxes className="size-5" />
            Environments
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Define named environments and track config drift across machines
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/environments/machines">
              <Server className="size-4" />
              Machines
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/environments/applications">
              <AppWindow className="size-4" />
              Applications
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLoading(true);
              fetchData();
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-4" />
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="brand-primary" size="sm">
                <Plus className="size-4" />
                New Environment
              </Button>
            </DialogTrigger>
            <DialogContent onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>New Environment</DialogTitle>
                <DialogDescription>
                  Create a named environment, optionally bound to an
                  application.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="env-name">Name</Label>
                  <Input
                    id="env-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="production"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="env-description">Description</Label>
                  <Input
                    id="env-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="env-application">Application</Label>
                  <Select
                    value={applicationId}
                    onValueChange={setApplicationId}
                  >
                    <SelectTrigger id="env-application" className="w-full">
                      <SelectValue placeholder="No application" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_APPLICATION}>
                        No application
                      </SelectItem>
                      {applications.map((app) => (
                        <SelectItem key={app.id} value={app.id}>
                          {app.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="brand-primary"
                  size="sm"
                  onClick={handleCreate}
                  disabled={creating || !name.trim()}
                >
                  {creating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {environments.length === 0 ? (
        <div className="rounded-lg border border-border p-12 text-center">
          <Boxes className="size-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No environments yet. Create one to start tracking config drift.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {environments.map((env) => (
            <div
              key={env.id}
              className="card card-hover group relative flex flex-col gap-2 rounded-lg border border-border p-4"
            >
              <Link
                href={`/environments/${env.id}`}
                className="flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Boxes className="size-4 shrink-0 text-muted-foreground" />
                    <h3 className="text-sm font-semibold truncate">
                      {env.name}
                    </h3>
                  </div>
                  {env.description && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {env.description}
                    </p>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>

              <div className="flex flex-wrap items-center gap-2">
                {appName(env.application_id) && (
                  <Badge variant="secondary" className="gap-1">
                    <AppWindow className="size-3" />
                    {appName(env.application_id)}
                  </Badge>
                )}
                {env.canonical_machine_id ? (
                  <Badge variant="brand-primary" className="gap-1">
                    <Crown className="size-3" />
                    canonical set
                  </Badge>
                ) : (
                  <Badge variant="warning">no canonical</Badge>
                )}
              </div>

              <div className="mt-auto flex items-center justify-end pt-1">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove environment?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This deletes{" "}
                        <span className="font-medium">{env.name}</span> and its
                        drift history.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction asChild>
                        <DestructiveButton onClick={() => handleDelete(env)}>
                          Remove
                        </DestructiveButton>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
