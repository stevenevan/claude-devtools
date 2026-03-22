import React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { Separator } from '@renderer/components/ui/separator';
import { HelpCircle } from 'lucide-react';

export const SessionContextHelpTooltip = (): React.ReactElement => {
  return (
    <Popover>
      <PopoverTrigger aria-label="Help: Visible Context">
        <HelpCircle
          size={14}
          className="text-text-muted cursor-help transition-colors hover:opacity-80"
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="space-y-3 text-xs">
          <div>
            <div className="text-text mb-1 font-semibold">What is Visible Context?</div>
            <p className="text-text-secondary leading-normal">
              Tokens consumed by file reads, tool outputs, and configuration files (CLAUDE.md) that
              are injected into the conversation.
            </p>
          </div>

          <Separator />

          <div>
            <div className="text-text mb-1 font-semibold">Total Context vs Visible Context</div>
            <div className="text-text-secondary space-y-2 leading-normal">
              <div className="flex">
                <span className="text-text-muted min-w-[74px] text-left">Total:</span>
                <span className="flex-1 leading-snug">
                  Total tokens that are injected into the conversation
                </span>
              </div>
              <div className="flex">
                <span className="text-text-muted min-w-[74px] text-left">Visible:</span>
                <span className="flex-1 leading-snug">
                  Subset of tokens that you can optimize &amp; debug
                </span>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <div className="text-text mb-1 font-semibold">Optimization Tips</div>
            <ul className="text-text-secondary space-y-1 pl-3 leading-normal">
              <li className="list-disc">Shorten large CLAUDE.md files</li>
              <li className="list-disc">Split large @-mentioned files</li>
              <li className="list-disc">Adjust MCP tool output verbosity</li>
            </ul>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
