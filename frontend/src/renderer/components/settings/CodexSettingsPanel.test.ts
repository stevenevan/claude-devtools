import { describe, expect, test } from 'bun:test';

import {
  buildPatch,
  draftFromView,
  fieldEditable,
  sourceAccessibleName,
} from './CodexSettingsPanel';

import type {
  CodexResolvedSetting,
  CodexSettingValue,
  CodexSettingsView,
} from '@shared/types/api';

function scalar(value: string): CodexSettingValue {
  return {
    kind: 'text',
    scalar: value,
    display: value,
    structured: null,
    redacted: false,
  };
}

function setting(
  key: string,
  value: string,
  editable: boolean,
  sourceLabel = 'User config'
): CodexResolvedSetting {
  return {
    key,
    value: scalar(value),
    sourceId: sourceLabel === 'System config' ? 'system' : 'user',
    sourceLabel,
    editable,
    readOnlyReason: editable ? null : 'A higher-priority read-only source owns this value',
    userValue: null,
    shadowed: [],
  };
}

function view(settings: CodexResolvedSetting[]): CodexSettingsView {
  return {
    context: {
      projectRoot: '/project',
      workingDirectory: '/project',
      profile: null,
      profileIsProjection: true,
      cliOverridesAvailable: false,
    },
    trust: {
      state: 'trusted',
      sourceLabel: 'User config',
      reason: null,
    },
    settings,
    sources: [],
    provenance: [],
    diagnostics: [],
    policy: {
      localRequirementsAvailable: false,
      cloudRequirementsAvailable: false,
      resolution: 'incomplete',
      constraints: [],
      diagnostics: [],
    },
    userRevision: 'missing',
    target: 'user config',
    canEdit: true,
  };
}

describe('Codex settings panel logic', () => {
  test('uses the effective system value as the starting user override draft', () => {
    const current = view([setting('model', 'system-model', true, 'System config')]);
    expect(draftFromView(current).model).toBe('system-model');
  });

  test('builds only changed typed fields', () => {
    const current = view([
      setting('model', 'old-model', true),
      setting('approval_policy', 'on-request', true),
      setting('sandbox_mode', 'read-only', true),
    ]);
    const settings = new Map(current.settings.map((item) => [item.key, item]));
    expect(
      buildPatch(
        {
          model: 'old-model',
          approvalPolicy: 'never',
          sandboxMode: 'workspace-write',
        },
        settings
      )
    ).toEqual({
      approvalPolicy: 'never',
      sandboxMode: 'workspace-write',
    });
  });

  test('keeps higher-layer settings read-only and labels missing provenance', () => {
    const current = view([setting('model', 'project-model', false, 'Project layer 1 (root)')]);
    const settings = new Map(current.settings.map((item) => [item.key, item]));
    expect(fieldEditable(current, settings, 'model')).toBe(false);
    expect(sourceAccessibleName(undefined)).toBe('No source defines this setting');
    expect(sourceAccessibleName(current.settings[0])).toBe('Project layer 1 (root)');
  });
});
