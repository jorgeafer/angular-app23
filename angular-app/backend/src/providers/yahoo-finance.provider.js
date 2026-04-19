const YahooFinance = require('yahoo-finance2').default;
const { env } = require('../config/env');
const { HttpError } = require('../errors/http-error');

class YahooFinanceProvider {
  constructor() {
    if (env.yahooAllowInsecureTls) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    this.client = new YahooFinance({
      suppressNotices: ['yahooSurvey'],
      validation: {
        logErrors: false
      }
    });
    this.countryCache = new Map();
  }

  async getAssetDetails(request) {
    const resolved = await this.resolveSymbol(request);
    const quote = await this.client.quote(resolved.symbol);
    const summary = await this.fetchSummary(resolved.symbol, request.assetType);
    const chart = await this.fetchDailyChart(resolved.symbol);

    return request.assetType === 'fund'
      ? await this.normalizeFund(request, resolved, quote, summary, chart)
      : this.normalizeEquity(request, resolved, quote, summary, chart);
  }

  async getFundSnapshot(request) {
    const resolved = await this.resolveSymbol(request);
    const quote = await this.client.quote(resolved.symbol);
    const summary = await this.fetchSummary(resolved.symbol, 'fund');
    const chart = await this.fetchDailyChart(resolved.symbol);
    const dailyPerformance = this.buildDailyPerformance(chart?.quotes);
    const latestPoint = dailyPerformance.at(-1);

    return compactObject({
      assetType: 'fund',
      requestedId: request.id,
      resolvedId: resolved.symbol,
      resolvedIdType: request.idType,
      name: resolved.searchHit?.longname || quote.longName || quote.shortName,
      isin: request.idType === 'isin' ? request.id : undefined,
      category: summary?.fundProfile?.categoryName || summary?.defaultKeyStatistics?.category || undefined,
      nav: latestPoint?.close ?? quote.regularMarketPrice ?? undefined,
      navDate: latestPoint?.date ?? toDateString(quote.regularMarketTime),
      dailyPerformance
    });
  }

  async resolveSymbol(request) {
    const searchResult = await this.client.search(request.id, {
      quotesCount: 10,
      newsCount: 0
    });

    const expectedTypes = request.assetType === 'fund' ? ['MUTUALFUND', 'ETF'] : ['EQUITY'];
    const hit = (searchResult.quotes || []).find((item) => expectedTypes.includes(item.quoteType));

    if (hit?.symbol) {
      return { symbol: hit.symbol, searchHit: hit };
    }

    if (request.idType === 'ticker' || request.idType === 'symbol') {
      return { symbol: request.id, searchHit: null };
    }

    throw new HttpError(404, 'Yahoo Finance no pudo resolver el identificador del activo');
  }

  async fetchSummary(symbol, assetType) {
    try {
      return await this.client.quoteSummary(symbol, {
        modules:
          assetType === 'fund'
            ? ['price', 'fundProfile', 'summaryProfile', 'defaultKeyStatistics', 'topHoldings', 'fundPerformance']
            : ['price', 'summaryProfile', 'financialData', 'defaultKeyStatistics']
      }, {
        validateResult: false
      });
    } catch {
      return null;
    }
  }

  async fetchDailyChart(symbol) {
    try {
      return await this.client.chart(
        symbol,
        {
          period1: '2000-01-01',
          interval: '1d'
        },
        {
          validateResult: false
        }
      );
    } catch {
      return null;
    }
  }

  async normalizeFund(request, resolved, quote, summary, chart) {
    const topHoldings = await this.buildTopHoldings(summary?.topHoldings?.holdings);
    const geographicExposure = this.buildGeographicExposure(topHoldings);
    const annualReturns = this.buildAnnualReturns(summary?.fundPerformance, summary?.defaultKeyStatistics);
    const dailyPerformance = this.buildDailyPerformance(chart?.quotes);
    const riskIndicator = this.buildRiskIndicator(summary?.fundPerformance, summary?.defaultKeyStatistics);

    return {
      assetType: 'fund',
      requestedId: request.id,
      resolvedId: resolved.symbol,
      resolvedIdType: request.idType,
      performanceId: undefined,
      name: resolved.searchHit?.longname || quote.longName || quote.shortName,
      isin: request.idType === 'isin' ? request.id : undefined,
      category: summary?.fundProfile?.categoryName || summary?.defaultKeyStatistics?.category || undefined,
      domicile: undefined,
      baseCurrency: quote.currency || undefined,
      nav: quote.regularMarketPrice ?? undefined,
      navDate: toDateString(quote.regularMarketTime),
      aum: summary?.defaultKeyStatistics?.totalAssets ?? undefined,
      benchmark: undefined,
      riskRating: formatMaybe(summary?.defaultKeyStatistics?.morningStarRiskRating),
      sustainabilityRating: undefined,
      expenseRatio:
        summary?.fundProfile?.feesExpensesInvestment?.netExpRatio ??
        summary?.fundProfile?.feesExpensesInvestment?.grossExpRatio ??
        summary?.defaultKeyStatistics?.annualReportExpenseRatio ??
        undefined,
      trailingReturns: compactObject({
        ytdReturn: toPercent(summary?.defaultKeyStatistics?.ytdReturn)
      }),
      portfolioBreakdown: compactObject({
        family: summary?.fundProfile?.family,
        beta3Year: summary?.defaultKeyStatistics?.beta3Year
      }),
      topHoldings,
      geographicExposure,
      annualReturns,
      dailyPerformance,
      riskIndicator
    };
  }

