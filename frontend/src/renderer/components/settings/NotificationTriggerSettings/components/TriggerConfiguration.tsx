import { JSX } from 'react';
import { cn } from '@renderer/lib/utils';

const SELECT_INPUT_BASE =
  'rounded-sm border border-border bg-transparent px-2 py-1 text-sm text-foreground focus:border-transparent focus:outline-hidden focus:ring-1 focus:ring-indigo-500';
import { AlertCircle } from 'lucide-react';

import { CONTENT_TYPE_OPTIONS, TOOL_NAME_OPTIONS } from '../utils/constants';
import { getAvailableMatchFields } from '../utils/trigger';

import { ColorPaletteSelector } from './ColorPaletteSelector';
import { ModeSelector } from './ModeSelector';
import { SettingsSectionHeader as SectionHeader } from '@renderer/components/settings/components/SettingsSectionHeader';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@renderer/components/ui/field';

import type {
  NotificationTrigger,
  TriggerContentType,
  TriggerMode,
  TriggerTokenType,
} from '@renderer/types/data';
import type { TriggerColor } from '@shared/constants/triggerColors';

interface TriggerConfigurationProps {
  trigger: NotificationTrigger;
  saving: boolean;
  localMode: TriggerMode;
  localPattern: string;
  localTokenThreshold: number;
  localTokenType: TriggerTokenType;
  patternError: string | null;
  onModeChange: (mode: TriggerMode) => void;
  onContentTypeChange: (value: TriggerContentType) => void;
  onToolNameChange: (value: string) => void;
  onMatchFieldChange: (value: string) => void;
  onPatternChange: (value: string) => void;
  onPatternBlur: () => void;
  onTokenThresholdChange: (value: number) => void;
  onTokenThresholdBlur?: () => void;
  onTokenTypeChange: (value: TriggerTokenType) => void;
  onColorChange: (color: TriggerColor) => void;
}

