export interface PortfolioNavPoint {
  date: string;
  close: number;
}

export type EditablePortfolioField = 'shares' | 'totalInvested' | 'investmentClass';

export interface CreateFundPayload {
  name: string;
  isin: string;
  type: string;
  currency: string;
  totalInvested: string;
  shares: string;
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
  navHistory?: PortfolioNavPoint[];
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

export interface PortfolioDataset {
  lastUpdated: string;
  sections: PortfolioSection[];
  rows: PortfolioRow[];
  summaryByType: PortfolioSummaryItem[];
  summaryByAsset: PortfolioSummaryItem[];
}
