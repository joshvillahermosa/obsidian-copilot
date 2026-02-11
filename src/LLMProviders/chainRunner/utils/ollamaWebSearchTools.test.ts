import {
  executeOllamaWebSearch,
  executeOllamaWebFetch,
  OLLAMA_WEB_SEARCH_SCHEMA,
  OLLAMA_WEB_FETCH_SCHEMA,
  OllamaWebSearchResponse,
  OllamaWebFetchResponse,
} from "./ollamaWebSearchTools";
import { ollamaAwareFetch } from "@/LLMProviders/ollamaAwareFetch";

// Mock ollamaAwareFetch
jest.mock("@/LLMProviders/ollamaAwareFetch");
const mockOllamaAwareFetch = ollamaAwareFetch as jest.MockedFunction<typeof ollamaAwareFetch>;

describe("ollamaWebSearchTools", () => {
  const baseUrl = "https://ollama.com";
  const apiKey = "test-api-key";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Tool Schemas", () => {
    test("OLLAMA_WEB_SEARCH_SCHEMA has correct structure", () => {
      expect(OLLAMA_WEB_SEARCH_SCHEMA).toEqual({
        type: "function",
        function: {
          name: "web_search",
          description: expect.any(String),
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: expect.any(String),
              },
              max_results: {
                type: "number",
                description: expect.any(String),
                default: 5,
              },
            },
            required: ["query"],
          },
        },
      });
    });

    test("OLLAMA_WEB_FETCH_SCHEMA has correct structure", () => {
      expect(OLLAMA_WEB_FETCH_SCHEMA).toEqual({
        type: "function",
        function: {
          name: "web_fetch",
          description: expect.any(String),
          parameters: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: expect.any(String),
              },
            },
            required: ["url"],
          },
        },
      });
    });
  });

  describe("executeOllamaWebSearch", () => {
    test("successfully executes web search with default max_results", async () => {
      const mockResponse: OllamaWebSearchResponse = {
        query: "test query",
        results: [
          {
            title: "Test Result 1",
            url: "https://example.com/1",
            content: "Test content 1",
          },
          {
            title: "Test Result 2",
            url: "https://example.com/2",
            content: "Test content 2",
          },
        ],
      };

      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await executeOllamaWebSearch(baseUrl, apiKey, "test query");

      expect(result).toEqual(mockResponse);
      expect(mockOllamaAwareFetch).toHaveBeenCalledWith(`${baseUrl}/api/web_search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "test query",
          max_results: 5,
        }),
      });
    });

    test("successfully executes web search with custom max_results", async () => {
      const mockResponse: OllamaWebSearchResponse = {
        query: "test query",
        results: [
          {
            title: "Test Result",
            url: "https://example.com",
            content: "Test content",
          },
        ],
      };

      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await executeOllamaWebSearch(baseUrl, apiKey, "test query", 3);

      expect(result).toEqual(mockResponse);
      expect(mockOllamaAwareFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: "test query",
            max_results: 3,
          }),
        })
      );
    });

    test("clamps max_results to maximum of 10", async () => {
      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ query: "test", results: [] }),
      } as Response);

      await executeOllamaWebSearch(baseUrl, apiKey, "test query", 20);

      expect(mockOllamaAwareFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: "test query",
            max_results: 10,
          }),
        })
      );
    });

    test("clamps max_results to minimum of 1", async () => {
      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ query: "test", results: [] }),
      } as Response);

      await executeOllamaWebSearch(baseUrl, apiKey, "test query", -5);

      expect(mockOllamaAwareFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: "test query",
            max_results: 1,
          }),
        })
      );
    });

    test("handles API error responses", async () => {
      mockOllamaAwareFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      } as Response);

      await expect(executeOllamaWebSearch(baseUrl, apiKey, "test query")).rejects.toThrow(
        "Web search failed (401): Unauthorized"
      );
    });

    test("handles network errors", async () => {
      const networkError = new Error("Network error");
      mockOllamaAwareFetch.mockRejectedValue(networkError);

      await expect(executeOllamaWebSearch(baseUrl, apiKey, "test query")).rejects.toThrow(
        "Network error"
      );
    });

    test("handles empty results", async () => {
      const mockResponse: OllamaWebSearchResponse = {
        query: "test query",
        results: [],
      };

      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await executeOllamaWebSearch(baseUrl, apiKey, "test query");

      expect(result.results).toEqual([]);
    });

    test("includes authorization header", async () => {
      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ query: "test", results: [] }),
      } as Response);

      await executeOllamaWebSearch(baseUrl, "custom-api-key", "test query");

      expect(mockOllamaAwareFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer custom-api-key",
          }),
        })
      );
    });
  });

  describe("executeOllamaWebFetch", () => {
    test("successfully executes web fetch", async () => {
      const mockResponse: OllamaWebFetchResponse = {
        url: "https://example.com",
        content: "Test page content",
        title: "Test Page",
      };

      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await executeOllamaWebFetch(baseUrl, apiKey, "https://example.com");

      expect(result).toEqual(mockResponse);
      expect(mockOllamaAwareFetch).toHaveBeenCalledWith(`${baseUrl}/api/web_fetch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: "https://example.com",
        }),
      });
    });

    test("successfully executes web fetch without title", async () => {
      const mockResponse: OllamaWebFetchResponse = {
        url: "https://example.com",
        content: "Test page content",
      };

      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await executeOllamaWebFetch(baseUrl, apiKey, "https://example.com");

      expect(result).toEqual(mockResponse);
      expect(result.title).toBeUndefined();
    });

    test("handles API error responses", async () => {
      mockOllamaAwareFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "URL not found",
      } as Response);

      await expect(
        executeOllamaWebFetch(baseUrl, apiKey, "https://invalid-url.com")
      ).rejects.toThrow("Web fetch failed (404): URL not found");
    });

    test("handles network errors", async () => {
      const networkError = new Error("Network timeout");
      mockOllamaAwareFetch.mockRejectedValue(networkError);

      await expect(executeOllamaWebFetch(baseUrl, apiKey, "https://example.com")).rejects.toThrow(
        "Network timeout"
      );
    });

    test("handles rate limiting errors", async () => {
      mockOllamaAwareFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
      } as Response);

      await expect(executeOllamaWebFetch(baseUrl, apiKey, "https://example.com")).rejects.toThrow(
        "Web fetch failed (429): Rate limit exceeded"
      );
    });

    test("includes authorization header", async () => {
      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ url: "https://example.com", content: "test" }),
      } as Response);

      await executeOllamaWebFetch(baseUrl, "custom-api-key", "https://example.com");

      expect(mockOllamaAwareFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer custom-api-key",
          }),
        })
      );
    });

    test("handles empty content", async () => {
      const mockResponse: OllamaWebFetchResponse = {
        url: "https://example.com",
        content: "",
      };

      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await executeOllamaWebFetch(baseUrl, apiKey, "https://example.com");

      expect(result.content).toBe("");
    });
  });

  describe("Integration scenarios", () => {
    test("web search with special characters in query", async () => {
      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ query: "test & query", results: [] }),
      } as Response);

      await executeOllamaWebSearch(baseUrl, apiKey, "test & query");

      expect(mockOllamaAwareFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: "test & query",
            max_results: 5,
          }),
        })
      );
    });

    test("web fetch with URL containing query parameters", async () => {
      const urlWithParams = "https://example.com/page?param=value&other=123";

      mockOllamaAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ url: urlWithParams, content: "test" }),
      } as Response);

      await executeOllamaWebFetch(baseUrl, apiKey, urlWithParams);

      expect(mockOllamaAwareFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            url: urlWithParams,
          }),
        })
      );
    });
  });
});
