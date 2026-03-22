/**
 * GeneralInfoSection - Name input and tool select for AddTriggerForm.
 */

import { cn } from '@renderer/lib/utils';

import { TOOL_NAME_OPTIONS } from '../utils/constants';

import { SectionHeader } from './SectionHeader';

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
}: Readonly<GeneralInfoSectionProps>): React.JSX.Element => {
  return (
    <div className="space-y-3">
      <SectionHeader title="General Info" />

      {/* Trigger Name */}
      <div className="border-border/50 border-b py-2">
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="new-trigger-name" className="text-muted-foreground text-sm">
            Trigger Name *
          </label>
        </div>
        <input
          id="new-trigger-name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g., Build Failure Alert"
          disabled={saving}
          required
          className={cn(
            'border-border text-foreground placeholder:text-muted-foreground w-full rounded-sm border bg-transparent px-2 py-1.5 text-sm focus:border-transparent focus:ring-1 focus:ring-indigo-500 focus:outline-hidden',
            saving && 'cursor-not-allowed opacity-50'
          )}
        />
      </div>

      {/* Scope/Tool Name */}
      <div className="border-border/50 flex items-center justify-between border-b py-2">
        <label htmlFor="new-trigger-tool-name" className="text-muted-foreground text-sm">
          Scope / Tool Name (optional)
        </label>
        <select
          id="new-trigger-tool-name"
          value={toolName}
          onChange={(e) => onToolNameChange(e.target.value)}
          disabled={saving}
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
      </div>
    </div>
  );
};
