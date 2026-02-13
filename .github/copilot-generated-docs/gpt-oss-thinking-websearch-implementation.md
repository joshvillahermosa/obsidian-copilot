# GPT-OSS Thinking & Web Search Controls - Implementation Plan

**Created**: February 13, 2026
**Status**: ✅ Complete (Phases 1-5)
**Feature**: Add GPT-OSS-specific controls (Thinking level dropdown and Web Search toggle) to chat toolbar and model configuration dialogs

---

## Overview

This feature adds dynamic toolbar controls for GPT-OSS cloud models that allow users to:

1. Select thinking level (Low, Medium, High) from a dropdown
2. Toggle web search on/off
3. Configure default values when adding/editing models

These controls only appear when a GPT-OSS model using Ollama Cloud is selected, ensuring a clean UI for other model types.

---

## Architecture Summary

### Key Components

1. **OllamaCloudControls.tsx** - New toolbar component for GPT-OSS settings
2. **ChatInput.tsx** - Main chat interface, hosts the controls
3. **ModelAddDialog.tsx** - Add model flow with GPT-OSS defaults
4. **ModelEditDialog.tsx** - Edit model parameters including GPT-OSS settings
5. **ollamaUtils.ts** - Detection and validation utilities
6. **LLMChainRunner.ts** - Already integrated, reads settings from config

### Data Flow

```
User selects GPT-OSS model
    ↓
Chat toolbar displays controls (reads from data.json)
    ↓
User changes thinking level or web search toggle
    ↓
Settings immediately saved to activeModels in data.json
    ↓
LLMChainRunner reads settings when generating response
    ↓
NativeOllamaClient receives thinking level and web search params
```

### File References

