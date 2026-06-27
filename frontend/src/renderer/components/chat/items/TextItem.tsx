import { CSSProperties, FC, memo } from 'react';

import { MessageSquare } from 'lucide-react';

import { MarkdownViewer } from '../viewers';

import { truncateText } from '@renderer/utils/stringUtils';

import { BaseItem } from './BaseItem';

import type { SemanticStep } from '@renderer/types/data';
import type { TriggerColor } from '@shared/constants/triggerColors';

interface TextItemProps {
  step: SemanticStep;
  preview: string;
  onClick: () => void;
  isExpanded: boolean;

  highlightClasses?: string;

  highlightStyle?: CSSProperties;

  notificationDotColor?: TriggerColor;
}

export const TextItem: FC<TextItemProps> = memo(function TextItem({
  step,
  preview,
  onClick,
  isExpanded,
  highlightClasses,
  highlightStyle,
  notificationDotColor,
}) {
  const fullContent = step.content.outputText ?? preview;
  const truncatedPreview = truncateText(preview, 60);

  // Get token count from step.tokens.output or step.content.tokenCount
  const tokenCount = step.tokens?.output ?? step.content.tokenCount ?? 0;

  return (
    <BaseItem
      icon={<MessageSquare className="size-4" />}
      label="Output"
      summary={truncatedPreview}
      tokenCount={tokenCount}
      onClick={onClick}
      isExpanded={isExpanded}
      highlightClasses={highlightClasses}
      highlightStyle={highlightStyle}
      notificationDotColor={notificationDotColor}
    >
      <MarkdownViewer content={fullContent} maxHeight="max-h-96" copyable />
    </BaseItem>
  );
});
