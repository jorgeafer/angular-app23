const { HttpError } = require('../errors/http-error');

const BASE_URL = 'https://api.twelvedata.com';

class TwelveDataProvider {
  constructor(apiKey) {
    if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is required');
    this.apiKey = apiKey;
  }

  // ── Public interface (same as YahooFinanceProvider) ──────────────────────

  async getAssetDetails(request) {
    const symbol = await this.resolveSymbol(request);
    const [quote, profile, timeSeries] = await Promise.all([
      this.fetchQuote(symbol),
      this.fetchProfile(symbol).catch(() => null),
      this.fetchTimeSeries(symbol).catch(() => [])
    ]);

    if (!quote) throw new HttpError(404, 'Twelve Data: activo no encontrado');

    return request.assetType === 'fund'
      ? this.normalizeFund(request, symbol, quote, profile, timeSeries)
      : this.normalizeEquity(request, symbol, quote, profile, timeSeries);
  }

  async getFundSnapshot(request) {
    return this.getAssetDetails({ ...request, assetType: 'fund' });
  }

  async getMarketSeries(symbol) {
    return this.fetchTimeSeries(symbol);
  }

  // ── Private fetch helpers ─────────────────────────────────────────────────

  async resolveSymbol(request) {
    if (request.idType === 'ticker' || request.idType === 'symbol') {
      return request.id;
    }

    const results = await this.get('/symbol_search', { symbol: request.id });

    if (!Array.isArray(results?.data) || !results.data.length) {
      throw new HttpError(404, `Twelve Data: sin resultados para ${request.id}`);
    }

    const preferredTypes = request.assetType === 'fund'
      ? ['ETF', 'Mutual Fund', 'Fund']
      : ['Common Stock', 'Equity', 'ADR'];

    const hit =
      results.data.find((item) => preferredTypes.some((t) => item.instrument_type?.includes(t))) ||
      results.data[0];

    if (!hit?.symbol) {
      throw new HttpError(404, `Twelve Data: sin resultado usable para ${request.id}`);
    }

    return hit.symbol;
  }

  async fetchQuote(symbol) {
    const data = await this.get('/quote', { symbol });
    if (isError(data)) return null;
    return data;
  }

  async fetchProfile(symbol) {
    const data = await this.get('/profile', { symbol });
    if (isError(data)) return null;
    return data;
  }

  async fetchTimeSeries(symbol) {
    const data = await this.get('/time_series', {
      symbol,
      interval: '1day',
      outputsize: 5000,
      date_format: 'YYYY-MM-DD'
    });

    if (isError(data) || !Array.isArray(data?.values)) return [];

    return data.values
      .map((point) => ({
        date: point.datetime,
        close: parseFloat(point.close)
      }))
      .filter((point) => point.date && Number.isFinite(point.close))
      .reverse(); // Twelve Data devuelve más reciente primero
  }

  async get(path, params = {}) {
    const qs = new URLSearchParams({ ...params, apikey: this.apiKey }).toString();
    const url = `${BASE_URL}${path}?${qs}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Twelve Data HTTP ${response.status} for ${path}`);
    }

    return response.json();
  }

  // ── Normalizers ────────────────────────────────────────────────────────────

  normalizeEquity(request, symbol, quote, profile, dailyPerformance) {
    const latestPoint = dailyPerformance.at(-1);

    return {
      assetType: 'equity',
      requestedId: request.id,
      resolvedId: symbol,
      resolvedIdType: request.idType,
      name: quote.name,
      isin: request.idType === 'isin' ? request.id : undefined,
      ticker: symbol,
      exchange: quote.exchange,
      currency: quote.currency,
      latestPrice: latestPoint?.close ?? parseNumber(quote.close),
      latestPriceDate: latestPoint?.date ?? quote.datetime,
      marketCap: quote.market_cap ? parseInt(quote.market_cap, 10) : undefined,
      sector: profile?.sector,
      country: profile?.country,
      industry: profile?.industry,
      dailyPerformance,
      valuationMetrics: {},
      financialsSummary: {}
    };
  }

  normalizeFund(request, symbol, quote, profile, dailyPerformance) {
    const latestPoint = dailyPerformance.at(-1);

    return {
      assetType: 'fund',
      requestedId: request.id,
      resolvedId: symbol,
      resolvedIdType: request.idType,
      name: quote.name,
      isin: request.idType === 'isin' ? request.id : undefined,
      baseCurrency: quote.currency,
      nav: latestPoint?.close ?? parseNumber(quote.close),
      navDate: latestPoint?.date ?? quote.datetime,
      family: profile?.name,
      category: undefined,
      country: profile?.country,
      dailyPerformance,
      topHoldings: [],
      geographicExposure: [],
      annualReturns: [],
      trailingReturns: {},
      portfolioBreakdown: {},
      riskIndicator: {}
    };
  }
}

function isError(data) {
  return !data || data.code === 400 || data.status === 'error';
}

function parseNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

module.exports = { TwelveDataProvider };
