/**
 * Types for Training Data Export Dialog
 */

export type ExportDestination = "download" | "s3" | "local";

export interface S3Config {
  bucket: string;
  prefix: string;
  region: string;
}

export interface LocalPathConfig {
  path: string;
}

export interface TrainingDataExportDialogProps {
  trigger?: React.ReactNode;
  projectName?: string;
}
