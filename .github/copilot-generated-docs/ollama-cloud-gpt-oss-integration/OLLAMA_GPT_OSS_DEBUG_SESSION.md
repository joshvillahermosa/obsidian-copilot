# Ollama GPT-OSS Integration - Debug Session Summary

**Date**: February 10, 2026
**Status**: ⚠️ **BLOCKED** - LangChain Bug Prevents Tool Calling
**Session**: Part II - Debugging web search integration
**Blocker**: `@langchain/ollama` package makes duplicate API calls, discarding tools

## 🚨 Critical Blocker: LangChain Tool Calling Bug

### The Problem

After three implementation attempts, we discovered that **LangChain's `@langchain/ollama` package has a fundamental bug** that prevents tool calling from working:

**Symptom**: When using `.bindTools()` (the documented way to add tools to Ollama models), LangChain makes **TWO API calls**:

1. **First call**: WITH tools (tools are sent to Ollama, model can see them)
2. **Second call**: WITHOUT tools (tools are discarded)

**Result**: The model responds to the second (toolless) call, so it **never actually uses the web search tools**, even though they were configured and sent correctly.

### Evidence from Logs

```
[LLMChainRunner] Ollama web search enabled - using .invoke() with tools
[LLMChainRunner] Invoking Ollama with bound tools

// First API call - tools present ✅
[OLLAMA API] Request Details {
  hasTools: true,
  toolCount: 2,
  toolNames: ['web_search', 'web_fetch'],
  model: 'gpt-oss:120b-cloud'
}
[OLLAMA API] Full Tools Structure: [
  {
    "type": "function",
    "function": {
      "name": "web_search",
      "description": "Search the internet for current information",
      "parameters": { /* perfect schema matching Ollama docs */ }
    }
  },
  // ... web_fetch schema
]

// Second API call - NO TOOLS ❌
[OLLAMA API] Request Details {
  hasTools: false,  // ← Tools disappeared!
  model: 'gpt-oss:120b-cloud'
}

// Response from the toolless call
[LLMChainRunner] Received response {
  hasContent: true,
  contentLength: 3504,
  hasToolCalls: false  // ← Model didn't use tools
}

// Model's response (thinking block excerpt):
"cannot claim lack of real-time access; we must rely on user-provided context"
// (Model knows it should search but has no tools to do so)
```

### What We Confirmed

✅ **Tool schemas are perfect** - Exact match with Ollama documentation
✅ **Configuration is correct** - Cloud endpoint, API key, capabilities enabled
✅ **Tools ARE sent** - First API call includes tools with correct format
✅ **Ollama receives tools** - No API errors, proper 200 responses

❌ **LangChain discards tools** - Second call strips out the tools array
❌ **Model never sees tools** - Response comes from toolless call
❌ **Web search doesn't work** - Falls back to "I don't have access" responses

### Implementation Attempts (All Failed)

#### Attempt 1: `.bindTools()` + `.stream()` (Standard Pattern)

```typescript
const boundModel = chatModel.bindTools(toolsToUse);
const stream = await boundModel.stream(messages, { signal });
```

**Result**: Two API calls, tools discarded ❌

#### Attempt 2: Tools in Stream Options

```typescript
const stream = await chatModel.stream(messages, {
  signal,
  tools: toolsToUse,
});
```

**Result**: Two API calls, tools discarded ❌

#### Attempt 3: `.bindTools()` + `.invoke()` with Simulated Streaming

```typescript
const boundModel = chatModel.bindTools(toolsToUse);
const response = await boundModel.invoke(messages, { signal });
// Simulate streaming by breaking response into words
for (let i = 0; i < words.length; i++) {
  streamer.processChunk({ content: words[i], ... });
}
```

**Result**: Two API calls, tools still discarded ❌

### Root Cause Analysis

**Hypothesis**: LangChain's `.bindTools()` creates a `RunnableBinding` wrapper that:

1. Makes an initial call to the model WITH tools (possibly for validation?)
2. Makes a second "actual" call WITHOUT tools
3. Returns the response from the toolless call

This pattern happens with **both `.stream()` and `.invoke()`**, making tool calling fundamentally broken in the current `@langchain/ollama` implementation.

