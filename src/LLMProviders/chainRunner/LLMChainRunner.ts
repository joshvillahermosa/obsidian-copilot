import {
  ABORT_REASON,
  ChatModelProviders,
  ModelCapability,
  WEB_SEARCH_SYSTEM_PROMPT,
  THINKING_MODE_PROMPT,
} from "@/constants";
import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { findCustomModel, withSuppressedTokenWarnings } from "@/utils";
import { BaseChainRunner } from "./BaseChainRunner";
import { loadAndAddChatHistory } from "./utils/chatHistoryUtils";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import { getModelKey } from "@/aiParams";
import { NativeOllamaClient } from "@/LLMProviders/NativeOllamaClient";
import {
  OLLAMA_WEB_SEARCH_SCHEMA,
  OLLAMA_WEB_FETCH_SCHEMA,
  executeOllamaWebSearch,
  executeOllamaWebFetch,
} from "./utils/ollamaWebSearchTools";
import { isGptOssModel, isOllamaCloudEndpoint } from "@/utils/ollamaUtils";
import { createToolResultMessage } from "./utils/nativeToolCalling";

export class LLMChainRunner extends BaseChainRunner {
  /**
   * Construct messages array using envelope-based context (L1-L5 layers)
   * Requires context envelope - throws error if unavailable
   */
  private async constructMessages(userMessage: ChatMessage): Promise<any[]> {
    // Require envelope for LLM chain
    if (!userMessage.contextEnvelope) {
      throw new Error(
        "[LLMChainRunner] Context envelope is required but not available. Cannot proceed with LLM chain."
      );
    }

    logInfo("[LLMChainRunner] Using envelope-based context");

    // Convert envelope to messages (L1 system + L2+L3+L5 user)
    const baseMessages = LayerToMessagesConverter.convert(userMessage.contextEnvelope, {
      includeSystemMessage: true,
      mergeUserContent: true,
      debug: false,
    });

    const messages: any[] = [];

    // Add system message (L1)
    const systemMessage = baseMessages.find((m) => m.role === "system");
    if (systemMessage) {
      messages.push(systemMessage);
    }

    // Add chat history (L4)
    const memory = this.chainManager.memoryManager.getMemory();
    await loadAndAddChatHistory(memory, messages);

    // Add user message (L2+L3+L5 merged)
    const userMessageContent = baseMessages.find((m) => m.role === "user");
    if (userMessageContent) {
      // Handle multimodal content if present
      if (userMessage.content && Array.isArray(userMessage.content)) {
        // Merge envelope text with multimodal content (images)
        const updatedContent = userMessage.content.map((item: any) => {
          if (item.type === "text") {
            return { ...item, text: userMessageContent.content };
          }
          return item;
        });
        messages.push({
          role: "user",
          content: updatedContent,
        });
      } else {
        messages.push(userMessageContent);
      }
    }

    return messages;
  }

