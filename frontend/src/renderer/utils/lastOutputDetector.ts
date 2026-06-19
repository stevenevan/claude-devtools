import { toDate } from './aiGroupHelpers';

import type { SemanticStep } from '../types/data';
import type { AIGroupLastOutput } from '../types/groups';

// Special case: when the last tool_call is ExitPlanMode, return 'plan_exit' with plan content.
// Preamble text (if any) is captured from the preceding output step.
export function findLastOutput(
  steps: SemanticStep[],
  isOngoing: boolean = false
): AIGroupLastOutput | null {
  // Interruption takes precedence over ongoing status — always visible even if session appears ongoing
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'interruption') {
      return {
        type: 'interruption',
        timestamp: step.startTime,
      };
    }
  }

  if (isOngoing) {
    return {
      type: 'ongoing',
      timestamp: steps.length > 0 ? toDate(steps[steps.length - 1].startTime) : new Date(),
    };
  }

  let lastExitPlanModeStep: SemanticStep | null = null;
  let lastOutputBeforeExitPlanMode: SemanticStep | null = null;

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'tool_call' && step.content.toolName === 'ExitPlanMode') {
      lastExitPlanModeStep = step;
      for (let j = i - 1; j >= 0; j--) {
        if (steps[j].type === 'output' && steps[j].content.outputText) {
          lastOutputBeforeExitPlanMode = steps[j];
          break;
        }
      }
      break;
    }
  }

  // Only emit plan_exit if no output or tool_result comes after ExitPlanMode
  if (lastExitPlanModeStep) {
    const exitPlanModeIndex = steps.indexOf(lastExitPlanModeStep);
    let hasLaterEnding = false;

    for (let i = exitPlanModeIndex + 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'output' && step.content.outputText) {
        hasLaterEnding = true;
        break;
      }
      if (step.type === 'tool_result' && step.content.toolResultContent) {
        hasLaterEnding = true;
        break;
      }
    }

    if (!hasLaterEnding) {
      const toolInput = lastExitPlanModeStep.content.toolInput as
        | Record<string, unknown>
        | undefined;
      const planContent = toolInput?.plan as string | undefined;

      return {
        type: 'plan_exit',
        planContent: planContent ?? '',
        planPreamble: lastOutputBeforeExitPlanMode?.content.outputText,
        timestamp: lastExitPlanModeStep.startTime,
      };
    }
  }

  // Pass 1: last output step with text
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'output' && step.content.outputText) {
      return {
        type: 'text',
        text: step.content.outputText,
        timestamp: step.startTime,
      };
    }
  }

  // Pass 2: last tool_result step
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'tool_result' && step.content.toolResultContent) {
      return {
        type: 'tool_result',
        toolName: step.content.toolName,
        toolResult: step.content.toolResultContent,
        isError: step.content.isError ?? false,
        timestamp: step.startTime,
      };
    }
  }

  // Pass 3: last interruption step
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'interruption' && step.content.interruptionText) {
      return {
        type: 'interruption',
        interruptionMessage: step.content.interruptionText,
        timestamp: step.startTime,
      };
    }
  }

  return null;
}