**Affected Package**: `@langchain/ollama` (LangChain TypeScript)
**Confirmed Version**: Latest as of February 10, 2026

### Possible Workarounds

1. **Bypass LangChain Entirely** (Recommended)

   - Implement raw Ollama API calls with tools ourselves
   - Handle tool loop and response parsing manually
   - Pros: Full control, tools will work
   - Cons: More code, need to implement streaming and tool loops

2. **File Bug Report and Wait**

   - Document with reproducible example
   - File at https://github.com/langchain-ai/langchainjs/issues
   - Wait for upstream fix
   - Pros: Proper solution
   - Cons: Unknown timeline, blocks feature

3. **Alternative Integration**

   - Check if Ollama Cloud has OpenAI-compatible endpoint
   - Use OpenAI provider with Ollama Cloud base URL
   - Pros: May work with existing tool calling
   - Cons: May not support thinking levels or GPT-OSS features

4. **Disable Feature**
   - Mark as "known issue" in documentation
   - Hide UI toggle for web search
   - Wait for LangChain fix
   - Pros: Easy, no broken functionality exposed
   - Cons: Feature unavailable to users

---

## Issues Resolved (Part I)

### 1. Plugin Load Failures ✅

**Problem**: Hot-reload causing duplicate view registrations
**Solution**: Added defensive try-catch blocks with optional chaining

```typescript
// Added error handling for hot-reload scenarios
try {
  this.registerView(CHAT_VIEWTYPE, ...);
  this.registerView(APPLY_VIEW_TYPE, ...);
} catch (error) {
  logWarn("View registration failed (may already be registered):", error);
}

// Defensive cleanup
this.customCommandRegister?.cleanup();
this.systemPromptRegister?.cleanup();
```

### 2. Headers Type Incompatibility ✅

**Problem**: `t.headers.get is not a function` - LangChain expecting Headers instance
**Solution**:

- Changed ChatOllama config to use plain object for headers (not Headers instance)
- Ensured Response objects always have proper Headers in `ollamaAwareFetch`

```typescript
// chatModelManager.ts - Use plain object
headers: {
  Authorization: `Bearer ${apiKey}`,
},

// ollamaAwareFetch.ts - Always return proper Response
return new Response(response.text, {
  status: response.status,
  statusText: response.status === 200 ? "OK" : "Error",
  headers: new Headers(response.headers || {}),
}) as any;
```

### 3. Incorrect Base URL ✅

**Problem**: URL construction resulted in 404 errors
**Solution**: Use `https://ollama.com` (no `/v1` or `/api` suffix)

- ChatOllama appends `/api/chat` automatically
- Final URL: `https://ollama.com/api/chat` ✅

### 4. Missing Configuration Fields ✅

**Problem**: `enableOllamaWebSearch: undefined` causing tools not to be injected
**Root Cause**: Model configuration lacked GPT-OSS-specific fields
**Solution**: Added required fields to `data.json`:

```json
{
  "name": "gpt-oss:120b-cloud",
  "provider": "ollama",
  "baseUrl": "https://ollama.com",
  "apiKey": "your-api-key",
  "capabilities": ["websearch", "reasoning"],
  "enableCors": true,
  "ollamaThinkingLevel": "medium", // ✅ Added
  "enableOllamaWebSearch": true, // ✅ Added
  "maxTokens": 32000 // ✅ Added
}
```

## Implementation Details

### Configuration Flow

```
data.json (model config)
  ↓
ChatModelManager.getModelConfig()
  ↓ (validates capabilities)
getOllamaModelCapabilities()
  ↓ (checks: GPT-OSS + Cloud + API key + enabled)
{
  tools: [web_search, web_fetch],  // Tool schemas injected
  think: "medium",                 // Thinking level set
  baseUrl: "https://ollama.com"    // Correct endpoint
}
  ↓
ChatOllama constructor
  ↓
Ollama Cloud API
```

### Tool Schemas Added

```typescript
// web_search tool
{
  type: "function",
  function: {
    name: "web_search",
    description: "Search the internet for current information and recent events",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", default: 5, minimum: 1, maximum: 10 }
      },
      required: ["query"]
    }
  }
}

// web_fetch tool
{
  type: "function",
  function: {
    name: "web_fetch",
    description: "Fetch and extract content from a specific URL",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" }
      },
      required: ["url"]
    }
  }
}
```

