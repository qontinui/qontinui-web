"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
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
import { AppWindow, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  createApplication,
  deleteApplication,
  DevenvApiError,
  listApplications,
  type Application,
} from "@/services/devenv-api";

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof DevenvApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchApps = useCallback(async () => {
    try {
      const data = await listApplications();
      setApps(data);
    } catch (err) {
      toast.error(errMessage(err, "Failed to load applications"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  const handleAdd = async () => {
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName || !trimmedSlug) {
      toast.error("Name and slug are required");
      return;
    }
    setAdding(true);
    try {
      await createApplication({
        name: trimmedName,
        slug: trimmedSlug,
        description: description.trim() || null,
      });
      toast.success(`Registered ${trimmedName}`);
      setName("");
      setSlug("");
      setDescription("");
      await fetchApps();
    } catch (err) {
      toast.error(errMessage(err, "Failed to register application"));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (app: Application) => {
    try {
      await deleteApplication(app.id);
      toast.success(`Removed ${app.name}`);
      await fetchApps();
    } catch (err) {
      toast.error(errMessage(err, `Failed to remove ${app.name}`));
    }
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
            <AppWindow className="size-5" />
            Applications
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Register applications that environments can be bound to
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLoading(true);
            fetchApps();
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {/* Add application form */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium">Add Application</h3>
          <p className="text-xs text-muted-foreground">
            Slug must be unique across your applications
          </p>
        </div>
        <div className="p-4">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleAdd();
            }}
          >
            <Input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background border-border max-w-xs text-sm"
            />
            <Input
              type="text"
              placeholder="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="bg-background border-border max-w-[12rem] font-mono text-sm"
            />
            <Input
              type="text"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-background border-border max-w-sm text-sm"
            />
            <Button
              type="submit"
              variant="brand-primary"
              size="sm"
              disabled={adding || !name.trim() || !slug.trim()}
            >
              {adding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add Application
            </Button>
          </form>
        </div>
      </div>

      {/* Application list */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium flex items-center gap-2">
                <AppWindow className="size-4" />
                Registered Applications
              </h3>
            </div>
            {apps.length > 0 && (
              <Badge variant="secondary">{apps.length}</Badge>
            )}
          </div>
        </div>
        <div className="p-4">
          {apps.length === 0 ? (
            <div className="text-center py-12">
              <AppWindow className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No applications registered yet. Add one above to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {apps.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <AppWindow className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {app.name}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{app.slug}</span>
                        {app.description && (
                          <span className="truncate">{app.description}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Remove application?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This will delete{" "}
                            <span className="font-medium">{app.name}</span>.
                            Environments bound to it will be unbound.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction asChild>
                            <DestructiveButton onClick={() => handleDelete(app)}>
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
      </div>
    </div>
  );
}
