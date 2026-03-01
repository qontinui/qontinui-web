"use client";

import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Webhook,
  Plus,
  AlertCircle,
  X,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";
import { useHooksPage } from "./_hooks";
import { HookEditor, HookCard } from "./_components";
import { ACTION_TYPES } from "./_lib";

export default function HooksPage() {
  const {
    isOffline,
    healthLoading,
    hooks,
    hooksLoading,
    hooksError,
    filteredHooks,
    refetch,
    showEditor,
    editingHook,
    handleCreate,
    handleEdit,
    handleSave,
    handleDelete,
    handleToggleEnabled,
    handleTest,
    handleCloseEditor,
    deletingId,
    testingId,
    testResults,
    searchQuery,
    setSearchQuery,
    error,
    setError,
  } = useHooksPage();

  if (healthLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isOffline) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Webhook className="w-5 h-5 text-sky-400" />
            <h1 className="text-lg font-semibold text-foreground">
              Lifecycle Hooks
            </h1>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
          <RunnerOfflineState message="Start the Qontinui Runner desktop app to configure lifecycle hooks." />
        </main>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Webhook className="w-5 h-5 text-sky-400" />
          <h1 className="text-lg font-semibold text-foreground">
            Lifecycle Hooks
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="text-muted-foreground hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleCreate}
            className="bg-primary hover:bg-primary/90 text-black font-semibold"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Hook
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto space-y-6 w-full">
        {error && (
          <div className="flex items-center justify-between gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-red-400 hover:text-red-300"
              onClick={() => setError(null)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        <Card className="bg-muted border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg text-white flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  Configured Hooks
                </CardTitle>
                <CardDescription className="text-muted-foreground mt-1">
                  Actions triggered by runner lifecycle events
                </CardDescription>
              </div>
              {hooks && hooks.length > 0 && (
                <Badge variant="secondary">{hooks.length} hooks</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {hooks && hooks.length > 3 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search hooks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-muted border-border text-white placeholder:text-muted-foreground"
                />
              </div>
            )}

            {hooksLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-20 bg-muted/50 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            ) : hooksError ? (
              <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
                <AlertCircle className="w-5 h-5" />
                <p className="text-sm">Failed to load hooks</p>
              </div>
            ) : !filteredHooks || filteredHooks.length === 0 ? (
              <div className="text-center py-12">
                <Webhook className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-4">
                  {hooks && hooks.length > 0
                    ? "No hooks match your search"
                    : "No lifecycle hooks configured"}
                </p>
                {(!hooks || hooks.length === 0) && (
                  <Button
                    onClick={handleCreate}
                    className="bg-primary hover:bg-primary/90 text-black font-semibold"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Hook
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredHooks.map((hook) => (
                  <HookCard
                    key={hook.id}
                    hook={hook}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onToggleEnabled={handleToggleEnabled}
                    onTest={handleTest}
                    testResult={testResults[hook.id]}
                    testing={testingId === hook.id}
                    deleting={deletingId === hook.id}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-muted border-border">
          <CardContent className="py-6">
            <div className="grid grid-cols-4 gap-4">
              {ACTION_TYPES.map((a) => {
                const Icon = a.icon;
                return (
                  <div key={a.value} className="text-center">
                    <Icon className={`w-8 h-8 mx-auto mb-2 ${a.color}`} />
                    <p className="text-sm font-medium text-foreground">
                      {a.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {a.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </main>

      {showEditor && (
        <HookEditor
          hook={editingHook}
          onSave={handleSave}
          onClose={handleCloseEditor}
        />
      )}
    </div>
  );
}
