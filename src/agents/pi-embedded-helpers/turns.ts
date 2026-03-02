import type { AgentMessage } from "@mariozechner/pi-agent-core";

function validateTurnsWithConsecutiveMerge<TRole extends "assistant" | "user">(params: {
  messages: AgentMessage[];
  role: TRole;
  merge: (
    previous: Extract<AgentMessage, { role: TRole }>,
    current: Extract<AgentMessage, { role: TRole }>,
  ) => Extract<AgentMessage, { role: TRole }>;
}): AgentMessage[] {
  const { messages, role, merge } = params;
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const result: AgentMessage[] = [];
  let lastRole: string | undefined;

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") {
      result.push(msg);
      continue;
    }

    const msgRole = (msg as { role?: unknown }).role as string | undefined;
    if (!msgRole) {
      result.push(msg);
      continue;
    }

    if (msgRole === lastRole && lastRole === role) {
      const lastMsg = result[result.length - 1];
      const currentMsg = msg as Extract<AgentMessage, { role: TRole }>;

      if (lastMsg && typeof lastMsg === "object") {
        const lastTyped = lastMsg as Extract<AgentMessage, { role: TRole }>;
        result[result.length - 1] = merge(lastTyped, currentMsg);
        continue;
      }
    }

    result.push(msg);
    lastRole = msgRole;
  }

  return result;
}

function mergeConsecutiveAssistantTurns(
  previous: Extract<AgentMessage, { role: "assistant" }>,
  current: Extract<AgentMessage, { role: "assistant" }>,
): Extract<AgentMessage, { role: "assistant" }> {
  const mergedContent = [
    ...(Array.isArray(previous.content) ? previous.content : []),
    ...(Array.isArray(current.content) ? current.content : []),
  ];
  return {
    ...previous,
    content: mergedContent,
    ...(current.usage && { usage: current.usage }),
    ...(current.stopReason && { stopReason: current.stopReason }),
    ...(current.errorMessage && {
      errorMessage: current.errorMessage,
    }),
  };
}

/**
 * Validates and fixes conversation turn sequences for Gemini API.
 * Gemini requires strict alternating user→assistant→tool→user pattern.
 * Merges consecutive assistant messages together.
 */
export function validateGeminiTurns(messages: AgentMessage[]): AgentMessage[] {
  return validateTurnsWithConsecutiveMerge({
    messages,
    role: "assistant",
    merge: mergeConsecutiveAssistantTurns,
  });
}

export function mergeConsecutiveUserTurns(
  previous: Extract<AgentMessage, { role: "user" }>,
  current: Extract<AgentMessage, { role: "user" }>,
): Extract<AgentMessage, { role: "user" }> {
  const mergedContent = [
    ...(Array.isArray(previous.content) ? previous.content : []),
    ...(Array.isArray(current.content) ? current.content : []),
  ];

  return {
    ...current,
    content: mergedContent,
    timestamp: current.timestamp ?? previous.timestamp,
  };
}

/**
 * Validates and fixes conversation turn sequences for Anthropic API.
 * Anthropic requires strict alternating user→assistant pattern.
 * Merges consecutive user messages together and drops empty text blocks.
 */
export function validateAnthropicTurns(messages: AgentMessage[]): AgentMessage[] {
  const merged = validateTurnsWithConsecutiveMerge({
    messages,
    role: "user",
    merge: mergeConsecutiveUserTurns,
  });

  // Anthropic API throws 400 if a text block contains only empty string.
  // We filter out any empty text blocks from the content arrays.
  return merged.map((msg) => {
    if (!msg || typeof msg !== "object") {
      return msg;
    }

    // Some message types like BashExecutionMessage don't have content arrays natively in the core union
    const msgWithContent = msg as Extract<AgentMessage, { content?: unknown }>;

    // If the content is a raw string and it is empty, replace it with placeholder
    if (typeof msgWithContent.content === "string") {
      if (msgWithContent.content.trim() === "") {
        return { ...msg, content: "(empty)" } as unknown as AgentMessage;
      }
      return msg;
    }

    if (!Array.isArray(msgWithContent.content)) {
      return msg;
    }

    const filteredContent = msgWithContent.content.filter((block: unknown) => {
      if (!block || typeof block !== "object") {
        if (typeof block === "string" && block.trim() === "") {
          return false;
        }
        return true;
      }
      const rec = block as { type?: unknown; text?: unknown };
      if (rec.type === "text" && typeof rec.text === "string" && rec.text.trim() === "") {
        return false;
      }
      return true;
    });

    // If we filtered out all blocks, keep at least one placeholder so the message isn't empty
    // (though in practice it should have an image or we'd just drop the message entirely).
    if (filteredContent.length === 0 && msgWithContent.content.length > 0) {
      filteredContent.push({ type: "text", text: "(empty)" });
    } else if (filteredContent.length === 0 && msgWithContent.content.length === 0) {
      // Catch empty arrays that were already empty
      filteredContent.push({ type: "text", text: "(empty)" });
    }

    return { ...msg, content: filteredContent } as unknown as AgentMessage;
  });
}
