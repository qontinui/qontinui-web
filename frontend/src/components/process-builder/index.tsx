"use client";

import { useProcessBuilder } from "./_hooks/use-process-builder";
import { LeftPanel } from "./_components/LeftPanel";
import { CenterPanel } from "./_components/CenterPanel";
import { RightPanel } from "./_components/RightPanel";
import { TransitionDialogs } from "./_components/TransitionDialogs";

export function ProcessBuilder() {
  const {
    selectedItem,
    selectedProcess,
    selectedAction,
    showTransitionDialog,
    transitionType,
    optionsExpanded,
    conversionItem,
    conversionDialogOpen,
    allCategories,
    screenshots,
    states,
    setSelectedAction,
    setOptionsExpanded,
    setConversionDialogOpen,
    createNewProcess,
    handleUpdateProcess,
    handleSelectItem,
    handleDeleteItem,
    handleConvertItem,
    handleConversionComplete,
    openTransitionDialog,
    closeTransitionDialog,
  } = useProcessBuilder();

  return (
    <div className="flex h-full">
      <LeftPanel
        selectedItem={selectedItem}
        onSelectItem={handleSelectItem}
        onDeleteItem={handleDeleteItem}
        onUpdateWorkflow={handleUpdateProcess}
        onCreateSequential={createNewProcess}
        onConvertItem={handleConvertItem}
      />

      <CenterPanel
        selectedProcess={selectedProcess}
        selectedAction={selectedAction}
        optionsExpanded={optionsExpanded}
        allCategories={allCategories}
        screenshots={screenshots}
        states={states}
        onOptionsToggle={setOptionsExpanded}
        onUpdateProcess={handleUpdateProcess}
        onSelectAction={setSelectedAction}
        onCreateOutgoingTransition={() => openTransitionDialog("outgoing")}
        onCreateIncomingTransition={() => openTransitionDialog("incoming")}
      />

      <RightPanel
        selectedProcess={selectedProcess}
        selectedAction={selectedAction}
        onUpdateProcess={handleUpdateProcess}
      />

      <TransitionDialogs
        showTransitionDialog={showTransitionDialog}
        transitionType={transitionType}
        preselectedWorkflowId={selectedProcess?.id}
        conversionDialogOpen={conversionDialogOpen}
        conversionItem={conversionItem}
        onCloseTransitionDialog={closeTransitionDialog}
        onConversionDialogOpenChange={setConversionDialogOpen}
        onConversionComplete={handleConversionComplete}
      />
    </div>
  );
}
