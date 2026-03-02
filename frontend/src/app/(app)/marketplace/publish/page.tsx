"use client";

import React, { useState } from "react";
import { Eye } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePublishForm } from "./_hooks/usePublishForm";
import { useSecurityScan } from "./_hooks/useSecurityScan";
import { PublishHeader } from "./_components/PublishHeader";
import { DetailsTab } from "./_components/DetailsTab";
import { CodeTab } from "./_components/CodeTab";
import { ReadmeTab } from "./_components/ReadmeTab";
import { PreviewTab } from "./_components/PreviewTab";
import { PublishSidebar } from "./_components/PublishSidebar";
import type { PublishTab } from "./types";

export default function PublishPackagePage() {
  const [activeTab, setActiveTab] = useState<PublishTab>("details");

  const {
    formState,
    setters,
    handleAddTag,
    handleRemoveTag,
    isFormValid,
    handlePublish,
    handleBack,
    isPublishing,
  } = usePublishForm();

  const { showSecurityScan, securityScanPassed, handleSecurityScan } =
    useSecurityScan();

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <PublishHeader onBack={handleBack} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as PublishTab)}
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

              <TabsContent value="details" className="mt-6">
                <DetailsTab
                  name={formState.name}
                  description={formState.description}
                  functionName={formState.functionName}
                  category={formState.category}
                  tags={formState.tags}
                  tagInput={formState.tagInput}
                  license={formState.license}
                  visibility={formState.visibility}
                  repositoryUrl={formState.repositoryUrl}
                  homepageUrl={formState.homepageUrl}
                  documentationUrl={formState.documentationUrl}
                  onNameChange={setters.setName}
                  onDescriptionChange={setters.setDescription}
                  onFunctionNameChange={setters.setFunctionName}
                  onCategoryChange={setters.setCategory}
                  onTagInputChange={setters.setTagInput}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                  onLicenseChange={setters.setLicense}
                  onVisibilityChange={setters.setVisibility}
                  onRepositoryUrlChange={setters.setRepositoryUrl}
                  onHomepageUrlChange={setters.setHomepageUrl}
                  onDocumentationUrlChange={setters.setDocumentationUrl}
                />
              </TabsContent>

              <TabsContent value="code" className="mt-6">
                <CodeTab code={formState.code} onCodeChange={setters.setCode} />
              </TabsContent>

              <TabsContent value="readme" className="mt-6">
                <ReadmeTab
                  readme={formState.readme}
                  onReadmeChange={setters.setReadme}
                />
              </TabsContent>

              <TabsContent value="preview" className="mt-6 space-y-6">
                <PreviewTab
                  name={formState.name}
                  description={formState.description}
                  category={formState.category}
                  tags={formState.tags}
                  code={formState.code}
                />
              </TabsContent>
            </Tabs>
          </div>

          <PublishSidebar
            code={formState.code}
            showSecurityScan={showSecurityScan}
            securityScanPassed={securityScanPassed}
            isFormValid={!!isFormValid()}
            isPublishing={isPublishing}
            onSecurityScan={() => handleSecurityScan(formState.code)}
            onPublish={handlePublish}
          />
        </div>
      </div>
    </div>
  );
}