### Diagnostic Logging Added

```typescript
// Web search decision logging
logInfo("[ChatModelManager] Web search decision", {
  modelName,
  enableOllamaWebSearch: customModel.enableOllamaWebSearch,
  capabilities: getOllamaModelCapabilities(customModel),
  shouldEnableWebSearch,
});

// Final config logging (Ollama only)
logInfo("[ChatModelManager] Creating Ollama model with config", {
  modelName: model.name,
  hasTools: !!constructorConfig.tools,
  toolCount: constructorConfig.tools?.length,
  think: constructorConfig.think,
  baseUrl: constructorConfig.baseUrl,
});
```

## Testing Requirements (Pending Blocker Resolution)

> ⚠️ **Note**: Testing cannot proceed until LangChain tool calling bug is resolved or bypassed.
> The sections below describe what WOULD be tested once tools are working.

### Expected Log Output (When Tools Work)

**Desired behavior** (not currently achievable):

```
[ChatModelManager] Web search decision {
  modelName: 'gpt-oss:120b-cloud',
  enableOllamaWebSearch: true,          // ✅ Should be true
  capabilities: {
    isCloudEndpoint: true,
    isGptOss: true,
    supportsWebSearch: true,            // ✅ Should be true
    supportsThinking: true,
    hasApiKey: true
  },
  shouldEnableWebSearch: true            // ✅ Should be true
}

[ChatModelManager] Creating Ollama model with config {
  modelName: 'gpt-oss:120b-cloud',
  hasTools: true,                        // ✅ Should be true
  toolCount: 2,                          // ✅ Should be 2
  think: 'medium',                       // ✅ Correct
  baseUrl: 'https://ollama.com'          // ✅ Correct
}

// SINGLE API call with tools (not two calls)
[OLLAMA API] Request Details {
  hasTools: true,
  toolCount: 2,
  model: 'gpt-oss:120b-cloud'
}

// Model uses tools in response
[LLMChainRunner] Received response {
  hasToolCalls: true,  // ✅ Model used web_search
  toolName: 'web_search',
  toolArgs: { query: 'latest news', max_results: 5 }
}

// Tool results sent back to model
[Tool Execution] web_search completed {
  results: [...search results...]
}

// Final answer with real data
[LLMChainRunner] Final response {
  hasContent: true,
  contentIncludes: 'According to recent news...'
}
```

**Current behavior** (problematic):

```
// Two API calls made
[OLLAMA API] Request 1 {hasTools: true, toolCount: 2}   // Tools present
[OLLAMA API] Request 2 {hasTools: false}                // Tools gone!

// Response from toolless request
[LLMChainRunner] Received response {
  hasToolCalls: false,  // ❌ Model didn't use tools
}

// Generic "I don't have access" response
[AI Response] "I don't have any news items stored in your vault..."
```

### Test Scenario

1. **Force model reload** (to clear cache):

   - Switch to different model (e.g., gpt-4.1)
   - Switch back to gpt-oss:120b-cloud
   - OR restart Obsidian (`Ctrl/Cmd + R`)

2. **Test query**: "What's going on in the news today?"

3. **Expected behavior**:
   - Model should receive web_search and web_fetch tools
   - Model should decide to use web search for current info
   - Should see tool call in logs (if verbose logging enabled)
   - Should return actual current news information

## Files Modified

### Part I: Initial Configuration & Fixes (✅ Working)

- `src/utils/ollamaUtils.ts` - Cloud detection, GPT-OSS detection, validation (NEW)
- `src/aiParams.ts` - Added `ollamaThinkingLevel`, `enableOllamaWebSearch` fields
- `src/constants.ts` - Updated websearch capability description
- `src/LLMProviders/chatModelManager.ts` - Initial tool injection attempt (moved to chain runner in Part II)
- `src/LLMProviders/ollamaAwareFetch.ts` - Headers fix, Response compatibility, enhanced logging
- `src/main.ts` - Defensive error handling for view/processor registration
- `data.json` - Updated gpt-oss:120b-cloud model config with new fields

### Part II: Tool Calling Attempts (❌ Blocked by LangChain Bug)

