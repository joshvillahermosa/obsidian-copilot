import React from "react";
import { AlertCircle } from "lucide-react";
import { CustomModel, OllamaThinkingLevel } from "@/aiParams";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isGptOssModel, isOllamaCloudEndpoint, validateOllamaWebSearch } from "@/utils/ollamaUtils";

interface OllamaCloudControlsProps {
  model: CustomModel;
  onUpdate: (updates: Partial<CustomModel>) => void;
  disabled?: boolean;
}

/**
 * GPT-OSS specific controls for thinking level and web search
 * Only renders when the model is a GPT-OSS variant on Ollama Cloud
 */
export const OllamaCloudControls: React.FC<OllamaCloudControlsProps> = ({
  model,
  onUpdate,
  disabled = false,
}) => {
  // Only show controls for GPT-OSS models on Ollama Cloud
  const shouldShowControls = isGptOssModel(model.name) && isOllamaCloudEndpoint(model.baseUrl);

  if (!shouldShowControls) {
    return null;
  }

  // Get current values with defaults
  const currentThinkingLevel: OllamaThinkingLevel = model.ollamaThinkingLevel || "medium";
  const currentWebSearch = model.enableOllamaWebSearch ?? true;

  // Validate web search configuration
  const validation = validateOllamaWebSearch(model);
  const showWarning = currentWebSearch && !validation.valid;

  const handleThinkingLevelChange = (value: string) => {
    onUpdate({ ollamaThinkingLevel: value as OllamaThinkingLevel });
  };

  const handleWebSearchToggle = (checked: boolean) => {
    onUpdate({ enableOllamaWebSearch: checked });
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="tw-flex tw-items-center tw-gap-2">
        {/* Thinking Level Dropdown */}
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <span className="tw-text-xs tw-text-muted">Thinking:</span>
          <Select
            value={currentThinkingLevel}
            onValueChange={handleThinkingLevelChange}
            disabled={disabled}
          >
            <SelectTrigger className="tw-h-7 tw-w-24 tw-text-xs">
              <SelectValue placeholder="Select level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Web Search Toggle */}
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <span className="tw-text-xs tw-text-muted">Web Search:</span>
          <SettingSwitch
            checked={currentWebSearch}
            onCheckedChange={handleWebSearchToggle}
            disabled={disabled}
            className="tw-scale-90"
          />
          {/* Validation Warning Icon */}
          {showWarning && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="tw-size-4 tw-text-[--text-warning]" />
              </TooltipTrigger>
              <TooltipContent className="tw-max-w-64">
                <p className="tw-text-xs">{validation.error}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};
