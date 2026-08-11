export interface CatalogPlugin {
  name: string;
  description: string | null;
  installed: boolean;
  installCommand: string | null;
}

export interface MarketplaceView {
  name: string;
  source: string | null;
  lastUpdated: string | null;
  plugins: CatalogPlugin[];
}

export interface MarketplaceCatalog {
  marketplaces: MarketplaceView[];
}
