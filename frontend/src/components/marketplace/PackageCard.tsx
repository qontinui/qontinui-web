"use client";

import React from "react";
import { Star, Download, Check, ShieldCheck, ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatDownloads,
  formatRating,
  getCategoryLabel,
  type CodePackage,
} from "@/types/code-packages";

interface PackageCardProps {
  package: CodePackage;
  onInstall?: (pkg: CodePackage) => void;
  onViewDetails?: (pkg: CodePackage) => void;
  isInstalled?: boolean;
  isInstalling?: boolean;
  compact?: boolean;
  className?: string;
}

export function PackageCard({
  package: pkg,
  onInstall,
  onViewDetails,
  isInstalled = false,
  isInstalling = false,
  compact = false,
  className,
}: PackageCardProps) {
  const handleCardClick = () => {
    if (onViewDetails) {
      onViewDetails(pkg);
    }
  };

  const handleInstallClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onInstall && !isInstalled && !isInstalling) {
      onInstall(pkg);
    }
  };

  return (
    <Card
      className={cn(
        "group relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-cyan-500/50 cursor-pointer",
        isInstalled && "border-green-500/50 bg-green-950/10",
        pkg.deprecated && "opacity-60",
        className
      )}
      onClick={handleCardClick}
    >
      {/* Gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 via-purple-500/0 to-green-500/0 group-hover:from-cyan-500/5 group-hover:via-purple-500/5 group-hover:to-green-500/5 transition-all duration-300 pointer-events-none" />

      <CardHeader className={cn("relative", compact && "pb-3")}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <CardTitle
                className={cn("truncate", compact ? "text-base" : "text-lg")}
              >
                {pkg.name}
              </CardTitle>
              {pkg.verified && (
                <span title="Verified by staff">
                  <ShieldCheck className="flex-shrink-0 w-4 h-4 text-cyan-500" />
                </span>
              )}
              {isInstalled && (
                <span title="Installed">
                  <Check className="flex-shrink-0 w-4 h-4 text-green-500" />
                </span>
              )}
            </div>
            <CardDescription
              className={cn("line-clamp-2", compact && "text-xs")}
            >
              {pkg.description}
            </CardDescription>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mt-2">
          <Badge variant="outline" className="text-xs">
            {getCategoryLabel(pkg.category)}
          </Badge>
          {pkg.featured && (
            <Badge className="bg-gradient-to-r from-cyan-500 to-purple-500 text-white text-xs">
              Featured
            </Badge>
          )}
          {pkg.deprecated && (
            <Badge variant="destructive" className="text-xs">
              Deprecated
            </Badge>
          )}
          {!compact &&
            pkg.tags.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
        </div>
      </CardHeader>

      <CardContent className={cn("relative", compact && "py-2")}>
        {/* Author */}
        <div className="flex items-center gap-2 text-sm text-text-muted mb-3">
          <span>by</span>
          <span className="font-medium text-text-secondary">
            {pkg.author.username}
          </span>
          {pkg.author.verified && (
            <ShieldCheck className="w-3 h-3 text-cyan-500" />
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-text-muted">
          <div
            className="flex items-center gap-1"
            title={`${pkg.total_downloads} total downloads`}
          >
            <Download className="w-4 h-4" />
            <span>{formatDownloads(pkg.total_downloads)}</span>
          </div>
          {pkg.rating_count > 0 && (
            <div
              className="flex items-center gap-1"
              title={`${pkg.rating_count} ratings`}
            >
              <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
              <span>{formatRating(pkg.average_rating)}</span>
              <span className="text-text-muted">({pkg.rating_count})</span>
            </div>
          )}
          <div className="flex items-center gap-1 text-xs">
            <span>v{pkg.latest_version.version}</span>
          </div>
        </div>

        {/* License */}
        {!compact && (
          <div className="mt-2 text-xs text-text-muted">
            License: {pkg.license}
          </div>
        )}
      </CardContent>

      <CardFooter
        className={cn("relative flex justify-between gap-2", compact && "pt-2")}
      >
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className="flex-1"
          onClick={handleCardClick}
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Details
        </Button>
        <Button
          size={compact ? "sm" : "default"}
          className={cn(
            "flex-1",
            isInstalled
              ? "bg-green-600 hover:bg-green-700"
              : "bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600"
          )}
          onClick={handleInstallClick}
          disabled={isInstalled || isInstalling || pkg.deprecated}
        >
          {isInstalling ? (
            <>
              <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Installing...
            </>
          ) : isInstalled ? (
            <>
              <Check className="w-4 h-4 mr-2" />
              Installed
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Install
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
