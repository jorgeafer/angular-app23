import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  YahooApiDetails,
  YahooDetailsViewModel,
  YahooFundDetailsViewModel,
  YahooLookupRequest,
  YahooMetricItem,
  YahooFundGeographyViewItem,
  YahooFundRiskViewModel
} from '../models/yahoo.models';
import { formatDateEs } from '../utils/formatting';

@Injectable({ providedIn: 'root' })
export class YahooFinanceAssetService {
  private readonly baseUrl = '/api/yahoo/assets';
  private readonly geographyPalette = ['#0b7a75', '#f28f3b', '#355070', '#6d597a', '#84a59d', '#b56576', '#2a9d8f'];

  constructor(private readonly http: HttpClient) {}

  getAssetDetails(request: YahooLookupRequest): Observable<YahooDetailsViewModel> {
    let params = new HttpParams()
      .set('assetType', request.assetType)
      .set('idType', request.idType)
      .set('id', request.id);

    if (request.yahooSymbol) {
      params = params.set('yahooSymbol', request.yahooSymbol);
    }

    if (request.name) {
      params = params.set('name', request.name);
    }

    return this.http.get<YahooApiDetails>(this.baseUrl, { params }).pipe(map((response) => this.toViewModel(response)));
  }

  private toViewModel(response: YahooApiDetails): YahooDetailsViewModel {
    if (response.assetType === 'fund') {
      const riskIndicator = this.mapRiskIndicator(response);

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
          this.stringMetric('Divisa base', response.baseCurrency),
          this.stringMetric('Risk rating', response.riskRating),
          this.stringMetric('ISIN', response.isin),
          this.stringMetric('Yahoo symbol', response.resolvedId)
        ]),
        analytics: this.objectMetrics(response.portfolioBreakdown),
        trailingReturns: this.objectMetrics(response.trailingReturns),
        extraMetrics: riskIndicator?.stats ?? [],
        topHoldings: (response.topHoldings ?? []).map((item) => ({
          name: item.name,
          symbol: item.symbol,
          geography: item.country,
          weight: item.weight,
          weightLabel: this.formatPercentValue(item.weight)
        })),
        geographicExposure: (response.geographicExposure ?? []).map((item, index) =>
          this.toGeographyViewItem(item.label, item.weight, index)
        ),
        annualReturns: (response.annualReturns ?? []).map((item) => ({
          label: item.label,
          year: item.year,
          value: item.value,
          valueLabel: this.formatPercentValue(item.value),
          isYtd: !!item.isYtd
        })),
        dailyPerformance: (response.dailyPerformance ?? []).map((item) => ({
          date: item.date,
          close: item.close
        })),
        riskIndicator
      } satisfies YahooFundDetailsViewModel;
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
        this.stringMetric('ISIN', response.isin)
      ]),
      analytics: this.objectMetrics(response.valuationMetrics),
      trailingReturns: [],
      extraMetrics: this.objectMetrics(response.financialsSummary)
    };
  }

  private mapRiskIndicator(response: Extract<YahooApiDetails, { assetType: 'fund' }>): YahooFundRiskViewModel | null {
    const rating = response.riskIndicator?.rating;
    const stats = this.compactMetrics([
      this.stringMetric('Nivel de riesgo', response.riskIndicator?.label),
      this.stringMetric('Periodo', response.riskIndicator?.period),
      this.numericMetric('Desviacion estandar', response.riskIndicator?.standardDeviation),
      this.numericMetric('Sharpe', response.riskIndicator?.sharpeRatio),
      this.numericMetric('Beta', response.riskIndicator?.beta),
      this.numericMetric('Alpha', response.riskIndicator?.alpha)
    ]);

    if (typeof rating !== 'number' && stats.length === 0) {
      return null;
    }

    return {
      rating,
      scaleMax: response.riskIndicator?.scaleMax ?? 5,
      label: response.riskIndicator?.label,
      stats
    };
  }

  private toGeographyViewItem(label: string, weight: number, index: number): YahooFundGeographyViewItem {
    return {
      label,
      weight,
      weightLabel: this.formatPercentValue(weight),
      color: this.geographyPalette[index % this.geographyPalette.length]
    };
  }

  private objectMetrics(source?: Record<string, number | string | null | undefined>): YahooMetricItem[] {
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

  private compactMetrics(metrics: Array<YahooMetricItem | null>): YahooMetricItem[] {
    return metrics.filter((metric): metric is YahooMetricItem => metric !== null);
  }

  private stringMetric(label: string, value?: string): YahooMetricItem | null {
    return value ? { label, value } : null;
  }

  private dateMetric(label: string, value?: string): YahooMetricItem | null {
    return value ? { label, value: formatDateEs(value) } : null;
  }

  private percentMetric(label: string, value?: number): YahooMetricItem | null {
    return typeof value === 'number' ? { label, value: `${this.formatDecimal(value)}%` } : null;
  }

  private numericMetric(label: string, value?: number): YahooMetricItem | null {
    return typeof value === 'number' ? { label, value: this.formatDecimal(value) } : null;
  }

  private currencyMetric(label: string, value?: number, currency?: string): YahooMetricItem | null {
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

  private formatPercentValue(value: number): string {
    return `${this.formatDecimal(value)}%`;
  }
}
