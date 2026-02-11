import {
  isOllamaCloudEndpoint,
  isGptOssModel,
  getOllamaModelCapabilities,
  validateOllamaWebSearch,
} from "./ollamaUtils";
import { CustomModel } from "@/aiParams";
import { ModelCapability } from "@/constants";

describe("ollamaUtils", () => {
  describe("isOllamaCloudEndpoint", () => {
    it("should return false for localhost endpoints", () => {
      expect(isOllamaCloudEndpoint("http://localhost:11434")).toBe(false);
      expect(isOllamaCloudEndpoint("https://localhost:11434")).toBe(false);
      expect(isOllamaCloudEndpoint("http://LOCALHOST:11434")).toBe(false);
    });

    it("should return false for 127.0.0.1 endpoints", () => {
      expect(isOllamaCloudEndpoint("http://127.0.0.1:11434")).toBe(false);
      expect(isOllamaCloudEndpoint("https://127.0.0.1:11434")).toBe(false);
    });

    it("should return false for 0.0.0.0 endpoints", () => {
      expect(isOllamaCloudEndpoint("http://0.0.0.0:11434")).toBe(false);
    });

    it("should return true for cloud endpoints", () => {
      expect(isOllamaCloudEndpoint("https://ollama.com")).toBe(true);
      expect(isOllamaCloudEndpoint("http://192.168.1.100:11434")).toBe(true);
      expect(isOllamaCloudEndpoint("https://api.example.com/ollama")).toBe(true);
    });

    it("should return false for undefined or empty baseUrl", () => {
      expect(isOllamaCloudEndpoint(undefined)).toBe(false);
      expect(isOllamaCloudEndpoint("")).toBe(false);
    });
  });

  describe("isGptOssModel", () => {
    it("should return true for GPT-OSS model names", () => {
      expect(isGptOssModel("gpt-oss:120b-cloud")).toBe(true);
      expect(isGptOssModel("gpt-oss:4b")).toBe(true);
      expect(isGptOssModel("GPT-OSS:120B")).toBe(true);
    });

    it("should be case insensitive", () => {
      expect(isGptOssModel("GPT-OSS:4B")).toBe(true);
      expect(isGptOssModel("Gpt-Oss:120b")).toBe(true);
      expect(isGptOssModel("gPt-OsS:70b")).toBe(true);
    });

    it("should return false for non-GPT-OSS models", () => {
      expect(isGptOssModel("llama3.2:3b")).toBe(false);
      expect(isGptOssModel("mistral:7b")).toBe(false);
      expect(isGptOssModel("codellama:13b")).toBe(false);
    });
  });

  describe("getOllamaModelCapabilities", () => {
    it("should correctly identify cloud GPT-OSS model with API key", () => {
      const model: CustomModel = {
        name: "gpt-oss:120b-cloud",
        provider: "ollama",
        baseUrl: "https://ollama.com",
        apiKey: "test-key",
        enabled: true,
      };

      const caps = getOllamaModelCapabilities(model);

      expect(caps.isCloudEndpoint).toBe(true);
      expect(caps.isGptOss).toBe(true);
      expect(caps.supportsWebSearch).toBe(true);
      expect(caps.supportsThinking).toBe(true);
      expect(caps.hasApiKey).toBe(true);
    });

    it("should correctly identify local GPT-OSS model without web search support", () => {
      const model: CustomModel = {
        name: "gpt-oss:4b",
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        enabled: true,
      };

      const caps = getOllamaModelCapabilities(model);

      expect(caps.isCloudEndpoint).toBe(false);
      expect(caps.isGptOss).toBe(true);
      expect(caps.supportsWebSearch).toBe(false); // local + no API key
      expect(caps.supportsThinking).toBe(true);
      expect(caps.hasApiKey).toBe(false);
    });

    it("should correctly identify non-GPT-OSS cloud model", () => {
      const model: CustomModel = {
        name: "llama3.2:3b",
        provider: "ollama",
        baseUrl: "https://ollama.com",
        apiKey: "test-key",
        enabled: true,
      };

      const caps = getOllamaModelCapabilities(model);

      expect(caps.isCloudEndpoint).toBe(true);
      expect(caps.isGptOss).toBe(false);
      expect(caps.supportsWebSearch).toBe(false); // not GPT-OSS
      expect(caps.supportsThinking).toBe(false);
      expect(caps.hasApiKey).toBe(true);
    });

    it("should detect thinking capability from model capabilities array", () => {
      const model: CustomModel = {
        name: "llama3.2:3b",
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        enabled: true,
        capabilities: [ModelCapability.REASONING],
      };

      const caps = getOllamaModelCapabilities(model);

      expect(caps.supportsThinking).toBe(true);
    });

    it("should return false for web search when API key is missing", () => {
      const model: CustomModel = {
        name: "gpt-oss:120b-cloud",
        provider: "ollama",
        baseUrl: "https://ollama.com",
        enabled: true,
        // apiKey missing
      };

      const caps = getOllamaModelCapabilities(model);

      expect(caps.supportsWebSearch).toBe(false);
    });
  });

  describe("validateOllamaWebSearch", () => {
    it("should validate correctly configured GPT-OSS model with web search", () => {
      const model: CustomModel = {
        name: "gpt-oss:120b-cloud",
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
      expect(result.warning).toBeUndefined();
    });

    it("should return error when web search enabled for non-GPT-OSS model", () => {
      const model: CustomModel = {
        name: "llama3.2:3b",
        provider: "ollama",
        baseUrl: "https://ollama.com",
        apiKey: "test-key",
        enableOllamaWebSearch: true,
        enabled: true,
      };

      const result = validateOllamaWebSearch(model);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Web search only available for GPT-OSS models");
    });

    it("should return error when web search enabled for local endpoint", () => {
      const model: CustomModel = {
        name: "gpt-oss:4b",
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        apiKey: "test-key",
        enableOllamaWebSearch: true,
        enabled: true,
      };

      const result = validateOllamaWebSearch(model);

      expect(result.valid).toBe(false);
      expect(result.error).toBe(
        "Web search requires Ollama Cloud. Change base URL to https://ollama.com"
      );
    });

    it("should return error when API key is missing", () => {
      const model: CustomModel = {
        name: "gpt-oss:120b-cloud",
        provider: "ollama",
        baseUrl: "https://ollama.com",
        enableOllamaWebSearch: true,
        enabled: true,
        // apiKey missing
      };

      const result = validateOllamaWebSearch(model);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("API key required. Get key at https://ollama.com/settings/keys");
    });

    it("should return warning for GPT-OSS with low context length", () => {
      const model: CustomModel = {
        name: "gpt-oss:120b-cloud",
        provider: "ollama",
        baseUrl: "https://ollama.com",
        apiKey: "test-key",
        maxTokens: 16000,
        enabled: true,
      };

      const result = validateOllamaWebSearch(model);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.warning).toBe("GPT-OSS works best with ≥32,000 tokens. Current: 16000");
    });

    it("should return warning for GPT-OSS with undefined maxTokens", () => {
      const model: CustomModel = {
        name: "gpt-oss:120b-cloud",
        provider: "ollama",
        baseUrl: "https://ollama.com",
        apiKey: "test-key",
        enabled: true,
        // maxTokens undefined
      };

      const result = validateOllamaWebSearch(model);

      expect(result.valid).toBe(true);
      expect(result.warning).toBe("GPT-OSS works best with ≥32,000 tokens. Current: 16000");
    });

    it("should not return warning when web search is disabled", () => {
      const model: CustomModel = {
        name: "gpt-oss:120b-cloud",
        provider: "ollama",
        baseUrl: "https://ollama.com",
        apiKey: "test-key",
        maxTokens: 16000,
        enableOllamaWebSearch: false,
        enabled: true,
      };

      const result = validateOllamaWebSearch(model);

      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined(); // Warning still shown for context length
    });

    it("should validate model without web search enabled", () => {
      const model: CustomModel = {
        name: "llama3.2:3b",
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        enabled: true,
      };

      const result = validateOllamaWebSearch(model);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });
});
