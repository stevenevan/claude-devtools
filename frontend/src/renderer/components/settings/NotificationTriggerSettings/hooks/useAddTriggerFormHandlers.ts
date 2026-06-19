import { useCallback } from 'react';

import { getAvailableMatchFields } from '../utils/trigger';

import type { AddTriggerFormStateReturn } from './useAddTriggerFormState';
import type { RepositoryDropdownItem } from '@renderer/components/settings/hooks/useSettingsConfig';
import type {
  NotificationTrigger,
  TriggerContentType,
  TriggerMatchField,
  TriggerMode,
} from '@renderer/types/data';

interface UseAddTriggerFormHandlersOptions {
  formState: AddTriggerFormStateReturn;
  validatePattern: (pattern: string) => boolean;
  clearPreview: () => void;
}

export interface AddTriggerFormHandlersReturn {
  handleModeChange: (newMode: TriggerMode) => void;
  handleContentTypeChange: (newContentType: TriggerContentType) => void;
  handleToolNameChange: (newToolName: string) => void;
  handleAddRepository: (item: RepositoryDropdownItem) => void;
  handleRemoveIgnorePattern: (idx: number) => void;
  handleAddIgnorePattern: (pattern: string) => void;
  handleRemoveRepository: (idx: number) => void;
  handleMatchPatternChange: (value: string) => void;
  handleTokenThresholdChange: (value: string) => void;
  handleCancel: () => void;
  buildNewTrigger: (generateId: () => string) => Omit<NotificationTrigger, 'isBuiltin'>;
}

export function useAddTriggerFormHandlers({
  formState,
  validatePattern,
  clearPreview,
}: UseAddTriggerFormHandlersOptions): AddTriggerFormHandlersReturn {
  const {
    name,
    toolName,
    mode,
    contentType,
    matchField,
    matchPattern,
    tokenThreshold,
    tokenType,
    ignorePatterns,
    repositoryIds,
    color,
    setMode,
    setContentType,
    setToolName,
    setMatchField,
    setMatchPattern,
    setTokenThreshold,
    setIgnorePatterns,
    setRepositoryIds,
    setIsExpanded,
    resetForm,
  } = formState;

  const handleModeChange = useCallback(
    (newMode: TriggerMode) => {
      setMode(newMode);
      if (newMode === 'error_status') {
        setContentType('tool_result');
      }
    },
    [setMode, setContentType]
  );

  const handleContentTypeChange = useCallback(
    (newContentType: TriggerContentType) => {
      setContentType(newContentType);
      const newMatchFields = getAvailableMatchFields(newContentType, toolName || undefined);
      setMatchField(newMatchFields[0]?.value || '');
      if (newContentType !== 'tool_use' && newContentType !== 'tool_result') {
        setToolName('');
      }
    },
    [toolName, setContentType, setMatchField, setToolName]
  );

  const handleToolNameChange = useCallback(
    (newToolName: string) => {
      setToolName(newToolName);
      const newMatchFields = getAvailableMatchFields(contentType, newToolName || undefined);
      setMatchField(newMatchFields[0]?.value || '');
    },
    [contentType, setToolName, setMatchField]
  );

  const handleAddRepository = useCallback(
    (item: RepositoryDropdownItem) => {
      if (!repositoryIds.includes(item.id)) {
        setRepositoryIds([...repositoryIds, item.id]);
      }
    },
    [repositoryIds, setRepositoryIds]
  );

  const handleRemoveIgnorePattern = useCallback(
    (idx: number) => {
      const newPatterns = [...ignorePatterns];
      newPatterns.splice(idx, 1);
      setIgnorePatterns(newPatterns);
    },
    [ignorePatterns, setIgnorePatterns]
  );

  const handleAddIgnorePattern = useCallback(
    (pattern: string) => {
      setIgnorePatterns([...ignorePatterns, pattern]);
    },
    [ignorePatterns, setIgnorePatterns]
  );

  const handleRemoveRepository = useCallback(
    (idx: number) => {
      const newIds = [...repositoryIds];
      newIds.splice(idx, 1);
      setRepositoryIds(newIds);
    },
    [repositoryIds, setRepositoryIds]
  );

  const handleMatchPatternChange = useCallback(
    (value: string) => {
      setMatchPattern(value);
      validatePattern(value);
    },
    [setMatchPattern, validatePattern]
  );

  const handleTokenThresholdChange = useCallback(
    (value: string) => {
      const val = value.replace(/\D/g, '');
      setTokenThreshold(parseInt(val) || 0);
    },
    [setTokenThreshold]
  );

  const handleCancel = useCallback(() => {
    resetForm();
    clearPreview();
    setIsExpanded(false);
  }, [resetForm, clearPreview, setIsExpanded]);

  const buildNewTrigger = useCallback(
    (generateId: () => string): Omit<NotificationTrigger, 'isBuiltin'> => {
      return {
        id: `custom-${generateId()}`,
        name: name.trim(),
        enabled: true,
        contentType,
        mode,
        ...(mode === 'error_status' && { requireError: true }),
        ...(mode === 'content_match' &&
          matchField && { matchField: matchField as TriggerMatchField }),
        ...(mode === 'content_match' && matchPattern && { matchPattern }),
        ...(mode === 'token_threshold' && { tokenThreshold, tokenType }),
        ...((contentType === 'tool_use' || contentType === 'tool_result') &&
          toolName && { toolName }),
        ...(ignorePatterns.length > 0 && { ignorePatterns }),
        ...(repositoryIds.length > 0 && { repositoryIds }),
        color,
      };
    },
    [
      name,
      contentType,
      mode,
      matchField,
      matchPattern,
      tokenThreshold,
      tokenType,
      toolName,
      ignorePatterns,
      repositoryIds,
      color,
    ]
  );

  return {
    handleModeChange,
    handleContentTypeChange,
    handleToolNameChange,
    handleAddRepository,
    handleRemoveIgnorePattern,
    handleAddIgnorePattern,
    handleRemoveRepository,
    handleMatchPatternChange,
    handleTokenThresholdChange,
    handleCancel,
    buildNewTrigger,
  };
}
