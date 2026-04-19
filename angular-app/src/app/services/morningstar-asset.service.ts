import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  MorningstarApiDetails,
  MorningstarAssetType,
  MorningstarDetailsViewModel,
  MorningstarIdentifierType,
  MorningstarLookupRequest,
  MorningstarMetricItem
} from '../models/morningstar.models';

@Injectable({ providedIn: 'root' })
export class MorningstarAssetService {
  private readonly baseUrl = '/api/morningstar/assets';

  constructor(private readonly http: HttpClient) {}

  getAssetDetails(request: MorningstarLookupRequest): Observable<MorningstarDetailsViewModel> {
    const params = new HttpParams()
      .set('assetType', request.assetType)
      .set('idType', request.idType)
      .set('id', request.id);

    // TODO-BACKEND-MORNINGSTAR: exponer este endpoint interno en backend y resolver autenticacion segura contra Morningstar.
    return this.http
      .get<MorningstarApiDetails>(this.baseUrl, { params })
      .pipe(map((response) => this.toViewModel(response)));
  }

  private toViewModel(response: MorningstarApiDetails): MorningstarDetailsViewModel {
    if (response.assetType === 'fund') {
      return {
        assetType: response.assetType,
        requestedId: response.requestedId,
        resolvedId: response.resolvedId,
        resolvedIdType: response.resolvedIdType,
        performanceId: response.performanceId,
        name: response.name,
        isin: response.isin,
        headlineMetrics: this.compactMetrics([
          this.currencyMetric('NAV mas reciente', response.nav, response.baseCurrency),
          this.dateMetric('Fecha NAV', response.navDate),
          this.currencyMetric('AUM', response.aum, response.baseCurrency),
          this.percentMetric('Expense ratio', response.expenseRatio)
        ]),
        basicInfo: this.compactMetrics([
          this.stringMetric('Categoria', response.category),
          this.stringMetric('Benchmark', response.benchmark),
          this.stringMetric('Divisa base', response.baseCurrency),
          this.stringMetric('Domicilio', response.domicile),
          this.stringMetric('Risk rating', response.riskRating),
          this.stringMetric('Sustainability rating', response.sustainabilityRating),
          this.stringMetric('Performance ID', response.performanceId),
          this.stringMetric('ISIN', response.isin)
        ]),
        analytics: this.objectMetrics(response.portfolioBreakdown),
        trailingReturns: this.objectMetrics(response.trailingReturns),
        extraMetrics: []
      };
    }

    return {
      assetType: response.assetType,
      requestedId: response.requestedId,
      resolvedId: response.resolvedId,
      resolvedIdType: response.resolvedIdType,
      performanceId: response.performanceId,
      name: response.name,
      isin: response.isin,
      headlineMetrics: this.compactMetrics([
        this.currencyMetric('Ultimo precio', response.latestPrice, response.currency),
        this.dateMetric('Fecha precio', response.latestPriceDate),
        this.currencyMetric('Capitalizacion', response.marketCap, response.currency)
      ]),
      basicInfo: this.compactMetrics([
        this.stringMetric('Ticker', response.ticker),
        this.stringMetric('Exchange', response.exchange),
        this.stringMetric('Moneda', response.currency),
        this.stringMetric('Sector', response.sector),
        this.stringMetric('Industria', response.industry),
        this.stringMetric('Pais', response.country),
        this.stringMetric('Performance ID', response.performanceId),
        this.stringMetric('ISIN', response.isin)
      ]),
      analytics: this.objectMetrics(response.valuationMetrics),
      trailingReturns: [],
      extraMetrics: this.objectMetrics(response.financialsSummary)
    };
  }

  private objectMetrics(source?: Record<string, number | string | null | undefined>): MorningstarMetricItem[] {
    if (!source) {
      return [];
    }

    return Object.entries(source)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([label, value]) => ({
        label: this.humanizeKey(label),
        value: typeof value === 'number' ? this.formatDecimal(value) : String(value)
      }));
  }

  private compactMetrics(metrics: Array<MorningstarMetricItem | null>): MorningstarMetricItem[] {
    return metrics.filter((metric): metric is MorningstarMetricItem => metric !== null);
  }

  private stringMetric(label: string, value?: string): MorningstarMetricItem | null {
    return value ? { label, value } : null;
  }

  private dateMetric(label: string, value?: string): MorningstarMetricItem | null {
    return value ? { label, value } : null;
  }

  private percentMetric(label: string, value?: number): MorningstarMetricItem | null {
    return typeof value === 'number'
      ? { label, value: `${this.formatDecimal(value)}%` }
      : null;
  }

  private currencyMetric(label: string, value?: number, currency?: string): MorningstarMetricItem | null {
    return typeof value === 'number'
      ? { label, value: this.formatCurrency(value, currency ?? 'EUR') }
      : null;
  }

  private humanizeKey(value: string): string {
    return value
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^./, (char) => char.toUpperCase());
  }

  private formatCurrency(value: number, currency: string): string {
    try {
      return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2
      }).format(value);
    } catch {
      return `${this.formatDecimal(value)} ${currency}`;
    }
  }

  private formatDecimal(value: number): string {
    return new Intl.NumberFormat('es-ES', {
      maximumFractionDigits: 2
    }).format(value);
  }
}
