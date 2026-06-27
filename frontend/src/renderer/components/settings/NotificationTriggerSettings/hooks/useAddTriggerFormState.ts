import { useCallback, useState } from 'react';

import type { TriggerContentType, TriggerMode, TriggerTokenType } from '@renderer/types/data';
import type { TriggerColor } from '@shared/constants/triggerColors';

interface AddTriggerFormState {
  name: string;
  toolName: string;
  mode: TriggerMode;
  contentType: TriggerContentType;
  matchField: string;
  matchPattern: string;
  tokenThreshold: number;
  tokenType: TriggerTokenType;
  ignorePatterns: string[];
  repositoryIds: string[];
  color: TriggerColor;
  isExpanded: boolean;
}

export interface AddTriggerFormStateReturn extends AddTriggerFormState {
  setName: (name: string) => void;
  setToolName: (toolName: string) => void;
  setMode: (mode: TriggerMode) => void;
  setContentType: (contentType: TriggerContentType) => void;
  setMatchField: (matchField: string) => void;
  setMatchPattern: (matchPattern: string) => void;
  setTokenThreshold: (threshold: number) => void;
  setTokenType: (tokenType: TriggerTokenType) => void;
  setIgnorePatterns: (patterns: string[]) => void;
  setRepositoryIds: (ids: string[]) => void;
  setColor: (color: TriggerColor) => void;
  setIsExpanded: (expanded: boolean) => void;
  resetForm: () => void;
}

export function useAddTriggerFormState(): AddTriggerFormStateReturn {
  const [name, setName] = useState('');
  const [toolName, setToolName] = useState<string>('');
  const [mode, setMode] = useState<TriggerMode>('error_status');
  const [contentType, setContentType] = useState<TriggerContentType>('tool_result');
  const [matchField, setMatchField] = useState<string>('content');
  const [matchPattern, setMatchPattern] = useState('');
  const [tokenThreshold, setTokenThreshold] = useState<number>(1000);
  const [tokenType, setTokenType] = useState<TriggerTokenType>('total');
  const [ignorePatterns, setIgnorePatterns] = useState<string[]>([]);
  const [repositoryIds, setRepositoryIds] = useState<string[]>([]);
  const [color, setColor] = useState<TriggerColor>('red');
  const [isExpanded, setIsExpanded] = useState(false);

  // ponytail: useCallback required — returned from hook; passed to useAddTriggerFormHandlers dep array
  const resetForm = useCallback(() => {
    setName('');
    setToolName('');
    setMode('error_status');
    setContentType('tool_result');
    setMatchField('content');
    setMatchPattern('');
    setTokenThreshold(1000);
    setTokenType('total');
    setIgnorePatterns([]);
    setRepositoryIds([]);
    // Intentionally do NOT reset color — preserve last-used color across triggers
  }, []);

  return {
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
    isExpanded,
    setName,
    setToolName,
    setMode,
    setContentType,
    setMatchField,
    setMatchPattern,
    setTokenThreshold,
    setTokenType,
    setIgnorePatterns,
    setRepositoryIds,
    setColor,
    setIsExpanded,
    resetForm,
  };
}
