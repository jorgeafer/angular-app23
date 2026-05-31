export type YahooAssetType = 'fund' | 'equity';
export type YahooIdentifierType = 'isin' | 'ticker' | 'symbol' | 'performanceId';

export interface YahooLookupRequest {
  assetType: YahooAssetType;
  idType: YahooIdentifierType;
  id: string;
  yahooSymbol?: string;
  name?: string;
}

export interface YahooFundApiDetails {
  assetType: 'fund';
  requestedId: string;
  resolvedId?: string;
  resolvedIdType?: YahooIdentifierType;
  performanceId?: string;
  name?: string;
  isin?: string;
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
  topHoldings?: YahooFundHoldingApiItem[];
  geographicExposure?: YahooFundGeographyApiItem[];
  annualReturns?: YahooFundReturnApiItem[];
  dailyPerformance?: YahooFundDailyPointApiItem[];
  riskIndicator?: YahooFundRiskIndicatorApi;
}

export interface YahooEquityApiDetails {
  assetType: 'equity';
  requestedId: string;
  resolvedId?: string;
  resolvedIdType?: YahooIdentifierType;
  performanceId?: string;
  name?: string;
  isin?: string;
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

export type YahooApiDetails = YahooFundApiDetails | YahooEquityApiDetails;

export interface YahooMetricItem {
  label: string;
  value: string;
}

export interface YahooFundHoldingApiItem {
  name: string;
  symbol?: string;
  weight: number;
  country?: string;
}

export interface YahooFundGeographyApiItem {
  label: string;
  weight: number;
}

export interface YahooFundReturnApiItem {
  label: string;
  year?: number;
  value: number;
  isYtd?: boolean;
}

export interface YahooFundDailyPointApiItem {
  date: string;
  close: number;
}

export interface YahooFundRiskIndicatorApi {
  rating?: number;
  scaleMax?: number;
  label?: string;
  standardDeviation?: number;
  sharpeRatio?: number;
  beta?: number;
  alpha?: number;
  period?: string;
}

export interface YahooFundHoldingViewItem {
  name: string;
  symbol?: string;
  geography?: string;
  weight: number;
  weightLabel: string;
}

export interface YahooFundGeographyViewItem {
  label: string;
  weight: number;
  weightLabel: string;
  color: string;
}

export interface YahooFundReturnViewItem {
  label: string;
  year?: number;
  value: number;
  valueLabel: string;
  isYtd: boolean;
}

export interface YahooFundDailyPointViewItem {
  date: string;
  close: number;
}

export type YahooFundChartRange = '1m' | '3m' | '6m' | 'ytd' | '1y' | '3y' | 'all';

export interface YahooFundRiskViewModel {
  rating?: number;
  scaleMax: number;
  label?: string;
  stats: YahooMetricItem[];
}

export interface YahooBaseDetailsViewModel {
  assetType: YahooAssetType;
  requestedId: string;
  resolvedId?: string;
  resolvedIdType?: YahooIdentifierType;
  performanceId?: string;
  name?: string;
  isin?: string;
  headlineMetrics: YahooMetricItem[];
  basicInfo: YahooMetricItem[];
  analytics: YahooMetricItem[];
  trailingReturns: YahooMetricItem[];
  extraMetrics: YahooMetricItem[];
}

export interface YahooFundDetailsViewModel extends YahooBaseDetailsViewModel {
  assetType: 'fund';
  topHoldings: YahooFundHoldingViewItem[];
  geographicExposure: YahooFundGeographyViewItem[];
  annualReturns: YahooFundReturnViewItem[];
  dailyPerformance: YahooFundDailyPointViewItem[];
  riskIndicator: YahooFundRiskViewModel | null;
}

export interface YahooEquityDetailsViewModel extends YahooBaseDetailsViewModel {
  assetType: 'equity';
}

export type YahooDetailsViewModel = YahooFundDetailsViewModel | YahooEquityDetailsViewModel;
