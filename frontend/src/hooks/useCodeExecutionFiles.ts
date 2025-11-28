/**
 * useCodeExecutionFiles Hook
 *
 * Manages Python file listing and validation for code execution actions.
 * Integrates with backend endpoints:
 * - GET /api/v1/code-execution/files/list - List available Python files
 * - POST /api/v1/code-execution/files/validate - Validate file path
 */

import { useState, useCallback, useEffect } from "react";
import { PythonFile } from "@/components/code-execution/PythonFileBrowser";

// Use empty string for relative URLs through Next.js proxy for proper cookie forwarding
const API_BASE_URL = "";

interface ListFilesResponse {
  files: Array<{
    path: string;
    name: string;
    size: number;
    last_modified: string;
  }>;
  project_root: string;
}

interface ValidateFileResponse {
  valid: boolean;
  path: string;
  exists: boolean;
  is_python_file: boolean;
  errors?: string[];
}

export interface UseCodeExecutionFilesOptions {
  /** Project ID */
  projectId?: number;
  /** Auto-load files on mount */
  autoLoad?: boolean;
  /** Enable auto-refresh (interval in ms) */
  autoRefresh?: number;
}

export function useCodeExecutionFiles(
  options: UseCodeExecutionFilesOptions = {}
) {
  const { projectId, autoLoad = true, autoRefresh } = options;

  const [files, setFiles] = useState<PythonFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectRoot, setProjectRoot] = useState<string>("");

  /**
   * Fetch list of Python files from backend
   */
  const fetchFiles = useCallback(async () => {
    if (!projectId) {
      setError("No project ID provided");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/code-execution/files/list?project_id=${projectId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include", // Include cookies for authentication
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.detail ||
            `Failed to fetch files: ${response.status} ${response.statusText}`
        );
      }

      const data: ListFilesResponse = await response.json();

      // Transform to PythonFile format
      const pythonFiles: PythonFile[] = data.files.map((file) => ({
        path: file.path,
        name: file.name,
        size: file.size,
        lastModified: file.last_modified,
        isValid: true, // Assume valid from server response
      }));

      setFiles(pythonFiles);
      setProjectRoot(data.project_root);
      setError(null);
    } catch (err: any) {
      console.error("[useCodeExecutionFiles] Error fetching files:", err);
      setError(err.message || "Failed to load Python files");
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  /**
   * Validate a file path
   */
  const validateFile = useCallback(
    async (filePath: string): Promise<ValidateFileResponse> => {
      if (!projectId) {
        return {
          valid: false,
          path: filePath,
          exists: false,
          is_python_file: false,
          errors: ["No project ID provided"],
        };
      }

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/v1/code-execution/files/validate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              project_id: projectId,
              file_path: filePath,
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          return {
            valid: false,
            path: filePath,
            exists: false,
            is_python_file: false,
            errors: [errorData.detail || "Validation failed"],
          };
        }

        const data: ValidateFileResponse = await response.json();
        return data;
      } catch (err: any) {
        console.error("[useCodeExecutionFiles] Error validating file:", err);
        return {
          valid: false,
          path: filePath,
          exists: false,
          is_python_file: false,
          errors: [err.message || "Validation error"],
        };
      }
    },
    [projectId]
  );

  /**
   * Refresh file list
   */
  const refresh = useCallback(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad && projectId) {
      fetchFiles();
    }
  }, [autoLoad, projectId, fetchFiles]);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefresh && autoRefresh > 0 && projectId) {
      const intervalId = setInterval(() => {
        fetchFiles();
      }, autoRefresh);

      return () => clearInterval(intervalId);
    }
  }, [autoRefresh, projectId, fetchFiles]);

  return {
    files,
    isLoading,
    error,
    projectRoot,
    fetchFiles,
    validateFile,
    refresh,
  };
}
