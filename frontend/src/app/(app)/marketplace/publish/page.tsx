"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Upload,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PackageCodePreview } from "@/components/marketplace/PackageCodePreview";
import { useCreatePackage } from "@/hooks/useCodePackages";
import {
  getCategoryLabel,
  type CreatePackageRequest,
  type PackageCategory,
  type PackageLicense,
  type PackageVisibility,
} from "@/types/code-packages";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Dynamically import Monaco editor
const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64 bg-background border border-border rounded-lg">
      <div className="text-muted-foreground">Loading editor...</div>
    </div>
  ),
});

const CATEGORIES: PackageCategory[] = [
  "automation",
  "utilities",
  "integrations",
  "patterns",
  "workflows",
  "testing",
  "data-processing",
  "ai-ml",
  "web-scraping",
  "other",
];

const LICENSES: PackageLicense[] = [
  "MIT",
  "Apache-2.0",
  "GPL-3.0",
  "BSD-3-Clause",
  "ISC",
  "Creative Commons",
  "Proprietary",
  "Other",
];

export default function PublishPackagePage() {
  const router = useRouter();
  const createPackage = useCreatePackage();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<PackageCategory>("automation");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [license, setLicense] = useState<PackageLicense>("MIT");
  const [code, setCode] = useState("");
  const [readme, setReadme] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [homepageUrl, setHomepageUrl] = useState("");
  const [documentationUrl, setDocumentationUrl] = useState("");
  const [visibility, setVisibility] = useState<PackageVisibility>("public");

  // UI state
  const [activeTab, setActiveTab] = useState<
    "details" | "code" | "readme" | "preview"
  >("details");
  const [showSecurityScan, setShowSecurityScan] = useState(false);
  const [securityScanPassed, setSecurityScanPassed] = useState<boolean | null>(
    null
  );

  const handleBack = () => {
    router.push("/marketplace");
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag) && tags.length < 10) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleSecurityScan = () => {
    setShowSecurityScan(true);
    // Simulate security scan
    setTimeout(() => {
      // Mock scan - in real app this would call backend
      const hasDangerousPatterns =
        code.includes("eval(") || code.includes("exec(");
      setSecurityScanPassed(!hasDangerousPatterns);
    }, 1500);
  };

  const handlePublish = async () => {
    if (!isFormValid()) return;

    const packageData: CreatePackageRequest = {
      name,
      description,
      category,
      tags,
      license,
      code,
      readme: readme || undefined,
      function_name: functionName,
      repository_url: repositoryUrl || undefined,
      homepage_url: homepageUrl || undefined,
      documentation_url: documentationUrl || undefined,
      visibility,
    };

    try {
      const newPackage = await createPackage.mutateAsync(packageData);
      router.push(`/marketplace/${newPackage.slug}`);
    } catch (error) {
      console.error("[PublishPackagePage] Failed to publish package:", error);
    }
  };

  const isFormValid = () => {
    return (
      name.trim() &&
      description.trim() &&
      code.trim() &&
      functionName.trim() &&
      category &&
      license &&
      visibility
    );
  };

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <h1 className="text-lg font-semibold text-foreground">
            Publish Package
          </h1>
          <span className="text-sm text-muted-foreground">
            Share your automation code with the community
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as typeof activeTab)}
            >
              <TabsList className="bg-muted w-full">
                <TabsTrigger value="details" className="flex-1">
                  Package Details
                </TabsTrigger>
                <TabsTrigger value="code" className="flex-1">
                  Code
                </TabsTrigger>
                <TabsTrigger value="readme" className="flex-1">
                  README
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex-1">
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="mt-6 space-y-6">
                <Card className="bg-muted/50 border-border">
                  <CardHeader>
                    <CardTitle>Basic Information</CardTitle>
                    <CardDescription>
                      Provide essential details about your package
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Name */}
                    <div className="space-y-2">
                      <Label htmlFor="name">Package Name *</Label>
                      <Input
                        id="name"
                        placeholder="my-awesome-package"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="bg-muted border-border"
                      />
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <Label htmlFor="description">Description *</Label>
                      <Textarea
                        id="description"
                        placeholder="A brief description of what your package does..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        className="bg-muted border-border resize-none"
                      />
                    </div>

                    {/* Function Name */}
                    <div className="space-y-2">
                      <Label htmlFor="functionName">Function Name *</Label>
                      <Input
                        id="functionName"
                        placeholder="main_function"
                        value={functionName}
                        onChange={(e) => setFunctionName(e.target.value)}
                        className="bg-muted border-border"
                      />
                      <p className="text-xs text-muted-foreground">
                        The main function that will be executed when this
                        package is used
                      </p>
                    </div>

                    {/* Category */}
                    <div className="space-y-2">
                      <Label htmlFor="category">Category *</Label>
                      <Select
                        value={category}
                        onValueChange={(v) => setCategory(v as PackageCategory)}
                      >
                        <SelectTrigger
                          id="category"
                          className="bg-muted border-border"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {getCategoryLabel(cat)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Tags */}
                    <div className="space-y-2">
                      <Label htmlFor="tags">Tags</Label>
                      <div className="flex gap-2">
                        <Input
                          id="tags"
                          placeholder="Add a tag..."
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddTag();
                            }
                          }}
                          className="bg-muted border-border"
                        />
                        <Button
                          type="button"
                          onClick={handleAddTag}
                          variant="outline"
                        >
                          Add
                        </Button>
                      </div>
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {tags.map((tag) => (
                            <Badge
                              key={tag}
                              variant="secondary"
                              className="cursor-pointer hover:bg-muted"
                              onClick={() => handleRemoveTag(tag)}
                            >
                              {tag} ×
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* License */}
                    <div className="space-y-2">
                      <Label htmlFor="license">License *</Label>
                      <Select
                        value={license}
                        onValueChange={(v) => setLicense(v as PackageLicense)}
                      >
                        <SelectTrigger
                          id="license"
                          className="bg-muted border-border"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LICENSES.map((lic) => (
                            <SelectItem key={lic} value={lic}>
                              {lic}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Visibility */}
                    <div className="space-y-2">
                      <Label htmlFor="visibility">Visibility *</Label>
                      <Select
                        value={visibility}
                        onValueChange={(v) =>
                          setVisibility(v as PackageVisibility)
                        }
                      >
                        <SelectTrigger
                          id="visibility"
                          className="bg-muted border-border"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="public">
                            Public - Anyone can find and install
                          </SelectItem>
                          <SelectItem value="unlisted">
                            Unlisted - Only via direct link
                          </SelectItem>
                          <SelectItem value="private">
                            Private - Only you can access
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-muted/50 border-border">
                  <CardHeader>
                    <CardTitle>Links (Optional)</CardTitle>
                    <CardDescription>
                      Provide additional resources for users
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="repositoryUrl">Repository URL</Label>
                      <Input
                        id="repositoryUrl"
                        placeholder="https://github.com/username/repo"
                        value={repositoryUrl}
                        onChange={(e) => setRepositoryUrl(e.target.value)}
                        className="bg-muted border-border"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="homepageUrl">Homepage URL</Label>
                      <Input
                        id="homepageUrl"
                        placeholder="https://mypackage.com"
                        value={homepageUrl}
                        onChange={(e) => setHomepageUrl(e.target.value)}
                        className="bg-muted border-border"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="documentationUrl">
                        Documentation URL
                      </Label>
                      <Input
                        id="documentationUrl"
                        placeholder="https://docs.mypackage.com"
                        value={documentationUrl}
                        onChange={(e) => setDocumentationUrl(e.target.value)}
                        className="bg-muted border-border"
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="code" className="mt-6">
                <Card className="bg-muted/50 border-border">
                  <CardHeader>
                    <CardTitle>Package Code</CardTitle>
                    <CardDescription>
                      Write or paste your Python code here
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[500px] border border-border rounded-lg overflow-hidden">
                      <Editor
                        value={code}
                        onChange={(value) => setCode(value || "")}
                        language="python"
                        theme="vs-dark"
                        options={{
                          minimap: { enabled: true },
                          fontSize: 14,
                          wordWrap: "on",
                          automaticLayout: true,
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="readme" className="mt-6">
                <Card className="bg-muted/50 border-border">
                  <CardHeader>
                    <CardTitle>README (Markdown)</CardTitle>
                    <CardDescription>
                      Provide documentation for your package (supports Markdown)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea
                      placeholder="# My Package&#10;&#10;## Installation&#10;&#10;## Usage&#10;&#10;## Examples"
                      value={readme}
                      onChange={(e) => setReadme(e.target.value)}
                      rows={15}
                      className="bg-muted border-border font-mono text-sm"
                    />
                    {readme && (
                      <div className="p-4 bg-background border border-border rounded-lg">
                        <div className="prose prose-invert prose-sm max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {readme}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="preview" className="mt-6 space-y-6">
                <Card className="bg-muted/50 border-border">
                  <CardHeader>
                    <CardTitle>Package Preview</CardTitle>
                    <CardDescription>
                      How your package will appear in the marketplace
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <h3 className="text-2xl font-bold text-foreground mb-2">
                        {name || "Package Name"}
                      </h3>
                      <p className="text-muted-foreground">
                        {description || "Package description"}
                      </p>
                    </div>

                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {getCategoryLabel(category)}
                        </Badge>
                        {tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {code && (
                      <div>
                        <h4 className="font-semibold text-foreground mb-2">
                          Code Preview
                        </h4>
                        <PackageCodePreview
                          code={code}
                          language="python"
                          fileName={`${name || "package"}.py`}
                          maxHeight="400px"
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Security Scan */}
            <Card className="bg-muted/50 border-border">
              <CardHeader>
                <CardTitle className="text-base">Security Scan</CardTitle>
                <CardDescription>
                  Scan your code for security issues before publishing
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleSecurityScan}
                  disabled={!code || showSecurityScan}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  {showSecurityScan ? "Scanning..." : "Run Security Scan"}
                </Button>

                {showSecurityScan && securityScanPassed !== null && (
                  <Alert
                    variant={securityScanPassed ? "default" : "destructive"}
                    className={
                      securityScanPassed
                        ? "border-green-500/50 bg-green-500/10"
                        : ""
                    }
                  >
                    <AlertDescription className="flex items-start gap-2">
                      {securityScanPassed ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-500" />
                          <div>
                            <div className="font-medium text-green-500">
                              Scan passed
                            </div>
                            <div className="text-xs text-muted-foreground">
                              No security issues detected
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <div>
                            <div className="font-medium">
                              Security issues found
                            </div>
                            <div className="text-xs">
                              Potentially dangerous patterns detected (eval,
                              exec)
                            </div>
                          </div>
                        </>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Guidelines */}
            <Card className="bg-muted/50 border-border">
              <CardHeader>
                <CardTitle className="text-base">
                  Publishing Guidelines
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <ul className="space-y-2 list-disc list-inside">
                  <li>Provide clear, descriptive names</li>
                  <li>Write comprehensive documentation</li>
                  <li>Include usage examples</li>
                  <li>Test your code thoroughly</li>
                  <li>Follow security best practices</li>
                  <li>Respect intellectual property</li>
                </ul>
              </CardContent>
            </Card>

            {/* Publish Button */}
            <Button
              size="lg"
              className="w-full bg-primary"
              onClick={handlePublish}
              disabled={
                !isFormValid() ||
                createPackage.isPending ||
                (showSecurityScan && !securityScanPassed)
              }
            >
              {createPackage.isPending ? (
                <>
                  <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Publish Package
                </>
              )}
            </Button>

            {!isFormValid() && (
              <p className="text-xs text-muted-foreground text-center">
                Please fill in all required fields (*)
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
