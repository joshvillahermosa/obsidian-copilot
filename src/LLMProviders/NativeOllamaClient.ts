import { BaseMessage, AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { ollamaAwareFetch } from "./ollamaAwareFetch";
import { logInfo, logError } from "@/logger";

export interface NativeOllamaClientConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  thinkingLevel?: "low" | "medium" | "high";
}

export interface OllamaToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface StreamOptions {
  tools?: OllamaToolSchema[];
  signal?: AbortSignal;
}

/**
 * Native Ollama API client that bypasses LangChain.
 * Uses ollamaAwareFetch for CORS handling and thinking transformation.
 * Implements streaming and tool calling for GPT-OSS models.
 */
export class NativeOllamaClient {
  private baseUrl: string;
  private apiKey: string;
  private modelName: string;
  private thinkingLevel: string;

  constructor(config: NativeOllamaClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.modelName = config.modelName;
    this.thinkingLevel = config.thinkingLevel || "medium";
  }

  /**
   * Map LangChain message type to Ollama API role format.
   * LangChain uses: "human", "ai", "system", "tool"
   * Ollama expects: "user", "assistant", "system", "tool"
   */
  private mapMessageTypeToRole(messageType: string): string {
    switch (messageType) {
      case "human":
        return "user";
      case "ai":
        return "assistant";
      case "system":
        return "system";
      case "tool":
        return "tool";
      default:
        // Fallback for unexpected types
        return messageType === "assistant" || messageType === "user" ? messageType : "user";
    }
  }

