import type {
  ConversationSegment,
  ConversationStats,
} from "../_types/ai-conversation-types";

export function parseInlineMarkers(
  text: string,
  sessionNumber: number
): ConversationSegment[] {
  const segments: ConversationSegment[] = [];

  const markerRegex =
    /\[FINDING:([\w]+):([\w_]+):([^\]]*)\]|\[STEP_COMPLETE:([\w_.-]+):([\w]+)\]|\[TASK_COMPLETE\]|\[(?:Planning Agent|Verification Agent|Knowledge Base|Orchestrator)\]\s*[^\n]*/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(text)) !== null) {
    const beforeText = text.slice(lastIndex, match.index).trim();
    if (beforeText) {
      segments.push({
        type: "ai",
        content: beforeText,
        sessionNumber,
      });
    }

    const fullMatch = match[0];

    if (fullMatch.startsWith("[FINDING:")) {
      segments.push({
        type: "finding",
        severity: (match[1] ?? "medium").toLowerCase(),
        category: match[2] ?? "unknown",
        title: match[3] ?? "",
        sessionNumber,
      });
    } else if (fullMatch.startsWith("[STEP_COMPLETE:")) {
      segments.push({
        type: "step-complete",
        stepName: match[4] ?? "unknown",
        status: (match[5] ?? "unknown").toLowerCase(),
        sessionNumber,
      });
    } else if (fullMatch === "[TASK_COMPLETE]") {
      segments.push({
        type: "task-complete",
        sessionNumber,
      });
    } else if (fullMatch.startsWith("[Planning Agent]")) {
      segments.push({
        type: "orchestrator",
        agent: "planning",
        content: fullMatch.replace(/^\[Planning Agent\]\s*/, ""),
        sessionNumber,
      });
    } else if (fullMatch.startsWith("[Verification Agent]")) {
      segments.push({
        type: "orchestrator",
        agent: "verification",
        content: fullMatch.replace(/^\[Verification Agent\]\s*/, ""),
        sessionNumber,
      });
    } else if (fullMatch.startsWith("[Knowledge Base]")) {
      segments.push({
        type: "orchestrator",
        agent: "knowledge",
        content: fullMatch.replace(/^\[Knowledge Base\]\s*/, ""),
        sessionNumber,
      });
    } else if (fullMatch.startsWith("[Orchestrator]")) {
      segments.push({
        type: "orchestrator",
        agent: "orchestrator",
        content: fullMatch.replace(/^\[Orchestrator\]\s*/, ""),
        sessionNumber,
      });
    }

    lastIndex = match.index + fullMatch.length;
  }

  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    segments.push({
      type: "ai",
      content: remaining,
      sessionNumber,
    });
  }

  return segments;
}

export function parseOutputLog(outputLog: string): ConversationSegment[] {
  if (!outputLog) return [];

  const segments: ConversationSegment[] = [];
  const sessionParts = outputLog.split(/(\[SESSION_START:(\d+)\])/);
  let currentSessionNumber = 1;

  for (let i = 0; i < sessionParts.length; i++) {
    const part = sessionParts[i] ?? "";
    const sessionMatch = part.match(/^\[SESSION_START:(\d+)\]$/);

    if (sessionMatch) {
      currentSessionNumber = parseInt(sessionMatch[1] ?? "1", 10);
      segments.push({
        type: "session-divider",
        content: `Session ${currentSessionNumber}`,
        sessionNumber: currentSessionNumber,
      });
      continue;
    }

    // Skip the captured group number from the regex split
    const prevPart = sessionParts[i - 1] ?? "";
    if (/^\d+$/.test(part) && i > 0 && /^\[SESSION_START:\d+\]$/.test(prevPart))
      continue;

    if (!part || !part.trim()) continue;

    // Split on user messages
    const userMsgRegex = /\[USER_MESSAGE\]([\s\S]*?)\[\/USER_MESSAGE\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = userMsgRegex.exec(part)) !== null) {
      const aiContent = part.slice(lastIndex, match.index).trim();
      if (aiContent) {
        segments.push(...parseInlineMarkers(aiContent, currentSessionNumber));
      }
      const userContent = (match[1] ?? "").trim();
      if (userContent) {
        segments.push({
          type: "user",
          content: userContent,
          sessionNumber: currentSessionNumber,
        });
      }
      lastIndex = match.index + match[0].length;
    }

    const remaining = part.slice(lastIndex).trim();
    if (remaining) {
      segments.push(...parseInlineMarkers(remaining, currentSessionNumber));
    }
  }

  return segments;
}

export function computeStats(
  segments: ConversationSegment[]
): ConversationStats {
  const stats: ConversationStats = {
    sessionCount: 0,
    messageCount: 0,
    findingsCount: 0,
    findingsBySeverity: {},
    stepsCompleted: 0,
    taskComplete: false,
  };

  for (const seg of segments) {
    switch (seg.type) {
      case "session-divider":
        if (seg.sessionNumber > stats.sessionCount) {
          stats.sessionCount = seg.sessionNumber;
        }
        break;
      case "ai":
      case "user":
        stats.messageCount++;
        break;
      case "finding":
        stats.findingsCount++;
        stats.findingsBySeverity[seg.severity] =
          (stats.findingsBySeverity[seg.severity] ?? 0) + 1;
        break;
      case "step-complete":
        stats.stepsCompleted++;
        break;
      case "task-complete":
        stats.taskComplete = true;
        break;
      case "orchestrator":
        stats.messageCount++;
        break;
    }
  }

  return stats;
}
