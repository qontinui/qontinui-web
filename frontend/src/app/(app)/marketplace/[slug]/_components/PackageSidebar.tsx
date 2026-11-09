import {
  Download,
  Star,
  Calendar,
  ExternalLink,
  Flag,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  formatDownloads,
  formatRating,
  scanDisplay,
} from "@/types/code-packages";
import type { CodePackage } from "@/types/code-packages";
import {
  SCAN_STATUS_BRIDGE_ID,
  SCAN_TONE_SURFACE,
  SCAN_TONE_TEXT,
  ScanIcon,
  ScanIssueList,
} from "@/components/marketplace/ScanStatus";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface PackageSidebarProps {
  pkg: CodePackage;
}

/**
 * The sidebar renders only a served detail payload, so an `unknown` scan here
 * is what the API served — re-reading would serve the same thing, and no
 * Retry is offered.
 */
export function PackageSidebar({ pkg }: PackageSidebarProps) {
  const latest = pkg.latest_version ?? null;
  const scan = latest ? scanDisplay(latest.security_scan) : null;
  return (
    <div className="space-y-6">
      <Card className="bg-muted/50 border-border">
        <CardHeader>
          <CardTitle className="text-base">Statistics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Download className="w-4 h-4" />
              <span className="text-sm">Downloads</span>
            </div>
            <span className="font-semibold text-foreground">
              {pkg.total_downloads !== undefined
                ? formatDownloads(pkg.total_downloads)
                : "Unknown"}
            </span>
          </div>
          <Separator className="bg-border" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Star className="w-4 h-4" />
              <span className="text-sm">Rating</span>
            </div>
            <span className="font-semibold text-foreground">
              {pkg.average_rating !== undefined
                ? formatRating(pkg.average_rating)
                : "Not rated"}
              {pkg.average_rating !== undefined &&
                pkg.rating_count !== undefined &&
                ` (${pkg.rating_count})`}
            </span>
          </div>
          <Separator className="bg-border" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <GitBranch className="w-4 h-4" />
              <span className="text-sm">Version</span>
            </div>
            <span className="font-mono text-sm font-semibold text-foreground">
              {latest ? `v${latest.version}` : "No published version"}
            </span>
          </div>
          <Separator className="bg-border" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span className="text-sm">Updated</span>
            </div>
            <span className="text-sm text-foreground">
              {formatDistanceToNow(new Date(pkg.updated_at), {
                addSuffix: true,
              })}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/50 border-border">
        <CardHeader>
          <CardTitle className="text-base">License</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="outline" className="text-sm">
            {pkg.license ?? "Unknown"}
          </Badge>
        </CardContent>
      </Card>

      {(pkg.repository_url || pkg.homepage_url || pkg.documentation_url) && (
        <Card className="bg-muted/50 border-border">
          <CardHeader>
            <CardTitle className="text-base">Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pkg.repository_url && (
              <a
                href={pkg.repository_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:text-primary/80"
              >
                <ExternalLink className="w-4 h-4" />
                Repository
              </a>
            )}
            {pkg.homepage_url && (
              <a
                href={pkg.homepage_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:text-primary/80"
              >
                <ExternalLink className="w-4 h-4" />
                Homepage
              </a>
            )}
            {pkg.documentation_url && (
              <a
                href={pkg.documentation_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:text-primary/80"
              >
                <ExternalLink className="w-4 h-4" />
                Documentation
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {latest && scan ? (
        <Card
          className={cn(SCAN_TONE_SURFACE[scan.tone])}
          data-ui-bridge-id={SCAN_STATUS_BRIDGE_ID}
          data-scan-status={scan.status}
        >
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ScanIcon display={scan} />
              <span className={SCAN_TONE_TEXT[scan.tone]}>{scan.label}</span>
            </CardTitle>
          </CardHeader>
          {(scan.detail || latest.security_scan.issues.length > 0) && (
            <CardContent className="space-y-2">
              {scan.detail && (
                <p className="text-sm text-muted-foreground">{scan.detail}</p>
              )}
              <ScanIssueList issues={latest.security_scan.issues} />
            </CardContent>
          )}
        </Card>
      ) : (
        <Card className="bg-muted/50 border-border">
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">
              No published version
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      <Button variant="outline" className="w-full" size="sm">
        <Flag className="w-4 h-4 mr-2" />
        Report Package
      </Button>
    </div>
  );
}
