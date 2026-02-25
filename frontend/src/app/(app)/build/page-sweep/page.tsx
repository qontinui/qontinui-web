"use client";

import { usePageSpecs } from "@/hooks/usePageSpecs";
import { PageSweepBuilder } from "@/components/page-sweep";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./page-sweep.spec.uibridge.json";

const pageSpec = pageSpecJson as unknown as SpecConfig;

export default function PageSweepPage() {
  usePageSpecs({ "page-sweep": pageSpec });
  return <PageSweepBuilder />;
}
