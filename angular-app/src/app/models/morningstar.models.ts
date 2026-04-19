export type MorningstarAssetType = 'fund' | 'equity';
export type MorningstarIdentifierType = 'isin' | 'ticker' | 'symbol' | 'performanceId';

export interface MorningstarLookupRequest {
  assetType: MorningstarAssetType;
  idType: MorningstarIdentifierType;
  id: string;
}

export interface MorningstarApiBase {
  assetType: MorningstarAssetType;
  requestedId: string;
  resolvedId?: string;
  resolvedIdType?: MorningstarIdentifierType;
  performanceId?: string;
  name?: string;
  isin?: string;
}

export interface MorningstarFundApiDetails extends MorningstarApiBase {
  assetType: 'fund';
  category?: string;
  domicile?: string;
  baseCurrency?: string;
  nav?: number;
  navDate?: string;
  aum?: number;
  benchmark?: string;
  riskRating?: string;
  sustainabilityRating?: string;
  expenseRatio?: number;
  trailingReturns?: Record<string, number | string | null | undefined>;
  portfolioBreakdown?: Record<string, number | string | null | undefined>;
}

export interface MorningstarEquityApiDetails extends MorningstarApiBase {
  assetType: 'equity';
  ticker?: string;
  exchange?: string;
  currency?: string;
  latestPrice?: number;
  latestPriceDate?: string;
  marketCap?: number;
  sector?: string;
  industry?: string;
  country?: string;
  valuationMetrics?: Record<string, number | string | null | undefined>;
  financialsSummary?: Record<string, number | string | null | undefined>;
}

export type MorningstarApiDetails = MorningstarFundApiDetails | MorningstarEquityApiDetails;

export interface MorningstarMetricItem {
  label: string;
  value: string;
}

export interface MorningstarDetailsViewModel {
  assetType: MorningstarAssetType;
  requestedId: string;
  resolvedId?: string;
  resolvedIdType?: MorningstarIdentifierType;
  performanceId?: string;
  name?: string;
  isin?: string;
  headlineMetrics: MorningstarMetricItem[];
  basicInfo: MorningstarMetricItem[];
  analytics: MorningstarMetricItem[];
  trailingReturns: MorningstarMetricItem[];
  extraMetrics: MorningstarMetricItem[];
}
