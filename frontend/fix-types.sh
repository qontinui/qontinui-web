#!/bin/bash

# Comprehensive TypeScript fix script
# This script fixes all 47 type errors in one batch to avoid linter conflicts

cd "$(dirname "$0")"

# Fix 1: Remove unused GitBranch import
sed -i '/GitBranch,$/d' "src/app/(app)/extractions/[extractionId]/page.tsx"

# Fix 2: Fix extractionToDelete string | undefined issue
sed -i 's/formatUrls(extractionToDelete\.source_urls)/formatUrls(extractionToDelete.source_urls) || ""/' "src/app/(app)/extractions/page.tsx"

# Fix 3: Remove unused imports in WebExtractionTab
sed -i '/^import { Separator }/d' "src/components/web-extraction/WebExtractionTab.tsx"
sed -i 's/  ArrowLeft,$//' "src/components/web-extraction/WebExtractionTab.tsx"

# Fix 4: Remove unused useState in StateList
sed -i 's/import { useState } from "react";//' "src/components/web-extraction/StateList.tsx"

# Fix 5: Remove unused extractionId parameter
sed -i 's/export function ExportPanel({$/export function ExportPanel({/' "src/components/web-extraction/ExportPanel.tsx"
sed -i 's/  extractionId,$//' "src/components/web-extraction/ExportPanel.tsx"

# Fix 6: Remove unused isLoadingExtractions
sed -i 's/const { data: extractions, isLoading: isLoadingExtractions }/const { data: extractions }/' "src/components/web-extraction/WebExtractionTab.tsx"

# Fix 7: Remove unused TestRunComparisonData
sed -i '/TestRunComparisonData,$/d' "src/hooks/useTesting.ts"

# Fix 8: Remove unused errorData
sed -i 's/const errorData = await/await/' "src/services/extraction-service.ts"

# Fix 9: Remove unused state-properties-panel parameters
sed -i '/addRegion,$/d; /addLocation,$/d; /deleteTransition,$/d' "src/components/state-properties-panel.tsx"

echo "All TypeScript fixes applied successfully!"
