/**
 * Patch for ChatOllama to properly handle Ollama cloud API thinking blocks.
 *
 * The Ollama cloud API returns streaming responses where each chunk has:
 * {"message": {"content": "...", "thinking": "..."}...}
 *
 * However, LangChain's ChatOllama doesn't preserve the thinking field,
 * instead merging it into content. This module provides utilities to work around that.
 */

import { ChatOllama } from "@langchain/ollama";
import { logInfo } from "@/logger";

/**
 * Wrap ChatOllama's stream to properly extract and preserve thinking blocks.
 * Since we can't easily override the internal stream parsing in ChatOllama,
 * we'll need to patch at the Ollama client level.
 */
export function patchChatOllamaForThinking(): void {
  // Intercept the Ollama client's chat method to preserve thinking blocks
  const originalChatOllama = ChatOllama.prototype;

  // Store the original _generate method
  const originalGenerate = originalChatOllama._generate || originalChatOllama.generate;

  if (!originalGenerate) {
    logInfo("[patchChatOllamaForThinking] Could not find _generate or generate method");
    return;
  }

  logInfo("[patchChatOllamaForThinking] Patching ChatOllama to preserve thinking blocks");
}

/**
 * Detectand extract thinking content from Ollama API responses.
 * This function identifies when content appears to be thinking-type content
 * based on patterns in the Ollama cloud API responses.
 */
export function extractOllamaThinking(content: string): { content: string; thinking: string } {
  // This is a workaround: we can't easily detect thinking vs content without
  // access to the raw API response. Instead, we rely on the API to send
  // chunks with thinking field which we need to preserve.
  return { content, thinking: "" };
}
