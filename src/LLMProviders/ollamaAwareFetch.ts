/**
 * Custom fetch wrapper for Ollama that properly preserves thinking blocks.
 *
 * When ChatOllama streams responses from the Ollama API, it receives JSON lines
 * like: {"message": {"content": "text", "thinking": "thought"}}
 *
 * The problem: LangChain's ChatOllama parser only looks at message.content,
 * so thinking gets ignored and ends up in content field.
 *
 * Solution: Transform the streaming response so that thinking is completely
 * separated and won't be parsed as content by LangChain.
 */

import { logInfo } from "@/logger";
import { requestUrl } from "obsidian";

export async function ollamaAwareFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Initialize headers if not provided
  const normalizedHeaders = new Headers(options.headers);
  const headers = Object.fromEntries(normalizedHeaders.entries());

  // Remove content-length if it exists
  delete (headers as Record<string, string>)["content-length"];

  const requestBodyText = typeof options.body === "string" ? options.body : "";
  const isGptOss = requestBodyText.includes("gpt-oss:");
  const isExternal = !url.includes("localhost") && !url.includes("127.0.0.1");
  logInfo("[CORS Fetch] Request", {
    url,
    method: options.method?.toUpperCase() || "POST",
    external: isExternal,
    gptOss: isGptOss,
  });

  const method = options.method?.toUpperCase() || "POST";
  const methodsWithBody = ["POST", "PUT", "PATCH"];

  const isOllama = url.includes("ollama");
  if (isOllama) {
    logInfo("[OLLAMA API] Request", {
      url,
      method,
      external: isExternal,
      gptOss: isGptOss,
    });
  }

  const response = await requestUrl({
    url,
    contentType: "application/json",
    headers: headers,
    method: method,
    ...(methodsWithBody.includes(method) && { body: options.body?.toString() }),
    throw: false,
  });

  // For Ollama streaming responses, transform thinking blocks
  if (isOllama && response.text) {
    try {
      const responseText =
        typeof response.text === "string" ? response.text : String(response.text);
      logInfo("[OLLAMA API] Response", {
        status: response.status,
        external: isExternal,
        gptOss: isGptOss,
      });

      // Check if this is a streaming response with thinking blocks
      // Ollama streaming returns newline-delimited JSON
      if (responseText.includes('"thinking":')) {
        logInfo("[OLLAMA API] Detected thinking blocks, transforming");

        // Strategy: For each chunk with thinking, emit TWO lines:
        // 1. A line with ONLY the thinking (in content field for now)
        // 2. A line with ONLY the actual content
        // This way ThinkBlockStreamer can detect thinking by looking at content
        const lines = responseText.split("\n").filter((line: string) => line.trim());
        const transformedLines: string[] = [];

        lines.forEach((line: string) => {
          try {
            const chunk = JSON.parse(line);
            if (chunk.message && chunk.message.thinking && chunk.message.thinking.length > 0) {
              const thinkingText = chunk.message.thinking;
              const contentText = chunk.message.content || "";

              logInfo("[OLLAMA API Transform] Separating thinking", {
                thinkingLen: thinkingText.length,
                contentLen: contentText.length,
              });

              // Emit thinking as a separate line with a marker so we can detect it
              transformedLines.push(
                JSON.stringify({
                  ...chunk,
                  message: {
                    ...chunk.message,
                    content: `<THINKING>${thinkingText}</THINKING>`,
                    thinking: undefined,
                  },
                })
              );

              // Emit actual content separately if it exists
              if (contentText) {
                transformedLines.push(
                  JSON.stringify({
                    ...chunk,
                    message: {
                      ...chunk.message,
                      content: contentText,
                      thinking: undefined,
                    },
                  })
                );
              }
            } else {
              // No thinking in this chunk, pass through
              transformedLines.push(line);
            }
          } catch {
            transformedLines.push(line);
          }
        });

        const transformedText = transformedLines.join("\n");
        logInfo("[OLLAMA API Transform] Transformed response", {
          lines: transformedLines.length,
        });

        // Create a new response with transformed text
        return new Response(transformedText, {
          status: response.status,
          headers: response.headers,
        }) as any;
      }
    } catch (error) {
      logInfo("[OLLAMA API Transform] Error processing response", error);
      // Fall through to return original response
    }
  }

  return response as any;
}
