/**
 * useFormatConversion Hook
 *
 * Manages format conversion dialog state and handles switching view modes
 * between sequential and graph visualization.
 */

import { useState, useCallback } from 'react'
import type { LibraryItem, BuilderMode } from '../types'
import { FormatConversionDialog } from '@/components/format-conversion-dialog'
import { toast } from 'sonner'
import { useAutomation } from '@/contexts/automation-context'

interface UseFormatConversionOptions {
  onModeChange?: (mode: BuilderMode) => void
}

export function useFormatConversion(options?: UseFormatConversionOptions) {
  const { updateWorkflow } = useAutomation()
  const [conversionItem, setConversionItem] = useState<LibraryItem | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  /**
   * Open conversion dialog for an item
   */
  const openConversion = useCallback((item: LibraryItem) => {
    console.log('[useFormatConversion] Opening conversion dialog for:', item.name)
    setConversionItem(item)
    setDialogOpen(true)
  }, [])

  /**
   * Close conversion dialog
   */
  const closeConversion = useCallback(() => {
    setDialogOpen(false)
    // Delay clearing item to allow dialog exit animation
    setTimeout(() => setConversionItem(null), 300)
  }, [])

  /**
   * Handle successful view mode switch
   */
  const handleConversionComplete = useCallback(
    (converted: LibraryItem) => {
      console.log('[useFormatConversion] Conversion complete, updating workflow:', converted.name)

      // Update the workflow with new viewMode
      updateWorkflow(converted)

      const viewMode = converted.metadata?.viewMode || 'sequential'
      const viewLabel = viewMode === 'sequential' ? 'Sequential' : 'Graph'

      // Switch the builder mode to match the new viewMode
      if (options?.onModeChange) {
        console.log('[useFormatConversion] Switching builder mode to:', viewMode)
        options.onModeChange(viewMode)
      }

      toast.success(`Switched to ${viewLabel} view`, {
        description: `"${converted.name}" will now open in ${viewLabel.toLowerCase()} mode.`,
      })

      console.log('[useFormatConversion] Toast shown, closing dialog')
      closeConversion()
    },
    [updateWorkflow, closeConversion, options]
  )

  /**
   * Render the conversion dialog
   */
  const ConversionDialog = useCallback(() => {
    return (
      <FormatConversionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={conversionItem}
        onConvert={handleConversionComplete}
      />
    )
  }, [dialogOpen, conversionItem, handleConversionComplete])

  return {
    openConversion,
    closeConversion,
    ConversionDialog,
    isConverting: dialogOpen,
    conversionItem,
  }
}
