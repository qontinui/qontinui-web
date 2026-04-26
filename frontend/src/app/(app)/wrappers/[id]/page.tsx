"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Download,
  ExternalLink,
  Package,
  ScrollText,
  ShieldCheck,
  Star,
  User as UserIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

import { CommentComposer } from "../_components/CommentComposer";
import { CommentThread } from "../_components/CommentThread";
import { OpenInRunnerButton } from "../_components/OpenInRunnerButton";
import { RatingBreakdown } from "../_components/RatingBreakdown";
import { RatingStars } from "../_components/RatingStars";
import { TransportBadge } from "../_components/TransportBadge";
import {
  useSubmitWrapperComment,
  useSubmitWrapperRating,
  useWrapper,
} from "../_hooks";

function formatInstalls(n: number): string {
  if (n < 1_000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function WrapperDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ? decodeURIComponent(params.id) : "";

  const { user } = useAuth();
  const { data: wrapper, isLoading, isError, error } = useWrapper(id, !!id);

  const submitRatingMutation = useSubmitWrapperRating(id);
  const submitCommentMutation = useSubmitWrapperComment(id);

  const handleSubmitRating = (stars: number) => {
    submitRatingMutation.mutate(stars);
  };

  const handleSubmitComment = async (body: string) => {
    await submitCommentMutation.mutateAsync({ body });
  };

  const handleSubmitReply = async (parentId: number, body: string) => {
    await submitCommentMutation.mutateAsync({ body, parentId });
  };

  // Build star-count map from comments? No — comments don't have star counts.
  // Backend doesn't expose distribution directly per the contract; we derive
  // an empty map and let RatingBreakdown render proportional bars based on
  // ratingCount only (each star will show 0). When the backend later returns
  // a `ratingDistribution`, this is the place to plug it in.
  const ratingDistribution = useMemo(() => undefined, []);

  if (isLoading) {
    return <DetailSkeleton onBack={() => router.push("/wrappers")} />;
  }

  if (isError || !wrapper) {
    return (
      <div className="h-[calc(100vh-44px)] overflow-y-auto bg-background">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/wrappers")}
            className="mb-6"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to wrappers
          </Button>
          <Card>
            <CardContent className="py-12 text-center">
              <h2 className="text-xl font-semibold text-foreground">
                Wrapper not found
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {error instanceof Error
                  ? error.message
                  : `We couldn't find a wrapper with id "${id}".`}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const isAuthed = !!user;

  return (
    <div className="h-[calc(100vh-44px)] overflow-y-auto bg-background">
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        {/* Breadcrumb */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/wrappers")}
          className="mb-4 -ml-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to wrappers
        </Button>

        {/* Header */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-cyan-400">
              <Package className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {wrapper.displayName}
                </h1>
                {wrapper.verified && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                  >
                    <ShieldCheck className="h-3 w-3" />
                    Verified
                  </Badge>
                )}
                <TransportBadge transport={wrapper.transport} />
              </div>
              <p className="mt-1 font-mono text-sm text-muted-foreground">
                {wrapper.package}
                <span className="mx-2 text-muted-foreground/50">·</span>v
                {wrapper.latestVersion}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                <span
                  className="flex items-center gap-1.5 text-muted-foreground"
                  title={`${wrapper.installCount.toLocaleString()} installs`}
                >
                  <Download className="h-4 w-4" />
                  <span className="tabular-nums">
                    {formatInstalls(wrapper.installCount)}
                  </span>
                  <span>installs</span>
                </span>
                {wrapper.ratingCount > 0 ? (
                  <span className="flex items-center gap-1.5">
                    <RatingStars value={wrapper.avgRating} size="sm" />
                    <span className="tabular-nums text-foreground">
                      {(wrapper.avgRating ?? 0).toFixed(1)}
                    </span>
                    <span className="text-muted-foreground">
                      ({wrapper.ratingCount})
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">No ratings yet</span>
                )}
              </div>
            </div>
          </div>

          <OpenInRunnerButton wrapperId={wrapper.id} className="lg:w-64" />
        </div>

        {/* Body */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main column */}
          <div className="space-y-6 lg:col-span-2">
            {/* Description */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">About this wrapper</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {wrapper.description?.trim() ||
                    "This wrapper does not provide a description."}
                </p>
                {wrapper.categories.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {wrapper.categories.map((cat) => (
                      <Badge
                        key={cat}
                        variant="secondary"
                        className="text-[11px] uppercase tracking-wide"
                      >
                        {cat}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Screenshots placeholder */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Screenshots</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
                  No screenshots yet
                </div>
              </CardContent>
            </Card>

            {/* Ratings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ratings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col gap-6 md:flex-row md:items-start">
                  <div className="flex shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-muted/30 p-5 md:w-44">
                    <div className="text-4xl font-bold tabular-nums text-foreground">
                      {wrapper.ratingCount > 0
                        ? (wrapper.avgRating ?? 0).toFixed(1)
                        : "—"}
                    </div>
                    <RatingStars
                      value={wrapper.avgRating}
                      size="sm"
                      className="mt-2"
                    />
                    <div className="mt-1 text-xs text-muted-foreground">
                      {wrapper.ratingCount}{" "}
                      {wrapper.ratingCount === 1 ? "rating" : "ratings"}
                    </div>
                  </div>
                  <RatingBreakdown
                    counts={ratingDistribution}
                    total={wrapper.ratingCount}
                    className="flex-1"
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    Your rating
                  </p>
                  {isAuthed ? (
                    <div className="flex items-center gap-3">
                      <RatingStars
                        value={null}
                        onChange={handleSubmitRating}
                        size="lg"
                        ariaLabel="Rate this wrapper"
                      />
                      {submitRatingMutation.isPending && (
                        <span className="text-xs text-muted-foreground">
                          Saving…
                        </span>
                      )}
                      {submitRatingMutation.isSuccess &&
                        !submitRatingMutation.isPending && (
                          <span className="text-xs text-emerald-400">
                            Thanks for rating!
                          </span>
                        )}
                      {submitRatingMutation.isError && (
                        <span className="text-xs text-red-400">
                          Couldn&apos;t save your rating
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <Link
                        href="/"
                        className="text-cyan-400 underline-offset-2 hover:underline"
                      >
                        Sign in
                      </Link>{" "}
                      to rate this wrapper.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Comments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Comments{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({wrapper.comments.length})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {isAuthed ? (
                  <CommentComposer
                    onSubmit={handleSubmitComment}
                    isSubmitting={submitCommentMutation.isPending}
                  />
                ) : (
                  <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                    <Link
                      href="/"
                      className="text-cyan-400 underline-offset-2 hover:underline"
                    >
                      Sign in
                    </Link>{" "}
                    to leave a comment.
                  </div>
                )}

                <CommentThread
                  comments={wrapper.comments}
                  {...(isAuthed ? { onReply: handleSubmitReply } : {})}
                  isPostingReply={submitCommentMutation.isPending}
                  maxDepth={1}
                />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <DetailRow icon={UserIcon} label="Author">
                  {wrapper.author.url ? (
                    <a
                      href={wrapper.author.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-cyan-400 hover:text-cyan-300"
                    >
                      {wrapper.author.name}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-foreground">
                      {wrapper.author.name}
                    </span>
                  )}
                </DetailRow>

                <DetailRow icon={ScrollText} label="License">
                  <span className="text-foreground">
                    {wrapper.license || "Unknown"}
                  </span>
                </DetailRow>

                {wrapper.repo && (
                  <DetailRow icon={ExternalLink} label="Repository">
                    <a
                      href={wrapper.repo}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "inline-flex items-center gap-0.5 truncate text-cyan-400 hover:text-cyan-300"
                      )}
                    >
                      View source
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </DetailRow>
                )}

                <DetailRow icon={Calendar} label="Synced">
                  <span className="text-foreground">
                    {formatDate(wrapper.registrySyncedAt)}
                  </span>
                </DetailRow>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Version history</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-foreground">
                      v{wrapper.latestVersion}
                    </span>
                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 bg-emerald-500/10 text-[10px] uppercase text-emerald-300"
                    >
                      Latest
                    </Badge>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Older versions will appear here once the registry begins
                  tracking version history.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">At a glance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Stat
                  label="Installs"
                  value={wrapper.installCount.toLocaleString()}
                  icon={Download}
                />
                <Stat
                  label="Rating"
                  value={
                    wrapper.ratingCount > 0
                      ? `${(wrapper.avgRating ?? 0).toFixed(1)} (${wrapper.ratingCount})`
                      : "—"
                  }
                  icon={Star}
                />
                <Stat
                  label="Transport"
                  value={wrapper.transport.toUpperCase()}
                  icon={Package}
                />
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

interface DetailRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}

function DetailRow({ icon: Icon, label, children }: DetailRowProps) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="truncate">{children}</div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-[calc(100vh-44px)] overflow-y-auto bg-background">
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-4 -ml-2 text-muted-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to wrappers
        </Button>
        <Skeleton className="mb-6 h-20 w-full" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Skeleton className="h-48" />
            <Skeleton className="h-32" />
            <Skeleton className="h-64" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        </div>
      </div>
    </div>
  );
}
