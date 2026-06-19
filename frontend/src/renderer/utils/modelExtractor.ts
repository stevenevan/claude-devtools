import { type ModelInfo, parseModelString } from '@shared/utils/modelParser';

import type { Process, SemanticStep } from '@renderer/types/data';

// Returns the most common model across tool_call steps (handles mixed-model sessions)
export function extractMainModel(steps: SemanticStep[]): ModelInfo | null {
  const modelCounts = new Map<string, { count: number; info: ModelInfo }>();

  for (const step of steps) {
    if (step.type === 'tool_call' && step.content.sourceModel) {
      const model = step.content.sourceModel;
      if (model && model !== '<synthetic>') {
        const info = parseModelString(model);
        if (info) {
          const existing = modelCounts.get(info.name);
          if (existing) {
            existing.count++;
          } else {
            modelCounts.set(info.name, { count: 1, info });
          }
        }
      }
    }
  }

  let maxCount = 0;
  let mainModel: ModelInfo | null = null;

  for (const { count, info } of modelCounts.values()) {
    if (count > maxCount) {
      maxCount = count;
      mainModel = info;
    }
  }

  return mainModel;
}

export function extractSubagentModels(
  processes: Process[],
  mainModel: ModelInfo | null
): ModelInfo[] {
  const uniqueModels = new Map<string, ModelInfo>();

  for (const process of processes) {
    const assistantMsg = process.messages?.find(
      (m) => m.type === 'assistant' && m.model && m.model !== '<synthetic>'
    );

    if (assistantMsg?.model) {
      const modelInfo = parseModelString(assistantMsg.model);
      if (modelInfo && modelInfo.name !== mainModel?.name) {
        uniqueModels.set(modelInfo.name, modelInfo);
      }
    }
  }

  return Array.from(uniqueModels.values());
}
