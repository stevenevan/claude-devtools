import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { Separator } from '@renderer/components/ui/separator';
import { HelpCircle } from 'lucide-react';

import React from 'react';

export const SessionContextHelpTooltip = (): React.ReactElement => {
  return (
    <Popover>
      <PopoverTrigger aria-label="Help: Visible Context">
        <HelpCircle
          size={14}
          className="cursor-help text-text-muted transition-colors hover:opacity-80"
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="space-y-3 text-xs">
          <div>
            <div className="mb-1 font-semibold text-text">
              What is Visible Context?
            </div>
            <p className="leading-normal text-text-secondary">
              Tokens consumed by file reads, tool outputs, and configuration files (CLAUDE.md)
              that are injected into the conversation.
            </p>
          </div>

          <Separator />

          <div>
            <div className="mb-1 font-semibold text-text">
              Total Context vs Visible Context
            </div>
            <div
              className="space-y-2 leading-normal text-text-secondary"
            >
              <div className="flex">
                <span
                  className="min-w-[74px] text-left text-text-muted"
                >
                  Total:
                </span>
                <span className="flex-1 leading-snug">
                  Total tokens that are injected into the conversation
                </span>
              </div>
              <div className="flex">
                <span
                  className="min-w-[74px] text-left text-text-muted"
                >
                  Visible:
                </span>
                <span className="flex-1 leading-snug">
                  Subset of tokens that you can optimize &amp; debug
                </span>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <div className="mb-1 font-semibold text-text">
              Optimization Tips
            </div>
            <ul
              className="space-y-1 pl-3 leading-normal text-text-secondary"
            >
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
