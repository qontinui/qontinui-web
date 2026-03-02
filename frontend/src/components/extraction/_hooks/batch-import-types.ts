import type { ImportFormat } from "@/lib/training-data-import";

export interface FileImportResult {
  fileName: string;
  status: "pending" | "importing" | "success" | "error";
  elementCount?: number;
  error?: string;
  format?: string;
}

export interface BatchImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface BatchImportState {
  format: ImportFormat;
  setFormat: (format: ImportFormat) => void;
  files: File[];
  classesContent: string;
  results: FileImportResult[];
  importing: boolean;
  skipDuplicates: boolean;
  setSkipDuplicates: (value: boolean) => void;
  mergeOverlapping: boolean;
  setMergeOverlapping: (value: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  classesInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFolderSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleClassesFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  removeFile: (fileName: string) => void;
  clearAllFiles: () => void;
  handleImport: () => Promise<void>;
  handleClose: () => void;
  completedCount: number;
  errorCount: number;
  progress: number;
}
