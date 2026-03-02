import { Clock, CheckCheck, XCircle, AlertCircle } from "lucide-react";
import { createElement } from "react";
import type { ReviewStatus } from "@/stores/extraction-annotation-store";

export const ELEMENT_TYPES = [
  { value: "button", label: "Button" },
  { value: "input", label: "Input Field" },
  { value: "link", label: "Link" },
  { value: "icon", label: "Icon" },
  { value: "label", label: "Label/Text" },
  { value: "container", label: "Container" },
  { value: "checkbox", label: "Checkbox" },
  { value: "radio", label: "Radio Button" },
  { value: "dropdown", label: "Dropdown" },
  { value: "menu", label: "Menu" },
  { value: "tab", label: "Tab" },
  { value: "image", label: "Image" },
  { value: "other", label: "Other" },
] as const;

export const REVIEW_STATUS_CONFIG: Record<
  ReviewStatus,
  { label: string; icon: React.ReactNode; color: string }
> = {
  pending: {
    label: "Pending",
    icon: createElement(Clock, { className: "h-3 w-3" }),
    color: "text-yellow-500",
  },
  approved: {
    label: "Approved",
    icon: createElement(CheckCheck, { className: "h-3 w-3" }),
    color: "text-green-500",
  },
  rejected: {
    label: "Rejected",
    icon: createElement(XCircle, { className: "h-3 w-3" }),
    color: "text-red-500",
  },
  needs_revision: {
    label: "Needs Revision",
    icon: createElement(AlertCircle, { className: "h-3 w-3" }),
    color: "text-purple-500",
  },
};

export interface FormValues {
  label: string;
  elementType: string;
  description: string;
  reasoning: string;
  isGroundTruth: boolean;
  isClickable: boolean;
  reviewStatus: ReviewStatus;
}
