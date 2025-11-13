'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useProjects } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Upload, FileArchive, X, Check, AlertCircle, ArrowLeft } from 'lucide-react';
import { RecordingService } from '@/services/recording-service';
import type { UploadResponse, RecordingError } from '@/types/recording';

interface UploadState {
  file: File | null;
  projectId: string;
  name: string;
  description: string;
  tags: string[];
  uploading: boolean;
  progress: number;
  validating: boolean;
  error: string | null;
  success: boolean;
  recordingId: string | null;
  validationErrors: string[];
  validationWarnings: string[];
}

export function RecordingUploadPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<UploadState>({
    file: null,
    projectId: '',
    name: '',
    description: '',
    tags: [],
    uploading: false,
    progress: 0,
    validating: false,
    error: null,
    success: false,
    recordingId: null,
    validationErrors: [],
    validationWarnings: [],
  });

  const [tagInput, setTagInput] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const recordingService = new RecordingService();

  // Handle drag and drop
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileSelect = (file: File) => {
    // Validate file type
    if (!file.name.endsWith('.zip')) {
      toast.error('Please select a ZIP file');
      return;
    }

    // Validate file size (max 500MB)
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (file.size > maxSize) {
      toast.error('File size must be less than 500MB');
      return;
    }

    setState(prev => ({
      ...prev,
      file,
      name: prev.name || file.name.replace('.zip', ''),
      error: null,
    }));
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !state.tags.includes(tag)) {
      setState(prev => ({ ...prev, tags: [...prev.tags, tag] }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setState(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  };

  const handleUpload = async () => {
    // Validation
    if (!state.file) {
      toast.error('Please select a file');
      return;
    }
    if (!state.projectId) {
      toast.error('Please select a project');
      return;
    }
    if (!state.name.trim()) {
      toast.error('Please enter a recording name');
      return;
    }

    setState(prev => ({ ...prev, uploading: true, progress: 0, error: null }));

    try {
      const response = await recordingService.uploadRecording(
        state.projectId,
        state.file,
        state.description,
        state.tags,
        (progress) => {
          setState(prev => ({ ...prev, progress }));
        }
      );

      // Check for validation errors
      if (response.validation_errors.length > 0) {
        setState(prev => ({
          ...prev,
          uploading: false,
          error: 'Recording uploaded with validation errors',
          validationErrors: response.validation_errors,
          validationWarnings: response.validation_warnings,
        }));
        toast.error('Recording uploaded but has validation errors');
        return;
      }

      // Success
      setState(prev => ({
        ...prev,
        uploading: false,
        success: true,
        recordingId: response.recording_id,
        validationWarnings: response.validation_warnings,
      }));

      toast.success('Recording uploaded successfully!');

      // Redirect to recording detail page after 2 seconds
      setTimeout(() => {
        router.push(`/recordings/${response.recording_id}`);
      }, 2000);

    } catch (error: any) {
      console.error('Upload failed:', error);
      setState(prev => ({
        ...prev,
        uploading: false,
        error: error.message || 'Failed to upload recording',
      }));
      toast.error(error.message || 'Failed to upload recording');
    }
  };

  const handleReset = () => {
    setState({
      file: null,
      projectId: state.projectId, // Keep project selection
      name: '',
      description: '',
      tags: [],
      uploading: false,
      progress: 0,
      validating: false,
      error: null,
      success: false,
      recordingId: null,
      validationErrors: [],
      validationWarnings: [],
    });
    setTagInput('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <Button
          variant="ghost"
          onClick={() => router.push('/recordings')}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Recordings
        </Button>
        <h1 className="text-3xl font-bold">Upload Recording</h1>
        <p className="text-muted-foreground mt-2">
          Upload an annotated recording to automatically discover states and transitions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recording Details</CardTitle>
          <CardDescription>
            Upload a ZIP file containing frames, interactions, and context events
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Project Selection */}
          <div className="space-y-2">
            <Label htmlFor="project">Project *</Label>
            <Select
              value={state.projectId}
              onValueChange={(value) => setState(prev => ({ ...prev, projectId: value }))}
              disabled={state.uploading || state.success}
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

          {/* File Upload Area */}
          <div className="space-y-2">
            <Label>Recording File *</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive
                  ? 'border-primary bg-primary/5'
                  : state.file
                  ? 'border-green-500 bg-green-50 dark:bg-green-950'
                  : 'border-border hover:border-primary/50'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              {state.file ? (
                <div className="flex items-center justify-center space-x-3">
                  <FileArchive className="h-8 w-8 text-green-600" />
                  <div className="text-left">
                    <p className="font-medium">{state.file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(state.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  {!state.uploading && !state.success && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setState(prev => ({ ...prev, file: null }));
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                  <div>
                    <p className="text-lg font-medium">
                      Drag and drop your recording ZIP file here
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      or click to browse (max 500MB)
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={state.uploading || state.success}
                  >
                    Browse Files
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={handleFileInputChange}
                    disabled={state.uploading || state.success}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Recording Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Recording Name *</Label>
            <Input
              id="name"
              value={state.name}
              onChange={(e) => setState(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., User Login Flow"
              disabled={state.uploading || state.success}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={state.description}
              onChange={(e) => setState(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe what this recording captures..."
              rows={3}
              disabled={state.uploading || state.success}
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <div className="flex space-x-2">
              <Input
                id="tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="Add tags..."
                disabled={state.uploading || state.success}
              />
              <Button
                variant="outline"
                onClick={handleAddTag}
                disabled={!tagInput.trim() || state.uploading || state.success}
              >
                Add
              </Button>
            </div>
            {state.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {state.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                    {tag}
                    {!state.uploading && !state.success && (
                      <X
                        className="h-3 w-3 cursor-pointer"
                        onClick={() => handleRemoveTag(tag)}
                      />
                    )}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Upload Progress */}
          {state.uploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Uploading...</span>
                <span>{Math.round(state.progress)}%</span>
              </div>
              <Progress value={state.progress} />
            </div>
          )}

          {/* Validation Warnings */}
          {state.validationWarnings.length > 0 && (
            <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <div className="flex items-start space-x-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium text-yellow-900 dark:text-yellow-100">
                    Validation Warnings
                  </h4>
                  <ul className="mt-2 space-y-1 text-sm text-yellow-800 dark:text-yellow-200">
                    {state.validationWarnings.map((warning, idx) => (
                      <li key={idx}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Validation Errors */}
          {state.validationErrors.length > 0 && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start space-x-2">
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium text-red-900 dark:text-red-100">
                    Validation Errors
                  </h4>
                  <ul className="mt-2 space-y-1 text-sm text-red-800 dark:text-red-200">
                    {state.validationErrors.map((error, idx) => (
                      <li key={idx}>• {error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {state.error && !state.validationErrors.length && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start space-x-2">
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <p className="text-sm text-red-800 dark:text-red-200">{state.error}</p>
              </div>
            </div>
          )}

          {/* Success Message */}
          {state.success && (
            <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <div className="flex items-start space-x-2">
                <Check className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium text-green-900 dark:text-green-100">
                    Upload Successful!
                  </h4>
                  <p className="text-sm text-green-800 dark:text-green-200 mt-1">
                    Your recording has been uploaded and will be processed shortly.
                    Redirecting to recording details...
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4">
            {state.success ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleReset}
                >
                  Upload Another
                </Button>
                <Button
                  onClick={() => router.push(`/recordings/${state.recordingId}`)}
                >
                  View Recording
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => router.push('/recordings')}
                  disabled={state.uploading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={
                    !state.file ||
                    !state.projectId ||
                    !state.name.trim() ||
                    state.uploading ||
                    state.success
                  }
                >
                  {state.uploading ? (
                    <>Uploading...</>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Recording
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
