export interface PortfolioNavPoint {
  date: string;
  close: number;
}

export type EditablePortfolioField = 'shares' | 'totalInvested' | 'investmentClass' | 'type' | 'currency';

export interface CreateFundPayload {
  name: string;
  isin: string;
  type: string;
  currency: string;
  totalInvested: string;
  shares: string;
}

export type PortfolioOperationType = 'buy' | 'sell' | 'dividend' | 'fee';

export interface PortfolioOperation {
  id: string;
  assetId: string;
  operationType: PortfolioOperationType;
  operationDate: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  feeAmount: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioOperationPayload {
  operationType: PortfolioOperationType;
  operationDate: string;
  quantity: string | number | null;
  unitPrice: string | number | null;
  amount: string | number | null;
  feeAmount: string | number | null;
  notes: string;
}

export interface PortfolioRow {
  id: string;
  section: 'FONDOS' | 'ACCIONES';
  assetKind?: 'fund' | 'equity';
  name: string;
  isin: string;
  ticker?: string;
  symbol?: string;
  performanceId?: string;
  shares: string;
  currency: string;
  type: string;
  investmentClass?: string;
  totalInvested: string;
  investedWeight: string;
  marketDate: string;
  unitValue: string;
  totalValuation: string;
  profitEuros: string;
  valuationWeight: string;
  totalReturn: string;
  totalInvestedValue: number;
  totalValuationValue: number;
  profitEurosValue: number;
  totalReturnValue: number;
  sharesValue: number;
  unitValueNumber: number;
  averageCost?: string;
  averageCostValue?: number;
  annualizedReturn?: string;
  annualizedReturnValue?: number;
  contribution?: string;
  contributionValue?: number;
  sector?: string;
  country?: string;
  managerName?: string;
  categoryName?: string;
  navHistory?: PortfolioNavPoint[];
  qualityIssues?: string[];
  qualityScore?: number;
  stalePrice?: boolean;
  missingIdentifiers?: boolean;
  missingHistory?: boolean;
}

export interface PortfolioTotals {
  totalInvested: string;
  totalValuation: string;
  profitEuros: string;
  totalReturn: string;
  totalInvestedValue: number;
  totalValuationValue: number;
  profitEurosValue: number;
  totalReturnValue: number;
}

export interface PortfolioSection {
  title: 'FONDOS' | 'ACCIONES';
  rows: PortfolioRow[];
  totals: PortfolioTotals | null;
}

export interface PortfolioSummaryItem {
  label: string;
  value: number;
  formattedValue: string;
  percentage: number;
}

export interface PortfolioAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
}

export interface PortfolioBenchmarkSnapshot {
  label: string;
  portfolioReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
}

export interface PortfolioBenchmarkSeriesPoint {
  date: string;
  portfolioReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
}

export interface PortfolioBenchmarkOverview {
  label: string;
  symbol: string;
  series: PortfolioBenchmarkSeriesPoint[];
  snapshots: PortfolioBenchmarkSnapshot[];
}

export interface PortfolioAnalyticsOverview {
  topHoldingName: string;
  topHoldingWeight: number;
  topFiveWeight: number;
  bestPerformerName: string;
  bestPerformerValue: number;
  worstPerformerName: string;
  worstPerformerValue: number;
  topContributorName: string;
  topContributorValue: number;
  annualizedPortfolioReturn: number;
  positiveCount: number;
  negativeCount: number;
  staleCount: number;
  missingIdentifierCount: number;
  missingHistoryCount: number;
}

export interface PortfolioQualityOverview {
  score: number;
  staleCount: number;
  missingIdentifierCount: number;
  missingHistoryCount: number;
}

export interface PortfolioImportPreview {
  positionCount: number;
  lastImportedAt: string | null;
  sectionCounts: {
    funds: number;
    equities: number;
  };
}

export interface PortfolioImportResult {
  imported: boolean;
  positions?: number;
  sourceMissing?: boolean;
}

export interface PortfolioDataset {
  lastUpdated: string;
  lastImportedAt?: string | null;
  sections: PortfolioSection[];
  rows: PortfolioRow[];
  summaryByType: PortfolioSummaryItem[];
  summaryByAsset: PortfolioSummaryItem[];
  summaryByCurrency: PortfolioSummaryItem[];
  summaryByClass: PortfolioSummaryItem[];
  summaryBySector: PortfolioSummaryItem[];
  summaryByCountry: PortfolioSummaryItem[];
  summaryByManager: PortfolioSummaryItem[];
  alerts: PortfolioAlert[];
  benchmarkOverview: PortfolioBenchmarkOverview | null;
  analytics: PortfolioAnalyticsOverview;
  quality: PortfolioQualityOverview;
}
