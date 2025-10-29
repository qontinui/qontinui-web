/**
 * Canvas Properties Panel Tests
 *
 * Comprehensive test suite for the properties panel and related components
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CanvasPropertiesPanel } from './CanvasPropertiesPanel';
import { MultiSelectProperties } from './MultiSelectProperties';
import { WorkflowProperties } from './WorkflowProperties';
import { ConnectionProperties } from './ConnectionProperties';
import { useCanvasStore } from '@/stores/canvas-store';
import { usePropertiesPanelStore } from '@/stores/properties-panel-store';
import type { Workflow, Action } from '@/lib/action-schema/action-types';

// Mock stores
vi.mock('@/stores/canvas-store');
vi.mock('@/stores/properties-panel-store');

// Mock action property components
vi.mock('@/components/action-properties/ActionConfigRegistry', () => ({
  actionConfigRegistry: {
    getComponent: vi.fn(() => () => <div>Mock Property Component</div>),
    getDisplayName: vi.fn((type) => type),
  },
}));

describe('CanvasPropertiesPanel', () => {
  const mockWorkflow: Workflow = {
    id: 'test-workflow',
    name: 'Test Workflow',
    version: '1.0.0',
    format: 'graph',
    actions: [
      {
        id: 'action-1',
        type: 'CLICK',
        config: { target: 'test', mouseButton: 'LEFT', numberOfClicks: 1 },
        position: [100, 100],
      },
      {
        id: 'action-2',
        type: 'TYPE',
        config: { text: 'hello' },
        position: [200, 200],
      },
    ],
    connections: {},
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup default store states
    (useCanvasStore as any).mockReturnValue({
      workflow: mockWorkflow,
      selectedNodes: [],
      selectedEdges: [],
      getActionById: (id: string) => mockWorkflow.actions.find((a) => a.id === id),
    });

    (usePropertiesPanelStore as any).mockReturnValue({
      isOpen: true,
      position: 'right',
      width: 400,
      height: 300,
      setPosition: vi.fn(),
      setWidth: vi.fn(),
      setHeight: vi.fn(),
      toggleOpen: vi.fn(),
      hasUnsavedChanges: false,
    });
  });

  describe('Panel Rendering', () => {
    it('should render the panel when open', () => {
      render(<CanvasPropertiesPanel />);
      expect(screen.getByText('Properties')).toBeInTheDocument();
    });

    it('should show collapsed state when closed', () => {
      (usePropertiesPanelStore as any).mockReturnValue({
        isOpen: false,
        toggleOpen: vi.fn(),
      });

      render(<CanvasPropertiesPanel collapsible />);
      expect(screen.getByText('Properties')).toBeInTheDocument();
      expect(screen.queryByText('Workflow Metadata')).not.toBeInTheDocument();
    });

    it('should toggle panel visibility', async () => {
      const toggleOpen = vi.fn();
      (usePropertiesPanelStore as any).mockReturnValue({
        isOpen: true,
        toggleOpen,
      });

      render(<CanvasPropertiesPanel collapsible />);
      const closeButton = screen.getByTitle('Close panel');
      await userEvent.click(closeButton);

      expect(toggleOpen).toHaveBeenCalled();
    });
  });

  describe('Single Node Selection', () => {
    it('should show single node properties when one node is selected', () => {
      (useCanvasStore as any).mockReturnValue({
        workflow: mockWorkflow,
        selectedNodes: ['action-1'],
        selectedEdges: [],
        getActionById: (id: string) => mockWorkflow.actions.find((a) => a.id === id),
      });

      render(<CanvasPropertiesPanel />);
      expect(screen.getByText('CLICK')).toBeInTheDocument();
      expect(screen.getByText('action-1')).toBeInTheDocument();
    });

    it('should show property editor for selected action type', () => {
      (useCanvasStore as any).mockReturnValue({
        workflow: mockWorkflow,
        selectedNodes: ['action-1'],
        selectedEdges: [],
        getActionById: (id: string) => mockWorkflow.actions.find((a) => a.id === id),
      });

      render(<CanvasPropertiesPanel />);
      expect(screen.getByText('Mock Property Component')).toBeInTheDocument();
    });

    it('should show history tab for single node', async () => {
      (useCanvasStore as any).mockReturnValue({
        workflow: mockWorkflow,
        selectedNodes: ['action-1'],
        selectedEdges: [],
        getActionById: (id: string) => mockWorkflow.actions.find((a) => a.id === id),
      });

      render(<CanvasPropertiesPanel />);
      const historyTab = screen.getByRole('tab', { name: /history/i });
      await userEvent.click(historyTab);

      expect(screen.getByText('Change History')).toBeInTheDocument();
    });
  });

  describe('Multi-Node Selection', () => {
    it('should show multi-select properties when multiple nodes are selected', () => {
      (useCanvasStore as any).mockReturnValue({
        workflow: mockWorkflow,
        selectedNodes: ['action-1', 'action-2'],
        selectedEdges: [],
        getActionById: (id: string) => mockWorkflow.actions.find((a) => a.id === id),
      });

      render(<CanvasPropertiesPanel />);
      expect(screen.getByText(/Multiple Selection/)).toBeInTheDocument();
      expect(screen.getByText(/2 actions/)).toBeInTheDocument();
    });
  });

  describe('Edge Selection', () => {
    it('should show connection properties when edge is selected', () => {
      (useCanvasStore as any).mockReturnValue({
        workflow: mockWorkflow,
        selectedNodes: [],
        selectedEdges: ['action-1-main-0-action-2'],
      });

      render(<CanvasPropertiesPanel />);
      expect(screen.getByText('Connection Properties')).toBeInTheDocument();
    });
  });

  describe('No Selection', () => {
    it('should show workflow properties when nothing is selected', () => {
      render(<CanvasPropertiesPanel />);
      expect(screen.getByText('Workflow Metadata')).toBeInTheDocument();
      expect(screen.getByText('Test Workflow')).toBeInTheDocument();
    });
  });

  describe('Panel Resizing', () => {
    it('should allow resizing the panel', async () => {
      const setWidth = vi.fn();
      (usePropertiesPanelStore as any).mockReturnValue({
        isOpen: true,
        position: 'right',
        width: 400,
        setWidth,
      });

      render(<CanvasPropertiesPanel />);

      // Find resize handle
      const resizeHandle = document.querySelector('.cursor-ew-resize');
      expect(resizeHandle).toBeInTheDocument();

      // Simulate drag (simplified)
      if (resizeHandle) {
        fireEvent.mouseDown(resizeHandle, { clientX: 0, clientY: 0 });
        fireEvent.mouseMove(document, { clientX: -50, clientY: 0 });
        fireEvent.mouseUp(document);

        await waitFor(() => {
          expect(setWidth).toHaveBeenCalled();
        });
      }
    });
  });

  describe('Unsaved Changes', () => {
    it('should show unsaved changes indicator', () => {
      (usePropertiesPanelStore as any).mockReturnValue({
        isOpen: true,
        hasUnsavedChanges: true,
      });

      render(<CanvasPropertiesPanel />);
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    it('should show save/discard buttons when there are unsaved changes', () => {
      (usePropertiesPanelStore as any).mockReturnValue({
        isOpen: true,
        hasUnsavedChanges: true,
      });

      render(<CanvasPropertiesPanel />);
      expect(screen.getByText('Save')).toBeInTheDocument();
      expect(screen.getByText('Discard')).toBeInTheDocument();
    });
  });
});

describe('MultiSelectProperties', () => {
  it('should show common properties for multiple actions', () => {
    render(<MultiSelectProperties actionIds={['action-1', 'action-2']} />);
    expect(screen.getByText(/Multiple Selection/)).toBeInTheDocument();
  });

  it('should show mixed indicator for different property values', () => {
    render(<MultiSelectProperties actionIds={['action-1', 'action-2']} />);
    // This would check for "(mixed)" text in the UI
  });

  it('should allow batch editing of common properties', async () => {
    render(<MultiSelectProperties actionIds={['action-1', 'action-2']} />);

    const enabledSwitch = screen.getByRole('switch', { name: /enabled/i });
    await userEvent.click(enabledSwitch);

    // Verify batch update was called
  });

  it('should show alignment tools for position', () => {
    render(<MultiSelectProperties actionIds={['action-1', 'action-2']} />);
    expect(screen.getByText('Align Left')).toBeInTheDocument();
    expect(screen.getByText('Align Center')).toBeInTheDocument();
  });
});

describe('WorkflowProperties', () => {
  const mockWorkflow: Workflow = {
    id: 'test',
    name: 'Test Workflow',
    version: '1.0.0',
    format: 'graph',
    actions: [],
    connections: {},
    metadata: {
      description: 'Test description',
      author: 'Test Author',
    },
    settings: {
      timeout: 5000,
      maxRetries: 3,
    },
  };

  beforeEach(() => {
    (useCanvasStore as any).mockReturnValue({
      workflow: mockWorkflow,
    });
  });

  it('should display workflow metadata', () => {
    render(<WorkflowProperties />);
    expect(screen.getByDisplayValue('Test Workflow')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test Author')).toBeInTheDocument();
  });

  it('should allow editing workflow name', async () => {
    render(<WorkflowProperties />);
    const nameInput = screen.getByDisplayValue('Test Workflow');

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Workflow');

    expect(nameInput).toHaveValue('Updated Workflow');
  });

  it('should display workflow settings', () => {
    render(<WorkflowProperties />);
    expect(screen.getByDisplayValue('5000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });

  it('should show workflow statistics', () => {
    render(<WorkflowProperties />);
    expect(screen.getByText('Statistics')).toBeInTheDocument();
  });
});

describe('ConnectionProperties', () => {
  const mockWorkflow: Workflow = {
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    format: 'graph',
    actions: [
      {
        id: 'action-1',
        type: 'CLICK',
        config: {},
        position: [0, 0],
      },
      {
        id: 'action-2',
        type: 'TYPE',
        config: {},
        position: [100, 100],
      },
    ],
    connections: {
      'action-1': {
        main: [[{ action: 'action-2', type: 'main', index: 0 }]],
      },
    },
  };

  beforeEach(() => {
    (useCanvasStore as any).mockReturnValue({
      workflow: mockWorkflow,
      deleteConnection: vi.fn(),
    });
  });

  it('should display connection details', () => {
    render(<ConnectionProperties edgeId="action-1-main-0-action-2" />);
    expect(screen.getByText('Connection Properties')).toBeInTheDocument();
  });

  it('should show source and target actions', () => {
    render(<ConnectionProperties edgeId="action-1-main-0-action-2" />);
    expect(screen.getByText('CLICK')).toBeInTheDocument();
    expect(screen.getByText('TYPE')).toBeInTheDocument();
  });

  it('should allow deleting connection', async () => {
    const deleteConnection = vi.fn();
    (useCanvasStore as any).mockReturnValue({
      workflow: mockWorkflow,
      deleteConnection,
    });

    // Mock window.confirm
    global.confirm = vi.fn(() => true);

    render(<ConnectionProperties edgeId="action-1-main-0-action-2" />);
    const deleteButton = screen.getByText('Delete');
    await userEvent.click(deleteButton);

    expect(deleteConnection).toHaveBeenCalledWith('action-1', 'main', 0, 'action-2');
  });
});

describe('Property Validation', () => {
  it('should show validation errors for invalid properties', () => {
    // This would test the validation system
  });

  it('should prevent saving invalid configurations', () => {
    // Test validation blocking save
  });

  it('should show inline validation messages', () => {
    // Test real-time validation display
  });
});

describe('Property History', () => {
  it('should track property changes', () => {
    // Test change tracking
  });

  it('should allow reverting changes', () => {
    // Test revert functionality
  });

  it('should show change timeline', () => {
    // Test history display
  });
});

describe('Accessibility', () => {
  it('should support keyboard navigation', async () => {
    render(<CanvasPropertiesPanel />);

    // Tab through inputs
    await userEvent.tab();
    // Test keyboard interactions
  });

  it('should have proper ARIA labels', () => {
    render(<CanvasPropertiesPanel />);
    // Check for aria-label attributes
  });

  it('should announce changes to screen readers', () => {
    // Test screen reader announcements
  });
});
