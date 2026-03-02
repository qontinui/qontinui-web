import {
  Download,
  Star,
  Calendar,
  ExternalLink,
  Flag,
  GitBranch,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDownloads, formatRating } from "@/types/code-packages";
import type { CodePackage } from "@/types/code-packages";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface PackageSidebarProps {
  pkg: CodePackage;
}

export function PackageSidebar({ pkg }: PackageSidebarProps) {
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
              {formatDownloads(pkg.total_downloads)}
            </span>
          </div>
          <Separator className="bg-border" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Star className="w-4 h-4" />
              <span className="text-sm">Rating</span>
            </div>
            <span className="font-semibold text-foreground">
              {formatRating(pkg.average_rating)} ({pkg.rating_count})
            </span>
          </div>
          <Separator className="bg-border" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <GitBranch className="w-4 h-4" />
              <span className="text-sm">Version</span>
            </div>
            <span className="font-mono text-sm font-semibold text-foreground">
              v{pkg.latest_version.version}
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
            {pkg.license}
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

      {pkg.latest_version.security_scan.scanned && (
        <Card
          className={cn(
            "border-border",
            pkg.latest_version.security_scan.passed
              ? "bg-green-500/10 border-green-500/50"
              : "bg-red-950/20 border-red-500/50"
          )}
        >
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {pkg.latest_version.security_scan.passed ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  Security Scan Passed
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  Security Issues Found
                </>
              )}
            </CardTitle>
          </CardHeader>
          {!pkg.latest_version.security_scan.passed &&
            pkg.latest_version.security_scan.issues && (
              <CardContent className="space-y-2">
                {pkg.latest_version.security_scan.issues.map((issue, index) => (
                  <div key={index} className="text-sm">
                    <Badge variant="destructive" className="mr-2">
                      {issue.severity}
                    </Badge>
                    <span className="text-muted-foreground">
                      {issue.description}
                    </span>
                  </div>
                ))}
              </CardContent>
            )}
        </Card>
      )}

      <Button variant="outline" className="w-full" size="sm">
        <Flag className="w-4 h-4 mr-2" />
        Report Package
      </Button>
    </div>
  );
}
