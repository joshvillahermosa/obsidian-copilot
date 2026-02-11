import { CustomModel } from "@/aiParams";
import { ModelCapability } from "@/constants";

/**
 * Determine if an Ollama endpoint is cloud-based (not local)
 * @param baseUrl - The base URL of the Ollama endpoint
 * @returns true if the endpoint is cloud-based, false if local
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
 * @param modelName - The name of the model
 * @returns true if the model is a GPT-OSS variant
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
 * @param model - The custom model configuration
 * @returns Object containing all computed capabilities
 */
export function getOllamaModelCapabilities(model: CustomModel): OllamaModelCapabilities {
  const isCloud = isOllamaCloudEndpoint(model.baseUrl);
  const isGptOss = isGptOssModel(model.name);
  const hasKey = !!model.apiKey;

  return {
    isCloudEndpoint: isCloud,
    isGptOss,
    supportsWebSearch: isGptOss && isCloud && hasKey,
    supportsThinking:
      isGptOss || (model.capabilities?.includes(ModelCapability.REASONING) ?? false),
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
 * @param model - The custom model configuration to validate
 * @returns Validation result with error/warning messages if applicable
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
