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
            {pkg.latest_version.readme ? (
              <div className="prose prose-invert prose-cyan max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {pkg.latest_version.readme}
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
        <PackageCodePreview
          code={pkg.latest_version.code}
          language="python"
          fileName={`${pkg.slug}.py`}
          maxHeight="600px"
        />
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
              {pkg.versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-start justify-between p-4 bg-muted rounded-lg border border-border"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-foreground">
                        v{version.version}
                      </span>
                      {version.id === pkg.latest_version.id && (
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
              Packages required by v{pkg.latest_version.version}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pkg.latest_version.dependencies.length > 0 ? (
              <div className="space-y-2">
                {pkg.latest_version.dependencies.map((dep, index) => (
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
