// hooks/useMockExecution.ts

import { useState } from 'react';
import { executeMockProcess } from '@/lib/api/integration-testing';
import type { MockExecutionRequest, MockExecutionResponse } from '@/types/integration-testing';

export function useMockExecution() {
  const [result, setResult] = useState<MockExecutionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = async (request: MockExecutionRequest) => {
    setLoading(true);
    setError(null);

    try {
      const response = await executeMockProcess(request);
      setResult(response);
      return response;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
  };

  return {
    result,
    loading,
    error,
    execute,
    reset,
  };
}
