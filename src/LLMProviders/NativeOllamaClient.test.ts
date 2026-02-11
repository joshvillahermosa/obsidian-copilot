import { NativeOllamaClient, OllamaToolSchema } from "./NativeOllamaClient";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { ollamaAwareFetch } from "./ollamaAwareFetch";

// Mock ollamaAwareFetch
jest.mock("./ollamaAwareFetch");
const mockedFetch = ollamaAwareFetch as jest.MockedFunction<typeof ollamaAwareFetch>;

// Mock logger
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

describe("NativeOllamaClient", () => {
  const config = {
    baseUrl: "https://ollama.com",
    apiKey: "test-api-key",
    modelName: "gpt-oss:120b-cloud",
    thinkingLevel: "medium" as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with provided config", () => {
      const client = new NativeOllamaClient(config);
      expect(client).toBeDefined();
    });

    it("should default thinking level to medium if not provided", () => {
      const client = new NativeOllamaClient({
        baseUrl: "https://ollama.com",
        apiKey: "test-key",
        modelName: "gpt-oss:4b",
      });
      expect(client).toBeDefined();
    });
  });

  describe("stream()", () => {
    it("should stream NDJSON responses and yield AIMessageChunk objects", async () => {
      // Mock streaming NDJSON response
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            const chunks = [
              '{"message":{"content":"Hello"}}\n',
              '{"message":{"content":" world"}}\n',
              '{"done":true}\n',
            ];
            let index = 0;

            return {
              read: async () => {
                if (index >= chunks.length) {
                  return { done: true, value: undefined };
                }
                const encoder = new TextEncoder();
                return { done: false, value: encoder.encode(chunks[index++]) };
              },
            };
          },
        },
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const messages = [new HumanMessage("Test message")];
      const chunks: any[] = [];

      for await (const chunk of client.stream(messages)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toBe("Hello");
      expect(chunks[1].content).toBe(" world");
    });

    it("should handle thinking blocks in streaming response", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            const chunks = [
              '{"message":{"thinking":"<THINKING>Analyzing...</THINKING>"}}\n',
              '{"message":{"content":"Final answer"}}\n',
              '{"done":true}\n',
            ];
            let index = 0;

            return {
              read: async () => {
                if (index >= chunks.length) {
                  return { done: true, value: undefined };
                }
                const encoder = new TextEncoder();
                return { done: false, value: encoder.encode(chunks[index++]) };
              },
            };
          },
        },
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const messages = [new HumanMessage("Test message")];
      const chunks: any[] = [];

      for await (const chunk of client.stream(messages)) {
        chunks.push(chunk);
      }

      expect(chunks[0].additional_kwargs.thinking).toBe("<THINKING>Analyzing...</THINKING>");
      expect(chunks[1].content).toBe("Final answer");
    });

    it("should handle tool_call_chunks in streaming response", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            const chunks = [
              '{"message":{"tool_calls":[{"id":"call_1","function":{"name":"web_search","arguments":{"query":"test"}}}]}}\n',
              '{"done":true}\n',
            ];
            let index = 0;

            return {
              read: async () => {
                if (index >= chunks.length) {
                  return { done: true, value: undefined };
                }
                const encoder = new TextEncoder();
                return { done: false, value: encoder.encode(chunks[index++]) };
              },
            };
          },
        },
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const toolSchema: OllamaToolSchema = {
        type: "function",
        function: {
          name: "web_search",
          description: "Search the web",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      };

      const messages = [new HumanMessage("Test message")];
      const chunks: any[] = [];

      for await (const chunk of client.stream(messages, { tools: [toolSchema] })) {
        chunks.push(chunk);
      }

      expect(chunks[0].tool_call_chunks).toHaveLength(1);
      expect(chunks[0].tool_call_chunks[0].name).toBe("web_search");
      expect(chunks[0].tool_call_chunks[0].id).toBe("call_1");
    });

    it("should send tools array when provided", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            const chunks = ['{"message":{"content":"response"}}\n', '{"done":true}\n'];
            let index = 0;

            return {
              read: async () => {
                if (index >= chunks.length) {
                  return { done: true, value: undefined };
                }
                const encoder = new TextEncoder();
                return { done: false, value: encoder.encode(chunks[index++]) };
              },
            };
          },
        },
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const toolSchema: OllamaToolSchema = {
        type: "function",
        function: {
          name: "test_tool",
          description: "Test tool",
          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      };

      const messages = [new HumanMessage("Test message")];

      // Consume stream
      for await (const _ of client.stream(messages, { tools: [toolSchema] })) {
        // Just consume
        console.log("ignore", _);
      }

      // Verify ollamaAwareFetch was called with tools
      expect(mockedFetch).toHaveBeenCalledWith(
        "https://ollama.com/api/chat",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"tools"'),
        })
      );
    });

    it("should handle API errors gracefully", async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const messages = [new HumanMessage("Test message")];

      await expect(async () => {
        for await (const _ of client.stream(messages)) {
          // Should throw before yielding
          console.log("ignore", _);
        }
      }).rejects.toThrow("Ollama API error (401): Unauthorized");
    });

    it("should handle malformed JSON chunks gracefully", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            const chunks = [
              '{"message":{"content":"valid"}}\n',
              "{invalid json}\n", // This should be logged as error but not crash
              '{"message":{"content":"also valid"}}\n',
              '{"done":true}\n',
            ];
            let index = 0;

            return {
              read: async () => {
                if (index >= chunks.length) {
                  return { done: true, value: undefined };
                }
                const encoder = new TextEncoder();
                return { done: false, value: encoder.encode(chunks[index++]) };
              },
            };
          },
        },
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const messages = [new HumanMessage("Test message")];
      const chunks: any[] = [];

      for await (const chunk of client.stream(messages)) {
        chunks.push(chunk);
      }

      // Should only get valid chunks
      expect(chunks).toHaveLength(2);
      expect(chunks[0].content).toBe("valid");
      expect(chunks[1].content).toBe("also valid");
    });

    it("should handle AbortSignal for cancellation", async () => {
      const abortController = new AbortController();
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              // Simulate abort during streaming
              abortController.abort();
              throw new DOMException("Aborted", "AbortError");
            },
          }),
        },
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const messages = [new HumanMessage("Test message")];

      await expect(async () => {
        for await (const _ of client.stream(messages, { signal: abortController.signal })) {
          // Should throw due to abort
          console.log("ignore", _);
        }
      }).rejects.toThrow("Aborted");
    });
  });

  describe("invoke()", () => {
    it("should accumulate all chunks into a complete AIMessage", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            const chunks = [
              '{"message":{"content":"Hello"}}\n',
              '{"message":{"content":" world"}}\n',
              '{"done":true}\n',
            ];
            let index = 0;

            return {
              read: async () => {
                if (index >= chunks.length) {
                  return { done: true, value: undefined };
                }
                const encoder = new TextEncoder();
                return { done: false, value: encoder.encode(chunks[index++]) };
              },
            };
          },
        },
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const messages = [new HumanMessage("Test message")];

      const result = await client.invoke(messages);

      expect(result).toBeInstanceOf(AIMessage);
      expect(result.content).toBe("Hello world");
    });

    it("should accumulate thinking blocks", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            const chunks = [
              '{"message":{"thinking":"<THINKING>Part 1</THINKING>"}}\n',
              '{"message":{"thinking":"<THINKING>Part 2</THINKING>"}}\n',
              '{"message":{"content":"Final answer"}}\n',
              '{"done":true}\n',
            ];
            let index = 0;

            return {
              read: async () => {
                if (index >= chunks.length) {
                  return { done: true, value: undefined };
                }
                const encoder = new TextEncoder();
                return { done: false, value: encoder.encode(chunks[index++]) };
              },
            };
          },
        },
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const messages = [new HumanMessage("Test message")];

      const result = await client.invoke(messages);

      expect(result.additional_kwargs.thinking).toBe(
        "<THINKING>Part 1</THINKING><THINKING>Part 2</THINKING>"
      );
      expect(result.content).toBe("Final answer");
    });

    it("should accumulate and parse tool calls", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            const chunks = [
              '{"message":{"tool_calls":[{"id":"call_1","function":{"name":"web_search","arguments":{"query":"test"}}}]}}\n',
              '{"done":true}\n',
            ];
            let index = 0;

            return {
              read: async () => {
                if (index >= chunks.length) {
                  return { done: true, value: undefined };
                }
                const encoder = new TextEncoder();
                return { done: false, value: encoder.encode(chunks[index++]) };
              },
            };
          },
        },
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const messages = [new HumanMessage("Test message")];

      const result = await client.invoke(messages);

      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls![0].name).toBe("web_search");
      expect(result.tool_calls![0].args).toEqual({ query: "test" });
    });

    it("should handle single complete tool call chunk", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => {
            const chunks = [
              '{"message":{"tool_calls":[{"id":"call_1","function":{"name":"web_search","arguments":{"query":"test"}}}]}}\n',
              '{"done":true}\n',
            ];
            let index = 0;

            return {
              read: async () => {
                if (index >= chunks.length) {
                  return { done: true, value: undefined };
                }
                const encoder = new TextEncoder();
                return { done: false, value: encoder.encode(chunks[index++]) };
              },
            };
          },
        },
      };

      mockedFetch.mockResolvedValue(mockResponse as any);

      const client = new NativeOllamaClient(config);
      const messages = [new HumanMessage("Test message")];

      const result = await client.invoke(messages);

      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls![0].name).toBe("web_search");
      expect(result.tool_calls![0].args).toEqual({ query: "test" });
    });
  });
});