  normalizeEquity(request, resolved, quote, summary, chart) {
    const dailyPerformance = this.buildDailyPerformance(chart?.quotes);
    const latestPoint = dailyPerformance.at(-1);

    return {
      assetType: 'equity',
      requestedId: request.id,
      resolvedId: resolved.symbol,
      resolvedIdType: request.idType,
      performanceId: undefined,
      name: resolved.searchHit?.longname || quote.longName || quote.shortName,
      isin: request.idType === 'isin' ? request.id : undefined,
      ticker: quote.symbol || resolved.symbol,
      exchange: quote.fullExchangeName || quote.exchange || resolved.searchHit?.exchDisp || undefined,
      currency: quote.currency || undefined,
      latestPrice: latestPoint?.close ?? quote.regularMarketPrice ?? undefined,
      latestPriceDate: latestPoint?.date ?? toDateString(quote.regularMarketTime),
      marketCap: quote.marketCap ?? summary?.price?.marketCap ?? undefined,
      sector: summary?.summaryProfile?.sectorDisp || summary?.summaryProfile?.sector || resolved.searchHit?.sectorDisp,
      industry:
        summary?.summaryProfile?.industryDisp || summary?.summaryProfile?.industry || resolved.searchHit?.industryDisp,
      country: summary?.summaryProfile?.country || undefined,
      dailyPerformance,
      valuationMetrics: compactObject({
        forwardPE: summary?.defaultKeyStatistics?.forwardPE,
        enterpriseValue: summary?.defaultKeyStatistics?.enterpriseValue,
        priceToBook: summary?.defaultKeyStatistics?.priceToBook,
        marketCap: quote.marketCap
      }),
      financialsSummary: compactObject({
        revenueGrowth: toPercent(summary?.financialData?.revenueGrowth),
        earningsGrowth: toPercent(summary?.financialData?.earningsGrowth),
        operatingMargins: toPercent(summary?.financialData?.operatingMargins),
        profitMargins: toPercent(summary?.financialData?.profitMargins),
        returnOnEquity: toPercent(summary?.financialData?.returnOnEquity),
        returnOnAssets: toPercent(summary?.financialData?.returnOnAssets),
        recommendationKey: summary?.financialData?.recommendationKey
      })
    };
  }

  async buildTopHoldings(holdings) {
    if (!Array.isArray(holdings) || holdings.length === 0) {
      return [];
    }

    const topHoldings = holdings
      .filter((holding) => holding?.holdingName && typeof holding?.holdingPercent === 'number')
      .slice(0, 10);

    return Promise.all(
      topHoldings.map(async (holding) => ({
        name: holding.holdingName,
        symbol: holding.symbol || undefined,
        weight: roundPercent(holding.holdingPercent * 100),
        country: await this.resolveHoldingCountry(holding.symbol)
      }))
    );
  }

  async resolveHoldingCountry(symbol) {
    if (!symbol) {
      return undefined;
    }

    if (this.countryCache.has(symbol)) {
      return this.countryCache.get(symbol);
    }

    try {
      const summary = await this.client.quoteSummary(
        symbol,
        {
          modules: ['summaryProfile', 'price']
        },
        {
          validateResult: false
        }
      );

      const country =
        summary?.summaryProfile?.country ||
        summary?.price?.exchangeName ||
        summary?.price?.fullExchangeName ||
        undefined;

      this.countryCache.set(symbol, country);
      return country;
    } catch {
      this.countryCache.set(symbol, undefined);
      return undefined;
    }
  }

