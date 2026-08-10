import { JSX } from 'react';
import { cn } from '@renderer/lib/utils';

const SELECT_INPUT_BASE =
  'rounded-sm border border-border bg-transparent px-2 py-1 text-sm text-foreground focus:border-transparent focus:outline-hidden focus:ring-1 focus:ring-indigo-500';
import { AlertCircle } from 'lucide-react';

import { CONTENT_TYPE_OPTIONS } from '../utils/constants';
import { getAvailableMatchFields } from '../utils/trigger';

import { SettingsSectionHeader as SectionHeader } from '@renderer/components/settings/components/SettingsSectionHeader';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@renderer/components/ui/field';

import type { TriggerContentType, TriggerMode, TriggerTokenType } from '@renderer/types/data';

interface DynamicConfigSectionProps {
  mode: TriggerMode;
  contentType: TriggerContentType;
  toolName: string;
  matchField: string;
  matchPattern: string;
  patternError: string | null;
  tokenThreshold: number;
  tokenType: TriggerTokenType;
  saving: boolean;
  onContentTypeChange: (contentType: TriggerContentType) => void;
  onMatchFieldChange: (matchField: string) => void;
  onMatchPatternChange: (value: string) => void;
  onTokenThresholdChange: (value: string) => void;
  onTokenTypeChange: (tokenType: TriggerTokenType) => void;
}

