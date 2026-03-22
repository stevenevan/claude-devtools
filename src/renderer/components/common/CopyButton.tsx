import React from 'react';

import { Button } from '@renderer/components/ui/button';
import { useClipboard } from '@renderer/hooks/mantine';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  /** Text to copy to clipboard */
  text: string;
  /** Background color the gradient fades into (must match parent surface) */
  bgColor?: string;
  /** Render as inline element instead of absolute overlay */
  inline?: boolean;
}

/**
 * Copy-to-clipboard button with two modes:
 *
 * **Overlay** (default): Absolute-positioned in top-right corner, visible on
 * group hover. A horizontal gradient fades from transparent to `bgColor` so
 * text behind the button isn't abruptly covered.
 * Requires an ancestor with `group` and `relative` classes.
 *
 * **Inline** (`inline`): Normal-flow button for use inside headers/toolbars.
 */
export const CopyButton: React.FC<CopyButtonProps> = ({
  text,
  bgColor = 'var(--code-bg)',
  inline = false,
}) => {
  const { copy, copied } = useClipboard({ timeout: 2000 });

  const icon = copied ? (
    <Check className="size-3.5 text-[var(--badge-success-bg)]" />
  ) : (
    <Copy className="text-muted-foreground size-3.5" />
  );

  if (inline) {
    return (
      <Button variant="ghost" size="icon-xs" onClick={() => copy(text)} title="Copy to clipboard">
        {icon}
      </Button>
    );
  }

  return (
    <div className="pointer-events-none absolute top-0 right-0 z-10 flex opacity-0 transition-opacity group-hover:opacity-100">
      {/* Gradient fade from transparent to bgColor so text isn't obscured */}
      <div
        className="w-8 self-stretch"
        style={{ background: `linear-gradient(to right, transparent, ${bgColor})` }}
      />
      {/* Solid background holding the button */}
      <div className="rounded-bl-lg p-1.5" style={{ backgroundColor: bgColor }}>
        <button
          onClick={() => copy(text)}
          className="pointer-events-auto rounded-sm p-1.5"
          title="Copy to clipboard"
        >
          {icon}
        </button>
      </div>
    </div>
  );
};
