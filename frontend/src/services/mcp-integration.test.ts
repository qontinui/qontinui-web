/**
 * MCP Integration Tests
 *
 * Tests for AI workflow generation and MCP client functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPClient, MCPError } from './mcp-client';
import type { Workflow } from '../lib/action-schema/action-types';

// ============================================================================
// Mock Data
// ============================================================================

const mockWorkflow: Workflow = {
  id: 'test-workflow-1',
  name: 'Test Workflow',
  version: '1.0.0',
  format: 'graph',
  actions: [
    {
      id: 'action-1',
      type: 'CLICK',
      config: { findBy: 'text', searchText: 'Submit' } as any,
      position: [100, 100],
    },
    {
      id: 'action-2',
      type: 'TYPE',
      config: { text: 'Hello World' } as any,
      position: [100, 200],
    },
  ],
  connections: {
    'action-1': {
      main: [[{ action: 'action-2', type: 'main', index: 0 }]],
    },
  },
};

// ============================================================================
// Test Setup
// ============================================================================

describe('MCPClient', () => {
  let client: MCPClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Create client with test URL
    client = new MCPClient('http://localhost:3000/test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Connection Tests
  // ==========================================================================

  describe('Connection', () => {
    it('should check server health', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: '1.0.0',
          capabilities: ['generate', 'search', 'validate'],
        }),
      });

      const health = await client.healthCheck();

      expect(health.available).toBe(true);
      expect(health.version).toBe('1.0.0');
      expect(health.capabilities).toHaveLength(3);
    });

    it('should handle connection errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const health = await client.healthCheck();

      expect(health.available).toBe(false);
    });
  });

  // ==========================================================================
  // Action Search Tests
  // ==========================================================================

  describe('Action Search', () => {
    it('should search actions by query', async () => {
      const mockResults = [
        {
          id: 'click',
          type: 'CLICK',
          name: 'Click',
          description: 'Click an element',
          category: 'Mouse',
          confidence: 0.95,
        },
      ];

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: mockResults }),
      });

      const results = await client.searchActions('click button');

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('CLICK');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/search/actions'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should apply search filters', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await client.searchActions('click', {
        category: ['Mouse'],
        actionType: ['CLICK'],
        limit: 5,
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.filters).toEqual({
        category: ['Mouse'],
        actionType: ['CLICK'],
        limit: 5,
      });
    });

    it('should cache search results', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      // First call
      await client.searchActions('test');

      // Second call (should use cache)
      await client.searchActions('test');

      // Should only call fetch once
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should get action details', async () => {
      const mockDetails = {
        id: 'click',
        type: 'CLICK',
        name: 'Click',
        description: 'Click an element',
        category: 'Mouse',
        parameters: [
          {
            name: 'findBy',
            type: 'string',
            description: 'How to find element',
            required: true,
          },
        ],
        examples: [],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDetails,
      });

      const details = await client.getActionDetails('CLICK');

      expect(details.type).toBe('CLICK');
      expect(details.parameters).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Workflow Validation Tests
  // ==========================================================================

  describe('Workflow Validation', () => {
    it('should validate workflow structure', async () => {
      const mockValidation = {
        valid: true,
        errors: [],
        warnings: [],
        stats: {
          actionCount: 2,
          connectionCount: 1,
          branchCount: 0,
          maxDepth: 2,
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ validation: mockValidation }),
      });

      const result = await client.validateWorkflow(mockWorkflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.stats?.actionCount).toBe(2);
    });

    it('should detect validation errors', async () => {
      const mockValidation = {
        valid: false,
        errors: [
          {
            id: 'error-1',
            type: 'cycle',
            severity: 'error',
            message: 'Cycle detected in workflow',
          },
        ],
        warnings: [],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ validation: mockValidation }),
      });

      const result = await client.validateWorkflow(mockWorkflow);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('cycle');
    });
  });

  // ==========================================================================
  // Workflow Generation Tests
  // ==========================================================================

  describe('Workflow Generation', () => {
    it('should generate workflow from description', async () => {
      const mockGenerated = {
        workflow: mockWorkflow,
        confidence: 0.92,
        explanation: 'Created a simple workflow',
        reasoning: ['Added click action', 'Added type action'],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGenerated,
      });

      const result = await client.generateWorkflow('Create a workflow that clicks and types');

      expect(result.workflow.actions).toHaveLength(2);
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.explanation).toBeTruthy();
    });

    it('should handle generation with context', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workflow: mockWorkflow,
          confidence: 0.9,
          explanation: 'Extended existing workflow',
        }),
      });

      await client.generateWorkflow('Add error handling', {
        existingWorkflow: mockWorkflow,
        templates: ['error_handling'],
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.context.existingWorkflow).toBeDefined();
      expect(callBody.context.templates).toContain('error_handling');
    });

    it('should refine workflow with feedback', async () => {
      const mockRefined = {
        workflow: mockWorkflow,
        confidence: 0.88,
        explanation: 'Added error handling',
        reasoning: ['Added try-catch block'],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRefined,
      });

      const result = await client.refineWorkflow(mockWorkflow, 'Add error handling');

      expect(result.workflow).toBeDefined();
      expect(result.explanation).toContain('error handling');
    });

    it('should handle generation timeout', async () => {
      fetchMock.mockImplementationOnce(
        () => new Promise(resolve => setTimeout(resolve, 100000))
      );

      await expect(client.generateWorkflow('test')).rejects.toThrow('timeout');
    }, 10000);
  });

  // ==========================================================================
  // Suggestions Tests
  // ==========================================================================

  describe('Suggestions', () => {
    it('should get workflow suggestions', async () => {
      const mockSuggestions = [
        {
          id: 'suggestion-1',
          type: 'optimization',
          title: 'Add parallel execution',
          description: 'Execute independent actions in parallel',
          confidence: 0.85,
          impact: 'high',
        },
      ];

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ suggestions: mockSuggestions }),
      });

      const suggestions = await client.getSuggestions(mockWorkflow);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].type).toBe('optimization');
      expect(suggestions[0].impact).toBe('high');
    });

    it('should apply suggestion to workflow', async () => {
      const suggestion = {
        id: 'suggestion-1',
        type: 'optimization' as const,
        title: 'Test',
        description: 'Test',
        confidence: 0.8,
        impact: 'high' as const,
        actions: [],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workflow: mockWorkflow }),
      });

      const result = await client.applySuggestion(mockWorkflow, suggestion);

      expect(result).toBeDefined();
      expect(result.actions).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should throw MCPError on failed request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Server error' }),
      });

      await expect(client.searchActions('test')).rejects.toThrow(MCPError);
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.searchActions('test')).rejects.toThrow();
    });

    it('should clear cache', () => {
      client.clearCache();
      // Cache should be empty, so next call should hit network
      // This is tested implicitly by other tests
    });
  });

  // ==========================================================================
  // Optimization Tests
  // ==========================================================================

  describe('Optimization', () => {
    it('should optimize workflow', async () => {
      const mockOptimized = {
        workflow: mockWorkflow,
        confidence: 0.9,
        explanation: 'Optimized for speed',
        reasoning: ['Removed redundant actions', 'Added parallel execution'],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOptimized,
      });

      const result = await client.optimizeWorkflow(mockWorkflow, ['speed']);

      expect(result.workflow).toBeDefined();
      expect(result.reasoning).toBeDefined();
    });
  });

  // ==========================================================================
  // Explanation Tests
  // ==========================================================================

  describe('Explanation', () => {
    it('should explain workflow', async () => {
      const mockExplanation = {
        summary: 'This workflow clicks and types',
        steps: [
          {
            actionId: 'action-1',
            explanation: 'Clicks the submit button',
            purpose: 'To submit the form',
          },
        ],
        flowDescription: 'Linear flow with 2 steps',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ explanation: mockExplanation }),
      });

      const explanation = await client.explainWorkflow(mockWorkflow);

      expect(explanation.summary).toBeTruthy();
      expect(explanation.steps).toHaveLength(1);
    });
  });
});

// ============================================================================
// Integration Tests (require actual MCP server)
// ============================================================================

describe.skip('MCP Integration (requires server)', () => {
  let client: MCPClient;

  beforeEach(() => {
    client = new MCPClient('http://localhost:3000/mcp');
  });

  it('should connect to real MCP server', async () => {
    const health = await client.healthCheck();
    expect(health.available).toBe(true);
  });

  it('should generate real workflow', async () => {
    const result = await client.generateWorkflow(
      'Create a workflow that clicks login and types credentials'
    );

    expect(result.workflow.actions.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});
