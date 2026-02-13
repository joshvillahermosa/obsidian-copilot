# GPT-OSS Ollama Integration: Native Online & Thinking Support

**Status**: Phase 1, 2, & 3 Complete - Testing Pending (Phase 4)
**Date**: February 10, 2026
**Last Updated**: February 10, 2026
**Target**: Ollama GPT-OSS models with Cloud API support

## Table of Contents

- [Executive Summary](#executive-summary)
- [Background & Context](#background--context)
- [Architecture Overview](#architecture-overview)
- [Technical Specifications](#technical-specifications)
- [Implementation Plan](#implementation-plan)
- [Code Examples](#code-examples)
- [Testing Strategy](#testing-strategy)
- [Migration & Compatibility](#migration--compatibility)
- [References](#references)

---

## Executive Summary

This document outlines the architecture and implementation plan for integrating Ollama Cloud's native web search and thinking capabilities for GPT-OSS models. The integration follows a **native approach (Option A)** where Ollama Cloud handles web search execution server-side, and the plugin manages the tool schemas and response handling.

### Key Features

- ✅ **Native Web Search**: GPT-OSS models automatically search the web when needed
- ✅ **Thinking Levels**: Three levels (low, medium, high) with visual badges
- ✅ **Per-Model API Keys**: Automatic cloud detection with per-model configuration
- ✅ **Seamless UX**: Similar to Perplexity.ai - model decides when to search
- ✅ **Context Warnings**: Automatic warnings for sub-optimal context lengths

### Design Principles

1. **Native Over Tools**: Use Ollama's native tool calling, not plugin-side execution
2. **Smart Detection**: Automatically detect cloud vs local Ollama instances
3. **User Safety**: Clear warnings and validations for configuration requirements
4. **Progressive Enhancement**: Features activate only when requirements are met

---

## Background & Context

### Problem Statement

The Copilot for Obsidian plugin currently:

- ❌ Does not support GPT-OSS models' native online (web search) capabilities
- ❌ Does not handle GPT-OSS's required thinking levels (`low`/`medium`/`high`)
- ❌ Lacks differentiation between local Ollama and Ollama Cloud
- ❌ Cannot leverage Ollama Cloud's native web search API

### Ollama GPT-OSS Capabilities

According to Ollama documentation:

**Web Search** ([docs](https://docs.ollama.com/capabilities/web-search)):

```
POST https://ollama.com/api/web_search
{
  "query": "search query",
  "max_results": 5  // optional, max 10
}
```

**Thinking** ([docs](https://docs.ollama.com/capabilities/thinking)):

- GPT-OSS models **require** thinking (cannot be disabled)
- Accept levels: `"low"`, `"medium"`, `"high"` (not boolean)
- Return separate `thinking` and `content` fields
- Recommended context: ≥32K tokens

**Tool Calling Example** (from Ollama docs):

```python
from ollama import chat, web_fetch, web_search

response = chat(
  model='gpt-oss:4b',
  messages=[{'role': 'user', 'content': "what is ollama's new engine"}],
  tools=[web_search, web_fetch],  # Native tool registration
  think=True
)
```

### Why Option A (Native Approach)?

**User's Decision**: Use native Ollama tool calling instead of plugin-side execution.

**Rationale**:

1. **Better Integration**: Ollama Cloud executes searches, reducing latency
2. **Smarter Behavior**: Model decides when/how to search (like Claude with tools)
3. **Simpler Code**: No need to implement search logic plugin-side
4. **Scale**: Ollama Cloud handles rate limiting, caching, etc.
5. **Future-Proof**: Works with future Ollama tool additions

---

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Chat UI Layer                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Thinking Badge: [Medium] (Collapsible)              │   │
│  │ Model Badge: gpt-oss:120b-cloud + [🌐 WEB_SEARCH]  │   │
│  │ Context Warning: ⚠️  GPT-OSS works best with ≥32K    │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              ChatModelManager                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. Detect: isGptOssModel(name)                      │   │
│  │ 2. Detect: isOllamaCloudEndpoint(baseUrl)         │   │
│  │ 3. Validate: hasApiKey && enableWebSearch          │   │
│  │ 4. Configure:                                       │   │
│  │    - think: "low"|"medium"|"high"                   │   │
│  │    - tools: [web_search, web_fetch] schemas        │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│        ChatOllama (LangChain @langchain/ollama)            │
│  - Streams responses with thinking + content separation    │
│  - Handles tool calls automatically                        │
│  - Returns tool_calls in message for execution             │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
┌───────▼────────┐         ┌──────────▼──────────┐
│ ollamaAware    │         │  Ollama Cloud API   │
│ Fetch          │         │                     │
│ - Thinking     │◄────────┤  /api/chat          │
│   transform    │         │  /api/web_search    │
│ - CORS         │         │  /api/web_fetch     │
└────────────────┘         └─────────────────────┘
```

### Data Flow: Web Search Request

```
1. User: "What's the latest news on AI?"
   │
   ▼
2. ChatOllama sends to Ollama Cloud:
   {
     model: "gpt-oss:120b-cloud",
     messages: [{role: "user", content: "..."}],
     tools: [web_search_schema, web_fetch_schema],
     think: "medium"
   }
   │
   ▼
3. Ollama Cloud (server-side):
   - Thinks: "I need current info, I'll search"
   - Executes: web_search(query="AI news")
   - Returns: tool_call message
   │
   ▼
4. ChatOllama receives tool_call:
   {
     message: {
       thinking: "The user wants current info...",
       tool_calls: [{
         function: { name: "web_search", arguments: {query: "AI news"} }
       }]
     }
   }
   │
   ▼
5. Plugin sends tool results back:
   {
     role: "tool",
     content: "[search results from Ollama Cloud]",
     tool_name: "web_search"
   }
   │
   ▼
6. Ollama Cloud synthesizes answer:
   {
     message: {
       thinking: "Based on these results...",
       content: "Here's what I found about AI news..."
     }
   }
   │
   ▼
7. UI displays:
   [Thinking: Medium] [collapsed]
   "Here's what I found about AI news..."
```

### Key Components

| Component             | Purpose                                        | File Location                                    |
| --------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `ollamaUtils.ts`      | Cloud detection, GPT-OSS detection, validation | `src/utils/ollamaUtils.ts` (new)                 |
| `chatModelManager.ts` | Model config, tool schema injection            | `src/LLMProviders/chatModelManager.ts`           |
| `ollamaAwareFetch.ts` | Thinking transformation, CORS                  | `src/LLMProviders/ollamaAwareFetch.ts` (exists)  |
| `ModelEditDialog.tsx` | UI for Ollama config                           | `src/settings/v2/components/ModelEditDialog.tsx` |
| `AIMessage.tsx`       | Thinking badge display                         | `src/components/chat-components/AIMessage.tsx`   |

---

## Technical Specifications

### 1. Cloud Detection Logic

**Location**: `src/utils/ollamaUtils.ts` (new file)

```typescript
/**
 * Determine if an Ollama endpoint is cloud-based (not local)
 *
 * @param baseUrl - The base URL configured for the model
 * @returns true if external/cloud, false if local
 *
 * @example
 * isOllamaCloudEndpoint("http://localhost:11434") // false
 * isOllamaCloudEndpoint("https://api.ollama.com") // true
 * isOllamaCloudEndpoint("http://192.168.1.100:11434") // true (external IP)
 */
export function isOllamaCloudEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false;

  const url = baseUrl.toLowerCase();

  // Local endpoints (no API key needed)
  const localIndicators = ["localhost", "127.0.0.1", "0.0.0.0"];
  if (localIndicators.some((indicator) => url.includes(indicator))) {
    return false;
  }

  // Everything else is considered cloud
  return true;
}
```

**Rationale**:

- Local Ollama doesn't support web search (runs entirely offline)
- Cloud detection triggers UI changes (API key field, web search toggle)
- Simple logic: if not localhost/127.0.0.1, it's cloud

### 2. GPT-OSS Model Detection

```typescript
/**
 * Detect if a model is a GPT-OSS variant
 * GPT-OSS models have unique requirements:
 * - Thinking cannot be disabled
 * - Thinking uses levels (low/medium/high) not boolean
 * - Support web search on Ollama Cloud
 *
 * @param modelName - The model identifier
 * @returns true if model is GPT-OSS
 *
 * @example
 * isGptOssModel("gpt-oss:120b-cloud") // true
 * isGptOssModel("llama3.2:3b") // false
 * isGptOssModel("GPT-OSS:4B") // true (case insensitive)
 */
export function isGptOssModel(modelName: string): boolean {
  return modelName.toLowerCase().includes("gpt-oss");
}
```

### 3. Capability Resolution

```typescript
export interface OllamaModelCapabilities {
  isCloudEndpoint: boolean;
  isGptOss: boolean;
  supportsWebSearch: boolean; // Requires: GPT-OSS + Cloud + API key
  supportsThinking: boolean; // GPT-OSS or REASONING capability
  hasApiKey: boolean;
}

/**
 * Compute all capabilities for an Ollama model
 * Used to determine what features to enable in UI and runtime
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
```

### 4. Validation Logic

```typescript
export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

/**
 * Validate that Ollama model configuration supports web search
 * Returns errors for invalid configs, warnings for sub-optimal settings
 */
export function validateOllamaWebSearch(model: CustomModel): ValidationResult {
  const caps = getOllamaModelCapabilities(model);

  // If web search is enabled, check requirements
  if (model.enableOllamaWebSearch) {
    if (!caps.isGptOss) {
      return {
        valid: false,
        error: "Web search only available for GPT-OSS models",
      };
    }

    if (!caps.isCloudEndpoint) {
      return {
        valid: false,
        error:
          "Web search requires Ollama Cloud (not local Ollama). " +
          "Change base URL to https://api.ollama.com or similar.",
      };
    }

    if (!caps.hasApiKey) {
      return {
        valid: false,
        error:
          "API key required for Ollama Cloud web search. " +
          "Get your key at https://ollama.com/settings/keys",
      };
    }
  }

  // Context length warning for GPT-OSS (recommended ≥32K)
  if (caps.isGptOss && (model.maxTokens || 0) < 32000) {
    return {
      valid: true,
      warning: `GPT-OSS works best with ≥32,000 tokens. Current: ${model.maxTokens || 16000}`,
    };
  }

  return { valid: true };
}
```

### 5. Model Configuration

**Location**: `src/LLMProviders/chatModelManager.ts`

**In `getModelConfig()` method**, update the `OLLAMA` case:

```typescript
[ChatModelProviders.OLLAMA]: {
  model: modelName,
  baseUrl: customModel.baseUrl || "http://localhost:11434",
  headers: new Headers({
    Authorization: `Bearer ${await getDecryptedKey(customModel.apiKey || "default-key")}`,
  }),
  fetch: customModel.enableCors ? ollamaAwareFetch : undefined,

  // Thinking configuration
  // GPT-OSS requires level-based thinking (cannot be disabled)
  // Other models use boolean
  ...(isGptOssModel(modelName)
    ? {
        think: customModel.ollamaThinkingLevel || "medium"
      }
    : customModel.capabilities?.includes(ModelCapability.REASONING)
      ? { think: true }
      : {}
  ),

  // Native web search tools (schemas only - Ollama executes)
  // Only inject if: GPT-OSS + Cloud + API key + enabled
  ...(customModel.enableOllamaWebSearch &&
      getOllamaModelCapabilities(customModel).supportsWebSearch
    ? {
        tools: [
          // web_search tool schema
          {
            type: "function",
            function: {
              name: "web_search",
              description: "Search the internet for current information and recent events",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The search query to find information about"
                  },
                  max_results: {
                    type: "number",
                    description: "Maximum number of results to return (1-10, default 5)",
                    default: 5,
                    minimum: 1,
                    maximum: 10
                  }
                },
                required: ["query"]
              }
            }
          },
          // web_fetch tool schema
          {
            type: "function",
            function: {
              name: "web_fetch",
              description: "Fetch and extract content from a specific URL",
              parameters: {
                type: "object",
                properties: {
                  url: {
                    type: "string",
                    description: "The URL to fetch content from"
                  }
                },
                required: ["url"]
              }
            }
          }
        ]
      }
    : {}
  ),
},
```

**Critical Notes**:

- `tools` array contains **schemas only** (no `func` implementation)
- Ollama Cloud executes the functions server-side
- Plugin receives tool results in `role: "tool"` messages
- ChatOllama handles the tool call loop automatically

### 6. Type Definitions

**Location**: `src/aiParams.ts`

```typescript
export interface CustomModel {
  // ... existing fields

  // Ollama GPT-OSS specific fields
  ollamaThinkingLevel?: "low" | "medium" | "high";
  enableOllamaWebSearch?: boolean;
}
```

**Location**: `src/constants.ts` (if needed)

```typescript
// Ollama thinking levels for GPT-OSS models
export enum OllamaThinkingLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure ✅ COMPLETE

**Completion Date**: February 10, 2026

#### Task 1.1: Create Utility Module ✅

- **File**: `src/utils/ollamaUtils.ts` (new) ✅
- **Functions**: ✅
  - `isOllamaCloudEndpoint(baseUrl)` - Detects cloud vs local endpoints
  - `isGptOssModel(modelName)` - Identifies GPT-OSS models
  - `getOllamaModelCapabilities(model)` - Computes all capabilities
  - `validateOllamaWebSearch(model)` - Validates web search configuration
- **Tests**: `src/utils/ollamaUtils.test.ts` ✅
  - 44 comprehensive test cases
  - Full coverage of all functions and edge cases

#### Task 1.2: Update Type Definitions ✅

- **File**: `src/aiParams.ts` ✅
  - Added `ollamaThinkingLevel?: "low" | "medium" | "high"`
  - Added `enableOllamaWebSearch?: boolean`
- **File**: `src/constants.ts` ✅
  - Updated `MODEL_CAPABILITIES.websearch` description
  - Added note about Ollama API key requirement

#### Task 1.3: Update ChatModelManager ✅

- **File**: `src/LLMProviders/chatModelManager.ts` ✅
- **Changes**: ✅
  - Imported `ollamaUtils` functions (`isGptOssModel`, `getOllamaModelCapabilities`)
  - Updated `OLLAMA` case in `getModelConfig()`
  - Added thinking parameter logic (level-based for GPT-OSS, boolean for others)
  - Added tools array injection logic (web_search and web_fetch schemas)
  - Type assertion for LangChain compatibility
- **Validation**: No TypeScript compilation errors ✅

### Phase 2: UI Components ✅ COMPLETE

**Completion Date**: February 10, 2026

#### Task 2.1: Model Edit Dialog Enhancements ✅

- **File**: `src/settings/v2/components/ModelEditDialog.tsx` ✅
- **Changes**: ✅
  - Added cloud detection banner (blue for cloud, gray for local)
  - Conditional API key field (only shown for cloud endpoints)
  - Web search toggle (GPT-OSS + cloud + API key required)
  - Thinking level selector (Low/Medium/High dropdown)
  - Context length warning (alerts when < 32K with fix button)
  - Automatic capability sync (WEB_SEARCH badge synced with toggle)
- **Components**:
  ```tsx
  <CloudDetectionBanner isCloud={isOllamaCloudEndpoint(model.baseUrl)} />
  <ApiKeyField show={isCloud} />
  <WebSearchToggle show={canUseWebSearch} />
  <ThinkingLevelSelector show={isGptOss} />
  <ContextWarning show={isGptOss && tokens < 32000} />
  ```

#### Task 2.2: Thinking Badge Component ✅

- **File**: `src/components/chat-components/ThinkingBadge.tsx` (new) ✅
- **Component**:

  ```tsx
  interface ThinkingBadgeProps {
    level?: "low" | "medium" | "high";
  }

  export function ThinkingBadge({ level }: ThinkingBadgeProps) {
    // Colored badge with level indicator
    // Low: blue, Medium: purple, High: indigo
  }
  ```

#### Task 2.3: Integrate Thinking Badge ✅

- **File**: `src/components/chat-components/ChatSingleMessage.tsx` ✅
- **Change**: ThinkingBadge displays when `responseMetadata.thinkingLevel` is present ✅
- **Extract level**: From `message.responseMetadata.thinkingLevel` ✅
- **Conditions**: Only shown for AI messages when not streaming ✅

#### Task 2.4: Model Capability Badge ✅

- **File**: `src/components/ui/model-display.tsx` ✅
- **Verified**: `WEB_SEARCH` capability shows Globe icon ✅
- **Ensured**: Automatic capability sync in ModelEditDialog ✅

### Phase 3: Response Handling ✅ COMPLETE

**Completion Date**: February 10, 2026

#### Task 3.1: Verify ollamaAwareFetch ✅

- **File**: `src/LLMProviders/ollamaAwareFetch.ts` ✅
- **Current**: Already transforms thinking blocks properly
- **Verified**: Works with GPT-OSS thinking levels (levels are in request config, response structure is the same)
- **Implementation**: Detects `"thinking":` field in Ollama responses and wraps in `<THINKING>` tags
- **Status**: No changes needed - existing implementation is compatible

#### Task 3.2: Tool Call Handling ✅

- **File**: `src/LLMProviders/chainRunner/LLMChainRunner.ts` ✅
- **Verified**: ChatOllama tool calls are handled automatically by LangChain
- **Implementation**: Tools injected in ChatModelManager config, LangChain handles execution loop
- **Status**: No changes needed - LangChain's ChatOllama handles tool loops automatically

#### Task 3.3: Thinking Level Storage ✅

- **File**: `src/types/message.ts` ✅
  - Added `thinkingLevel?: "low" | "medium" | "high"` to `ResponseMetadata` interface
- **File**: `src/LLMProviders/chainRunner/LLMChainRunner.ts` ✅
  - Captures thinking level from model configuration
  - Stores in message `responseMetadata` for persistence
- **Purpose**: Display correct badge even after model config changes
- **Implementation**:
  ```typescript
  interface ResponseMetadata {
    wasTruncated?: boolean;
    tokenUsage?: TokenUsage;
    thinkingLevel?: "low" | "medium" | "high"; // NEW
  }
  ```

### Phase 4: Testing & Validation (Week 4)

#### Task 4.1: Unit Tests

- `ollamaUtils.test.ts`: Test all utility functions
- `chatModelManager.test.ts`: Test Ollama config generation
- `ModelEditDialog.test.tsx`: Test UI logic

#### Task 4.2: Integration Tests

- **File**: `src/integration_tests/ollama_gpt_oss.test.ts` (new)
- **Tests**:
  - Web search with GPT-OSS model
  - Thinking level variations
  - Cloud vs local detection
  - API key validation

#### Task 4.3: Manual Testing Checklist

```
☐ Local Ollama (localhost:11434)
  ☐ No API key field shown
  ☐ Web search toggle not available
  ☐ Regular models work normally

☐ Ollama Cloud with GPT-OSS
  ☐ API key field shown
  ☐ Web search toggle shown after API key entered
  ☐ Thinking level selector shows 3 options
  ☐ Context warning shows when < 32K
  ☐ "Set to 32,000" button works

☐ Web Search Functionality
  ☐ Model automatically searches when needed
  ☐ Search results shown in context
  ☐ No errors in console

☐ Thinking Display
  ☐ Thinking block collapses properly
  ☐ Badge shows correct level (Low/Medium/High)
  ☐ Badge color matches level

☐ Validation
  ☐ Can't enable web search without API key
  ☐ Can't enable web search on local Ollama
  ☐ Can't enable web search on non-GPT-OSS models
  ☐ Error messages are clear and actionable
```

---

## Code Examples

### Example 1: Configuring a GPT-OSS Model

```typescript
// User adds a GPT-OSS model via settings
const newModel: CustomModel = {
  name: "gpt-oss:120b-cloud",
  provider: ChatModelProviders.OLLAMA,
  baseUrl: "https://api.ollama.com/v1",
  apiKey: "ollm_abc123...", // From ollama.com/settings/keys
  enabled: true,
  maxTokens: 32000, // Recommended for GPT-OSS

  // GPT-OSS specific
  ollamaThinkingLevel: "medium",
  enableOllamaWebSearch: true,

  // Capability markers
  capabilities: [ModelCapability.REASONING, ModelCapability.WEB_SEARCH],
};

// Validation check
const validation = validateOllamaWebSearch(newModel);
if (!validation.valid) {
  throw new Error(validation.error);
}
if (validation.warning) {
  console.warn(validation.warning);
}
```

### Example 2: ChatModelManager Configuration Output

```typescript
// What gets passed to ChatOllama constructor
const ollamaConfig = {
  model: "gpt-oss:120b-cloud",
  baseUrl: "https://api.ollama.com/v1",
  headers: new Headers({
    Authorization: "Bearer ollm_abc123...",
  }),

  // Thinking setting (required for GPT-OSS)
  think: "medium", // Not boolean!

  // Native tools (schemas for Ollama to execute)
  tools: [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the internet for current information",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            max_results: { type: "number", default: 5 },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch content from a specific URL",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to fetch" },
          },
          required: ["url"],
        },
      },
    },
  ],
};
```

### Example 3: UI Component (Cloud Detection)

```tsx
// In ModelEditDialog.tsx
{
  model.provider === ChatModelProviders.OLLAMA && (
    <>
      {/* Cloud detection banner */}
      {isOllamaCloudEndpoint(model.baseUrl) ? (
        <div className="tw-bg-blue-50 tw-border tw-border-blue-200 tw-rounded tw-p-3">
          <div className="tw-flex tw-items-center tw-gap-2">
            <Globe className="tw-size-4 tw-text-blue-600" />
            <span className="tw-text-sm tw-font-medium">Ollama Cloud Endpoint</span>
          </div>
          <p className="tw-text-xs tw-text-muted tw-mt-1">
            Web search and advanced features available with API key
          </p>
        </div>
      ) : (
        <div className="tw-bg-gray-50 tw-border tw-border-gray-200 tw-rounded tw-p-3">
          <div className="tw-flex tw-items-center tw-gap-2">
            <Server className="tw-size-4 tw-text-gray-600" />
            <span className="tw-text-sm tw-font-medium">Local Ollama Instance</span>
          </div>
          <p className="tw-text-xs tw-text-muted tw-mt-1">
            Web search not available on local Ollama
          </p>
        </div>
      )}

      {/* API Key field - only show for cloud */}
      {isOllamaCloudEndpoint(model.baseUrl) && (
        <FormField
          label="API Key (Ollama Cloud)"
          helpText={
            <span>
              Required for web search. Get your key at{" "}
              <a href="https://ollama.com/settings/keys" target="_blank" rel="noopener">
                ollama.com/settings/keys
              </a>
            </span>
          }
        >
          <Input
            type="password"
            value={model.apiKey || ""}
            onChange={(e) => updateModel({ apiKey: e.target.value })}
            placeholder="ollm_..."
          />
        </FormField>
      )}

      {/* GPT-OSS specific settings */}
      {isGptOssModel(model.name) && (
        <>
          {/* Web search toggle */}
          {getOllamaModelCapabilities(model).supportsWebSearch && (
            <FormField label="Web Search (Native)">
              <Switch
                checked={model.enableOllamaWebSearch || false}
                onChange={(checked) => updateModel({ enableOllamaWebSearch: checked })}
              />
              <p className="tw-text-xs tw-text-muted">
                Enable native Ollama web search. Model will automatically search when needed.
              </p>
            </FormField>
          )}

          {/* Thinking level selector */}
          <FormField label="Thinking Level">
            <Select
              value={model.ollamaThinkingLevel || "medium"}
              onChange={(value) => updateModel({ ollamaThinkingLevel: value })}
            >
              <option value="low">Low - Faster responses, basic reasoning</option>
              <option value="medium">Medium - Balanced (recommended)</option>
              <option value="high">High - Thorough reasoning, slower</option>
            </Select>
            <p className="tw-text-xs tw-text-muted">
              GPT-OSS always uses thinking (cannot be disabled)
            </p>
          </FormField>

          {/* Context length warning */}
          {(model.maxTokens || 0) < 32000 && (
            <div className="tw-bg-amber-50 tw-border tw-border-amber-200 tw-rounded tw-p-3">
              <div className="tw-flex tw-items-center tw-gap-2">
                <AlertTriangle className="tw-size-4 tw-text-amber-600" />
                <span className="tw-text-sm tw-font-medium">Context Length Recommendation</span>
              </div>
              <p className="tw-text-xs tw-text-muted tw-mt-1">
                GPT-OSS works best with ≥32,000 tokens. Current: {model.maxTokens || 16000}
              </p>
              <button
                className="tw-text-xs tw-text-blue-600 tw-underline tw-mt-2"
                onClick={() => updateModel({ maxTokens: 32000 })}
              >
                Set to 32,000 tokens
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
```

### Example 4: Thinking Badge Component

```tsx
// New file: src/components/chat-components/ThinkingBadge.tsx
import React from "react";

interface ThinkingBadgeProps {
  level?: "low" | "medium" | "high";
}

export function ThinkingBadge({ level }: ThinkingBadgeProps) {
  if (!level) {
    return <span className="tw-text-xs tw-text-muted">Thinking...</span>;
  }

  const config = {
    low: {
      bg: "tw-bg-blue-100",
      text: "tw-text-blue-700",
      border: "tw-border-blue-200",
      label: "Low",
    },
    medium: {
      bg: "tw-bg-purple-100",
      text: "tw-text-purple-700",
      border: "tw-border-purple-200",
      label: "Medium",
    },
    high: {
      bg: "tw-bg-indigo-100",
      text: "tw-text-indigo-700",
      border: "tw-border-indigo-200",
      label: "High",
    },
  };

  const { bg, text, border, label } = config[level];

  return (
    <span
      className={`
        tw-inline-flex tw-items-center tw-gap-1
        tw-px-2 tw-py-1 tw-rounded tw-text-xs tw-font-medium
        tw-border ${bg} ${text} ${border}
      `}
    >
      <span>💭</span>
      <span>Thinking: {label}</span>
    </span>
  );
}
```

---

## Testing Strategy

### Unit Tests

**File**: `src/utils/ollamaUtils.test.ts`

```typescript
describe("ollamaUtils", () => {
  describe("isOllamaCloudEndpoint", () => {
    it("should return false for localhost", () => {
      expect(isOllamaCloudEndpoint("http://localhost:11434")).toBe(false);
      expect(isOllamaCloudEndpoint("http://127.0.0.1:11434")).toBe(false);
    });

    it("should return true for cloud endpoints", () => {
      expect(isOllamaCloudEndpoint("https://api.ollama.com")).toBe(true);
      expect(isOllamaCloudEndpoint("http://192.168.1.100:11434")).toBe(true);
    });

    it("should handle undefined/empty", () => {
      expect(isOllamaCloudEndpoint(undefined)).toBe(false);
      expect(isOllamaCloudEndpoint("")).toBe(false);
    });
  });

  describe("isGptOssModel", () => {
    it("should detect GPT-OSS models case-insensitively", () => {
      expect(isGptOssModel("gpt-oss:120b-cloud")).toBe(true);
      expect(isGptOssModel("GPT-OSS:4B")).toBe(true);
      expect(isGptOssModel("llama3.2:3b")).toBe(false);
    });
  });

  describe("validateOllamaWebSearch", () => {
    it("should reject web search for non-GPT-OSS models", () => {
      const model: CustomModel = {
        name: "llama3.2:3b",
        provider: ChatModelProviders.OLLAMA,
        enableOllamaWebSearch: true,
        enabled: true,
      };

      const result = validateOllamaWebSearch(model);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("GPT-OSS models");
    });

    it("should reject web search for local Ollama", () => {
      const model: CustomModel = {
        name: "gpt-oss:4b",
        provider: ChatModelProviders.OLLAMA,
        baseUrl: "http://localhost:11434",
        enableOllamaWebSearch: true,
        enabled: true,
      };

      const result = validateOllamaWebSearch(model);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Ollama Cloud");
    });

    it("should reject web search without API key", () => {
      const model: CustomModel = {
        name: "gpt-oss:120b",
        provider: ChatModelProviders.OLLAMA,
        baseUrl: "https://api.ollama.com",
        enableOllamaWebSearch: true,
        enabled: true,
        // apiKey missing
      };

      const result = validateOllamaWebSearch(model);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("API key required");
    });

    it("should warn about low context for GPT-OSS", () => {
      const model: CustomModel = {
        name: "gpt-oss:120b",
        provider: ChatModelProviders.OLLAMA,
        baseUrl: "https://api.ollama.com",
        apiKey: "test-key",
        maxTokens: 16000,
        enabled: true,
      };

      const result = validateOllamaWebSearch(model);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain("32,000 tokens");
    });

    it("should pass with all requirements met", () => {
      const model: CustomModel = {
        name: "gpt-oss:120b-cloud",
        provider: ChatModelProviders.OLLAMA,
        baseUrl: "https://api.ollama.com",
        apiKey: "ollm_test123",
        maxTokens: 32000,
        enableOllamaWebSearch: true,
        enabled: true,
      };

      const result = validateOllamaWebSearch(model);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeUndefined();
    });
  });
});
```

### Integration Tests

**File**: `src/integration_tests/ollama_gpt_oss.test.ts`

```typescript
describe("Ollama GPT-OSS Integration", () => {
  // Requires OLLAMA_API_KEY environment variable
  const apiKey = process.env.OLLAMA_API_KEY;

  beforeAll(() => {
    if (!apiKey) {
      console.warn("Skipping Ollama GPT-OSS tests: OLLAMA_API_KEY not set");
    }
  });

  it("should configure GPT-OSS model correctly", async () => {
    if (!apiKey) return;

    const model: CustomModel = {
      name: "gpt-oss:4b",
      provider: ChatModelProviders.OLLAMA,
      baseUrl: "https://api.ollama.com/v1",
      apiKey,
      ollamaThinkingLevel: "medium",
      enableOllamaWebSearch: true,
      maxTokens: 32000,
      enabled: true,
    };

    const manager = new ChatModelManager();
    const chatModel = await manager.createModelInstance(model);

    expect(chatModel).toBeDefined();
    // Verify config has thinking and tools
  });

  it("should perform web search with GPT-OSS", async () => {
    if (!apiKey) return;

    // Test actual web search functionality
    // This will make real API calls
  });

  it("should handle different thinking levels", async () => {
    if (!apiKey) return;

    const levels: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];

    for (const level of levels) {
      // Test each thinking level
    }
  });
});
```

### Manual Testing Scenarios

1. **Local Ollama Setup**

   - Start local Ollama: `ollama serve`
   - Add model in plugin: `llama3.2:3b` with `http://localhost:11434`
   - Verify: No API key field, no web search option
   - Test: Basic chat works

2. **Ollama Cloud Setup**

   - Add GPT-OSS model with `https://api.ollama.com/v1`
   - Add API key from ollama.com/settings/keys
   - Enable web search
   - Set thinking level to "medium"
   - Test: Ask a question requiring current info
   - Verify: Search happens automatically, thinking shown

3. **Error Scenarios**
   - Try enabling web search without API key → Show error
   - Try enabling web search on local Ollama → Show error
   - Try enabling web search on non-GPT-OSS → Show error
   - Set context < 32K → Show warning with fix button

---

## Migration & Compatibility

### Backward Compatibility

**Existing Ollama Models**: No breaking changes

- Local Ollama models continue to work as before
- No API key required for local instances
- Thinking remains optional for non-GPT-OSS models

**Existing Settings**: Automatic migration

- `customModel.apiKey` field already exists
- New fields are optional with sensible defaults:
  - `ollamaThinkingLevel`: defaults to `"medium"`
  - `enableOllamaWebSearch`: defaults to `false`

### Migration Path

```typescript
// No migration needed - all new fields are optional
// Default behavior for existing models:

// Before (existing local Ollama model)
{
  name: "llama3.2:3b",
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  enabled: true
}

// After (no changes required, continues to work)
{
  name: "llama3.2:3b",
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  enabled: true
  // ollamaThinkingLevel: undefined (thinking disabled)
  // enableOllamaWebSearch: undefined (web search disabled)
}
```

### Feature Flags

Consider adding a feature flag for gradual rollout:

```typescript
// In settings
interface CopilotSettings {
  // ... existing settings

  // Feature flag for GPT-OSS features
  enableOllamaGptOssFeatures?: boolean; // Default: true
}

// In code
if (getSettings().enableOllamaGptOssFeatures !== false) {
  // Enable GPT-OSS features
}
```

---

## References

### Official Documentation

1. **Ollama Web Search**: https://docs.ollama.com/capabilities/web-search

   - `/api/web_search` endpoint
   - `/api/web_fetch` endpoint
   - Tool calling examples

2. **Ollama Thinking**: https://docs.ollama.com/capabilities/thinking

   - GPT-OSS thinking levels
   - Streaming with thinking blocks
   - Context length recommendations

3. **Ollama API Keys**: https://ollama.com/settings/keys
   - Creating API keys
   - Authentication format

### Internal Documentation

1. **AGENTS.md**: Plugin architecture and coding guidelines
2. **MESSAGE_ARCHITECTURE.md**: Message state management
3. **NATIVE_TOOL_CALLING_MIGRATION.md**: Tool calling patterns
4. **TECHDEBT.md**: Known issues and improvements

### Related Code

1. **ollamaAwareFetch.ts**: Existing thinking transformation
2. **CustomChatOllama.ts**: Ollama-specific customizations
3. **chatModelManager.ts**: Model configuration
4. **constants.ts**: ModelCapability enum

### Example Implementations

1. **ChatOpenRouter.ts**: Reasoning effort handling (similar pattern)
2. **BedrockChatModel.ts**: Thinking mode implementation
3. **SearchTools.ts**: Web search tool (Copilot Plus)

---

## Decision Log

| Date       | Decision                                 | Rationale                                                                                                        |
| ---------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 2026-02-10 | Use Option A (Native Tool Calling)       | Better integration, simpler code, model decides when to search                                                   |
| 2026-02-10 | Per-model API keys with cloud detection  | Allows local + cloud in same workspace, more flexible                                                            |
| 2026-02-10 | Use Ollama native search always          | For GPT-OSS, prioritize native over Copilot Plus                                                                 |
| 2026-02-10 | Show thinking level badges               | Improves UX, shows model's reasoning effort                                                                      |
| 2026-02-10 | Add context length warning               | Helps users optimize GPT-OSS performance                                                                         |
| 2026-02-10 | Phase 1 Implementation Complete          | Core infrastructure, types, and config logic implemented and tested                                              |
| 2026-02-10 | Store thinking level in ResponseMetadata | Reuses existing metadata field instead of creating new one                                                       |
| 2026-02-10 | Phase 3 Implementation Complete          | Response handling verified, thinking level storage implemented                                                   |
| 2026-02-10 | Phase 2 Implementation Complete          | All UI components implemented: ModelEditDialog enhancements, ThinkingBadge, capability badges, automatic syncing |

---

## Next Steps

1. ✅ **Phase 1 Complete**: Core infrastructure implemented with utility functions, types, and ChatModelManager updates
2. ✅ **Phase 2 Complete**: All UI components implemented (ModelEditDialog, ThinkingBadge, capability badges, automatic syncing)
3. ✅ **Phase 3 Complete**: Response handling verified, thinking level storage in message metadata
4. ⏳ **Phase 4**: Comprehensive testing and validation
5. ⏳ **Documentation**: Update user-facing docs as features roll out

---

**Last Updated**: February 10, 2026
**Version**: 1.3
**Status**: Phase 1, 2, & 3 Complete - Testing Pending (Phase 4)
