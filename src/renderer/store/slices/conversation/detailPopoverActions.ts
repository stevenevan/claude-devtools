import type { ActiveDetailItem } from './types';

export function buildDetailPopover(
  aiGroupId: string,
  itemId: string,
  type: ActiveDetailItem['type']
): ActiveDetailItem {
  return { aiGroupId, itemId, type };
}
