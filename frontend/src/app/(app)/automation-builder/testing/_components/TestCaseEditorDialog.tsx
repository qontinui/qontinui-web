"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TestCaseEditor as SharedTestCaseEditor } from "@/components/workflow-testing/TestCaseEditor";
import { TestSuiteEditor } from "@/components/workflow-testing/TestSuiteEditor";
import type { TestCase, TestSuite } from "@/services/workflow-testing";
import type { Workflow } from "@/lib/action-schema/action-types";

interface TestCaseEditorDialogProps {
  /** Whether the create-test dialog is open */
  showCreateTest: boolean;
  /** Currently editing test case (null if not editing) */
  editingTest: TestCase | null;
  /** Whether the create-suite dialog is open */
  showCreateSuite: boolean;
  /** Currently editing suite (null if not editing) */
  editingSuite: TestSuite | null;
  /** Whether the import dialog is open */
  showImportDialog: boolean;
  /** Available workflows for the editor */
  workflows: Workflow[];
  /** Available test cases (for suite editor) */
  testCases: TestCase[];
  /** Handlers */
  onCreateTest: (testCase: TestCase) => void;
  onUpdateTest: (testCase: TestCase) => void;
  onCreateSuite: (suite: TestSuite) => void;
  onUpdateSuite: (suite: TestSuite) => void;
  onImportTests: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onCloseCreateTest: () => void;
  onCloseEditTest: () => void;
  onCloseCreateSuite: () => void;
  onCloseEditSuite: () => void;
  onCloseImport: () => void;
}

/**
 * Manages all testing-related dialog modals:
 * - Create test case
 * - Edit test case
 * - Create test suite
 * - Edit test suite
 * - Import tests
 */
export function TestCaseEditorDialog({
  showCreateTest,
  editingTest,
  showCreateSuite,
  editingSuite,
  showImportDialog,
  workflows,
  testCases,
  onCreateTest,
  onUpdateTest,
  onCreateSuite,
  onUpdateSuite,
  onImportTests,
  onCloseCreateTest,
  onCloseEditTest,
  onCloseCreateSuite,
  onCloseEditSuite,
  onCloseImport,
}: TestCaseEditorDialogProps) {
  return (
    <>
      {showCreateTest && workflows.length > 0 && (
        <Dialog open onOpenChange={onCloseCreateTest}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <SharedTestCaseEditor
              workflow={workflows[0]!}
              onSave={onCreateTest}
              onCancel={onCloseCreateTest}
            />
          </DialogContent>
        </Dialog>
      )}

      {editingTest && (
        <Dialog open onOpenChange={onCloseEditTest}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <SharedTestCaseEditor
              testCase={editingTest}
              workflow={
                (workflows.find((w) => w.id === editingTest.workflowId) ||
                  workflows[0])!
              }
              onSave={onUpdateTest}
              onCancel={onCloseEditTest}
            />
          </DialogContent>
        </Dialog>
      )}

      {showCreateSuite && (
        <Dialog open onOpenChange={onCloseCreateSuite}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <TestSuiteEditor
              availableTestCases={testCases}
              onSave={onCreateSuite}
              onCancel={onCloseCreateSuite}
            />
          </DialogContent>
        </Dialog>
      )}

      {editingSuite && (
        <Dialog open onOpenChange={onCloseEditSuite}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <TestSuiteEditor
              suite={editingSuite}
              availableTestCases={testCases}
              onSave={onUpdateSuite}
              onCancel={onCloseEditSuite}
            />
          </DialogContent>
        </Dialog>
      )}

      {showImportDialog && (
        <Dialog open onOpenChange={onCloseImport}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import Tests</DialogTitle>
              <DialogDescription>
                Select a JSON file containing test cases and suites
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input type="file" accept=".json" onChange={onImportTests} />
            </div>
            <DialogFooter>
              <Button onClick={onCloseImport} variant="outline">
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