export const DynamicConfigSection = ({
  mode,
  contentType,
  toolName,
  matchField,
  matchPattern,
  patternError,
  tokenThreshold,
  tokenType,
  saving,
  onContentTypeChange,
  onMatchFieldChange,
  onMatchPatternChange,
  onTokenThresholdChange,
  onTokenTypeChange,
}: Readonly<DynamicConfigSectionProps>): JSX.Element => {
  // Get available match fields based on content type and tool name
  const availableMatchFields = getAvailableMatchFields(contentType, toolName || undefined);

  return (
    <div className="space-y-3">
      <SectionHeader title="Configuration" />

      {/* Error Status Mode */}
      {mode === 'error_status' && (
        <div className="py-2">
          <p className="text-muted-foreground text-sm">
            Triggers when a tool execution reports an error (is_error: true).
          </p>
        </div>
      )}

      {/* Content Match Mode */}
      {mode === 'content_match' && (
        <div className="space-y-3">
          {/* Content Type */}
          <Field
            disabled={saving}
            className="border-border/50 flex-row items-center justify-between border-b py-2"
          >
            <FieldLabel
              htmlFor="new-trigger-content-type"
              className="text-muted-foreground text-sm"
            >
              Content Type
            </FieldLabel>
            <select
              id="new-trigger-content-type"
              value={contentType}
              onChange={(e) => onContentTypeChange(e.target.value as TriggerContentType)}
              disabled={saving}
              aria-describedby="new-trigger-content-type-description"
              className={cn(
                SELECT_INPUT_BASE,
                saving ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              )}
            >
              {CONTENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-background">
                  {option.label}
                </option>
              ))}
            </select>
            <FieldDescription id="new-trigger-content-type-description" className="sr-only">
              Select which content type this trigger inspects.
            </FieldDescription>
          </Field>

          {/* Match Field */}
          {availableMatchFields.length > 0 && (
            <Field
              disabled={saving}
              className="border-border/50 flex-row items-center justify-between border-b py-2"
            >
              <FieldLabel
                htmlFor="new-trigger-match-field"
                className="text-muted-foreground text-sm"
              >
                Match Field
              </FieldLabel>
              <select
                id="new-trigger-match-field"
                value={matchField || availableMatchFields[0]?.value || ''}
                onChange={(e) => onMatchFieldChange(e.target.value)}
                disabled={saving}
                aria-describedby="new-trigger-match-field-description"
                className={cn(
                  SELECT_INPUT_BASE,
                  saving ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                )}
              >
                {availableMatchFields.map((option) => (
                  <option key={option.value} value={option.value} className="bg-background">
                    {option.label}
                  </option>
                ))}
              </select>
              <FieldDescription id="new-trigger-match-field-description" className="sr-only">
                Select the content field used for matching.
              </FieldDescription>
            </Field>
          )}

          {/* Match Pattern */}
          <Field
            disabled={saving}
            invalid={Boolean(patternError)}
            className="border-border/50 border-b py-2"
          >
            <div className="mb-2 flex items-center justify-between">
              <FieldLabel
                htmlFor="new-trigger-match-pattern"
                className="text-muted-foreground text-sm"
              >
                Match Pattern (Regex)
              </FieldLabel>
            </div>
            <input
              id="new-trigger-match-pattern"
              type="text"
              value={matchPattern}
              onChange={(e) => onMatchPatternChange(e.target.value)}
              placeholder="e.g., error|failed|exception"
              disabled={saving}
              aria-invalid={patternError ? true : undefined}
              aria-describedby={`new-trigger-match-pattern-description${patternError ? ' new-trigger-match-pattern-error' : ''}`}
              className={cn(
                'text-foreground placeholder:text-muted-foreground w-full rounded-sm border bg-transparent px-2 py-1.5 font-mono text-sm focus:border-transparent focus:ring-1 focus:ring-indigo-500 focus:outline-hidden',
                patternError ? 'border-red-500' : 'border-border',
                saving && 'cursor-not-allowed opacity-50'
              )}
            />
            {patternError && (
              <FieldError
                id="new-trigger-match-pattern-error"
                match
                className="mt-1 flex items-center gap-1 text-xs text-red-400"
              >
                <AlertCircle className="size-3" />
                {patternError}
              </FieldError>
            )}
            <FieldDescription id="new-trigger-match-pattern-description" className="mt-1 text-xs">
              Leave empty to match all content. Uses JavaScript regex syntax.
            </FieldDescription>
          </Field>
        </div>
      )}

      {/* Token Threshold Mode */}
      {mode === 'token_threshold' && (
        <div className="space-y-3">
          <Field
            disabled={saving}
            className="border-border/50 flex-row items-center justify-between border-b py-2"
          >
            <FieldLabel htmlFor="new-trigger-token-type" className="text-muted-foreground text-sm">
              Token Type
            </FieldLabel>
            <select
              id="new-trigger-token-type"
              value={tokenType}
              onChange={(e) => onTokenTypeChange(e.target.value as TriggerTokenType)}
              disabled={saving}
              aria-describedby="new-trigger-token-type-description"
              className={cn(
                SELECT_INPUT_BASE,
                saving ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              )}
            >
              <option value="total" className="bg-background">
                Total Tokens
              </option>
              <option value="input" className="bg-background">
                Input Tokens
              </option>
              <option value="output" className="bg-background">
                Output Tokens
              </option>
            </select>
            <FieldDescription id="new-trigger-token-type-description" className="sr-only">
              Select which token count this trigger measures.
            </FieldDescription>
          </Field>
          <Field
            disabled={saving}
            className="border-border/50 flex-row items-center justify-between border-b py-2"
          >
            <FieldLabel htmlFor="new-trigger-threshold" className="text-muted-foreground text-sm">
              Threshold
            </FieldLabel>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Alert if &gt;</span>
              <input
                id="new-trigger-threshold"
                type="text"
                inputMode="numeric"
                value={tokenThreshold || ''}
                onChange={(e) => onTokenThresholdChange(e.target.value)}
                placeholder="0"
                disabled={saving}
                aria-describedby="new-trigger-threshold-description"
                className={cn(
                  'border-border text-foreground w-20 rounded-sm border bg-transparent px-2 py-1 text-right text-sm focus:border-transparent focus:ring-1 focus:ring-indigo-500 focus:outline-hidden',
                  saving && 'cursor-not-allowed opacity-50'
                )}
              />
              <span className="text-muted-foreground text-xs">tokens</span>
            </div>
            <FieldDescription id="new-trigger-threshold-description" className="sr-only">
              Alert when the selected token count exceeds this threshold.
            </FieldDescription>
          </Field>
        </div>
      )}
    </div>
  );
};