- `src/utils/ollamaWebSearchTools.ts` - Tool definitions using LangChain's `tool()` helper (NEW)

  - `ollamaWebSearchTool` - Internet search tool schema
  - `ollamaWebFetchTool` - URL fetch tool schema
  - `getOllamaWebSearchTools()` - Export function for chain runner

- `src/LLMProviders/chainRunner/LLMChainRunner.ts` - THREE implementation attempts:

  - Attempt 1: `.bindTools()` + `.stream()` with extensive logging
  - Attempt 2: Tools as stream options parameter
  - Attempt 3: `.bindTools()` + `.invoke()` with word-by-word simulated streaming
  - All attempts failed due to LangChain making duplicate API calls

- `src/LLMProviders/chatModelManager.ts` - Updated again:

  - Removed tool injection from constructor (moved to chain runner)
  - Added comment: "Web search tools are NOT configured here. They must be bound using .bindTools() in the chain runner"
  - Simplified Ollama model creation

- `src/LLMProviders/ollamaAwareFetch.ts` - Enhanced logging:
  - Added full tool structure logging
  - Request details showing hasTools, toolCount, toolNames
  - Helps prove tools ARE being sent (but discarded by LangChain)

### Tests

- `src/utils/ollamaUtils.test.ts` - 44 comprehensive test cases (NEW)

## Known Issues & Limitations

### 🚨 Critical Blockers

1. **LangChain Tool Calling Bug** (BLOCKS WEB SEARCH)

   - **Issue**: `.bindTools()` makes duplicate API calls, second call discards tools
   - **Impact**: Web search completely non-functional despite perfect configuration
   - **Affects**: All three implementation attempts (stream, stream options, invoke)
   - **Status**: Requires LangChain fix or custom implementation bypass
   - **Tracking**: Need to file issue at https://github.com/langchain-ai/langchainjs/issues

2. **Thinking Block Corruption** (IMPACTS UX)
   - **Issue**: Mixed `<think>` and `<THINKING>` tags in simulated streaming output
   - **Cause**: Word-by-word streaming may break tag parsing logic
   - **Impact**: Thinking badge may not display correctly
   - **Status**: Related to Attempt 3's simulated streaming approach

### Non-Critical Limitations

3. **Model Cache**: Static model instance caching requires explicit reload

   - **Workaround**: Switch models or restart Obsidian after config changes
   - **Status**: Normal behavior, not a bug

4. **CORS Issues**: Initial connection may fail, then retry with CORS fetch

   - **Status**: Normal behavior, error handled gracefully via `ollamaAwareFetch`

5. **Tool Execution Decision**: Model must decide to use tools (when they work)
   - Ollama Cloud models should automatically search when needed
   - Depends on model's reasoning about query requirements
   - **Status**: Expected AI behavior, not a bug

## Next Steps - Decision Required ⚠️

### Current State

- ✅ Configuration and detection logic working perfectly
- ✅ Tool schemas validated (exact match with Ollama documentation)
- ✅ Thinking levels implemented and stored in message metadata
- ✅ UI components ready (ThinkingBadge, ModelEditDialog, etc.)
- ❌ **Web search completely blocked by LangChain bug**
- ❌ Cannot proceed with testing until blocker resolved

### Decision Options

#### Option 1: Implement Custom Ollama API Client (Recommended for Production)

**Effort**: High (2-3 days)
**Pros**:

- Full control over API calls and tool loops
- Guaranteed to work (proven by Ollama documentation)
- Can optimize for Ollama-specific features
- No dependency on LangChain bug fixes

**Cons**:

- Significant code changes required
- Need to implement streaming, tool loops, error handling
- Duplicates some LangChain functionality

**Implementation Plan**:

1. Create `src/LLMProviders/CustomOllamaClient.ts`
2. Implement streaming with native fetch + SSE parsing
3. Handle tool call loop (model → tool execution → model → response)
4. Integrate with existing `ollamaAwareFetch` for thinking transformation
5. Replace ChatOllama with custom client when web search enabled

#### Option 2: File Bug Report and Wait (Recommended for Open Source)

**Effort**: Low (1-2 hours)
**Pros**:

- Proper upstream fix benefits entire LangChain community
- No maintenance burden on our side
- Preserves LangChain integration benefits

**Cons**:

