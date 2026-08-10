import { JSX } from 'react';
import { cn } from '@renderer/lib/utils';

import { TOOL_NAME_OPTIONS } from '../utils/constants';

import { SettingsSectionHeader as SectionHeader } from '@renderer/components/settings/components/SettingsSectionHeader';
import { Field, FieldDescription, FieldLabel } from '@renderer/components/ui/field';

interface GeneralInfoSectionProps {
  name: string;
  toolName: string;
  saving: boolean;
  onNameChange: (name: string) => void;
  onToolNameChange: (toolName: string) => void;
}

export const GeneralInfoSection = ({
  name,
  toolName,
  saving,
  onNameChange,
  onToolNameChange,
}: Readonly<GeneralInfoSectionProps>): JSX.Element => {
  return (
    <div className="space-y-3">
      <SectionHeader title="General Info" />

      {/* Trigger Name */}
      <Field disabled={saving} className="border-border/50 border-b py-2">
        <div className="mb-2 flex items-center justify-between">
          <FieldLabel htmlFor="new-trigger-name" className="text-muted-foreground text-sm">
            Trigger Name *
          </FieldLabel>
        </div>
        <input
          id="new-trigger-name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g., Build Failure Alert"
          disabled={saving}
          required
          aria-describedby="new-trigger-name-description"
          className={cn(
            'border-border text-foreground placeholder:text-muted-foreground w-full rounded-sm border bg-transparent px-2 py-1.5 text-sm focus:border-transparent focus:ring-1 focus:ring-indigo-500 focus:outline-hidden',
            saving && 'cursor-not-allowed opacity-50'
          )}
        />
        <FieldDescription id="new-trigger-name-description" className="sr-only">
          Name used to identify this notification trigger.
        </FieldDescription>
      </Field>

      {/* Scope/Tool Name */}
      <Field
        disabled={saving}
        className="border-border/50 flex-row items-center justify-between border-b py-2"
      >
        <FieldLabel htmlFor="new-trigger-tool-name" className="text-muted-foreground text-sm">
          Scope / Tool Name (optional)
        </FieldLabel>
        <select
          id="new-trigger-tool-name"
          value={toolName}
          onChange={(e) => onToolNameChange(e.target.value)}
          disabled={saving}
          aria-describedby="new-trigger-tool-name-description"
          className={cn(
            'border-border text-foreground rounded-sm border bg-transparent px-2 py-1 text-sm focus:border-transparent focus:ring-1 focus:ring-indigo-500 focus:outline-hidden',
            saving ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          )}
        >
          {TOOL_NAME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value} className="bg-background">
              {option.label}
            </option>
          ))}
        </select>
        <FieldDescription id="new-trigger-tool-name-description" className="sr-only">
          Limit this trigger to a specific tool when selected.
        </FieldDescription>
      </Field>
    </div>
  );
};
