"use client";

import React from "react";
import Link from "next/link";
import { Download, Package, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { WrapperEntry } from "../_api";
import { RatingStars } from "./RatingStars";
import { TransportBadge } from "./TransportBadge";

interface WrapperListCardProps {
  wrapper: WrapperEntry;
  className?: string;
}

function formatInstalls(n: number): string {
  if (n < 1_000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function WrapperListCard({ wrapper, className }: WrapperListCardProps) {
  return (
    <Link
      href={`/wrappers/${encodeURIComponent(wrapper.id)}`}
      className="group block focus:outline-none"
    >
      <Card
        className={cn(
          "h-full transition-all duration-200 hover:border-cyan-500/40 hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-cyan-500/60",
          className
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Package className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base truncate">
                  {wrapper.displayName}
                </CardTitle>
                {wrapper.verified && (
                  <span title="Verified by qontinui">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-400" />
                  </span>
                )}
              </div>
              <p className="font-mono text-xs text-muted-foreground truncate">
                {wrapper.package}
              </p>
            </div>
            <TransportBadge transport={wrapper.transport} />
          </div>
        </CardHeader>

        <CardContent className="pb-3">
          <CardDescription className="line-clamp-2 min-h-[2.5rem]">
            {wrapper.description ?? "No description provided."}
          </CardDescription>

          {wrapper.categories.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {wrapper.categories.slice(0, 3).map((cat) => (
                <Badge
                  key={cat}
                  variant="secondary"
                  className="text-[10px] uppercase tracking-wide"
                >
                  {cat}
                </Badge>
              ))}
              {wrapper.categories.length > 3 && (
                <Badge variant="outline" className="text-[10px]">
                  +{wrapper.categories.length - 3}
                </Badge>
              )}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex items-center justify-between border-t border-border pt-3">
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={`${wrapper.installCount.toLocaleString()} installs`}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="tabular-nums">
              {formatInstalls(wrapper.installCount)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <RatingStars value={wrapper.avgRating} size="sm" />
            {wrapper.ratingCount > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {(wrapper.avgRating ?? 0).toFixed(1)}{" "}
                <span className="text-muted-foreground/70">
                  ({wrapper.ratingCount})
                </span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/70">
                No ratings
              </span>
            )}
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}
