import { JSX, memo, useCallback } from 'react';
import { useRepositoryLookup } from '../hooks/useRepositoryLookup';
import { useTriggerCardState } from '../hooks/useTriggerCardState';
import { useTriggerForm } from '../hooks/useTriggerForm';

import { IgnorePatternsSection } from './IgnorePatternsSection';
import { RepositoryScopeSection } from './RepositoryScopeSection';
import { TriggerCardHeader } from './TriggerCardHeader';
import { TriggerConfiguration } from './TriggerConfiguration';
import { TriggerPreview } from './TriggerPreview';

import type { NotificationTrigger } from '@renderer/types/data';

interface TriggerCardProps {
  trigger: NotificationTrigger;
  saving: boolean;
  onUpdate: (triggerId: string, updates: Partial<NotificationTrigger>) => Promise<void>;
  onRemove: (triggerId: string) => Promise<void>;
}

const TriggerCardInner = ({
  trigger,
  saving,
  onUpdate,
  onRemove,
}: Readonly<TriggerCardProps>): JSX.Element => {
  // Wrap callbacks to include trigger.id
  // ponytail: useCallback required — passed to hook dep arrays (useTriggerForm, useTriggerCardState)
  const handleUpdate = useCallback(
    (updates: Partial<NotificationTrigger>) => onUpdate(trigger.id, updates),
    [onUpdate, trigger.id]
  );

  const handleRemove = (): Promise<void> => onRemove(trigger.id);

  // Use shared form hook for validation and preview
  const { patternError, validatePattern, previewResult, handleTestTrigger, handleViewSession } =
    useTriggerForm({ trigger, onUpdate: handleUpdate });

  // Use extracted state and handlers hook
  const {
    isExpanded,
    setIsExpanded,
    editingName,
    setEditingName,
    localName,
    setLocalName,
    localPattern,
    localMode,
    localTokenThreshold,
    localTokenType,
    handleToggleEnabled,
    handleNameSave,
    handlePatternBlur,
    handlePatternChange,
    handleContentTypeChange,
    handleToolNameChange,
    handleMatchFieldChange,
    handleModeChange,
    handleTokenThresholdChange,
    handleTokenThresholdBlur,
    handleTokenTypeChange,
    handleAddIgnorePattern,
    handleRemoveIgnorePattern,
    handleAddRepository,
    handleRemoveRepository,
    handleColorChange,
  } = useTriggerCardState({ trigger, onUpdate: handleUpdate, validatePattern });

  // Convert repositoryIds to RepositoryDropdownItem[] for display
  const selectedRepositoryItems = useRepositoryLookup(trigger.repositoryIds ?? []);

  return (
    <div className="border-border/50 border-b last:border-b-0">
      {/* Header row */}
      <TriggerCardHeader
        trigger={trigger}
        saving={saving}
        localMode={localMode}
        editingName={editingName}
        localName={localName}
        isExpanded={isExpanded}
        onSetEditingName={setEditingName}
        onSetLocalName={setLocalName}
        onNameSave={handleNameSave}
        onToggleEnabled={handleToggleEnabled}
        onToggleExpanded={() => setIsExpanded(!isExpanded)}
        onRemove={handleRemove}
      />

      {/* Expanded details */}
      {isExpanded && (
        <div className="space-y-4 pb-4 pl-4">
          {/* Configuration sections */}
          <TriggerConfiguration
            trigger={trigger}
            saving={saving}
            localMode={localMode}
            localPattern={localPattern}
            localTokenThreshold={localTokenThreshold}
            localTokenType={localTokenType}
            patternError={patternError}
            onModeChange={handleModeChange}
            onContentTypeChange={handleContentTypeChange}
            onToolNameChange={handleToolNameChange}
            onMatchFieldChange={handleMatchFieldChange}
            onPatternChange={handlePatternChange}
            onPatternBlur={handlePatternBlur}
            onTokenThresholdChange={handleTokenThresholdChange}
            onTokenThresholdBlur={handleTokenThresholdBlur}
            onTokenTypeChange={handleTokenTypeChange}
            onColorChange={handleColorChange}
          />

          {/* Section 4: Advanced (Collapsible) */}
          <IgnorePatternsSection
            patterns={trigger.ignorePatterns ?? []}
            onAdd={handleAddIgnorePattern}
            onRemove={handleRemoveIgnorePattern}
            disabled={saving}
          />

          {/* Section 5: Repository Scope (Collapsible) */}
          <RepositoryScopeSection
            repositoryIds={trigger.repositoryIds ?? []}
            selectedItems={selectedRepositoryItems}
            onAdd={handleAddRepository}
            onRemove={handleRemoveRepository}
            disabled={saving}
          />

          {/* Preview Section */}
          <TriggerPreview
            previewResult={previewResult}
            onTest={() => handleTestTrigger(trigger)}
            onViewSession={handleViewSession}
          />
        </div>
      )}
    </div>
  );
};

// Memoize to prevent re-rendering when other triggers change
// ponytail: memo kept — unlisted instance, keeping to avoid regression
export const TriggerCard = memo(TriggerCardInner);