- Types: [src/aiParams.ts](../../src/aiParams.ts#L153-L154)
- Utilities: [src/utils/ollamaUtils.ts](../../src/utils/ollamaUtils.ts)
- Chain Runner: [src/LLMProviders/chainRunner/LLMChainRunner.ts](../../src/LLMProviders/chainRunner/LLMChainRunner.ts#L137-L140)
- UI Components: [src/components/ui/select.tsx](../../src/components/ui/select.tsx), [src/components/ui/setting-switch.tsx](../../src/components/ui/setting-switch.tsx)

---

## Design Decisions

| Decision                | Choice                                         | Rationale                                          |
| ----------------------- | ---------------------------------------------- | -------------------------------------------------- |
| **UI Location**         | Chat toolbar (visible, next to model selector) | Quick access, always visible when GPT-OSS selected |
| **Persistence**         | Save to model config immediately               | Maintain user preferences across sessions          |
| **Model Configuration** | Controls in both Add and Edit dialogs          | Set defaults on creation, modify anytime           |
| **Defaults**            | Thinking: "medium", Web Search: enabled        | Optimal balance for most users                     |
| **Component Reuse**     | Existing Select and SettingSwitch              | Consistency with codebase patterns                 |

---

## Development Phases

### Phase 1: Foundation & Types ✅ COMPLETE

**Goal**: Ensure type safety and utility functions are in place

#### Tasks

1. **Update TypeScript Types**

   - File: [src/aiParams.ts](../../src/aiParams.ts)
   - Verify `CustomModel` interface includes:
     ```typescript
     ollamaThinkingLevel?: "low" | "medium" | "high";
     enableOllamaWebSearch?: boolean;
     ```
   - Add type alias: `export type OllamaThinkingLevel = "low" | "medium" | "high"`
   - Ensure fields are optional for backward compatibility

2. **Verify Utility Functions**
   - File: [src/utils/ollamaUtils.ts](../../src/utils/ollamaUtils.ts)
   - Confirm these functions exist and work correctly:
     - `isGptOssModel(modelName: string): boolean`
     - `isOllamaCloudEndpoint(baseUrl: string): boolean`
     - `validateOllamaWebSearch(model: CustomModel): ValidationResult`
   - Add JSDoc comments if missing

**Deliverable**: Type-safe foundation for GPT-OSS controls

---

### Phase 2: Chat Toolbar Controls Component ✅ COMPLETE

**Goal**: Create reusable component that renders thinking dropdown and web search toggle

#### Tasks

1. **Create OllamaCloudControls Component**

   - File: Create new [src/components/chat-components/OllamaCloudControls.tsx](../../src/components/chat-components/OllamaCloudControls.tsx)
   - Component structure:

     ```typescript
     interface OllamaCloudControlsProps {
       model: CustomModel;
       onUpdate: (updates: Partial<CustomModel>) => void;
       disabled?: boolean;
     }

     export const OllamaCloudControls: React.FC<OllamaCloudControlsProps>;
     ```

2. **Implement Conditional Rendering**

   - Import detection functions from `ollamaUtils.ts`
   - Only render when: `isGptOssModel(model.name) && isOllamaCloudEndpoint(model.baseUrl)`
   - Return `null` if conditions not met

3. **Add Thinking Level Dropdown**

   - Use `Select` component from [src/components/ui/select.tsx](../../src/components/ui/select.tsx)
   - Controlled component pattern: `value={model.ollamaThinkingLevel || "medium"}`
   - Options: Low, Medium, High
   - On change: `onUpdate({ ollamaThinkingLevel: newValue })`
   - Styling: Match [ChatToolControls.tsx](../../src/components/chat-components/ChatToolControls.tsx) patterns

4. **Add Web Search Toggle**

   - Use `SettingSwitch` from [src/components/ui/setting-switch.tsx](../../src/components/ui/setting-switch.tsx)
   - Controlled component: `checked={model.enableOllamaWebSearch ?? true}`
   - On change: `onUpdate({ enableOllamaWebSearch: newValue })`
   - Label: "Web Search"

5. **Add Validation Warnings**

   - Call `validateOllamaWebSearch(model)`
   - If validation fails, show warning icon with tooltip
   - Display error message (e.g., "API key required for web search")
   - Use existing icon components from codebase

6. **Layout & Styling**
   - Use Tailwind classes with `tw-` prefix
   - Compact horizontal layout to fit in toolbar
   - Responsive design considerations
   - Match visual style of existing toolbar controls

**Deliverable**: Reusable, self-contained toolbar controls component

---

### Phase 3: Chat Toolbar Integration ✅ COMPLETE

**Goal**: Add OllamaCloudControls to the chat interface

#### Tasks

1. **Integrate into ChatInput**

   - File: Edit [src/components/chat-components/ChatInput.tsx](../../src/components/chat-components/ChatInput.tsx)
   - Import `OllamaCloudControls` component
   - Import `getSettings` and `updateSetting` from settings store
   - Import `useAtom` from Jotai for `modelKeyAtom`

2. **Get Current Model**

   - Read current model key from `modelKeyAtom`
   - Parse to get `name` and `provider` (format: `name|provider`)
   - Fetch model from `settings.activeModels.find(...)`

3. **Implement Update Handler**

   - Create `handleOllamaUpdate` function:
     ```typescript
     const handleOllamaUpdate = (updates: Partial<CustomModel>) => {
       const settings = getSettings();
       const updatedModels = settings.activeModels.map((m) =>
         `${m.name}|${m.provider}` === modelKey ? { ...m, ...updates } : m
       );
       updateSetting("activeModels", updatedModels);
     };
     ```
   - No debouncing needed (immediate save per design decision)

4. **Add to Toolbar Layout**

   - Position: After `ModelSelector`, before `ChatToolControls`
   - Suggested structure:
     ```tsx
     <div className="tw-flex tw-items-center tw-gap-2">
       <ModelSelector value={modelKey} onChange={setModelKey} />
       {currentModel && (
         <OllamaCloudControls
           model={currentModel}
           onUpdate={handleOllamaUpdate}
           disabled={isGenerating}
         />
       )}
       <ChatToolControls {...toolControlsProps} />
     </div>
     ```

5. **Test Rendering**
   - Verify controls appear when GPT-OSS cloud model selected
   - Verify controls disappear when switching to other models
   - Verify disabled state when generating

**Deliverable**: Functional controls in chat interface that read/write settings

---

### Phase 4: Model Configuration Dialogs ✅ COMPLETE

**Goal**: Add GPT-OSS controls to model add/edit workflows

#### Part A: ModelAddDialog

1. **Add Form State**

   - File: Edit [src/settings/v2/components/ModelAddDialog.tsx](../../src/settings/v2/components/ModelAddDialog.tsx)
   - Add state variables:
     ```typescript
     const [ollamaThinkingLevel, setOllamaThinkingLevel] = useState<OllamaThinkingLevel>("medium");
     const [enableOllamaWebSearch, setEnableOllamaWebSearch] = useState<boolean>(true);
     ```

2. **Add Conditional Form Section**

   - After base model configuration fields
   - Show when: provider is Ollama AND model name matches GPT-OSS pattern
   - Section title: "GPT-OSS Defaults"
   - Use `FormField` component pattern from existing dialog

3. **Add Thinking Level Dropdown**

   - Label: "Default Thinking Level"
   - Description: "Controls reasoning depth (affects response time)"
   - Use same `Select` component as toolbar
   - Bind to `ollamaThinkingLevel` state

4. **Add Web Search Toggle**

   - Label: "Enable Web Search by Default"
   - Description: "Allows model to search the web for information"
   - Use `SettingSwitch` component
   - Bind to `enableOllamaWebSearch` state

5. **Include in Save Payload**

   - When calling `addModel()`, include:
     ```typescript
     const newModel = {
       ...baseModelConfig,
       ...(isGptOssAndCloud && {
         ollamaThinkingLevel,
         enableOllamaWebSearch,
       }),
     };
     ```

6. **Add Validation**
   - Call `validateOllamaWebSearch()` before save
   - Show error message if validation fails
   - Prevent save if critical validation fails

#### Part B: ModelEditDialog

1. **Check Model Type**

   - File: Edit [src/settings/v2/components/ModelEditDialog.tsx](../../src/settings/v2/components/ModelEditDialog.tsx)
   - Determine if model is GPT-OSS + Ollama Cloud
   - Store in local variable: `const isGptOssCloud = isGptOssModel(model.name) && isOllamaCloudEndpoint(model.baseUrl)`

2. **Add Conditional Section**

   - Add section in parameters area (after main model parameters)
   - Pattern similar to `showReasoningEffort` in [ModelParametersEditor.tsx](../../src/components/ui/ModelParametersEditor.tsx)
   - Section header: "GPT-OSS Settings"

3. **Add Controls**

   - Thinking level dropdown (same as Add dialog)
   - Web search toggle (same as Add dialog)
   - Bind directly to model properties via existing debounced save

4. **Wire to Auto-Save**

   - Ensure existing 500ms debounce applies to these fields
   - Changes should trigger `debouncedUpdate()`
   - Include in save payload when flushing debounce

5. **Validation**
   - Show inline warnings if configuration invalid
   - Don't prevent editing (allow user to fix issues)

**Deliverable**: Complete model configuration flow with GPT-OSS defaults

---

### Phase 5: Default Initialization ✅ COMPLETE

**Goal**: Ensure new GPT-OSS models have sensible defaults

#### Tasks

1. **Update Model Creation Logic**

   - File: Identify model creation function in [src/settings/model.ts](../../src/settings/model.ts) or settings store
   - When adding new model, check if it's GPT-OSS + Ollama Cloud
   - Apply defaults if not explicitly provided:
     ```typescript
     if (isGptOssModel(model.name) && isOllamaCloudEndpoint(model.baseUrl)) {
       model.ollamaThinkingLevel = model.ollamaThinkingLevel ?? "medium";
       model.enableOllamaWebSearch = model.enableOllamaWebSearch ?? true;
     }
     ```

2. **Migration for Existing Models**
   - Check if existing GPT-OSS models in `data.json` lack these fields
   - Optional: Add migration in settings loader to backfill defaults
   - Alternative: Let edit dialog handle missing values gracefully

**Deliverable**: All GPT-OSS models have consistent defaults

---

### Phase 6: Enhanced Capabilities (Optional)

**Goal**: Make capability badges reactive to user settings

#### Tasks

1. **Update Capability Detection**

   - File: Edit [src/utils/ollamaUtils.ts](../../src/utils/ollamaUtils.ts)
   - Function: `getOllamaModelCapabilities(model: CustomModel)`
   - Add logic:

     ```typescript
     const capabilities: ModelCapability[] = [];

     if (model.ollamaThinkingLevel) {
       capabilities.push(ModelCapability.REASONING);
     }

     if (model.enableOllamaWebSearch) {
       capabilities.push(ModelCapability.WEB_SEARCH);
     }

     return capabilities;
     ```

2. **Update Display Logic**
   - Ensure model selector and other UI uses computed capabilities
   - Badges should update when settings change
   - Test that capability icons appear/disappear correctly

**Deliverable**: Dynamic capability badges based on user configuration

---

## Manual Testing Checklist

### Test 1: Add New GPT-OSS Model

**Steps**:

1. Open Settings → Models → Add Model
2. Select provider: "Ollama"
3. Enter model name: "gpt-oss:test-model"
4. Set base URL: "https://ollama.com"
5. Enter API key

**Expected Behavior**:

- ✓ "GPT-OSS Defaults" section appears after base configuration
- ✓ Thinking level dropdown shows, defaults to "Medium"
- ✓ Web search toggle shows, defaults to enabled/ON
- ✓ Can change thinking level to "Low" or "High"
- ✓ Can toggle web search off/on
- ✓ Save button saves configuration

**Verification**:

- Open `data.json`
- Find new model in `activeModels` array
- Confirm `ollamaThinkingLevel: "medium"` (or user's selection)
- Confirm `enableOllamaWebSearch: true` (or user's selection)
- Confirm `capabilities` includes appropriate values

---

### Test 2: Edit Existing GPT-OSS Model

**Steps**:

1. Open Settings → Models
2. Find existing GPT-OSS model (e.g., "gpt-oss:120b-cloud")
3. Click edit icon
4. Locate "GPT-OSS Settings" section

**Expected Behavior**:

- ✓ Thinking level dropdown shows current value from config
- ✓ Web search toggle shows current state from config
- ✓ Change thinking from "high" to "low"
- ✓ Toggle web search from on to off
- ✓ Wait 500ms (debounce period)

**Verification**:

- Open `data.json`
- Confirm `ollamaThinkingLevel` updated to "low"
- Confirm `enableOllamaWebSearch` updated to `false`
- Changes persisted correctly

---

### Test 3: Chat Toolbar Display

**Steps**:

1. Open Copilot chat view
2. Select a GPT-OSS cloud model from model selector
3. Observe toolbar area

**Expected Behavior**:

- ✓ Thinking level dropdown appears after model selector
- ✓ Dropdown shows current value from model config
- ✓ Web search toggle appears next to thinking dropdown
- ✓ Toggle shows current state from model config
- ✓ Controls styled consistently with other toolbar elements
- ✓ Controls responsive on mobile viewport

---

### Test 4: Change Settings in Chat

**Steps**:

1. In chat view, with GPT-OSS model selected
2. Change thinking level from "medium" to "high"
3. Immediately check `data.json` (no delay)
4. Toggle web search from on to off
5. Immediately check `data.json` again

**Expected Behavior**:

- ✓ Thinking level change saves instantly to `data.json`
- ✓ Web search toggle change saves instantly to `data.json`
- ✓ No 500ms delay (immediate persistence)
- ✓ UI reflects updated values

**Verification**:

- `data.json` has `ollamaThinkingLevel: "high"`
- `data.json` has `enableOllamaWebSearch: false`

---

### Test 5: Model Switching

**Steps**:

1. In chat, select GPT-OSS cloud model
2. Note controls are visible with values A
3. Switch to different GPT-OSS cloud model
4. Note controls show values B (different from A)
5. Switch to non-GPT-OSS model (e.g., "gpt-4.1")

**Expected Behavior**:

- ✓ Controls persist values per-model
- ✓ Switching models loads correct settings
- ✓ Controls disappear when non-GPT-OSS model selected
- ✓ Controls reappear when switching back to GPT-OSS

---

### Test 6: Send Message with Custom Settings

**Steps**:

1. Select GPT-OSS model
2. Set thinking to "high"
3. Enable web search
4. Type message: "What's the latest news about AI?"
5. Send message
6. Observe response

**Expected Behavior**:

- ✓ No errors in console
- ✓ Response generates successfully
- ✓ If thinking applied, response may show `<THINKING>` blocks (if debug enabled)
- ✓ If web search enabled, response may cite sources

**Verification**:

- Check console logs (if debug mode on)
- Confirm `NativeOllamaClient` used (not standard `ChatOllama`)
- Confirm thinking level and web search params passed to client

---

### Test 7: Disable Web Search & Send Message

**Steps**:

1. Select GPT-OSS model
2. Toggle web search OFF
3. Send message: "Hello"

**Expected Behavior**:

- ✓ Standard `ChatOllama` client used (NOT `NativeOllamaClient`)
- ✓ Response generates normally
- ✓ No web search tools injected

**Verification**:

- Check `LLMChainRunner.ts` logic: `shouldUseNativeOllama` should be `false` when web search disabled
- Standard Ollama API endpoint called

---

### Test 8: Non-GPT-OSS Ollama Model

**Steps**:

1. Add/select local Ollama model (e.g., "llama3:8b")
2. Set base URL: "http://localhost:11434"
3. Open chat with this model

**Expected Behavior**:

- ✓ GPT-OSS controls do NOT appear in Add dialog
- ✓ GPT-OSS controls do NOT appear in Edit dialog
- ✓ GPT-OSS controls do NOT appear in chat toolbar
- ✓ Chat works normally with standard Ollama client

---

### Test 9: Validation Warnings

**Steps**:

1. Add GPT-OSS model with cloud URL
2. DO NOT enter API key
3. Enable web search toggle
4. Try to save or use the model

**Expected Behavior**:

- ✓ Warning icon appears next to web search toggle
- ✓ Tooltip shows: "API key required for web search" (or similar)
- ✓ Still allows saving (warning, not error)
- ✓ Runtime error handled gracefully if API call fails

---

### Test 10: Edge Cases

**Test 10a**: Empty/Missing Values

- Model with no `ollamaThinkingLevel` set → defaults to "medium"
- Model with no `enableOllamaWebSearch` set → defaults to `true`

**Test 10b**: Invalid Values

- Model with `ollamaThinkingLevel: "invalid"` → fallback to "medium"
- Model with `enableOllamaWebSearch: "invalid"` → fallback to `true`

**Test 10c**: Model Name Variations

- Test with "gpt-oss:120b-cloud"
- Test with "GPT-OSS:70B-CLOUD" (case insensitive?)
- Test with "gpt-oss-v2:10b"

**Test 10d**: Local Ollama with Cloud Model Name

- Model: "gpt-oss:test"
- URL: "http://localhost:11434"
- Expected: Controls should NOT appear (not cloud endpoint)

---

## Success Criteria

- [x] GPT-OSS controls appear in chat toolbar when applicable
- [x] Controls appear in ModelAddDialog with correct defaults
- [x] Controls appear in ModelEditDialog with current values
- [x] Changes to thinking level persist immediately to `data.json`
- [x] Changes to web search toggle persist immediately to `data.json`
- [x] Controls only appear for GPT-OSS + Ollama Cloud models
- [x] Non-GPT-OSS models unaffected (no controls shown)
- [x] Local Ollama models unaffected (no controls shown)
- [x] Validation warnings display when API key missing
- [ ] All manual test cases pass (pending user testing)
- [x] No regression on existing Ollama functionality
- [x] Code follows existing patterns (Radix UI, Tailwind, Jotai)

---

## Technical Notes

### Detection Logic

The controls should appear when ALL conditions are true:

1. `model.name` matches GPT-OSS pattern (use `isGptOssModel()`)
2. `model.provider === ChatModelProviders.OLLAMA`
3. `model.baseUrl` is an Ollama Cloud endpoint (use `isOllamaCloudEndpoint()`)

### Settings Persistence

- **Chat toolbar changes**: Immediate save, no debounce
- **ModelEditDialog changes**: 500ms debounce (existing pattern)
- **ModelAddDialog**: Save on form submit

### Component Styling

Match existing toolbar patterns:

- Compact horizontal layout
- Muted text colors for labels
- Hover states for interactive elements
- Disabled states when generating
- Mobile-responsive (consider collapsing to icons on small screens)

### Error Handling

- Gracefully handle missing API keys (show warning, don't block)
- Handle invalid configuration values (fallback to defaults)
- Log errors to console when debug mode enabled
- Don't crash if model config is malformed

---

## Future Enhancements

1. **Presets**: Add "Quick Presets" button with common configurations

   - Fast: Low thinking, web search off
   - Balanced: Medium thinking, web search on (default)
   - Deep: High thinking, web search on

2. **Context Menu**: Right-click model in selector for quick settings

3. **Keyboard Shortcuts**:

   - `Cmd+Shift+T`: Cycle thinking levels
   - `Cmd+Shift+W`: Toggle web search

4. **Usage Analytics**: Track which thinking levels and web search settings are most popular

5. **Response Time Indicators**: Show estimated response time based on thinking level

---

## Related Documentation

- [Ollama Utils Implementation](../../src/utils/ollamaUtils.ts)
- [LLM Chain Runner](../../src/LLMProviders/chainRunner/LLMChainRunner.ts)
- [Model Configuration Types](../../src/aiParams.ts)
- [Native Ollama Client](../../src/LLMProviders/ollamaAwareFetch.ts)
- [CORS Investigation](../../CORS_INVESTIGATION.md)

---

**End of Implementation Plan**
