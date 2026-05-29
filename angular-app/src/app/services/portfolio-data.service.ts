import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import {
  CreateFundPayload,
  EditablePortfolioField,
  PortfolioDataset,
  PortfolioImportPreview,
  PortfolioImportResult,
  PortfolioOperation,
  PortfolioOperationPayload,
  PortfolioRow,
  PortfolioSection
} from '../models/portfolio.models';
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

  getAssetOperations(id: string, portfolioKey = 'main'): Promise<PortfolioOperation[]> {
    return firstValueFrom(
      this.http
        .get<PortfolioOperation[]>(`${this.getBaseUrl(portfolioKey)}/assets/${encodeURIComponent(id)}/operations`)
        .pipe(map((operations) => operations.map((operation) => this.mapOperation(operation))))
    );
  }

  async createAssetOperation(
    id: string,
    payload: PortfolioOperationPayload,
    portfolioKey = 'main'
  ): Promise<PortfolioOperation[]> {
    const operations = await firstValueFrom(
      this.http
        .post<PortfolioOperation[]>(`${this.getBaseUrl(portfolioKey)}/assets/${encodeURIComponent(id)}/operations`, payload)
        .pipe(map((items) => items.map((operation) => this.mapOperation(operation))))
    );

    this.datasetPromises.clear();
    return operations;
  }

  async updateAssetOperation(
    id: string,
    operationId: string,
    payload: PortfolioOperationPayload,
    portfolioKey = 'main'
  ): Promise<PortfolioOperation[]> {
    const operations = await firstValueFrom(
      this.http
        .patch<PortfolioOperation[]>(
          `${this.getBaseUrl(portfolioKey)}/assets/${encodeURIComponent(id)}/operations/${encodeURIComponent(operationId)}`,
          payload
        )
        .pipe(map((items) => items.map((operation) => this.mapOperation(operation))))
    );

    this.datasetPromises.clear();
    return operations;
  }

  async deleteAssetOperation(id: string, operationId: string, portfolioKey = 'main'): Promise<PortfolioOperation[]> {
    const operations = await firstValueFrom(
      this.http
        .delete<PortfolioOperation[]>(`${this.getBaseUrl(portfolioKey)}/assets/${encodeURIComponent(id)}/operations/${encodeURIComponent(operationId)}`)
        .pipe(map((items) => items.map((operation) => this.mapOperation(operation))))
    );

    this.datasetPromises.clear();
    return operations;
  }

  getImportPreview(portfolioKey = 'main'): Promise<PortfolioImportPreview> {
    return firstValueFrom(
      this.http
        .get<PortfolioImportPreview>(`${this.getBaseUrl(portfolioKey)}/import/preview`)
        .pipe(map((preview) => this.mapImportPreview(preview)))
    );
  }

  async importPortfolio(portfolioKey = 'main'): Promise<PortfolioImportResult> {
    const result = await firstValueFrom(
      this.http.post<PortfolioImportResult>(`${this.getBaseUrl(portfolioKey)}/import`, {})
    );

    this.datasetPromises.clear();
    return result;
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
      lastImportedAt: dataset.lastImportedAt ? formatDateEs(dataset.lastImportedAt.slice(0, 10)) : dataset.lastImportedAt,
      sections: dataset.sections.map((section) => this.mapSection(section)),
      rows: dataset.rows.map((row) => this.mapRow(row)),
      summaryBySector: dataset.summaryBySector.map((item) => ({ ...item })),
      summaryByCountry: dataset.summaryByCountry.map((item) => ({ ...item })),
      summaryByManager: dataset.summaryByManager.map((item) => ({ ...item })),
      summaryByCurrency: dataset.summaryByCurrency.map((item) => ({ ...item })),
      summaryByClass: dataset.summaryByClass.map((item) => ({ ...item })),
      alerts: dataset.alerts.map((item) => ({ ...item })),
      benchmarkOverview: dataset.benchmarkOverview
        ? {
            ...dataset.benchmarkOverview,
            series: (dataset.benchmarkOverview.series ?? []).map((item) => ({ ...item })),
            snapshots: dataset.benchmarkOverview.snapshots.map((item) => ({ ...item }))
          }
        : null,
      analytics: { ...dataset.analytics },
      quality: { ...dataset.quality }
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
      totalReturn: normalizePercentString(row.totalReturn),
      averageCost: normalizeCurrencyString(row.averageCost ?? ''),
      annualizedReturn: normalizePercentString(row.annualizedReturn ?? ''),
      contribution: normalizePercentString(row.contribution ?? ''),
      qualityIssues: [...(row.qualityIssues ?? [])]
    };
  }

  private mapOperation(operation: PortfolioOperation): PortfolioOperation {
    return {
      ...operation,
      operationDate: formatDateEs(operation.operationDate),
      createdAt: operation.createdAt ? formatDateEs(operation.createdAt.slice(0, 10)) : operation.createdAt,
      updatedAt: operation.updatedAt ? formatDateEs(operation.updatedAt.slice(0, 10)) : operation.updatedAt
    };
  }

  private mapImportPreview(preview: PortfolioImportPreview): PortfolioImportPreview {
    return {
      ...preview,
      lastWorkbookUpdate: preview.lastWorkbookUpdate ? formatDateEs(preview.lastWorkbookUpdate.slice(0, 10)) : null,
      warnings: [...(preview.warnings ?? [])]
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
