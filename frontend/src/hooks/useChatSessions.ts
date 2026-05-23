import { useQuery } from "@tanstack/react-query";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

export interface ChatSession {
  id: string;
  task_name: string;
  status: string;
  created_at: string;
}

interface ChatSessionsResponse {
  sessions: ChatSession[];
  runner_connected: boolean;
}

export const chatSessionsKeys = {
  all: ["chat-sessions"] as const,
  list: () => [...chatSessionsKeys.all, "list"] as const,
};

/**
 * Fetch chat sessions from the backend.
 * Uses TanStack Query for caching and refetching.
 */
export function useChatSessions() {
  return useQuery({
    queryKey: chatSessionsKeys.list(),
    queryFn: async (): Promise<ChatSessionsResponse> => {
      const response = await httpClient.fetch(
        `${ApiConfig.API_BASE_URL}/api/v1/chat/sessions`
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch chat sessions: ${response.status}`);
      }
      return response.json();
    },
    staleTime: 10000,
    placeholderData: (prev) => prev,
  });
}
