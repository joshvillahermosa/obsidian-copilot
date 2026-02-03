# CORS Issue Investigation - Ollama Provider

## Investigation Result: ✅ OPTION 1 IS VIABLE

### Key Finding

The `ChatOllama` class from `@langchain/ollama@1.0.0` **DOES support a custom `fetch` parameter**.

From the type definitions in `node_modules/@langchain/ollama/dist/chat_models.d.ts`:

```typescript
interface ChatOllamaInput extends BaseChatModelParams, OllamaCamelCaseOptions {
  // ... other properties
  /**
   * Optional HTTP Headers to include in the request.
   */
  headers?: Headers | Record<string, string>;
  // ... other properties
  /**
   * The fetch function to use.
   * @default fetch
   */
  fetch?: typeof fetch;
}
```

### Root Cause

In [src/LLMProviders/chatModelManager.ts](src/LLMProviders/chatModelManager.ts#L282-L289), the Ollama configuration is currently:

```typescript
[ChatModelProviders.OLLAMA]: {
  model: modelName,
  baseUrl: customModel.baseUrl || "http://localhost:11434",
  headers: new Headers({
    Authorization: `Bearer ${await getDecryptedKey(customModel.apiKey || "default-key")}`,
  }),
  // ❌ MISSING: fetch?: customModel.enableCors ? safeFetch : undefined
},
```

### Solution

Add the `fetch` parameter to respect the `enableCors` flag:

```typescript
[ChatModelProviders.OLLAMA]: {
  model: modelName,
  baseUrl: customModel.baseUrl || "http://localhost:11434",
  headers: new Headers({
    Authorization: `Bearer ${await getDecryptedKey(customModel.apiKey || "default-key")}`,
  }),
  fetch: customModel.enableCors ? safeFetch : undefined,  // ✅ ADD THIS LINE
},
```

### Why This Will Work

1. **ChatOllama accepts the `fetch` parameter** in its constructor options
2. **safeFetch uses Obsidian's `requestUrl` API** which properly bypasses CORS restrictions
3. **Pattern already proven** in other providers (OpenAI, LM_STUDIO) and embedding manager
4. **No breaking changes** - passing `undefined` for fetch just uses the default browser fetch

### Additional Notes

- The `enableCors: true` flag is already set in your `data.json` configuration
- The embedding manager already implements this pattern correctly (see [src/LLMProviders/embeddingManager.ts](src/LLMProviders/embeddingManager.ts#L218))
- This is the minimal, non-invasive fix

### Next Steps

Apply the one-line fix to `chatModelManager.ts` in the Ollama provider configuration.
