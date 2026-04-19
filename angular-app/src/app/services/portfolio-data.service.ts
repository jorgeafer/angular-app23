import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { CreateFundPayload, EditablePortfolioField, PortfolioDataset, PortfolioRow, PortfolioSection } from '../models/portfolio.models';
import {
  formatDateEs,
  normalizeCurrencyString,
  normalizeNumericString,
  normalizePercentString
} from '../utils/formatting';

@Injectable({ providedIn: 'root' })
export class PortfolioDataService {
  private datasetPromises = new Map<string, Promise<PortfolioDataset>>();

  constructor(private readonly http: HttpClient) {}

  getPortfolio(portfolioKey = 'main', asOfDate = ''): Promise<PortfolioDataset> {
    const cacheKey = `${portfolioKey}:${asOfDate || 'latest'}`;

    if (!this.datasetPromises.has(cacheKey)) {
      this.datasetPromises.set(
        cacheKey,
        firstValueFrom(
          this.http
            .get<PortfolioDataset>(this.getBaseUrl(portfolioKey), {
              params: this.buildPortfolioParams(asOfDate)
            })
            .pipe(map((dataset) => this.mapPortfolioDataset(dataset)))
        )
      );
    }

    return this.datasetPromises.get(cacheKey)!;
  }

  getAssetById(id: string, portfolioKey = 'main'): Promise<PortfolioRow | undefined> {
    return firstValueFrom(
      this.http
        .get<PortfolioRow>(`${this.getBaseUrl(portfolioKey)}/assets/${encodeURIComponent(id)}`)
        .pipe(map((row) => this.mapRow(row)))
    );
  }

  refreshPortfolio(portfolioKey = 'main', asOfDate = ''): Promise<PortfolioDataset> {
    const cacheKey = `${portfolioKey}:${asOfDate || 'latest'}`;
    const request = firstValueFrom(
      this.http
        .get<PortfolioDataset>(this.getBaseUrl(portfolioKey), {
          params: this.buildPortfolioParams(asOfDate)
        })
        .pipe(map((dataset) => this.mapPortfolioDataset(dataset)))
    );

    this.datasetPromises.set(cacheKey, request);
    return request;
  }

  async updateAssetValue(id: string, field: EditablePortfolioField, value: string, portfolioKey = 'main'): Promise<PortfolioRow> {
    const updated = await firstValueFrom(
      this.http
        .patch<PortfolioRow>(`${this.getBaseUrl(portfolioKey)}/assets/${encodeURIComponent(id)}`, {
          field,
          value
        })
        .pipe(map((row) => this.mapRow(row)))
    );

    this.datasetPromises.clear();
    return updated;
  }

  async createFund(payload: CreateFundPayload, portfolioKey = 'main'): Promise<PortfolioRow> {
    const created = await firstValueFrom(
      this.http.post<PortfolioRow>(`${this.getBaseUrl(portfolioKey)}/assets`, payload).pipe(map((row) => this.mapRow(row)))
    );

    this.datasetPromises.clear();
    return created;
  }

  async deleteFund(id: string, portfolioKey = 'main'): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.getBaseUrl(portfolioKey)}/assets/${encodeURIComponent(id)}`));
    this.datasetPromises.clear();
  }

  private getBaseUrl(portfolioKey: string): string {
    return portfolioKey === 'deva' ? '/api/deva-portfolio' : '/api/portfolio';
  }

  private buildPortfolioParams(asOfDate: string): HttpParams | undefined {
    return asOfDate ? new HttpParams().set('date', asOfDate) : undefined;
  }

  private mapPortfolioDataset(dataset: PortfolioDataset): PortfolioDataset {
    return {
      ...dataset,
      lastUpdated: formatDateEs(dataset.lastUpdated),
      sections: dataset.sections.map((section) => this.mapSection(section)),
      rows: dataset.rows.map((row) => this.mapRow(row))
    };
  }

  private mapSection(section: PortfolioSection): PortfolioSection {
    return {
      ...section,
      rows: section.rows.map((row) => this.mapRow(row)),
      totals: section.totals
        ? {
            ...section.totals,
            totalInvested: normalizeCurrencyString(section.totals.totalInvested),
            totalValuation: normalizeCurrencyString(section.totals.totalValuation),
            profitEuros: normalizeCurrencyString(section.totals.profitEuros),
            totalReturn: normalizePercentString(section.totals.totalReturn)
          }
        : null
    };
  }

  private mapRow(row: PortfolioRow): PortfolioRow {
    return {
      ...row,
      shares: normalizeNumericString(row.shares, this.resolveNumericDigits(row.shares)),
      type: this.normalizeTypeLabel(row.type),
      investmentClass: String(row.investmentClass ?? '').trim() || undefined,
      totalInvested: normalizeCurrencyString(row.totalInvested),
      investedWeight: normalizePercentString(row.investedWeight),
      marketDate: formatDateEs(row.marketDate),
      unitValue: normalizeNumericString(row.unitValue, this.resolveNumericDigits(row.unitValue)),
      totalValuation: normalizeCurrencyString(row.totalValuation),
      profitEuros: normalizeCurrencyString(row.profitEuros),
      valuationWeight: normalizePercentString(row.valuationWeight),
      totalReturn: normalizePercentString(row.totalReturn)
    };
  }

  private resolveNumericDigits(value?: string): number {
    if (!value) {
      return 2;
    }

    const separatorIndex = Math.max(value.lastIndexOf('.'), value.lastIndexOf(','));
    if (separatorIndex === -1) {
      return 0;
    }

    return Math.min(Math.max(value.length - separatorIndex - 1, 0), 6);
  }

  private normalizeTypeLabel(value?: string): string {
    const normalized = String(value ?? '').trim();

    if (/^acci[óoÃ\?]n$/i.test(normalized) || /^acci.n$/i.test(normalized)) {
      return 'Acción';
    }

    return normalized;
  }
}