export const TriggerConfiguration = ({
  trigger,
  saving,
  localMode,
  localPattern,
  localTokenThreshold,
  localTokenType,
  patternError,
  onModeChange,
  onContentTypeChange,
  onToolNameChange,
  onMatchFieldChange,
  onPatternChange,
  onPatternBlur,
  onTokenThresholdChange,
  onTokenThresholdBlur,
  onTokenTypeChange,
  onColorChange,
}: Readonly<TriggerConfigurationProps>): JSX.Element => {
  const availableMatchFields = getAvailableMatchFields(trigger.contentType, trigger.toolName);

  return (
    <>
      {/* Section 1: General Info */}
      <div className="space-y-3">
        <SectionHeader title="General Info" />

        {/* Scope/Tool Name */}
        {(trigger.contentType === 'tool_use' || trigger.contentType === 'tool_result') && (
          <Field
            disabled={saving}
            className="border-border/50 flex-row items-center justify-between border-b py-2"
          >
            <FieldLabel
              htmlFor={`trigger-${trigger.id}-tool-name`}
              className="text-muted-foreground text-sm"
            >
              Scope / Tool Name
            </FieldLabel>
            <select
              id={`trigger-${trigger.id}-tool-name`}
              value={trigger.toolName ?? ''}
              onChange={(e) => onToolNameChange(e.target.value)}
              disabled={saving}
              aria-describedby={`trigger-${trigger.id}-tool-name-description`}
              className={cn(
                SELECT_INPUT_BASE,
                saving ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              )}
            >
              {TOOL_NAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-background">
                  {option.label}
                </option>
              ))}
            </select>
            <FieldDescription
              id={`trigger-${trigger.id}-tool-name-description`}
              className="sr-only"
            >
              Limit this trigger to a specific tool.
            </FieldDescription>
          </Field>
        )}
      </div>

      {/* Dot Color */}
      <div className="space-y-3">
        <SectionHeader title="Dot Color" />
        <ColorPaletteSelector value={trigger.color} onChange={onColorChange} disabled={saving} />
      </div>

      {/* Section 2: Trigger Condition (Mode Selector) */}
      <div className="space-y-3">
        <SectionHeader title="Trigger Condition" />
        <ModeSelector value={localMode} onChange={onModeChange} disabled={saving} />
      </div>

      {/* Section 3: Dynamic Configuration */}
      <div className="space-y-3">
        <SectionHeader title="Configuration" />

        {/* Error Status Mode */}
        {localMode === 'error_status' && (
          <div className="py-2">
            <p className="text-muted-foreground text-sm">
              Triggers when a tool execution reports an error (is_error: true).
            </p>
          </div>
        )}

        {/* Content Match Mode */}
        {localMode === 'content_match' && (
          <>
            {/* Content Type */}
            <Field
              disabled={saving}
              className="border-border/50 flex-row items-center justify-between border-b py-2"
            >
              <FieldLabel
                htmlFor={`trigger-${trigger.id}-content-type`}
                className="text-muted-foreground text-sm"
              >
                Content Type
              </FieldLabel>
              <select
                id={`trigger-${trigger.id}-content-type`}
                value={trigger.contentType}
                onChange={(e) => onContentTypeChange(e.target.value as TriggerContentType)}
                disabled={saving}
                aria-describedby={`trigger-${trigger.id}-content-type-description`}
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
              <FieldDescription
                id={`trigger-${trigger.id}-content-type-description`}
                className="sr-only"
              >
                Select which content type this trigger inspects.
              </FieldDescription>
            </Field>
            <ContentMatchConfig
              triggerId={trigger.id}
              matchField={trigger.matchField}
              availableMatchFields={availableMatchFields}
              localPattern={localPattern}
              patternError={patternError}
              saving={saving}
              onMatchFieldChange={onMatchFieldChange}
              onPatternChange={onPatternChange}
              onPatternBlur={onPatternBlur}
            />
          </>
        )}

        {/* Token Threshold Mode */}
        {localMode === 'token_threshold' && (
          <TokenThresholdConfig
            triggerId={trigger.id}
            localTokenType={localTokenType}
            localTokenThreshold={localTokenThreshold}
            saving={saving}
            onTokenTypeChange={onTokenTypeChange}
            onTokenThresholdChange={onTokenThresholdChange}
            onTokenThresholdBlur={onTokenThresholdBlur}
          />
        )}
      </div>
    </>
  );
};

// Content Match Configuration

interface ContentMatchConfigProps {
  triggerId: string;
  matchField?: string;
  availableMatchFields: { value: string; label: string }[];
  localPattern: string;
  patternError: string | null;
  saving: boolean;
  onMatchFieldChange: (value: string) => void;
  onPatternChange: (value: string) => void;
  onPatternBlur: () => void;
}

