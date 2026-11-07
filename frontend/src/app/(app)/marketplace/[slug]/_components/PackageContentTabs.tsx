import { FileText, Code, GitBranch, Package } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PackageCodePreview } from "@/components/marketplace/PackageCodePreview";
import { usePackageVersions } from "@/hooks/useCodePackages";
import { formatDownloads } from "@/types/code-packages";
import type { CodePackage } from "@/types/code-packages";
import { formatDistanceToNow } from "date-fns";

type TabValue = "readme" | "code" | "versions" | "dependencies";

interface PackageContentTabsProps {
  pkg: CodePackage;
  selectedTab: TabValue;
  onTabChange: (tab: TabValue) => void;
}

export function PackageContentTabs({
  pkg,
  selectedTab,
  onTabChange,
}: PackageContentTabsProps) {
  const latest = pkg.latest_version ?? null;
  const versionsQuery = usePackageVersions(pkg.id);
  const versions = versionsQuery.data ?? [];
  const dependencies = latest?.dependencies ?? [];

  return (
    <Tabs value={selectedTab} onValueChange={(v) => onTabChange(v as TabValue)}>
      <TabsList className="bg-muted w-full">
        <TabsTrigger value="readme" className="flex-1">
          <FileText className="w-4 h-4 mr-2" />
          README
        </TabsTrigger>
        <TabsTrigger value="code" className="flex-1">
          <Code className="w-4 h-4 mr-2" />
          Code
        </TabsTrigger>
        <TabsTrigger value="versions" className="flex-1">
          <GitBranch className="w-4 h-4 mr-2" />
          Versions
        </TabsTrigger>
        <TabsTrigger value="dependencies" className="flex-1">
          <Package className="w-4 h-4 mr-2" />
          Dependencies
        </TabsTrigger>
      </TabsList>

      <TabsContent value="readme" className="mt-6">
        <Card className="bg-muted/50 border-border">
          <CardContent className="p-6">
            {latest?.readme ? (
              <div className="prose prose-invert prose-cyan max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {latest.readme}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No README provided for this package.
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="code" className="mt-6">
        {latest ? (
          <PackageCodePreview
            code={latest.code}
            language="python"
            fileName={`${pkg.slug}.py`}
            maxHeight="600px"
          />
        ) : (
          <Card className="bg-muted/50 border-border">
            <CardContent className="p-6 text-center py-12 text-muted-foreground">
              No published version
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="versions" className="mt-6">
        <Card className="bg-muted/50 border-border">
          <CardHeader>
            <CardTitle>Version History</CardTitle>
            <CardDescription>
              All published versions of this package
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {versionsQuery.isPending && (
                <div className="text-sm text-muted-foreground">
                  Loading versions...
                </div>
              )}
              {versionsQuery.isError && (
                <div className="text-sm text-muted-foreground">
                  The package versions could not be loaded
                </div>
              )}
              {versionsQuery.isSuccess && versions.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No published version
                </div>
              )}
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-start justify-between p-4 bg-muted rounded-lg border border-border"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-foreground">
                        v{version.version}
                      </span>
                      {version.id === latest?.id && (
                        <Badge variant="secondary">Latest</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Released{" "}
                      {formatDistanceToNow(new Date(version.created_at), {
                        addSuffix: true,
                      })}
                    </div>
                    {version.changelog && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {version.changelog}
                      </p>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatDownloads(version.downloads)} downloads
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="dependencies" className="mt-6">
        <Card className="bg-muted/50 border-border">
          <CardHeader>
            <CardTitle>Dependencies</CardTitle>
            <CardDescription>
              {latest
                ? `Packages required by v${latest.version}`
                : "No published version"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dependencies.length > 0 ? (
              <div className="space-y-2">
                {dependencies.map((dep, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-muted rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-foreground">
                        {dep.package_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {dep.version_constraint}
                      </Badge>
                      {dep.optional && (
                        <Badge variant="secondary" className="text-xs">
                          Optional
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No dependencies required
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
