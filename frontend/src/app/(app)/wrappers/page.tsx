"use client";

import React, { useMemo, useState } from "react";
import { Package, Search, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { ListWrappersParams, WrapperSort } from "./_api";
import { WrapperListCard } from "./_components/WrapperListCard";
import { useWrappers } from "./_hooks";

const ALL_CATEGORIES = "__all__";

// Categories surfaced in the dropdown. We keep this list short and editable;
// the backend may return additional categories on individual wrappers, but
// these are the curated filter buckets.
const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: ALL_CATEGORIES, label: "All categories" },
  { value: "ai", label: "AI" },
  { value: "frontend", label: "Frontend" },
  { value: "productivity", label: "Productivity" },
  { value: "devtools", label: "Dev tools" },
  { value: "communication", label: "Communication" },
  { value: "data", label: "Data" },
];

const SORT_OPTIONS: Array<{ value: WrapperSort; label: string }> = [
  { value: "installs", label: "Most installed" },
  { value: "rating", label: "Top rated" },
  { value: "recent", label: "Recently updated" },
];

export default function WrappersPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sort, setSort] = useState<WrapperSort>("installs");

  const params = useMemo<ListWrappersParams>(() => {
    const p: ListWrappersParams = { sort, limit: 60 };
    if (query.trim()) p.q = query.trim();
    if (category !== ALL_CATEGORIES) p.category = category;
    if (verifiedOnly) p.verified = true;
    return p;
  }, [query, category, verifiedOnly, sort]);

  const { data, isLoading, isError, error, refetch } = useWrappers(params);

  const wrappers = data?.wrappers ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="h-[calc(100vh-44px)] overflow-y-auto bg-background">
      <div className="mx-auto max-w-[1280px] px-6 py-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-cyan-400">
              <Package className="h-5 w-5" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Wrappers
            </h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Discover and install wrapper extensions for the qontinui runner —
            typed actions, MCP-style, first-class. Each wrapper is an
            independent Node subprocess the runner manages on your behalf.
          </p>
        </header>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search wrappers by name, package, or description"
                className="pl-9"
                aria-label="Search wrappers"
              />
            </div>

            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger
                className="md:w-48"
                aria-label="Filter by category"
              >
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={sort}
              onValueChange={(v) => setSort(v as WrapperSort)}
            >
              <SelectTrigger className="md:w-48" aria-label="Sort by">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm",
                "cursor-pointer hover:border-cyan-500/40"
              )}
            >
              <ShieldCheck className="h-4 w-4 text-cyan-400" />
              <span className="text-foreground">Verified only</span>
              <Switch
                checked={verifiedOnly}
                onCheckedChange={setVerifiedOnly}
                aria-label="Verified only"
              />
            </label>
          </CardContent>
        </Card>

        {/* Results count */}
        {!isLoading && !isError && (
          <p className="mb-4 text-xs text-muted-foreground">
            {total === 0
              ? "No wrappers match your filters."
              : `${total} wrapper${total === 1 ? "" : "s"}`}
          </p>
        )}

        {/* Grid */}
        {isLoading ? (
          <LoadingGrid />
        ) : isError ? (
          <ErrorState
            message={
              error instanceof Error ? error.message : "Failed to load wrappers"
            }
            onRetry={() => refetch()}
          />
        ) : wrappers.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {wrappers.map((w) => (
              <WrapperListCard key={w.id} wrapper={w} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-48 rounded-lg" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="py-16">
      <CardContent className="flex flex-col items-center text-center">
        <Package className="mb-3 h-12 w-12 text-muted-foreground/60" />
        <h3 className="text-lg font-semibold text-foreground">
          No wrappers found
        </h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Try a different search, broaden your category filter, or turn off the
          verified-only switch.
        </p>
      </CardContent>
    </Card>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="py-16">
      <CardContent className="flex flex-col items-center text-center">
        <h3 className="text-lg font-semibold text-foreground">
          Couldn&apos;t load wrappers
        </h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
        <Button onClick={onRetry} variant="outline" className="mt-4">
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
