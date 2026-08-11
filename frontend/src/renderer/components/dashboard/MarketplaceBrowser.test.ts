import { expect, test } from 'bun:test';

import type { CatalogPlugin, DuplicateGroup, GlobalPlugin, MarketplaceView } from '@shared/types/api';

import {
  buildSimpleMarketplaceEntries,
  indexDuplicateGroups,
  indexGlobalPlugins,
  marketplacePluginKey,
} from './MarketplaceBrowser';

function plugin(name: string, installed = false, description = `${name} description`): CatalogPlugin {
  return {
    name,
    description,
    installed,
    installCommand: installed ? null : `claude plugin install ${name}@marketplace`,
  };
}

function marketplace(name: string, plugins: CatalogPlugin[], source = `github:${name}/repo`): MarketplaceView {
  return {
    name,
    source,
    lastUpdated: null,
    plugins,
  };
}

test('puts available add-ons before installed entries and filters by marketplace and text', () => {
  const marketplaces = [
    marketplace('zeta', [plugin('installed', true), plugin('available')]),
    marketplace('alpha', [plugin('spreadsheet', false, 'Workbooks and tables')]),
  ];

  expect(
    buildSimpleMarketplaceEntries(marketplaces, 'all', '').map(
      ({ marketplace: itemMarketplace, plugin: item }) => `${itemMarketplace.name}/${item.name}`
    )
  ).toEqual(['alpha/spreadsheet', 'zeta/available', 'zeta/installed']);
  expect(
    buildSimpleMarketplaceEntries(marketplaces, 'alpha', 'workbook').map(({ plugin: item }) => item.name)
  ).toEqual(['spreadsheet']);
  expect(buildSimpleMarketplaceEntries(marketplaces, 'all', 'missing')).toEqual([]);
});

test('indexes installed plugins by marketplace and name without repeated scans', () => {
  const installed: GlobalPlugin = {
    id: 'plugin-1',
    name: 'formatter',
    marketplace: 'official',
    version: '1.0.0',
    installedAt: '',
    lastUpdated: '',
    enabled: true,
  };
  const duplicate: DuplicateGroup = { name: 'formatter', entries: [installed] };

  expect(indexGlobalPlugins([installed]).get(marketplacePluginKey('official', 'formatter'))).toBe(
    installed
  );
  expect(indexDuplicateGroups([duplicate]).get('formatter')).toBe(duplicate);
});

test('keeps entries with unavailable install instructions visible but non-actionable', () => {
  const item = plugin('unsafe');
  const marketplaceWithUnavailableCommand = marketplace('third-party', [
    { ...item, installCommand: null },
  ]);

  const [entry] = buildSimpleMarketplaceEntries([marketplaceWithUnavailableCommand], 'all', '');
  expect(entry?.plugin.name).toBe('unsafe');
  expect(entry?.plugin.installCommand).toBeNull();
});
