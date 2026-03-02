"use client";

import { useProjects } from "@/hooks/use-projects";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { useRecordingUpload } from "./_hooks/useRecordingUpload";
import { FileDropZone } from "./_components/FileDropZone";
import { TagInput } from "./_components/TagInput";
import { UploadStatusMessages } from "./_components/UploadStatusMessages";
import { UploadActionButtons } from "./_components/UploadActionButtons";

export function RecordingUploadPage() {
  const { data: projects = [] } = useProjects();
  const {
    state,
    tagInput,
    setTagInput,
    dragActive,
    fileInputRef,
    handleDrag,
    handleDrop,
    handleFileInputChange,
    clearFile,
    setProjectId,
    setName,
    setDescription,
    handleAddTag,
    handleRemoveTag,
    handleUpload,
    handleReset,
    navigateToRecordings,
    navigateToRecording,
    isUploadDisabled,
    isFormDisabled,
  } = useRecordingUpload();

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <Button variant="ghost" onClick={navigateToRecordings} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Recordings
        </Button>
        <h1 className="text-3xl font-bold">Upload Recording</h1>
        <p className="text-muted-foreground mt-2">
          Upload an annotated recording to automatically discover states and
          transitions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recording Details</CardTitle>
          <CardDescription>
            Upload a ZIP file containing frames, interactions, and context
            events
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="project">Project *</Label>
            <Select
              value={state.projectId}
              onValueChange={setProjectId}
              disabled={isFormDisabled}
            >
              <SelectTrigger id="project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <FileDropZone
            file={state.file}
            dragActive={dragActive}
            disabled={isFormDisabled}
            fileInputRef={fileInputRef}
            onDrag={handleDrag}
            onDrop={handleDrop}
            onFileInputChange={handleFileInputChange}
            onClearFile={clearFile}
          />

          <div className="space-y-2">
            <Label htmlFor="name">Recording Name *</Label>
            <Input
              id="name"
              value={state.name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., User Login Flow"
              disabled={isFormDisabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={state.description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this recording captures..."
              rows={3}
              disabled={isFormDisabled}
            />
          </div>

          <TagInput
            tags={state.tags}
            tagInput={tagInput}
            disabled={isFormDisabled}
            onTagInputChange={setTagInput}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
          />

          <UploadStatusMessages
            uploading={state.uploading}
            progress={state.progress}
            error={state.error}
            success={state.success}
            validationErrors={state.validationErrors}
            validationWarnings={state.validationWarnings}
          />

          <UploadActionButtons
            success={state.success}
            uploading={state.uploading}
            uploadDisabled={isUploadDisabled}
            recordingId={state.recordingId}
            onUpload={handleUpload}
            onReset={handleReset}
            onCancel={navigateToRecordings}
            onViewRecording={navigateToRecording}
          />
        </CardContent>
      </Card>
    </div>
  );
}
