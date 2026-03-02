"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { recordingService } from "@/services/service-factory";

export interface UploadState {
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

const INITIAL_STATE: UploadState = {
  file: null,
  projectId: "",
  name: "",
  description: "",
  tags: [],
  uploading: false,
  progress: 0,
  validating: false,
  error: null,
  success: false,
  recordingId: null,
  validationErrors: [],
  validationWarnings: [],
};

const MAX_FILE_SIZE = 500 * 1024 * 1024;

export function useRecordingUpload() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<UploadState>(INITIAL_STATE);
  const [tagInput, setTagInput] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    if (!file.name.endsWith(".zip")) {
      toast.error("Please select a ZIP file");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error("File size must be less than 500MB");
      return;
    }

    setState((prev) => ({
      ...prev,
      file,
      name: prev.name || file.name.replace(".zip", ""),
      error: null,
    }));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    },
    [handleFileSelect]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
        handleFileSelect(e.target.files[0]);
      }
    },
    [handleFileSelect]
  );

  const clearFile = useCallback(() => {
    setState((prev) => ({ ...prev, file: null }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const setProjectId = useCallback((value: string) => {
    setState((prev) => ({ ...prev, projectId: value }));
  }, []);

  const setName = useCallback((value: string) => {
    setState((prev) => ({ ...prev, name: value }));
  }, []);

  const setDescription = useCallback((value: string) => {
    setState((prev) => ({ ...prev, description: value }));
  }, []);

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !state.tags.includes(tag)) {
      setState((prev) => ({ ...prev, tags: [...prev.tags, tag] }));
      setTagInput("");
    }
  }, [tagInput, state.tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setState((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }));
  }, []);

  const handleUpload = useCallback(async () => {
    if (!state.file) {
      toast.error("Please select a file");
      return;
    }
    if (!state.projectId) {
      toast.error("Please select a project");
      return;
    }
    if (!state.name.trim()) {
      toast.error("Please enter a recording name");
      return;
    }

    setState((prev) => ({
      ...prev,
      uploading: true,
      progress: 0,
      error: null,
    }));

    try {
      const response = await recordingService.uploadRecording(
        state.projectId,
        state.file,
        state.description,
        state.tags,
        (progress) => {
          setState((prev) => ({ ...prev, progress }));
        }
      );

      if (response.validation_errors.length > 0) {
        setState((prev) => ({
          ...prev,
          uploading: false,
          error: "Recording uploaded with validation errors",
          validationErrors: response.validation_errors,
          validationWarnings: response.validation_warnings,
        }));
        toast.error("Recording uploaded but has validation errors");
        return;
      }

      setState((prev) => ({
        ...prev,
        uploading: false,
        success: true,
        recordingId: response.recording_id,
        validationWarnings: response.validation_warnings,
      }));

      toast.success("Recording uploaded successfully!");

      setTimeout(() => {
        router.push(`/recordings/${response.recording_id}`);
      }, 2000);
    } catch (error: unknown) {
      console.error("Upload failed:", error);
      setState((prev) => ({
        ...prev,
        uploading: false,
        error:
          error instanceof Error ? error.message : "Failed to upload recording",
      }));
      toast.error(
        error instanceof Error ? error.message : "Failed to upload recording"
      );
    }
  }, [
    state.file,
    state.projectId,
    state.name,
    state.description,
    state.tags,
    router,
  ]);

  const handleReset = useCallback(() => {
    setState({
      ...INITIAL_STATE,
      projectId: state.projectId,
    });
    setTagInput("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [state.projectId]);

  const navigateToRecordings = useCallback(() => {
    router.push("/recordings");
  }, [router]);

  const navigateToRecording = useCallback(
    (id: string) => {
      router.push(`/recordings/${id}`);
    },
    [router]
  );

  const isUploadDisabled =
    !state.file ||
    !state.projectId ||
    !state.name.trim() ||
    state.uploading ||
    state.success;

  const isFormDisabled = state.uploading || state.success;

  return {
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
  };
}