  buildGeographicExposure(topHoldings) {
    if (!Array.isArray(topHoldings) || topHoldings.length === 0) {
      return [];
    }

    const totals = new Map();
    let accumulated = 0;

    for (const holding of topHoldings) {
      const label = holding.country || 'No disponible';
      accumulated += holding.weight;
      totals.set(label, roundPercent((totals.get(label) || 0) + holding.weight));
    }

    const otherWeight = roundPercent(Math.max(0, 100 - accumulated));

    if (otherWeight > 0) {
      totals.set('Otros', roundPercent((totals.get('Otros') || 0) + otherWeight));
    }

    return Array.from(totals.entries())
      .map(([label, weight]) => ({ label, weight }))
      .sort((left, right) => right.weight - left.weight);
  }

  buildAnnualReturns(fundPerformance, defaultKeyStatistics) {
    const currentYear = new Date().getFullYear();
    const annualItems = [];
    const ytdValue =
      firstNumber(
        fundPerformance?.trailingReturns?.ytd,
        fundPerformance?.performanceOverview?.ytdReturnPct,
        defaultKeyStatistics?.ytdReturn
      ) ?? undefined;

    if (typeof ytdValue === 'number') {
      annualItems.push({
        label: `${currentYear} YTD`,
        year: currentYear,
        value: roundPercent(ytdValue * 100),
        isYtd: true
      });
    }

    const yearlyReturns = Array.isArray(fundPerformance?.annualTotalReturns?.returns)
      ? fundPerformance.annualTotalReturns.returns
      : [];

    const lastTenYears = yearlyReturns
      .filter((item) => item?.year && item.year < currentYear && typeof item?.annualValue === 'number')
      .sort((left, right) => right.year - left.year)
      .slice(0, 10)
      .map((item) => ({
        label: String(item.year),
        year: item.year,
        value: roundPercent(item.annualValue * 100),
        isYtd: false
      }));

    return [...annualItems, ...lastTenYears];
  }

  buildDailyPerformance(quotes) {
    if (!Array.isArray(quotes)) {
      return [];
    }

    return quotes
      .filter((quote) => quote?.date instanceof Date && typeof quote?.close === 'number')
      .map((quote) => ({
        date: quote.date.toISOString().slice(0, 10),
        close: roundDecimal(quote.close, 4)
      }));
  }

  buildRiskIndicator(fundPerformance, defaultKeyStatistics) {
    const rating =
      firstNumber(
        fundPerformance?.riskOverviewStatistics?.riskRating,
        defaultKeyStatistics?.morningStarRiskRating
      ) ?? undefined;

    const preferredStats =
      fundPerformance?.riskOverviewStatistics?.riskStatistics?.find((item) => item?.year === '3y') ||
      fundPerformance?.riskOverviewStatistics?.riskStatistics?.find((item) => item?.year === '5y') ||
      fundPerformance?.riskOverviewStatistics?.riskStatistics?.[0];

    return compactObject({
      rating,
      scaleMax: 5,
      label: describeRisk(rating),
      standardDeviation:
        typeof preferredStats?.stdDev === 'number' ? roundDecimal(preferredStats.stdDev, 2) : undefined,
      sharpeRatio:
        typeof preferredStats?.sharpeRatio === 'number' ? roundDecimal(preferredStats.sharpeRatio, 2) : undefined,
      beta: typeof preferredStats?.beta === 'number' ? roundDecimal(preferredStats.beta, 2) : undefined,
      alpha: typeof preferredStats?.alpha === 'number' ? roundDecimal(preferredStats.alpha, 2) : undefined,
      period: preferredStats?.year || undefined
    });
  }
}

function compactObject(source) {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function formatMaybe(value) {
  return value === undefined || value === null ? undefined : String(value);
}

function firstNumber(...values) {
  return values.find((value) => typeof value === 'number');
}

function toDateString(value) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function toPercent(value) {
  if (typeof value !== 'number') {
    return undefined;
  }

  return `${(value * 100).toFixed(2)}%`;
}

function roundPercent(value) {
  return roundDecimal(value, 2);
}

function roundDecimal(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function describeRisk(value) {
  if (typeof value !== 'number') {
    return undefined;
  }

  if (value <= 1) {
    return 'Muy bajo';
  }

  if (value <= 2) {
    return 'Bajo';
  }

  if (value <= 3) {
    return 'Medio';
  }

  if (value <= 4) {
    return 'Alto';
  }

  return 'Muy alto';
}

module.exports = { YahooFinanceProvider };
