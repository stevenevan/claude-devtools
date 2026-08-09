import { expect, test } from 'bun:test';

import { getStepSummaryRegionId, isStepSummaryExpanded } from './StepSummary';

test('StepSummary keeps a source-derived ID for controlled expansion and region linkage', () => {
  const summaryId = 'simple-steps-assistant-turn-1';

  expect(getStepSummaryRegionId(summaryId)).toBe('simple-steps-assistant-turn-1-details');
  expect(getStepSummaryRegionId(summaryId)).toBe(getStepSummaryRegionId(summaryId));
  expect(isStepSummaryExpanded(new Set([summaryId]), summaryId)).toBeTrue();
  expect(isStepSummaryExpanded(new Set(), summaryId)).toBeFalse();
});
