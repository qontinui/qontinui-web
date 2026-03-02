import type {
  PackageCategory,
  PackageLicense,
  PackageVisibility,
} from "@/types/code-packages";

export interface PublishFormState {
  name: string;
  description: string;
  category: PackageCategory;
  tags: string[];
  tagInput: string;
  license: PackageLicense;
  code: string;
  readme: string;
  functionName: string;
  repositoryUrl: string;
  homepageUrl: string;
  documentationUrl: string;
  visibility: PackageVisibility;
}

export type PublishTab = "details" | "code" | "readme" | "preview";

export const CATEGORIES: PackageCategory[] = [
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

export const LICENSES: PackageLicense[] = [
  "MIT",
  "Apache-2.0",
  "GPL-3.0",
  "BSD-3-Clause",
  "ISC",
  "Creative Commons",
  "Proprietary",
  "Other",
];
