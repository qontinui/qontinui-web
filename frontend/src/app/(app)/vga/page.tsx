"use client";

/**
 * /vga — landing page.
 *
 * Lists all persisted VGA state machines as cards with a filter by
 * `target_process`. Each card links into the builder for that SM.
 * When no SMs exist, prompts the user to create their first.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Eye, EyeOff, Layers, Loader2, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { listStateMachines } from "./_components/api-client";

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const sec = Math.max(1, Math.round((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export default function VgaLandingPage() {
  const [targetProcessFilter, setTargetProcessFilter] = useState<string>("all");

  const {
    data: stateMachines,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["vga", "state-machines"],
    queryFn: listStateMachines,
    refetchOnWindowFocus: false,
  });

  const targetProcesses = useMemo(() => {
    const set = new Set<string>();
    for (const sm of stateMachines ?? []) set.add(sm.targetProcess);
    return [...set].sort();
  }, [stateMachines]);

  const visible = useMemo(() => {
    if (!stateMachines) return [];
    if (targetProcessFilter === "all") return stateMachines;
    return stateMachines.filter(
      (sm) => sm.targetProcess === targetProcessFilter
    );
  }, [stateMachines, targetProcessFilter]);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">
            VGA state machines
          </h1>
          <Badge variant="outline">Visual GUI automation</Badge>
        </div>
        <Link
          href="/vga/builder/new"
          aria-label="Create a new VGA state machine"
        >
          <Button size="sm">
            <Plus className="size-4" />
            Create state machine
          </Button>
        </Link>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Target process:</span>
          <Select
            value={targetProcessFilter}
            onValueChange={setTargetProcessFilter}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {targetProcesses.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-sm text-red-500">
            Failed to load state machines: {(error as Error).message}
          </div>
        ) : (stateMachines?.length ?? 0) === 0 ? (
          <EmptyState />
        ) : visible.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No state machines match this filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((sm) => (
              <Link
                key={sm.id}
                href={`/vga/builder/${sm.id}`}
                className="focus:outline-none focus:ring-2 focus:ring-ring rounded-xl"
              >
                <Card className="cursor-pointer hover:border-primary transition-colors h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      <span className="truncate">{sm.name}</span>
                      {sm.private ? (
                        <span
                          title="Private — not exported for training"
                          aria-label="Private"
                        >
                          <EyeOff className="size-4 text-muted-foreground shrink-0" />
                        </span>
                      ) : (
                        <span
                          title="Public — eligible for training exports"
                          aria-label="Public"
                        >
                          <Eye className="size-4 text-muted-foreground shrink-0" />
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription className="truncate">
                      {sm.targetProcess}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{sm.targetOs}</Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {sm.groundingModel}
                    </Badge>
                    <Badge variant="outline">
                      <Layers className="size-3" /> {sm.elementCount} elements
                    </Badge>
                  </CardContent>
                  <CardFooter>
                    <span className="text-xs text-muted-foreground">
                      Updated {formatRelative(sm.updatedAt)}
                    </span>
                  </CardFooter>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Layers className="size-12 text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold">No state machines yet</h2>
      <p className="text-sm text-muted-foreground max-w-md mt-2">
        Visual GUI automation works by capturing a screenshot of your target
        app, letting the VLM propose interactive elements, and saving the
        confirmed ones into a reusable state machine.
      </p>
      <Link href="/vga/builder/new" className="mt-6">
        <Button>
          <Plus className="size-4" /> Create your first VGA state machine
        </Button>
      </Link>
    </div>
  );
}
