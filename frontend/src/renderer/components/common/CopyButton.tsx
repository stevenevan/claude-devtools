import { FC } from 'react';

import { Button } from '@renderer/components/ui/button';
import { useClipboard } from '@renderer/hooks/mantine';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  label?: string;
  // Background color the gradient fades into (must match parent surface)
  bgColor?: string;
  // Render as inline element instead of absolute overlay; overlay requires ancestor with `group` and `relative`
  inline?: boolean;
}

export const CopyButton: FC<CopyButtonProps> = ({
  text,
  label,
  bgColor = 'var(--code-bg)',
  inline = false,
}) => {
  const { copy, copied } = useClipboard({ timeout: 2000 });
  const copyLabel = label ?? 'Copy to clipboard';
  const copiedMessage = label ? `${label} copied` : 'Copied to clipboard';

  const icon = copied ? (
    <Check className="size-3.5 text-[var(--badge-success-bg)]" />
  ) : (
    <Copy className="text-muted-foreground size-3.5" />
  );

  if (inline) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => copy(text)}
          aria-label={copyLabel}
          title={copyLabel}
        >
          {icon}
        </Button>
        {copied && (
          <span role="status" aria-live="polite" className="sr-only">
            {copiedMessage}
          </span>
        )}
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute top-0 right-0 z-10 flex opacity-0 transition-opacity group-hover:opacity-100">
      <div
        className="w-8 self-stretch"
        style={{ background: `linear-gradient(to right, transparent, ${bgColor})` }}
      />
      <div className="rounded-bl-lg p-1.5" style={{ backgroundColor: bgColor }}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => copy(text)}
          className="pointer-events-auto rounded-sm p-1.5"
          aria-label={copyLabel}
          title={copyLabel}
        >
          {icon}
        </Button>
      </div>
      {copied && (
        <span role="status" aria-live="polite" className="sr-only">
          {copiedMessage}
        </span>
      )}
    </div>
  );
};