- Unknown timeline (could be days, weeks, or months)
- Feature unavailable to users until fixed
- May require follow-up and testing after fix

**Implementation Plan**:

1. Create minimal reproducible example with logs
2. File issue at https://github.com/langchain-ai/langchainjs/issues
3. Document blocker in plugin documentation
4. Disable web search UI toggle with "Coming Soon" message
5. Monitor issue for updates

#### Option 3: Try OpenAI-Compatible Endpoint (Quick Experiment)

**Effort**: Medium (4-6 hours)
**Pros**:

- May work around LangChain bug
- OpenAI tool calling is well-tested in LangChain
- Could be quick win

**Cons**:

- Ollama Cloud's OpenAI endpoint may not support tools
- May lose thinking levels or GPT-OSS specific features
- Need to verify compatibility with Ollama Cloud

**Implementation Plan**:

1. Check if Ollama Cloud supports OpenAI-compatible endpoint
2. Test with `https://ollama.com/v1` + OpenAI provider
3. Verify tool calling works
4. Verify thinking levels are preserved
5. If successful, add as alternative provider option

#### Option 4: Disable Feature Temporarily

**Effort**: Very Low (30 minutes)
**Pros**:

- Quick, no broken functionality exposed
- Clean user experience (no false promises)
- Can re-enable when fix available

**Cons**:

- Feature unavailable indefinitely
- Disappointing for users who need web search
- Wasted effort on configuration/UI implementation

**Implementation Plan**:

1. Comment out tool injection logic in chatModelManager
2. Hide web search toggle in ModelEditDialog
3. Add note in documentation: "Web search coming soon - pending upstream fix"
4. Keep all code in place for quick re-enablement

### Recommendation

**For immediate user value**: Option 1 (Custom Client)

- Web search is a key GPT-OSS feature
- Configuration/UI work already complete
- Only blocker is LangChain, which we can bypass

**For long-term maintainability**: Option 2 (File Bug + Wait)

- Let LangChain team fix their bug
- Less code to maintain
- Benefits entire community

**Compromise approach**: Option 2 + Option 1

1. File bug report immediately (helps community)
2. Implement custom client as workaround (helps users now)
3. Switch back to LangChain when fixed (reduces maintenance)

### Immediate Actions (Regardless of Option)

1. Document this blocker in main integration doc
2. Update plugin README with current status
3. Add warning in settings UI if user enables web search
4. Preserve all configuration/UI code (will be needed eventually)

## References

- Main Integration Doc: [OLLAMA_GPT_OSS_INTEGRATION.md](./OLLAMA_GPT_OSS_INTEGRATION.md)
- Ollama Cloud Docs: https://docs.ollama.com/cloud
- Ollama Web Search: https://docs.ollama.com/capabilities/web-search
- Ollama Thinking: https://docs.ollama.com/capabilities/thinking
- LangChain Ollama Docs: https://python.langchain.com/docs/integrations/chat/ollama
- LangChain Issues: https://github.com/langchain-ai/langchainjs/issues

## Debug Session Timeline

| Phase                 | Duration     | Status         | Notes                                                          |
| --------------------- | ------------ | -------------- | -------------------------------------------------------------- |
| Part I: Initial Setup | ~2 hours     | ✅ Complete    | Fixed plugin load, headers, base URL, configuration            |
| Part II: Tool Calling | ~3 hours     | ❌ Blocked     | Three implementation attempts, all failed due to LangChain bug |
| **Total Session**     | **~5 hours** | **⚠️ Blocked** | **Root cause identified, decision required**                   |

### Key Learnings

1. **Configuration was never the problem** - Tool schemas were perfect from the start
2. **LangChain abstraction hides issues** - Duplicate API calls not visible without deep logging
3. **Testing assumptions matter** - "Tools configured" ≠ "Tools working"
4. **Upstream dependencies can block features** - Even with perfect implementation
5. **Diagnostic logging is critical** - Without detailed logs, would never have found the issue

---

**Last Updated**: February 10, 2026
**Session Duration**: ~5 hours (Part I: 2h, Part II: 3h)
**Status**: ⚠️ **BLOCKED** - LangChain bug prevents tool calling
**Next Action**: Decision required on workaround approach (see "Next Steps" section)
