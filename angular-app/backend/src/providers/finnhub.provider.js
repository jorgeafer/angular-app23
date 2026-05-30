const { HttpError } = require('../errors/http-error');

const BASE_URL = 'https://finnhub.io/api/v1';
const TEN_YEARS_AGO_S = Math.floor((Date.now() - 10 * 365 * 24 * 60 * 60 * 1000) / 1000);

class FinnhubProvider {
  constructor(apiKey) {
    if (!apiKey) throw new Error('FINNHUB_API_KEY is required');
    this.apiKey = apiKey;
  }

  // ── Public interface (same as YahooFinanceProvider) ──────────────────────

  async getAssetDetails(request) {
    const symbol = await this.resolveSymbol(request);
    const [quote, profile, dailyPerformance] = await Promise.all([
      this.fetchQuote(symbol),
      this.fetchProfile(symbol, request).catch(() => null),
      this.fetchCandles(symbol).catch(() => [])
    ]);

    if (!quote || (quote.c === 0 && quote.pc === 0)) {
      throw new HttpError(404, `Finnhub: sin datos para ${symbol}`);
    }

    return request.assetType === 'fund'
      ? this.normalizeFund(request, symbol, quote, profile, dailyPerformance)
      : this.normalizeEquity(request, symbol, quote, profile, dailyPerformance);
  }

  async getFundSnapshot(request) {
    return this.getAssetDetails({ ...request, assetType: 'fund' });
  }

  async getMarketSeries(symbol) {
    return this.fetchCandles(symbol);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  async resolveSymbol(request) {
    if (request.idType === 'ticker' || request.idType === 'symbol') {
      return request.id;
    }

    const results = await this.get('/search', { q: request.id });
    const hits = Array.isArray(results?.result) ? results.result : [];

    if (!hits.length) {
      throw new HttpError(404, `Finnhub: sin resultados para ${request.id}`);
    }

    // Prefer ETF/Fund types first
    const preferred = hits.find((h) =>
      ['ETP', 'ETF', 'Mutual Fund', 'FUND'].some((t) => h.type?.includes(t))
    );
    const hit = preferred ?? hits[0];

    if (!hit?.symbol) {
      throw new HttpError(404, `Finnhub: no se pudo resolver ${request.id}`);
    }

    return hit.symbol;
  }

  async fetchQuote(symbol) {
    const data = await this.get('/quote', { symbol });
    if (!data || data.c === undefined) return null;
    return data;
  }

  async fetchProfile(symbol, request) {
    // Try ETF profile (free tier)
    try {
      const data = await this.get('/etf/profile', { symbol });
      if (data?.name) return { ...data, _source: 'etf' };
    } catch {}

    // Try stock/company profile (free tier)
    try {
      const data = await this.get('/stock/profile2', { symbol });
      if (data?.name) return { ...data, _source: 'stock' };
    } catch {}

    // Try mutual fund profile by ISIN (premium — may return 403)
    if (request?.idType === 'isin') {
      try {
        const data = await this.get('/mutual-fund/profile2', { isin: request.id });
        if (data?.name) return { ...data, _source: 'mutualfund' };
      } catch {}
    }

    return null;
  }

  async fetchCandles(symbol) {
    const to = Math.floor(Date.now() / 1000);

    const data = await this.get('/stock/candle', {
      symbol,
      resolution: 'D',
      from: String(TEN_YEARS_AGO_S),
      to: String(to)
    });

    if (!data || data.s !== 'ok' || !Array.isArray(data.c) || !data.c.length) {
      return [];
    }

    return data.t
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        close: Number(data.c[i].toFixed(4))
      }))
      .filter((p) => Number.isFinite(p.close));
  }

  async get(path, params = {}) {
    const qs = new URLSearchParams({ ...params, token: this.apiKey }).toString();
    const url = `${BASE_URL}${path}?${qs}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (response.status === 403) {
      throw new HttpError(403, 'Finnhub: endpoint requiere plan premium');
    }

    if (!response.ok) {
      throw new Error(`Finnhub HTTP ${response.status} para ${path}`);
    }

    return response.json();
  }

  // ── Normalizers ────────────────────────────────────────────────────────────

  normalizeFund(request, symbol, quote, profile, dailyPerformance) {
    const latestPoint = dailyPerformance.at(-1);

    return {
      assetType: 'fund',
      requestedId: request.id,
      resolvedId: symbol,
      resolvedIdType: request.idType,
      name: profile?.name ?? profile?.longName ?? symbol,
      isin: request.idType === 'isin' ? request.id : undefined,
      baseCurrency: profile?.currency,
      nav: latestPoint?.close ?? quote.c ?? undefined,
      navDate: latestPoint?.date ?? new Date().toISOString().slice(0, 10),
      family: profile?.fundFamily ?? profile?.managedBy ?? undefined,
      category: profile?.category ?? profile?.type ?? undefined,
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

  normalizeEquity(request, symbol, quote, profile, dailyPerformance) {
    const latestPoint = dailyPerformance.at(-1);

    return {
      assetType: 'equity',
      requestedId: request.id,
      resolvedId: symbol,
      resolvedIdType: request.idType,
      name: profile?.name ?? symbol,
      isin: request.idType === 'isin' ? request.id : undefined,
      ticker: symbol,
      exchange: profile?.exchange,
      currency: profile?.currency,
      latestPrice: latestPoint?.close ?? quote.c ?? undefined,
      latestPriceDate: latestPoint?.date ?? new Date().toISOString().slice(0, 10),
      marketCap: profile?.marketCapitalization
        ? Math.round(profile.marketCapitalization * 1e6)
        : undefined,
      sector: profile?.finnhubIndustry,
      country: profile?.country,
      industry: profile?.finnhubIndustry,
      dailyPerformance,
      valuationMetrics: {},
      financialsSummary: {}
    };
  }
}

module.exports = { FinnhubProvider };
