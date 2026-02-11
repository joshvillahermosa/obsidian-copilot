# GPT-OSS Ollama Integration: Native Implementation (V2)

**Status**: ⚠️ **REVISED PLAN** - Native Fetch Implementation (Bypassing LangChain)
**Date**: February 11, 2026
**Last Updated**: February 11, 2026
**Version**: 2.0 (Complete Architecture Revision)
**Target**: Ollama GPT-OSS models with Cloud API support
**Implementation**: Native HTTP client using `ollamaAwareFetch` (no LangChain for GPT-OSS web search)

## Table of Contents

- [Executive Summary](#executive-summary)
- [Background & Context](#background--context)
- [Why Native Implementation](#why-native-implementation)
- [Architecture Overview](#architecture-overview)
- [Network Request Strategy](#network-request-strategy)
- [Technical Specifications](#technical-specifications)
- [Implementation Plan](#implementation-plan)
- [Code Examples](#code-examples)
- [Testing Strategy](#testing-strategy)
- [Migration & Compatibility](#migration--compatibility)
- [References](#references)

---

## Executive Summary

This document outlines the **revised architecture** for integrating Ollama Cloud's GPT-OSS models with web search and thinking capabilities. After discovering a critical bug in `@langchain/ollama` that prevents tool calling from working (duplicate API calls that discard tools), we've pivoted to a **native fetch-based implementation** using the existing `ollamaAwareFetch` infrastructure.

### Key Features

- 🔄 **Native HTTP Client**: Direct API calls to `https://ollama.com/api/chat` using `ollamaAwareFetch`
- 🌐 **Web Search Tools**: Client-side execution of `web_search` and `web_fetch` via Ollama Cloud API
- 💭 **Thinking Levels**: Three levels (low, medium, high) with proper streaming support
- 🔄 **Tool Execution Loop**: ReAct pattern using existing `AutonomousAgentChainRunner` patterns
- 🔀 **Smart Fallback**: Non-GPT-OSS Ollama models continue using LangChain (no disruption)
- 🛡️ **CORS Handling**: Leverage Obsidian's `requestUrl()` via `ollamaAwareFetch`

### Design Principles

1. **Bypass LangChain for GPT-OSS Web Search**: Direct HTTP calls, no middleware bugs
2. **Reuse Infrastructure**: Leverage `ollamaAwareFetch`, `ThinkBlockStreamer`, existing tool patterns
3. **Conditional Activation**: Only use native client when `isGptOss + isCloud + webSearchEnabled`
4. **Maintain Compatibility**: All other Ollama models continue using existing LangChain integration

---

## Background & Context

### Problem Statement

The Copilot for Obsidian plugin currently:

- ❌ Does not support GPT-OSS models' native web search capabilities
- ❌ Does not handle GPT-OSS's required thinking levels (`low`/`medium`/`high`)
- ❌ Lacks differentiation between local Ollama and Ollama Cloud
- ❌ Cannot leverage Ollama Cloud's native web search API
- 🐛 **LangChain has a tool calling bug** that prevents web search from working

### Ollama GPT-OSS Capabilities

According to Ollama documentation:

**Web Search** ([docs](https://docs.ollama.com/capabilities/web-search)):

```bash
POST https://ollama.com/api/web_search
{
  "query": "search query",
  "max_results": 5  // optional, max 10
}
```

**Web Fetch** ([docs](https://docs.ollama.com/capabilities/web-search)):

```bash
POST https://ollama.com/api/web_fetch
{
  "url": "https://example.com"
}
```

**Thinking** ([docs](https://docs.ollama.com/capabilities/thinking)):

- GPT-OSS models **require** thinking (cannot be disabled)
- Accept levels: `"low"`, `"medium"`, `"high"` (not boolean)
- Return separate `thinking` and `content` fields in streaming responses
- Recommended context: ≥32K tokens

**Chat API** ([docs](https://docs.ollama.com/cloud)):

```javascript
POST https://ollama.com/api/chat
{
  "model": "gpt-oss:120b-cloud",
  "messages": [{"role": "user", "content": "..."}],
  "tools": [web_search_schema, web_fetch_schema],
  "think": "medium",
  "stream": true
}
// Returns newline-delimited JSON (NDJSON) chunks
```

---

## Why Native Implementation?

### The LangChain Bug (Critical Blocker)

**Discovered**: February 10, 2026
**Impact**: Web search completely non-functional with LangChain
**Reference**: See [OLLAMA_GPT_OSS_DEBUG_SESSION.md](./OLLAMA_GPT_OSS_DEBUG_SESSION.md)

#### Bug Description

The `@langchain/ollama` package has a critical bug when using `.bindTools()`:

**Symptom**: Makes **TWO API calls** per request:

1. **First call**: WITH tools array (tools sent to Ollama) ✅
2. **Second call**: WITHOUT tools array (tools discarded) ❌
3. Model responds to second call (toolless)

**Result**: Model never receives tools, web search doesn't work despite perfect configuration.

#### Evidence from Debug Session

```
[LLMChainRunner] Invoking Ollama with bound tools

// First API call - tools present ✅
[OLLAMA API] Request Details {
  hasTools: true,
  toolCount: 2,
  toolNames: ['web_search', 'web_fetch']
}

// Second API call - NO TOOLS ❌
[OLLAMA API] Request Details {
  hasTools: false
}

// Model response (from toolless call)
[LLMChainRunner] Received response {
  hasToolCalls: false
}
```

#### Failed Attempts

All three implementation approaches with LangChain failed:

1. ❌ **Attempt 1**: `.bindTools()` + `.stream()` (standard pattern)
2. ❌ **Attempt 2**: Tools in stream options parameter
3. ❌ **Attempt 3**: `.bindTools()` + `.invoke()` with simulated streaming

**Conclusion**: Must bypass LangChain entirely for GPT-OSS with web search enabled.

### Why Native Implementation Works

**Advantages**:

1. ✅ **Full Control**: Direct HTTP calls to `https://ollama.com/api/chat`
2. ✅ **No Bug**: Single API call with tools correctly included
3. ✅ **Proven Infrastructure**: `ollamaAwareFetch` already handles CORS + thinking transformation
4. ✅ **Existing Patterns**: ReAct loop pattern already proven in `AutonomousAgentChainRunner`
5. ✅ **Compatible**: `ThinkBlockStreamer` works with any chunk format

**Trade-offs**:

- ⚠️ More code to maintain (streaming parser, tool loop)
- ⚠️ Can't use LangChain's automatic features for GPT-OSS web search
- ⚠️ Need to implement NDJSON parsing for streaming

**Mitigation**:

- 🎯 Only use native client when: `isGptOss() + isOllamaCloudEndpoint() + enableWebSearch === true`
- 🎯 All other Ollama models continue using LangChain (zero risk to existing functionality)
- 🎯 Can switch back to LangChain when bug is fixed upstream

---

## Architecture Overview

### System Architecture (Native Implementation)

```
┌─────────────────────────────────────────────────────────────┐
│                      Chat UI Layer                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Thinking Badge: [Medium] (Collapsible)              │   │
│  │ Model Badge: gpt-oss:120b-cloud + [🌐 WEB_SEARCH]  │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              LLMChainRunner                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Detection Logic (before streaming):                 │   │
│  │                                                       │   │
│  │ shouldUseNativeOllama =                             │   │
│  │   isGptOssModel(name) &&                           │   │
│  │   isOllamaCloudEndpoint(baseUrl) &&                │   │
│  │   enableOllamaWebSearch === true                   │   │
│  │                                                       │   │
│  │ if (shouldUseNativeOllama):                        │   │
│  │   → NativeOllamaClient                             │   │
│  │ else:                                               │   │
│  │   → LangChain ChatOllama (existing)                │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
┌───────▼────────┐         ┌──────────▼──────────┐
│ Native Ollama  │         │  LangChain          │
│ Client         │         │  ChatOllama         │
│                │         │                     │
│ - stream()     │         │  (non-GPT-OSS       │
│ - invoke()     │         │   models)           │
│ - Tool loop    │         │                     │
│ - NDJSON parse │         │                     │
└───────┬────────┘         └─────────────────────┘
        │
        │ (uses for all requests)
        ▼
┌────────────────┐
│ ollamaAware    │
│ Fetch          │
│ - CORS bypass  │◄────────┐
│ - Thinking     │         │
│   transform    │         │
└───────┬────────┘         │
        │                  │
        │                  │ (for tool execution)
        ▼                  │
┌─────────────────────────┴──────────┐
│   Ollama Cloud API                  │
│                                     │
│  /api/chat   (streaming, tools)     │
│  /api/web_search  (tool execution)  │
│  /api/web_fetch   (tool execution)  │
└─────────────────────────────────────┘
```

### Data Flow: Native Web Search Request

```
1. User: "What's the latest news on AI?"
   │
   ▼
2. LLMChainRunner detects:
   isGptOss = true
   isCloud = true
   enableWebSearch = true
   → Create NativeOllamaClient(config)
   │
   ▼
3. client.stream(messages, options) via ollamaAwareFetch:
   POST https://ollama.com/api/chat
   {
     model: "gpt-oss:120b-cloud",
     messages: [{role: "user", content: "latest AI news"}],
     tools: [web_search_schema, web_fetch_schema],
     think: "medium",
     stream: true
   }
   │
   ▼
4. Ollama Cloud (server-side):
   - Model analyzes: "User needs current information"
   - Model decides: "I should use web_search"
   - Executes: web_search(query="AI news 2026")
   - Returns: Streaming NDJSON chunks
   │
   ▼
5. NativeOllamaClient receives chunks:
   {"message": {"thinking": "Analyzing query..."}}
   {"message": {"thinking": "Need current info..."}}
   {"message": {"tool_calls": [{"function": {"name": "web_search", ...}}]}}
   {"done": true}
   │
   ▼
6. ThinkBlockStreamer processes chunks:
   - Extracts thinking from <THINKING> tags (via ollamaAwareFetch)
   - Accumulates tool_calls via tool_call_chunks
   - Returns: hasToolCalls() = true, getToolCalls() = [...]
   │
   ▼
7. LLMChainRunner detects tool calls:
   if (streamer.hasToolCalls() && shouldUseNativeOllama):
     toolCalls = streamer.getToolCalls()
     for each toolCall:
       if (toolCall.name === "web_search"):
         result = await executeOllamaWebSearch(args.query, args.max_results)
       messages.push({
         role: "tool",
         content: JSON.stringify(result),
         tool_name: "web_search"
       })
   │
   ▼
8. Re-invoke client.stream() with tool results:
   POST https://ollama.com/api/chat
   {
     messages: [
       {role: "user", content: "latest AI news"},
       {role: "assistant", tool_calls: [...]},
       {role: "tool", content: "[search results]", tool_name: "web_search"}
     ],
     think: "medium",
     stream: true
   }
   │
   ▼
9. Ollama synthesizes final answer from search results:
   {"message": {"thinking": "Based on search results..."}}
   {"message": {"content": "Here's the latest in AI..."}}
   {"done": true}
   │
   ▼
10. UI displays:
    [Thinking: Medium] [collapsed]
    "Here's the latest in AI: [synthesized answer with citations]"
```

### Key Components (Revised)

| Component                 | Purpose                                        | File Location                                                | Status           |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------ | ---------------- |
| `ollamaUtils.ts`          | Cloud detection, GPT-OSS detection, validation | `src/utils/ollamaUtils.ts`                                   | ❌ **To Create** |
| `NativeOllamaClient.ts`   | Direct HTTP client for Ollama API              | `src/LLMProviders/NativeOllamaClient.ts`                     | ❌ **To Create** |
| `ollamaWebSearchTools.ts` | Web search/fetch tool executors                | `src/LLMProviders/chainRunner/utils/ollamaWebSearchTools.ts` | ❌ **To Create** |
| `LLMChainRunner.ts`       | Detection & routing logic                      | `src/LLMProviders/chainRunner/LLMChainRunner.ts`             | ✅ **To Update** |
| `ollamaAwareFetch.ts`     | CORS bypass, thinking transformation           | `src/LLMProviders/ollamaAwareFetch.ts`                       | ✅ **Exists**    |
| `ThinkBlockStreamer.ts`   | Chunk processing, tool call accumulation       | `src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts`   | ✅ **Exists**    |
| `aiParams.ts`             | Type definitions for CustomModel               | `src/aiParams.ts`                                            | ✅ **To Update** |
| `ModelEditDialog.tsx`     | UI for Ollama config (optional)                | `src/settings/v2/components/ModelEditDialog.tsx`             | ⏸️ **Optional**  |

---

## Network Request Strategy

This section explains the critical architectural decision about how to bypass CORS restrictions when making API calls to Ollama Cloud from the browser environment.

### The CORS Problem

Browser-based applications (including Obsidian plugins running in Electron) face Cross-Origin Resource Sharing (CORS) restrictions when making API calls to external services. Ollama Cloud API at `https://ollama.com/api/chat` does not set CORS headers that allow arbitrary browser origins to access it.

### Three Possible Approaches

#### 1. Browser's Native `fetch()` API ❌

```typescript
// This FAILS in production
const response = await fetch("https://ollama.com/api/chat", {
  method: "POST",
  headers: { "Authorization": "Bearer key" },
  body: JSON.stringify({ model: "gpt-oss:120b", messages: [...] })
});
// Error: CORS policy blocked
```

**Why it fails**:

- Browser enforces Same-Origin Policy
- Ollama Cloud doesn't return `Access-Control-Allow-Origin: *` header
- Preflight OPTIONS request gets rejected

#### 2. XMLHttpRequest ❌

```typescript
// Also FAILS - same CORS restrictions
const xhr = new XMLHttpRequest();
xhr.open("POST", "https://ollama.com/api/chat");
xhr.setRequestHeader("Authorization", "Bearer key");
xhr.send(body);
// Error: CORS policy blocked
```

**Same problem**: XMLHttpRequest follows same CORS rules as fetch.

#### 3. Obsidian's `requestUrl()` API ✅ **(Our Choice)**

```typescript
// From obsidian module
import { requestUrl } from "obsidian";

const response = await requestUrl({
  url: "https://ollama.com/api/chat",
  method: "POST",
  headers: { "Authorization": "Bearer key" },
  body: JSON.stringify({ model: "gpt-oss:120b", messages: [...] })
});
// Success! Bypasses CORS
```

**Why it works**:

- **Electron's Node.js layer**: Obsidian plugins run in Electron, which has both browser context AND Node.js context
- **`requestUrl()` uses Node.js networking**: Executes the HTTP request in the Node.js layer, not the browser layer
- **No CORS enforcement**: Node.js doesn't have Same-Origin Policy
- **Returns Response-like object**: Compatible with browser Response API

### The `ollamaAwareFetch` Abstraction

Looking at `src/LLMProviders/ollamaAwareFetch.ts`, we have an existing wrapper:

```typescript
export async function ollamaAwareFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Use Obsidian's requestUrl (bypasses CORS)
  const response = await requestUrl({
    url,
    method: options.method || "POST",
    headers: Object.fromEntries(new Headers(options.headers).entries()),
    body: options.body?.toString(),
    throw: false,
  });

  // BONUS: Transforms Ollama thinking blocks
  if (response.text.includes('"thinking":')) {
    // Wraps thinking in <THINKING> tags for ThinkBlockStreamer
    const transformed = transformThinkingBlocks(response.text);
    return new Response(transformed, {
      status: response.status,
      headers: new Headers(response.headers),
    });
  }

  return new Response(response.text, {
    status: response.status,
    headers: new Headers(response.headers),
  }) as any;
}
```

**Key features**:

1. ✅ **CORS bypass**: Uses `requestUrl()` under the hood
2. ✅ **Fetch-compatible API**: Takes `RequestInit`, returns `Response`
3. ✅ **Thinking transformation**: Already parses Ollama's thinking blocks and wraps them in `<THINKING>` tags
4. ✅ **Headers normalization**: Handles both plain objects and Headers instances
5. ✅ **Battle-tested**: Already in production use for LangChain's ChatOllama with `enableCors: true`

### Implementation in NativeOllamaClient

```typescript
class NativeOllamaClient {
  async *stream(messages: BaseMessage[], options): AsyncGenerator<AIMessageChunk> {
    const requestBody = {
      model: this.modelName,
      messages: messages.map((m) => ({ role: m._getType(), content: m.content })),
      stream: true,
      think: this.thinkingLevel || "medium",
      tools: options.tools || [],
    };

    // Use ollamaAwareFetch - handles CORS AND thinking transformation
    const response = await ollamaAwareFetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    // Parse streaming NDJSON response
    const reader = response.body.getReader();
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

        const json = JSON.parse(line);

        // Ollama Cloud format: { message: { content?, thinking?, tool_calls? }, done }
        yield new AIMessageChunk({
          content: json.message?.content || "",
          additional_kwargs: {
            thinking: json.message?.thinking, // Already wrapped in <THINKING> by ollamaAwareFetch
            tool_calls: json.message?.tool_calls,
          },
        });
      }
    }
  }
}
```

### Why This Approach?

**Terminology Clarification**: When we say "native fetch", we mean:

- ✅ "Native" = Not using LangChain's abstraction layer
- ✅ "Native" = Direct HTTP calls to Ollama Cloud API
- ❌ NOT "native browser fetch()" - that fails due to CORS

**Full description**: "Native Ollama API integration using `ollamaAwareFetch` wrapper (which uses Obsidian's `requestUrl()` for CORS bypass)"

**Advantages over alternatives**:

- ✅ Reuses existing CORS bypass mechanism
- ✅ Leverages built-in Ollama thinking block transformation
- ✅ Provides fetch-compatible API for easy streaming
- ✅ Already proven in production
- ✅ Avoids adding new dependencies
- ✅ No need to reimplement CORS handling

---

## Technical Specifications

### 1. Utility Module (`ollamaUtils.ts`)

**Location**: `src/utils/ollamaUtils.ts` (NEW FILE)

```typescript
import { CustomModel } from "@/aiParams";
import { ModelCapability } from "@/constants";

/**
 * Determine if an Ollama endpoint is cloud-based (not local)
 */
export function isOllamaCloudEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  const url = baseUrl.toLowerCase();

  // Local endpoints
  const localIndicators = ["localhost", "127.0.0.1", "0.0.0.0"];
  if (localIndicators.some((indicator) => url.includes(indicator))) {
    return false;
  }

  return true; // Everything else is cloud
}

/**
 * Detect if a model is a GPT-OSS variant
 */
export function isGptOssModel(modelName: string): boolean {
  return modelName.toLowerCase().includes("gpt-oss");
}

/**
 * Ollama model capabilities
 */
export interface OllamaModelCapabilities {
  isCloudEndpoint: boolean;
  isGptOss: boolean;
  supportsWebSearch: boolean; // GPT-OSS + Cloud + API key
  supportsThinking: boolean;
  hasApiKey: boolean;
}

/**
 * Compute all capabilities for an Ollama model
 */
export function getOllamaModelCapabilities(model: CustomModel): OllamaModelCapabilities {
  const isCloud = isOllamaCloudEndpoint(model.baseUrl);
  const isGptOss = isGptOssModel(model.name);
  const hasKey = !!model.apiKey;

  return {
    isCloudEndpoint: isCloud,
    isGptOss,
    supportsWebSearch: isGptOss && isCloud && hasKey,
    supportsThinking: isGptOss || model.capabilities?.includes(ModelCapability.REASONING),
    hasApiKey: hasKey,
  };
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

/**
 * Validate Ollama model configuration for web search
 */
export function validateOllamaWebSearch(model: CustomModel): ValidationResult {
  const caps = getOllamaModelCapabilities(model);

  if (model.enableOllamaWebSearch) {
    if (!caps.isGptOss) {
      return { valid: false, error: "Web search only available for GPT-OSS models" };
    }
    if (!caps.isCloudEndpoint) {
      return {
        valid: false,
        error: "Web search requires Ollama Cloud. Change base URL to https://ollama.com",
      };
    }
    if (!caps.hasApiKey) {
      return {
        valid: false,
        error: "API key required. Get key at https://ollama.com/settings/keys",
      };
    }
  }

  // Context length warning
  if (caps.isGptOss && (model.maxTokens || 0) < 32000) {
    return {
      valid: true,
      warning: `GPT-OSS works best with ≥32,000 tokens. Current: ${model.maxTokens || 16000}`,
    };
  }

  return { valid: true };
}
```

### 2. Native Ollama Client

**Location**: `src/LLMProviders/NativeOllamaClient.ts` (NEW FILE)

```typescript
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
      messages: messages.map((m) => ({
        role: m._getType(),
        content: m.content,
        ...(m._getType() === "tool" ? { tool_name: (m as any).name } : {}),
      })),
      stream: true,
      think: this.thinkingLevel,
      ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
    };

    logInfo("[NativeOllamaClient] Request body", {
      hasTools: !!requestBody.tools,
      toolCount: requestBody.tools?.length,
      think: requestBody.think,
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
            logInfo("[NativeOllamaClient] Stream complete");
            break;
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
```

### 3. Web Search Tool Executors

**Location**: `src/LLMProviders/chainRunner/utils/ollamaWebSearchTools.ts` (NEW FILE)

```typescript
import { ollamaAwareFetch } from "@/LLMProviders/ollamaAwareFetch";
import { logInfo, logError } from "@/logger";
import { OllamaToolSchema } from "@/LLMProviders/NativeOllamaClient";

export const OLLAMA_WEB_SEARCH_SCHEMA: OllamaToolSchema = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the internet for current information and recent events",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find information about",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (1-10, default 5)",
          default: 5,
        },
      },
      required: ["query"],
    },
  },
};

export const OLLAMA_WEB_FETCH_SCHEMA: OllamaToolSchema = {
  type: "function",
  function: {
    name: "web_fetch",
    description: "Fetch and extract content from a specific URL",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch content from",
        },
      },
      required: ["url"],
    },
  },
};

/**
 * Execute web search via Ollama Cloud API
 */
export async function executeOllamaWebSearch(
  baseUrl: string,
  apiKey: string,
  query: string,
  maxResults: number = 5
): Promise<any> {
  logInfo("[OllamaWebSearch] Executing", { query, maxResults });

  const response = await ollamaAwareFetch(`${baseUrl}/api/web_search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(maxResults, 10),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logError("[OllamaWebSearch] API error", { status: response.status, errorText });
    throw new Error(`Web search failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  logInfo("[OllamaWebSearch] Success", { resultCount: result.results?.length });
  return result;
}

/**
 * Execute web fetch via Ollama Cloud API
 */
export async function executeOllamaWebFetch(
  baseUrl: string,
  apiKey: string,
  url: string
): Promise<any> {
  logInfo("[OllamaWebFetch] Executing", { url });

  const response = await ollamaAwareFetch(`${baseUrl}/api/web_fetch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logError("[OllamaWebFetch] API error", { status: response.status, errorText });
    throw new Error(`Web fetch failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  logInfo("[OllamaWebFetch] Success");
  return result;
}
```

### 4. Type Definitions Update

**Location**: `src/aiParams.ts`

Add to `CustomModel` interface:

```typescript
export interface CustomModel {
  // ... existing fields

  // Ollama GPT-OSS specific fields
  ollamaThinkingLevel?: "low" | "medium" | "high";
  enableOllamaWebSearch?: boolean;
}
```

### 5. LLMChainRunner Integration

**Location**: `src/LLMProviders/chainRunner/LLMChainRunner.ts`

Update the `run()` method to detect and use native client:

```typescript
async run(
  userMessage: ChatMessage,
  abortController: AbortController,
  updateCurrentAiMessage: (message: string) => void,
  addMessage: (message: ChatMessage) => void,
  options: { /* ... */ }
): Promise<string> {
  // ... existing code for streamer setup

  try {
    const messages = await this.constructMessages(userMessage);
    const chatModel = this.chainManager.chatModelManager.getChatModel();

    // Detect if we should use native Ollama client
    const settings = getSettings();
    const modelKey = getModelKey();
    const customModel = findCustomModel(modelKey, settings.activeModels);

    const shouldUseNativeOllama =
      customModel.provider === ChatModelProviders.OLLAMA &&
      isGptOssModel(customModel.name) &&
      isOllamaCloudEndpoint(customModel.baseUrl) &&
      customModel.enableOllamaWebSearch === true;

    if (shouldUseNativeOllama) {
      logInfo("[LLMChainRunner] Using NativeOllamaClient for GPT-OSS web search");

      // Create native client
      const nativeClient = new NativeOllamaClient({
        baseUrl: customModel.baseUrl!,
        apiKey: customModel.apiKey!,
        modelName: customModel.name,
        thinkingLevel: customModel.ollamaThinkingLevel
      });

      // Stream with tools
      const chatStream = nativeClient.stream(messages, {
        tools: [OLLAMA_WEB_SEARCH_SCHEMA, OLLAMA_WEB_FETCH_SCHEMA],
        signal: abortController.signal
      });

      // Process chunks through ThinkBlockStreamer
      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) break;
        streamer.processChunk(chunk);
      }

      // Check for tool calls after streaming completes
      if (streamer.hasToolCalls()) {
        await this.handleNativeOllamaToolCalls(
          nativeClient,
          messages,
          streamer,
          customModel,
          abortController,
          updateCurrentAiMessage
        );
      }
    } else {
      // Use existing LangChain ChatOllama
      logInfo("[LLMChainRunner] Using LangChain ChatOllama (standard flow)");

      const chatStream = await withSuppressedTokenWarnings(() =>
        chatModel.stream(messages, { signal: abortController.signal })
      );

      for await (const chunk of chatStream) {
        if (abortController.signal.aborted) break;
        streamer.processChunk(chunk);
      }
    }
  } catch (error) {
    // ... existing error handling
  }

  // ... rest of existing code
}

/**
 * Handle tool calls for native Ollama client (ReAct loop)
 */
private async handleNativeOllamaToolCalls(
  client: NativeOllamaClient,
  messages: BaseMessage[],
  streamer: ThinkBlockStreamer,
  customModel: CustomModel,
  abortController: AbortController,
  updateCurrentAiMessage: (message: string) => void
): Promise<void> {
  const MAX_ITERATIONS = 3;
  let iteration = 0;

  const aiMessage = streamer.buildAIMessage();
  messages.push(aiMessage);

  while (iteration < MAX_ITERATIONS && streamer.hasToolCalls()) {
    iteration++;
    logInfo(`[LLMChainRunner] Tool execution iteration ${iteration}`);

    const toolCalls = streamer.getToolCalls();

    for (const toolCall of toolCalls) {
      logInfo(`[LLMChainRunner] Executing tool: ${toolCall.name}`, toolCall.args);

      let result: any;

      if (toolCall.name === "web_search") {
        result = await executeOllamaWebSearch(
          customModel.baseUrl!,
          customModel.apiKey!,
          toolCall.args.query,
          toolCall.args.max_results
        );
      } else if (toolCall.name === "web_fetch") {
        result = await executeOllamaWebFetch(
          customModel.baseUrl!,
          customModel.apiKey!,
          toolCall.args.url
        );
      } else {
        logError(`[LLMChainRunner] Unknown tool: ${toolCall.name}`);
        result = { error: `Unknown tool: ${toolCall.name}` };
      }

      // Add tool result to messages
      messages.push(new ToolMessage({
        content: JSON.stringify(result),
        tool_call_id: toolCall.id,
        name: toolCall.name
      }));
    }

    // Re-invoke with tool results
    const newStreamer = new ThinkBlockStreamer(updateCurrentAiMessage, excludeThinking);
    const chatStream = client.stream(messages, {
      signal: abortController.signal
    });

    for await (const chunk of chatStream) {
      if (abortController.signal.aborted) break;
      newStreamer.processChunk(chunk);
    }

    // Update streamer for next iteration check
    streamer = newStreamer;

    if (streamer.hasToolCalls()) {
      const followUpMessage = streamer.buildAIMessage();
      messages.push(followUpMessage);
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    logWarn("[LLMChainRunner] Reached max tool call iterations");
  }
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure ⏳ PENDING

**Objective**: Create utility module and update type definitions

#### Task 1.1: Create Utility Module

- [ ] **File**: `src/utils/ollamaUtils.ts` (new)
- [ ] **Functions**:
  - [ ] `isOllamaCloudEndpoint(baseUrl)` - Detects cloud vs local endpoints
  - [ ] `isGptOssModel(modelName)` - Identifies GPT-OSS models
  - [ ] `getOllamaModelCapabilities(model)` - Computes all capabilities
  - [ ] `validateOllamaWebSearch(model)` - Validates web search configuration
- [ ] **Tests**: `src/utils/ollamaUtils.test.ts`
  - [ ] Test cloud detection (localhost, 127.0.0.1, external URLs)
  - [ ] Test GPT-OSS detection (case insensitive)
  - [ ] Test capability resolution
  - [ ] Test validation logic (all error/warning cases)

#### Task 1.2: Update Type Definitions

- [ ] **File**: `src/aiParams.ts`
  - [ ] Add `ollamaThinkingLevel?: "low" | "medium" | "high"` to CustomModel
  - [ ] Add `enableOllamaWebSearch?: boolean` to CustomModel
- [ ] **Validation**: Ensure no TypeScript compilation errors

**Completion Criteria**:

- All utility functions working and tested
- Type definitions updated
- No breaking changes to existing code

---

### Phase 2: Native Client Implementation ⏳ PENDING

**Objective**: Create NativeOllamaClient with streaming and tool support

#### Task 2.1: Create Client Class

- [ ] **File**: `src/LLMProviders/NativeOllamaClient.ts` (new)
- [ ] **Constructor**: Accept config with baseUrl, apiKey, modelName, thinkingLevel
- [ ] **Method**: `async *stream(messages, options): AsyncGenerator<AIMessageChunk>`
  - [ ] Use `ollamaAwareFetch` for API calls
  - [ ] Parse NDJSON streaming response
  - [ ] Yield chunks compatible with ThinkBlockStreamer
  - [ ] Handle tool_call_chunks properly
  - [ ] Support AbortSignal for cancellation
- [ ] **Method**: `async invoke(messages, options): Promise<AIMessage>`
  - [ ] Collect all chunks from stream()
  - [ ] Return complete AIMessage with tool_calls array
- [ ] **Error Handling**: Proper error messages for API failures

#### Task 2.2: Test Native Client

- [ ] **File**: `src/LLMProviders/NativeOllamaClient.test.ts` (new)
- [ ] **Tests**:
  - [ ] Test streaming with mock NDJSON responses
  - [ ] Test invoke method
  - [ ] Test tool_call_chunks accumulation
  - [ ] Test error handling (network errors, API errors)
  - [ ] Test AbortSignal cancellation

**Completion Criteria**:

- Client can stream responses from Ollama Cloud
- Chunks are compatible with ThinkBlockStreamer
- Tool calls are properly extracted
- All tests passing

---

### Phase 3: Tool Executors ⏳ PENDING

**Objective**: Implement web search and web fetch tool execution

#### Task 3.1: Create Tool Executors

- [ ] **File**: `src/LLMProviders/chainRunner/utils/ollamaWebSearchTools.ts` (new)
- [ ] **Export**: `OLLAMA_WEB_SEARCH_SCHEMA` - Tool schema for web_search
- [ ] **Export**: `OLLAMA_WEB_FETCH_SCHEMA` - Tool schema for web_fetch
- [ ] **Function**: `executeOllamaWebSearch(baseUrl, apiKey, query, maxResults)`
  - [ ] Use `ollamaAwareFetch` to call `/api/web_search`
  - [ ] Return formatted results
  - [ ] Handle errors gracefully
- [ ] **Function**: `executeOllamaWebFetch(baseUrl, apiKey, url)`
  - [ ] Use `ollamaAwareFetch` to call `/api/web_fetch`
  - [ ] Return formatted content
  - [ ] Handle errors gracefully

#### Task 3.2: Test Tool Executors

- [ ] **File**: `src/LLMProviders/chainRunner/utils/ollamaWebSearchTools.test.ts` (new)
- [ ] **Tests**:
  - [ ] Test web_search with mock responses
  - [ ] Test web_fetch with mock responses
  - [ ] Test error handling
  - [ ] Test maxResults clamping (max 10)

**Completion Criteria**:

- Tool schemas match Ollama documentation
- Executors can call Ollama Cloud APIs
- Error handling is robust
- All tests passing

---

### Phase 4: LLMChainRunner Integration ⏳ PENDING

**Objective**: Integrate native client into LLMChainRunner with conditional logic

#### Task 4.1: Add Detection Logic

- [ ] **File**: `src/LLMProviders/chainRunner/LLMChainRunner.ts`
- [ ] **Import**: `NativeOllamaClient`, tool executors, ollamaUtils
- [ ] **Before streaming**: Add detection logic
  - [ ] Check if provider is OLLAMA
  - [ ] Check if model is GPT-OSS (`isGptOssModel()`)
  - [ ] Check if endpoint is cloud (`isOllamaCloudEndpoint()`)
  - [ ] Check if web search is enabled
  - [ ] Set `shouldUseNativeOllama` flag

#### Task 4.2: Implement Native Client Flow

- [ ] **If shouldUseNativeOllama**:
  - [ ] Create NativeOllamaClient instance
  - [ ] Call `client.stream()` with tool schemas
  - [ ] Process chunks through ThinkBlockStreamer (existing)
  - [ ] Check `streamer.hasToolCalls()` after streaming
  - [ ] If has tool calls, execute tool loop (new method)
- [ ] **Else**:
  - [ ] Use existing LangChain ChatOllama flow (no changes)

#### Task 4.3: Implement Tool Loop

- [ ] **New method**: `handleNativeOllamaToolCalls()`
  - [ ] Extract tool calls from streamer
  - [ ] For each tool call:
    - [ ] Execute web_search or web_fetch
    - [ ] Add ToolMessage to messages array
  - [ ] Re-invoke client.stream() with tool results
  - [ ] Process response through new ThinkBlockStreamer
  - [ ] Repeat until no more tool calls (max 3 iterations)

#### Task 4.4: Preserve Response Metadata

- [ ] Store thinking level in ResponseMetadata
- [ ] Maintain compatibility with existing message structure
- [ ] Ensure ThinkingBadge displays correctly

**Completion Criteria**:

- Detection logic correctly routes to native client
- Existing Ollama models (non-GPT-OSS) unaffected
- Tool loop executes web search correctly
- Streaming and thinking display work properly
- All existing tests still pass

---

### Phase 5: Testing & Validation ⏳ PENDING

**Objective**: Comprehensive testing of native implementation

#### Task 5.1: Unit Tests

- [ ] Verify all new modules have tests
- [ ] Run full test suite: `npm test`
- [ ] Ensure no regressions in existing tests
- [ ] Code coverage > 80% for new code

#### Task 5.2: Integration Tests

- [ ] **File**: `src/integration_tests/ollama_gpt_oss_native.test.ts` (new)
- [ ] **Tests** (requires OLLAMA_API_KEY):
  - [ ] Configure GPT-OSS model correctly
  - [ ] Stream responses from Ollama Cloud
  - [ ] Execute web search and get real results
  - [ ] Test different thinking levels (low, medium, high)
  - [ ] Test tool loop with multiple iterations
  - [ ] Test error scenarios (invalid API key, network errors)

#### Task 5.3: Manual Testing

- [ ] **Local Ollama**:

  - [ ] Start local Ollama: `ollama serve`
  - [ ] Add model: `llama3.2:3b` with `http://localhost:11434`
  - [ ] Verify: Uses LangChain (existing flow)
  - [ ] Test: Basic chat works normally

- [ ] **Ollama Cloud (non-GPT-OSS)**:

  - [ ] Add model: `llama3.2:3b` with cloud endpoint
  - [ ] Verify: Uses LangChain (existing flow)
  - [ ] Test: Basic chat works normally

- [ ] **Ollama Cloud (GPT-OSS without web search)**:

  - [ ] Add model: `gpt-oss:120b-cloud`, web search disabled
  - [ ] Verify: Uses LangChain
  - [ ] Test: Thinking works, no web search

- [ ] **Ollama Cloud (GPT-OSS with web search)** ⭐:
  - [ ] Add model: `gpt-oss:120b-cloud` with `enableOllamaWebSearch: true`
  - [ ] Add API key from https://ollama.com/settings/keys
  - [ ] Set thinking level to "medium"
  - [ ] Set maxTokens to 32000
  - [ ] Test query: "What's the latest news on AI in 2026?"
  - [ ] Verify: Uses NativeOllamaClient (check logs)
  - [ ] Verify: Model performs web search automatically
  - [ ] Verify: Response includes real current information
  - [ ] Verify: Thinking badge displays correct level
  - [ ] Verify: No errors in console

#### Task 5.4: Performance Testing

- [ ] Measure response time vs LangChain (should be similar)
- [ ] Test with large tool result payloads
- [ ] Test streaming latency
- [ ] Test memory usage

**Completion Criteria**:

- All tests passing
- Manual testing confirms web search works
- No regressions in existing functionality
- Performance is acceptable

---

### Phase 6: Documentation & Cleanup (Optional) ⏸️ DEFERRED

**Objective**: Polish and prepare for production

#### Task 6.1: Code Documentation

- [ ] Add JSDoc comments to all public functions
- [ ] Update AGENTS.md with native client architecture
- [ ] Document debugging tips (how to verify native client is used)

#### Task 6.2: User Documentation

- [ ] Update README with GPT-OSS web search instructions
- [ ] Add troubleshooting section for common errors
- [ ] Document API key setup process

#### Task 6.3: UI Enhancements (Optional)

- [ ] Update ModelEditDialog with cloud detection banner
- [ ] Add web search toggle (conditional on GPT-OSS + cloud + API key)
- [ ] Add thinking level selector (Low/Medium/High)
- [ ] Add context length warning (< 32K)
- [ ] Add "Set to 32,000" quick fix button

**Completion Criteria**:

- Documentation is complete and accurate
- UI is polished (if implemented)
- Ready for user testing

---

## Code Examples

### Example 1: Using NativeOllamaClient Directly

```typescript
import { NativeOllamaClient } from "@/LLMProviders/NativeOllamaClient";
import {
  OLLAMA_WEB_SEARCH_SCHEMA,
  OLLAMA_WEB_FETCH_SCHEMA,
} from "@/LLMProviders/chainRunner/utils/ollamaWebSearchTools";
import { HumanMessage } from "@langchain/core/messages";

// Create client
const client = new NativeOllamaClient({
  baseUrl: "https://ollama.com",
  apiKey: "ollm_abc123...",
  modelName: "gpt-oss:120b-cloud",
  thinkingLevel: "medium",
});

// Stream with tools
const messages = [new HumanMessage("What's the latest AI news?")];

for await (const chunk of client.stream(messages, {
  tools: [OLLAMA_WEB_SEARCH_SCHEMA, OLLAMA_WEB_FETCH_SCHEMA],
})) {
  console.log(chunk.content);
  // chunk.additional_kwargs.thinking contains thinking blocks
  // chunk.tool_call_chunks contains incremental tool calls
}
```

### Example 2: Tool Execution Flow

```typescript
import { executeOllamaWebSearch } from "@/LLMProviders/chainRunner/utils/ollamaWebSearchTools";

// After detecting tool call from streamer
const toolCalls = streamer.getToolCalls();

for (const toolCall of toolCalls) {
  if (toolCall.name === "web_search") {
    const result = await executeOllamaWebSearch(
      "https://ollama.com",
      "ollm_abc123...",
      toolCall.args.query,
      toolCall.args.max_results || 5
    );

    console.log("Search results:", result.results);
    // result.results = [{ title, url, content }, ...]

    // Add to messages for next model call
    messages.push(
      new ToolMessage({
        content: JSON.stringify(result),
        tool_call_id: toolCall.id,
        name: "web_search",
      })
    );
  }
}
```

### Example 3: Detection Logic in LLMChainRunner

```typescript
// In LLMChainRunner.run()
const settings = getSettings();
const modelKey = getModelKey();
const customModel = findCustomModel(modelKey, settings.activeModels);

// Detection logic
const shouldUseNativeOllama =
  customModel.provider === ChatModelProviders.OLLAMA &&
  isGptOssModel(customModel.name) &&
  isOllamaCloudEndpoint(customModel.baseUrl) &&
  customModel.enableOllamaWebSearch === true;

if (shouldUseNativeOllama) {
  logInfo("[LLMChainRunner] Using NativeOllamaClient");
  // Native client flow...
} else {
  logInfo("[LLMChainRunner] Using LangChain ChatOllama");
  // Existing LangChain flow...
}
```

### Example 4: Model Configuration

```typescript
// In data.json or settings
{
  "name": "gpt-oss:120b-cloud",
  "provider": "ollama",
  "baseUrl": "https://ollama.com",  // Cloud endpoint
  "apiKey": "ollm_abc123...",       // API key from ollama.com
  "enabled": true,
  "maxTokens": 32000,               // Recommended for GPT-OSS

  // GPT-OSS specific
  "ollamaThinkingLevel": "medium",  // "low" | "medium" | "high"
  "enableOllamaWebSearch": true,    // Triggers native client

  // Capabilities
  "capabilities": ["websearch", "reasoning"]
}
```

---

## Testing Strategy

### Unit Tests

**File**: `src/utils/ollamaUtils.test.ts`

```typescript
describe("ollamaUtils", () => {
  test("isOllamaCloudEndpoint", () => {
    expect(isOllamaCloudEndpoint("http://localhost:11434")).toBe(false);
    expect(isOllamaCloudEndpoint("http://127.0.0.1:11434")).toBe(false);
    expect(isOllamaCloudEndpoint("https://ollama.com")).toBe(true);
    expect(isOllamaCloudEndpoint("http://192.168.1.100:11434")).toBe(true);
  });

  test("isGptOssModel", () => {
    expect(isGptOssModel("gpt-oss:120b-cloud")).toBe(true);
    expect(isGptOssModel("GPT-OSS:4B")).toBe(true);
    expect(isGptOssModel("llama3.2:3b")).toBe(false);
  });

  test("validateOllamaWebSearch", () => {
    const model: CustomModel = {
      name: "gpt-oss:120b",
      provider: "ollama",
      baseUrl: "https://ollama.com",
      apiKey: "test-key",
      enableOllamaWebSearch: true,
      maxTokens: 32000,
      enabled: true,
    };

    const result = validateOllamaWebSearch(model);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
```

### Integration Tests

**File**: `src/integration_tests/ollama_gpt_oss_native.test.ts`

```typescript
describe("Native Ollama GPT-OSS Integration", () => {
  const apiKey = process.env.OLLAMA_API_KEY;

  beforeAll(() => {
    if (!apiKey) {
      console.warn("Skipping: OLLAMA_API_KEY not set");
    }
  });

  test("stream with tools", async () => {
    if (!apiKey) return;

    const client = new NativeOllamaClient({
      baseUrl: "https://ollama.com",
      apiKey,
      modelName: "gpt-oss:4b",
      thinkingLevel: "medium",
    });

    const messages = [new HumanMessage("What is Ollama?")];
    let hasContent = false;

    for await (const chunk of client.stream(messages, {
      tools: [OLLAMA_WEB_SEARCH_SCHEMA],
    })) {
      if (chunk.content) hasContent = true;
    }

    expect(hasContent).toBe(true);
  });
});
```

### Manual Testing Checklist

```
☐ Phase 1: Core Infrastructure
  ☐ ollamaUtils functions work correctly
  ☐ Type definitions compile without errors
  ☐ All unit tests pass

☐ Phase 2: Native Client
  ☐ Client can stream from Ollama Cloud
  ☐ Chunks are compatible with ThinkBlockStreamer
  ☐ Tool calls are extracted properly
  ☐ Error handling works

☐ Phase 3: Tool Executors
  ☐ web_search executes successfully
  ☐ web_fetch executes successfully
  ☐ Results are formatted correctly

☐ Phase 4: LLMChainRunner Integration
  ☐ Detection logic correctly identifies GPT-OSS + cloud + web search
  ☐ Native client is used when conditions met
  ☐ LangChain is used for all other cases
  ☐ Tool loop executes correctly (max 3 iterations)
  ☐ No regressions in existing Ollama functionality

☐ Phase 5: End-to-End Testing
  ☐ Local Ollama: Works normally (uses LangChain)
  ☐ Cloud Ollama (non-GPT-OSS): Works normally (uses LangChain)
  ☐ GPT-OSS without web search: Works normally (uses LangChain)
  ☐ GPT-OSS with web search:
    ☐ Uses NativeOllamaClient (verify logs)
    ☐ Performs web search automatically
    ☐ Returns current information
    ☐ Thinking badge displays
    ☐ No errors in console
```

---

## Migration & Compatibility

### Backward Compatibility

**Existing Ollama Models**: ✅ No breaking changes

- Local Ollama models work exactly as before
- Non-GPT-OSS cloud models work as before
- No API key required for local instances

**New Behavior**: Only activated when ALL conditions are met:

1. Provider is Ollama
2. Model is GPT-OSS (contains "gpt-oss" in name)
3. Endpoint is cloud (not localhost/127.0.0.1)
4. Web search is enabled (`enableOllamaWebSearch: true`)

**Fallback**: If any condition is false, uses existing LangChain ChatOllama.

### Migration Path

```typescript
// Before (existing model config)
{
  "name": "llama3.2:3b",
  "provider": "ollama",
  "baseUrl": "http://localhost:11434",
  "enabled": true
}

// After (no changes needed - continues to work)
{
  "name": "llama3.2:3b",
  "provider": "ollama",
  "baseUrl": "http://localhost:11434",
  "enabled": true
  // New fields are optional and default to false/undefined
  // ollamaThinkingLevel: undefined
  // enableOllamaWebSearch: undefined
}
```

### Upgrading to GPT-OSS with Web Search

```typescript
// Add new GPT-OSS model config
{
  "name": "gpt-oss:120b-cloud",
  "provider": "ollama",
  "baseUrl": "https://ollama.com",      // Cloud endpoint
  "apiKey": "ollm_abc123...",           // From ollama.com/settings/keys
  "enabled": true,
  "maxTokens": 32000,                   // Recommended

  // NEW: Enable native client features
  "ollamaThinkingLevel": "medium",      // "low" | "medium" | "high"
  "enableOllamaWebSearch": true,        // Triggers native client

  "capabilities": ["websearch", "reasoning"]
}
```

---

## References

### Official Documentation

1. **Ollama Cloud API**: https://docs.ollama.com/cloud

   - Chat endpoint with streaming
   - Authentication format

2. **Ollama Web Search**: https://docs.ollama.com/capabilities/web-search

   - `/api/web_search` endpoint
   - `/api/web_fetch` endpoint
   - Tool schema format

3. **Ollama Thinking**: https://docs.ollama.com/capabilities/thinking

   - GPT-OSS thinking levels
   - Streaming response format
   - Context length recommendations

4. **Ollama JavaScript SDK**: https://github.com/ollama/ollama-js
   - Example implementations
   - Tool calling patterns

### Internal Documentation

1. **AGENTS.md**: Plugin architecture and coding guidelines
2. **MESSAGE_ARCHITECTURE.md**: Message state management
3. **OLLAMA_GPT_OSS_DEBUG_SESSION.md**: LangChain bug investigation
4. **NATIVE_TOOL_CALLING_MIGRATION.md**: Tool calling patterns

### Related Code

1. **ollamaAwareFetch.ts** (Line 36-127): CORS bypass and thinking transformation
2. **ThinkBlockStreamer.ts** (Line 205-330): Chunk processing and tool accumulation
3. **AutonomousAgentChainRunner.ts** (Line 610-805): ReAct loop pattern
4. **toolExecution.ts** (Line 29-130): Tool execution utilities

---

## Decision Log

| Date       | Decision                                 | Rationale                                                        |
| ---------- | ---------------------------------------- | ---------------------------------------------------------------- |
| 2026-02-10 | Use Option A (Native Tool Calling)       | Ollama Cloud executes searches server-side                       |
| 2026-02-10 | Discovered LangChain bug                 | `.bindTools()` makes duplicate API calls, discards tools         |
| 2026-02-11 | **PIVOT to Native Implementation**       | LangChain bug blocks web search, must bypass entirely            |
| 2026-02-11 | Use `ollamaAwareFetch` for network       | Proven CORS bypass, thinking transformation included             |
| 2026-02-11 | Conditional activation only              | Only use native client when GPT-OSS + cloud + web search enabled |
| 2026-02-11 | Implement client-side tool loop          | ReAct pattern similar to AutonomousAgentChainRunner              |
| 2026-02-11 | Store thinking level in ResponseMetadata | Reuse existing metadata structure                                |
| 2026-02-11 | Phase-based implementation plan          | 5 phases with clear objectives and completion criteria           |

---

## Next Steps

1. ⏳ **Phase 1**: Create utility module and update type definitions
2. ⏳ **Phase 2**: Implement NativeOllamaClient with streaming support
3. ⏳ **Phase 3**: Create web search tool executors
4. ⏳ **Phase 4**: Integrate native client into LLMChainRunner
5. ⏳ **Phase 5**: Comprehensive testing and validation
6. ⏸️ **Phase 6** (Optional): Documentation and UI enhancements

**Current Status**: Ready to begin Phase 1 implementation

---

**Last Updated**: February 11, 2026
**Version**: 2.0
**Status**: ⚠️ REVISED PLAN - Native Implementation (All Phases Pending)
**Architecture**: Native HTTP client bypassing LangChain for GPT-OSS web search