  async run(
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    }
  ): Promise<string> {
    // Check if the current model has reasoning capability
    const settings = getSettings();
    const modelKey = getModelKey();
    let excludeThinking = false;

    try {
      const currentModel = findCustomModel(modelKey, settings.activeModels);
      // Exclude thinking blocks if model doesn't have REASONING capability
      excludeThinking = !currentModel.capabilities?.includes(ModelCapability.REASONING);
    } catch (error) {
      // If we can't find the model, default to including thinking blocks
      logInfo(
        "Could not determine model capabilities, defaulting to include thinking blocks",
        error
      );
    }

    let streamer = new ThinkBlockStreamer(updateCurrentAiMessage, excludeThinking);

    try {
      // Construct messages using envelope or legacy approach
      const messages = await this.constructMessages(userMessage);

      // Record the payload for debugging (includes layered view if envelope available)
      const chatModel = this.chainManager.chatModelManager.getChatModel();
      const modelName = (chatModel as { modelName?: string } | undefined)?.modelName;
      recordPromptPayload({
        messages,
        modelName,
        contextEnvelope: userMessage.contextEnvelope,
      });

      logInfo("Final Request to AI:\n", messages);

      // Detect if we should use native Ollama client for GPT-OSS with web search
      const settings = getSettings();
      const modelKey = getModelKey();
      const customModel = findCustomModel(modelKey, settings.activeModels);

      const shouldUseNativeOllama =
        customModel.provider === ChatModelProviders.OLLAMA &&
        isGptOssModel(customModel.name) &&
        isOllamaCloudEndpoint(customModel.baseUrl) &&
        customModel.enableOllamaWebSearch === true;

      if (shouldUseNativeOllama) {
        logInfo("[LLMChainRunner] Using NativeOllamaClient for GPT-OSS web search", {
          model: customModel.name,
          baseUrl: customModel.baseUrl,
          thinkingLevel: customModel.ollamaThinkingLevel,
        });

        // Inject web search and thinking mode instructions into system message
        const systemMsg = messages.find((m: any) => m.role === "system");
        if (systemMsg) {
          systemMsg.content += WEB_SEARCH_SYSTEM_PROMPT;

          // Add thinking mode guidance for any thinking level
          if (customModel.ollamaThinkingLevel) {
            systemMsg.content += THINKING_MODE_PROMPT;
            logInfo("[LLMChainRunner] Added THINKING MODE requirements to system prompt", {
              thinkingLevel: customModel.ollamaThinkingLevel,
            });
          }

          logInfo("[LLMChainRunner] Added web search and thinking instructions to system prompt");
        }

        // Create native client
        const nativeClient = new NativeOllamaClient({
          baseUrl: customModel.baseUrl!,
          apiKey: customModel.apiKey!,
          modelName: customModel.name,
          thinkingLevel: customModel.ollamaThinkingLevel,
        });

        // Stream with tools
        const chatStream = nativeClient.stream(messages, {
          tools: [OLLAMA_WEB_SEARCH_SCHEMA, OLLAMA_WEB_FETCH_SCHEMA],
          signal: abortController.signal,
        });

        // Process chunks through ThinkBlockStreamer
        for await (const chunk of chatStream) {
          if (abortController.signal.aborted) {
            logInfo("Stream iteration aborted", { reason: abortController.signal.reason });
            break;
          }
          streamer.processChunk(chunk);
        }

        // Check for tool calls after streaming completes
        logInfo("[LLMChainRunner] Stream complete, checking for tool calls", {
          hasToolCalls: streamer.hasToolCalls(),
          toolCallCount: streamer.getToolCalls().length,
        });

        if (streamer.hasToolCalls()) {
          // Get the final streamer with complete content after tool execution
          const finalStreamer = await this.handleNativeOllamaToolCalls(
            nativeClient,
            messages,
            streamer,
            customModel,
            abortController,
            updateCurrentAiMessage,
            excludeThinking
          );
          // Use the final streamer for response (has actual content)
          streamer = finalStreamer;
          logInfo("[LLMChainRunner] Using final streamer after tool execution");
        }

        // Detect thinking-only responses and attempt recovery for any thinking level
        if (customModel.ollamaThinkingLevel && !abortController.signal.aborted) {
          const needsRecovery = this.detectThinkingOnlyResponse(
            streamer,
            customModel.ollamaThinkingLevel
          );
          if (needsRecovery) {
            logWarn("[LLMChainRunner] Detected thinking-only response, attempting recovery", {
              thinkingLevel: customModel.ollamaThinkingLevel,
            });
            const recoveryStreamer = await this.recoverFromThinkingOnlyResponse(
              nativeClient,
              messages,
              streamer,
              abortController,
              updateCurrentAiMessage,
              excludeThinking
            );
            streamer = recoveryStreamer;
          }
        }
      } else {
        // Use existing LangChain ChatOllama (standard flow)
        logInfo("[LLMChainRunner] Using LangChain ChatOllama (standard flow)");

        // Stream with abort signal
        const chatStream = await withSuppressedTokenWarnings(() =>
          this.chainManager.chatModelManager.getChatModel().stream(messages, {
            signal: abortController.signal,
          })
        );

        // Track if this is an Ollama model for logging
        const isOllamaModel = chatModel.constructor.name === "ChatOllama";
        let chunkIndex = 0;

        for await (const chunk of chatStream) {
          if (abortController.signal.aborted) {
            logInfo("Stream iteration aborted", { reason: abortController.signal.reason });
            break;
          }

          // Log raw chunks from Ollama for debugging
          if (isOllamaModel) {
            logInfo(`[OLLAMA CHUNK ${chunkIndex}] Raw chunk:`, chunk);
            if (chunk.content)
              logInfo(
                `  - content: ${typeof chunk.content === "string" ? chunk.content.slice(0, 200) : JSON.stringify(chunk.content).slice(0, 200)}`
              );
            if (chunk.additional_kwargs)
              logInfo(
                `  - additional_kwargs: ${JSON.stringify(chunk.additional_kwargs).slice(0, 200)}`
              );
            chunkIndex++;
          }

          streamer.processChunk(chunk);
        }
      }
    } catch (error: any) {
      // Check if the error is due to abort signal
      if (error.name === "AbortError" || abortController.signal.aborted) {
        logInfo("Stream aborted by user", { reason: abortController.signal.reason });
        // Don't show error message for user-initiated aborts
      } else {
        await this.handleError(error, streamer.processErrorChunk.bind(streamer));
      }
    }

    // Always return the response, even if partial
    const result = streamer.close();

    const responseMetadata = {
      wasTruncated: result.wasTruncated,
      tokenUsage: result.tokenUsage ?? undefined,
    };

    // Only skip saving if it's a new chat (clearing everything)
    if (abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      updateCurrentAiMessage("");
      return "";
    }

    await this.handleResponse(
      result.content,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      undefined,
      undefined,
      responseMetadata
    );

    return result.content;
  }

  /**
   * Detect if the response is primarily thinking with little or no final answer.
   * This can happen at any thinking level when the model gets absorbed in reasoning.
   * Detection thresholds are adjusted based on thinking level.
   */
  private detectThinkingOnlyResponse(
    streamer: ThinkBlockStreamer,
    thinkingLevel?: string
  ): boolean {
    const analysis = streamer.analyzeContent();

    logInfo("[LLMChainRunner] Response analysis", {
      totalLength: analysis.totalLength,
      thinkingLength: analysis.thinkingLength,
      finalContentLength: analysis.contentLength,
      thinkingRatio: (analysis.thinkingRatio * 100).toFixed(1) + "%",
      hasFinalContent: analysis.contentLength > 0,
      thinkingLevel,
    });

    // Adjust thresholds based on thinking level
    // Lower thinking levels should have stricter detection (less thinking expected)
    let minThinkingChars = 500;
    let maxFinalChars = 100;
    let minThinkingRatio = 0.9;

    if (thinkingLevel === "low") {
      // Low thinking: Even moderate thinking without answer is unusual
      minThinkingChars = 200;
      maxFinalChars = 50;
      minThinkingRatio = 0.85;
    } else if (thinkingLevel === "medium") {
      // Medium thinking: More thinking expected, but still needs answer
      minThinkingChars = 350;
      maxFinalChars = 75;
      minThinkingRatio = 0.88;
    }
    // High thinking uses default values (most lenient)

    // Consider it thinking-only if:
    // 1. There's substantial thinking content (threshold varies by level)
    // 2. Final answer is very short or non-existent (threshold varies by level)
    // 3. Thinking comprises high % of total response (threshold varies by level)
    const isThinkingOnly =
      analysis.thinkingLength > minThinkingChars &&
      analysis.contentLength < maxFinalChars &&
      analysis.thinkingRatio > minThinkingRatio;

    if (isThinkingOnly) {
      logWarn("[LLMChainRunner] Detected thinking-only response pattern", {
        thinkingChars: analysis.thinkingLength,
        finalAnswerChars: analysis.contentLength,
        thinkingLevel,
        thresholds: { minThinkingChars, maxFinalChars, minThinkingRatio },
        verdict: "NEEDS_RECOVERY",
      });
    }

    return isThinkingOnly;
  }

  /**
   * Recover from thinking-only response by prompting the model to provide a final answer.
   * Adds a system message requesting the final answer and re-invokes the model.
   */
  private async recoverFromThinkingOnlyResponse(
    client: NativeOllamaClient,
    messages: any[],
    currentStreamer: ThinkBlockStreamer,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    excludeThinking: boolean
  ): Promise<ThinkBlockStreamer> {
    logInfo("[LLMChainRunner] Attempting recovery from thinking-only response");

    // Get the current content (without closing the streamer)
    const currentContent = currentStreamer.getContent();

    // Add the thinking-only response to conversation history
    messages.push({
      role: "assistant",
      content: currentContent,
    });

    // Add recovery prompt asking for final answer
    messages.push({
      role: "user",
      content:
        "Please provide your final answer to my question. You've done the thinking, now I need the conclusion.",
    });

    logInfo("[LLMChainRunner] Invoking model with recovery prompt", {
      totalMessages: messages.length,
    });

    try {
      const chatStream = client.stream(messages, {
        signal: abortController.signal,
      });

      // Accumulate recovery content
      let recoveryContent = "";

      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) {
          logInfo("Recovery stream aborted", { reason: abortController.signal.reason });
          break;
        }

        // Extract content from chunk (handle both string and array content)
        let chunkContent = "";
        if (typeof chunk.content === "string") {
          chunkContent = chunk.content;
        } else if (Array.isArray(chunk.content)) {
          // Handle Claude-style content arrays
          for (const item of chunk.content) {
            if (item.type === "text" && item.text) {
              chunkContent += item.text;
            }
          }
        }

        if (chunkContent) {
          recoveryContent += chunkContent;
          // Show combined content in real-time
          updateCurrentAiMessage(currentContent + "\n\n" + recoveryContent);
        }
      }

      if (recoveryContent.trim().length > 10) {
        logInfo("[LLMChainRunner] Recovery successful - got final answer", {
          recoveryLength: recoveryContent.length,
        });

        // Create a new streamer with the combined content
        const combinedStreamer = new ThinkBlockStreamer(updateCurrentAiMessage, excludeThinking);
        const combinedContent = currentContent + "\n\n" + recoveryContent;
        combinedStreamer.setContent(combinedContent);

        return combinedStreamer;
      } else {
        logWarn(
          "[LLMChainRunner] Recovery attempt did not produce sufficient content, using original"
        );
        return currentStreamer;
      }
    } catch (error: any) {
      logWarn("[LLMChainRunner] Recovery attempt failed", error);
      return currentStreamer;
    }
  }

  /**
   * Handle tool calls for native Ollama client (ReAct loop)
   * Executes web search/fetch tools and re-invokes the model with results
   * Returns the final streamer with complete content
   */
  private async handleNativeOllamaToolCalls(
    client: NativeOllamaClient,
    messages: any[],
    streamer: ThinkBlockStreamer,
    customModel: any,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    excludeThinking: boolean
  ): Promise<ThinkBlockStreamer> {
    const MAX_ITERATIONS = 3;
    let iteration = 0;

    // Add initial AI message with tool calls
    const aiMessage = streamer.buildAIMessage();
    messages.push(aiMessage);

    while (iteration < MAX_ITERATIONS && streamer.hasToolCalls()) {
      iteration++;
      logInfo(`[LLMChainRunner] Tool execution iteration ${iteration}`);

      const toolCalls = streamer.getToolCalls();

      for (const toolCall of toolCalls) {
        logInfo(`[LLMChainRunner] Executing tool: ${toolCall.name}`, toolCall.args);

        let result: any;

        try {
          if (toolCall.name === "web_search") {
            result = await executeOllamaWebSearch(
              customModel.baseUrl!,
              customModel.apiKey!,
              toolCall.args.query as string,
              toolCall.args.max_results as number | undefined
            );
          } else if (toolCall.name === "web_fetch") {
            result = await executeOllamaWebFetch(
              customModel.baseUrl!,
              customModel.apiKey!,
              toolCall.args.url as string
            );
          } else {
            logWarn(`[LLMChainRunner] Unknown tool: ${toolCall.name}`);
            result = { error: `Unknown tool: ${toolCall.name}` };
          }
        } catch (error: any) {
          logWarn(`[LLMChainRunner] Tool execution failed: ${toolCall.name}`, error);
          result = { error: `Tool execution failed: ${error.message}` };
        }

        // Add tool result to messages
        const toolMessage = createToolResultMessage(
          toolCall.id,
          toolCall.name,
          JSON.stringify(result)
        );
        logInfo(`[LLMChainRunner] Created tool result message`, {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          resultPreview: JSON.stringify(result).substring(0, 300),
          resultLength: JSON.stringify(result).length,
        });
        messages.push(toolMessage);
      }

      // Re-invoke with tool results using the SAME streamer to accumulate content
      logInfo("[LLMChainRunner] Re-invoking model with tool results", {
        totalMessages: messages.length,
        iteration,
        lastThreeRoles: messages.slice(-3).map((m: any) => ({
          role: m._getType ? m._getType() : m.role,
          hasToolCalls: !!(m as any).tool_calls,
          isToolResult: m._getType ? m._getType() === "tool" : false,
        })),
      });

      // Clear previous tool calls from streamer before next iteration
      // (new stream will populate with fresh tool calls if model makes more)
      streamer.clearToolCalls();

      const chatStream = client.stream(messages, {
        signal: abortController.signal,
      });

      // Process chunks into the SAME streamer (accumulates content)
      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) {
          logInfo("Stream iteration aborted during tool loop", {
            reason: abortController.signal.reason,
          });
          break;
        }
        streamer.processChunk(chunk);
      }

      // Check if model made more tool calls (multi-step reasoning)
      if (streamer.hasToolCalls()) {
        const followUpMessage = streamer.buildAIMessage();
        messages.push(followUpMessage);
        logInfo("[LLMChainRunner] Model made additional tool calls, continuing loop", {
          toolCallCount: streamer.getToolCalls().length,
          iteration,
        });
      }
    }

    if (iteration >= MAX_ITERATIONS) {
      logWarn("[LLMChainRunner] Reached max tool call iterations");
    }

    logInfo("[LLMChainRunner] Tool loop complete", {
      totalIterations: iteration,
      hasMoreToolCalls: streamer.hasToolCalls(),
    });

    // Return the streamer that accumulated all iterations
    return streamer;
  }
}