  /**
   * Normalize message content to string format.
   * LangChain messages can have content as string or array (for multimodal).
   * Ollama API expects string only - extract text from arrays.
   */
  private normalizeContent(content: any): string {
    // Handle string content (simple case)
    if (typeof content === "string") {
      return content;
    }

    // Handle array content (multimodal - extract text parts)
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (typeof part === "object" && part !== null) {
            // Extract text from structured content parts
            if ("text" in part && typeof part.text === "string") {
              return part.text;
            }
            if ("content" in part && typeof part.content === "string") {
              return part.content;
            }
          }
          return "";
        })
        .join("");
    }

    // Handle object content with text property
    if (typeof content === "object" && content !== null && "text" in content) {
      const textContent = (content as { text?: string }).text;
      return textContent ?? "";
    }

    // Fallback: convert to string
    return String(content || "");
  }

  /**
   * Stream chat completion from Ollama Cloud.
   * Yields AIMessageChunk objects compatible with ThinkBlockStreamer.
   */
  async *stream(
    messages: BaseMessage[],
    options: StreamOptions = {}
  ): AsyncGenerator<AIMessageChunk> {
    logInfo("[NativeOllamaClient] Starting stream", {
      model: this.modelName,
      messageCount: messages.length,
      hasTools: !!options.tools,
      thinkingLevel: this.thinkingLevel,
    });

    const requestBody = {
      model: this.modelName,
      messages: messages.map((m) => {
        // Safely get message type with fallback
        const messageType =
          typeof m._getType === "function" ? m._getType() : ((m as any).role ?? "user");

        // Map LangChain types to Ollama role format
        const role = this.mapMessageTypeToRole(messageType);

        // Normalize content to string (handle arrays from multimodal messages)
        const content = this.normalizeContent(m.content);

        const baseMsg: any = {
          role,
          content,
        };

        // Add tool_calls for AI messages (required for tool execution loop)
        if (messageType === "ai" && (m as any).tool_calls && (m as any).tool_calls.length > 0) {
          baseMsg.tool_calls = (m as any).tool_calls.map((tc: any) => ({
            id: tc.id || tc.name, // Use name as fallback ID if not present
            type: "function",
            function: {
              name: tc.name,
              arguments: tc.args,
            },
          }));
        }

        // Add tool_call_id for tool result messages (required to link back to tool call)
        if (messageType === "tool") {
          if ((m as any).tool_call_id) {
            baseMsg.tool_call_id = (m as any).tool_call_id;
          }
          if ((m as any).name) {
            baseMsg.name = (m as any).name;
          }
        }

        return baseMsg;
      }),
      stream: true,
      think: this.thinkingLevel,
      ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
    };

    logInfo("[NativeOllamaClient] Request body", {
      hasTools: !!requestBody.tools,
      toolCount: requestBody.tools?.length,
      think: requestBody.think,
      messageCount: requestBody.messages.length,
      messageTypes: requestBody.messages.map((m: any) => m.role),
      toolNames: requestBody.tools?.map((t: any) => t.function?.name),
    });

    // Log full message details for debugging
    logInfo("[NativeOllamaClient] Full messages:", {
      messages: requestBody.messages.map((m: any, idx: number) => ({
        index: idx,
        role: m.role,
        contentPreview:
          typeof m.content === "string"
            ? m.content.substring(0, 200)
            : JSON.stringify(m.content).substring(0, 200),
        hasToolCalls: !!m.tool_calls,
        toolCallCount: m.tool_calls?.length,
        toolCallIds: m.tool_calls?.map((tc: any) => tc.id),
        hasToolCallId: !!m.tool_call_id,
        toolCallId: m.tool_call_id,
        toolName: m.name,
      })),
    });

    // Use ollamaAwareFetch for CORS bypass and thinking transformation
    const response = await ollamaAwareFetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError("[NativeOllamaClient] API error", { status: response.status, errorText });
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    // Parse streaming NDJSON response
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const json = JSON.parse(line);

          // Handle done signal
          if (json.done) {
            logInfo("[NativeOllamaClient] Stream complete", {
              totalTokens: json.eval_count,
              promptTokens: json.prompt_eval_count,
            });
            break;
          }

          // Log raw chunk for debugging (every 10th chunk to avoid spam)
          if (Math.random() < 0.1) {
            logInfo("[NativeOllamaClient] Raw chunk sample", {
              hasContent: !!json.message?.content,
              contentLength: json.message?.content?.length || 0,
              contentPreview: json.message?.content?.substring(0, 100),
              hasThinking: !!json.message?.thinking,
              thinkingLength: json.message?.thinking?.length || 0,
              hasToolCalls: !!json.message?.tool_calls,
              toolCallCount: json.message?.tool_calls?.length || 0,
            });
          }

          // Yield chunk compatible with ThinkBlockStreamer
          // Note: thinking already wrapped in <THINKING> tags by ollamaAwareFetch
          yield new AIMessageChunk({
            content: json.message?.content || "",
            additional_kwargs: {
              thinking: json.message?.thinking,
            },
            tool_call_chunks:
              json.message?.tool_calls?.map((tc: any, idx: number) => ({
                index: idx,
                id: tc.id,
                name: tc.function?.name,
                args: JSON.stringify(tc.function?.arguments || {}),
              })) || [],
          });

          // Log tool calls for debugging
          if (json.message?.tool_calls && json.message.tool_calls.length > 0) {
            logInfo("[NativeOllamaClient] Received tool calls in chunk", {
              toolCount: json.message.tool_calls.length,
              tools: json.message.tool_calls.map((tc: any) => tc.function?.name),
            });
          }
        } catch (error) {
          logError("[NativeOllamaClient] Failed to parse chunk", { line, error });
        }
      }
    }
  }

  /**
   * Non-streaming invoke (mainly for tool loop).
   * Returns complete AIMessage with tool_calls array.
   */
  async invoke(messages: BaseMessage[], options: StreamOptions = {}): Promise<AIMessage> {
    let fullContent = "";
    let fullThinking = "";
    const toolCalls: any[] = [];

    // Collect all chunks
    for await (const chunk of this.stream(messages, options)) {
      if (chunk.content) fullContent += chunk.content;
      if (chunk.additional_kwargs?.thinking) fullThinking += chunk.additional_kwargs.thinking;
      if (chunk.tool_call_chunks) {
        // Accumulate tool calls from chunks
        for (const tc of chunk.tool_call_chunks) {
          const existing = toolCalls.find((t) => t.index === tc.index);
          if (existing) {
            if (tc.name) existing.name = tc.name;
            if (tc.id) existing.id = tc.id;
            if (tc.args) existing.args += tc.args;
          } else {
            toolCalls.push({ ...tc });
          }
        }
      }
    }

    // Parse accumulated tool calls
    const parsedToolCalls = toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: JSON.parse(tc.args || "{}"),
    }));

    return new AIMessage({
      content: fullContent,
      additional_kwargs: {
        thinking: fullThinking,
      },
      tool_calls: parsedToolCalls,
    });
  }
}
