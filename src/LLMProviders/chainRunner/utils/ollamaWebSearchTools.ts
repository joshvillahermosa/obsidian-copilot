import { ollamaAwareFetch } from "@/LLMProviders/ollamaAwareFetch";
import { logInfo, logError } from "@/logger";
import { OllamaToolSchema } from "@/LLMProviders/NativeOllamaClient";

/**
 * Web search tool schema for Ollama Cloud API.
 * Allows the model to search the internet for current information.
 */
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

/**
 * Web fetch tool schema for Ollama Cloud API.
 * Allows the model to fetch and extract content from a specific URL.
 */
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
 * Web search result from Ollama Cloud API
 */
export interface OllamaWebSearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Web search response from Ollama Cloud API
 */
export interface OllamaWebSearchResponse {
  results: OllamaWebSearchResult[];
  query: string;
}

/**
 * Web fetch response from Ollama Cloud API
 */
export interface OllamaWebFetchResponse {
  url: string;
  content: string;
  title?: string;
}

/**
 * Execute web search via Ollama Cloud API.
 * Makes a POST request to /api/web_search with the search query.
 *
 * @param baseUrl - Ollama Cloud base URL (e.g., "https://ollama.com")
 * @param apiKey - Ollama Cloud API key
 * @param query - Search query string
 * @param maxResults - Maximum number of results to return (1-10, default 5)
 * @returns Search results with titles, URLs, and content snippets
 * @throws Error if the API request fails
 */
export async function executeOllamaWebSearch(
  baseUrl: string,
  apiKey: string,
  query: string,
  maxResults: number = 5
): Promise<OllamaWebSearchResponse> {
  logInfo("[OllamaWebSearch] Executing", { query, maxResults });

  // Clamp maxResults to valid range (1-10)
  const clampedMaxResults = Math.min(Math.max(maxResults, 1), 10);

  try {
    const response = await ollamaAwareFetch(`${baseUrl}/api/web_search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: clampedMaxResults,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError("[OllamaWebSearch] API error", { status: response.status, errorText });
      throw new Error(`Web search failed (${response.status}): ${errorText}`);
    }

    const result: OllamaWebSearchResponse = await response.json();
    logInfo("[OllamaWebSearch] Success", { resultCount: result.results?.length || 0 });
    return result;
  } catch (error) {
    logError("[OllamaWebSearch] Request failed", { error });
    throw error;
  }
}

/**
 * Execute web fetch via Ollama Cloud API.
 * Makes a POST request to /api/web_fetch to retrieve content from a specific URL.
 *
 * @param baseUrl - Ollama Cloud base URL (e.g., "https://ollama.com")
 * @param apiKey - Ollama Cloud API key
 * @param url - URL to fetch content from
 * @returns Fetched content with URL and optional title
 * @throws Error if the API request fails
 */
export async function executeOllamaWebFetch(
  baseUrl: string,
  apiKey: string,
  url: string
): Promise<OllamaWebFetchResponse> {
  logInfo("[OllamaWebFetch] Executing", { url });

  try {
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

    const result: OllamaWebFetchResponse = await response.json();
    logInfo("[OllamaWebFetch] Success", { contentLength: result.content?.length || 0 });
    return result;
  } catch (error) {
    logError("[OllamaWebFetch] Request failed", { error });
    throw error;
  }
}