const ContentMatchConfig = ({
  triggerId,
  matchField,
  availableMatchFields,
  localPattern,
  patternError,
  saving,
  onMatchFieldChange,
  onPatternChange,
  onPatternBlur,
}: Readonly<ContentMatchConfigProps>): JSX.Element => {
  return (
    <div className="space-y-3">
      {/* Match Field */}
      {availableMatchFields.length > 0 && (
        <Field
          disabled={saving}
          className="border-border/50 flex-row items-center justify-between border-b py-2"
        >
          <FieldLabel
            htmlFor={`trigger-${triggerId}-match-field`}
            className="text-muted-foreground text-sm"
          >
            Match Field
          </FieldLabel>
          <select
            id={`trigger-${triggerId}-match-field`}
            value={matchField ?? availableMatchFields[0]?.value ?? ''}
            onChange={(e) => onMatchFieldChange(e.target.value)}
            disabled={saving}
            aria-describedby={`trigger-${triggerId}-match-field-description`}
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
          <FieldDescription
            id={`trigger-${triggerId}-match-field-description`}
            className="sr-only"
          >
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
            htmlFor={`trigger-${triggerId}-match-pattern`}
            className="text-muted-foreground text-sm"
          >
            Match Pattern (Regex)
          </FieldLabel>
        </div>
        <input
          id={`trigger-${triggerId}-match-pattern`}
          type="text"
          value={localPattern}
          onChange={(e) => onPatternChange(e.target.value)}
          onBlur={onPatternBlur}
          placeholder="e.g., error|failed|exception"
          disabled={saving}
          aria-invalid={patternError ? true : undefined}
          aria-describedby={`trigger-${triggerId}-match-pattern-description${patternError ? ` trigger-${triggerId}-match-pattern-error` : ''}`}
          className={cn(
            'text-foreground placeholder:text-muted-foreground w-full rounded-sm border bg-transparent px-2 py-1.5 font-mono text-sm focus:border-transparent focus:ring-1 focus:ring-indigo-500 focus:outline-hidden',
            patternError ? 'border-red-500' : 'border-border',
            saving && 'cursor-not-allowed opacity-50'
          )}
        />
        {patternError && (
          <FieldError
            id={`trigger-${triggerId}-match-pattern-error`}
            match
            className="mt-1 flex items-center gap-1 text-xs text-red-400"
          >
            <AlertCircle className="size-3" />
            {patternError}
          </FieldError>
        )}
        <FieldDescription
          id={`trigger-${triggerId}-match-pattern-description`}
          className="mt-1 text-xs"
        >
          Leave empty to match all content. Uses JavaScript regex syntax.
        </FieldDescription>
      </Field>
    </div>
  );
};

// Token Threshold Configuration

interface TokenThresholdConfigProps {
  triggerId: string;
  localTokenType: TriggerTokenType;
  localTokenThreshold: number;
  saving: boolean;
  onTokenTypeChange: (value: TriggerTokenType) => void;
  onTokenThresholdChange: (value: number) => void;
  onTokenThresholdBlur?: () => void;
}

const TokenThresholdConfig = ({
  triggerId,
  localTokenType,
  localTokenThreshold,
  saving,
  onTokenTypeChange,
  onTokenThresholdChange,
  onTokenThresholdBlur,
}: Readonly<TokenThresholdConfigProps>): JSX.Element => {
  return (
    <div className="space-y-3">
      <Field
        disabled={saving}
        className="border-border/50 flex-row items-center justify-between border-b py-2"
      >
        <FieldLabel
          htmlFor={`trigger-${triggerId}-token-type`}
          className="text-muted-foreground text-sm"
        >
          Token Type
        </FieldLabel>
        <select
          id={`trigger-${triggerId}-token-type`}
          value={localTokenType}
          onChange={(e) => onTokenTypeChange(e.target.value as TriggerTokenType)}
          disabled={saving}
          aria-describedby={`trigger-${triggerId}-token-type-description`}
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
        <FieldDescription
          id={`trigger-${triggerId}-token-type-description`}
          className="sr-only"
        >
          Select which token count this trigger measures.
        </FieldDescription>
      </Field>
      <Field
        disabled={saving}
        className="border-border/50 flex-row items-center justify-between border-b py-2"
      >
        <FieldLabel
          htmlFor={`trigger-${triggerId}-threshold`}
          className="text-muted-foreground text-sm"
        >
          Threshold
        </FieldLabel>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Alert if &gt;</span>
          <input
            id={`trigger-${triggerId}-threshold`}
            type="text"
            inputMode="numeric"
            value={localTokenThreshold || ''}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '');
              onTokenThresholdChange(parseInt(val) || 0);
            }}
            onBlur={onTokenThresholdBlur}
            placeholder="0"
            disabled={saving}
            aria-describedby={`trigger-${triggerId}-threshold-description`}
            className={cn(
              'border-border text-foreground w-20 rounded-sm border bg-transparent px-2 py-1 text-right text-sm focus:border-transparent focus:ring-1 focus:ring-indigo-500 focus:outline-hidden',
              saving && 'cursor-not-allowed opacity-50'
            )}
          />
          <span className="text-muted-foreground text-xs">tokens</span>
        </div>
        <FieldDescription
          id={`trigger-${triggerId}-threshold-description`}
          className="sr-only"
        >
          Alert when the selected token count exceeds this threshold.
        </FieldDescription>
      </Field>
    </div>
  );
};
