const { HttpError } = require('../errors/http-error');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
};

// Cache en memoria ISIN → símbolo Yahoo Finance (evita búsquedas repetidas)
const symbolCache = new Map();

class YahooFinanceHttpProvider {
  // ── Public interface ──────────────────────────────────────────────────────

  async getAssetDetails(request) {
    const symbol = await this.resolveSymbol(request);
    const { meta, dailyPerformance } = await this.fetchChart(symbol);

    if (!dailyPerformance.length && !meta?.regularMarketPrice) {
      throw new HttpError(404, `Yahoo Finance: sin datos para ${symbol}`);
    }

    const latestPoint = dailyPerformance.at(-1);

    if (request.assetType === 'fund') {
      return {
        assetType: 'fund',
        requestedId: request.id,
        resolvedId: symbol,
        resolvedIdType: request.idType,
        name: meta?.longName ?? meta?.shortName ?? request.name ?? symbol,
        isin: request.idType === 'isin' ? request.id : undefined,
        baseCurrency: meta?.currency,
        nav: latestPoint?.close ?? meta?.regularMarketPrice,
        navDate: latestPoint?.date,
        dailyPerformance,
        topHoldings: [],
        geographicExposure: [],
        annualReturns: [],
        trailingReturns: {},
        portfolioBreakdown: {},
        riskIndicator: {}
      };
    }

    return {
      assetType: 'equity',
      requestedId: request.id,
      resolvedId: symbol,
      resolvedIdType: request.idType,
      name: meta?.longName ?? meta?.shortName ?? symbol,
      isin: request.idType === 'isin' ? request.id : undefined,
      ticker: symbol,
      exchange: meta?.fullExchangeName ?? meta?.exchangeName,
      currency: meta?.currency,
      latestPrice: latestPoint?.close ?? meta?.regularMarketPrice,
      latestPriceDate: latestPoint?.date,
      dailyPerformance,
      valuationMetrics: {},
      financialsSummary: {}
    };
  }

  async getFundSnapshot(request) {
    const symbol = await this.resolveSymbol(request);
    const { meta, dailyPerformance } = await this.fetchChart(symbol);
    const latestPoint = dailyPerformance.at(-1);

    return {
      assetType: 'fund',
      requestedId: request.id,
      resolvedId: symbol,
      resolvedIdType: request.idType,
      name: meta?.longName ?? meta?.shortName ?? request.name ?? symbol,
      isin: request.idType === 'isin' ? request.id : undefined,
      nav: latestPoint?.close ?? meta?.regularMarketPrice,
      navDate: latestPoint?.date,
      dailyPerformance,
      topHoldings: [],
      geographicExposure: [],
      annualReturns: [],
      trailingReturns: {},
      portfolioBreakdown: {},
      riskIndicator: {}
    };
  }

  async getMarketSeries(symbol) {
    const { dailyPerformance } = await this.fetchChart(symbol);
    return dailyPerformance;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  async resolveSymbol(request) {
    // Símbolo de Yahoo Finance explícitamente proporcionado (ej: 0P0001J9GX.F)
    if (request.yahooSymbol) {
      return request.yahooSymbol;
    }

    // Ticker/símbolo: usarlo directamente
    if (request.idType === 'ticker' || request.idType === 'symbol') {
      return request.id;
    }

    // Caché: ISIN ya resuelto anteriormente
    if (symbolCache.has(request.id)) {
      return symbolCache.get(request.id);
    }

    // Para ISIN: intentar primero OpenFIGI (Bloomberg)
    if (request.idType === 'isin') {
      const figi = await this.resolveISINviaOpenFIGI(request.id).catch(() => null);
      if (figi?.symbol) {
        // OpenFIGI encontró un símbolo, pero almacenar también la información de origen
        // para poder validar si Yahoo Finance devuelve datos creíbles
        symbolCache.set(request.id, figi.symbol);
        this.lastResolvedExchange = figi.exchange; // Guardar para validación posterior
        return figi.symbol;
      }
    }

    // Fallback: buscar por nombre en Yahoo Finance
    if (request.name) {
      const symbol = await this.searchByName(request.name, 'MUTUALFUND');
      if (symbol) {
        symbolCache.set(request.id, symbol);
        return symbol;
      }
    }

    throw new HttpError(404, `Yahoo Finance: no se encontro símbolo para ${request.name ?? request.id}`);
  }

  async resolveISINviaOpenFIGI(isin) {
    const response = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isin }]),
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) return null;

    const [result] = await response.json();
    if (!result?.data || result.data.length === 0) return null;

    // Preferir símbolos de mercados principales; evitar opciones/derivados
    const preferredData = result.data.find(
      (d) => (d.exchCode === 'US' || d.exchCode?.startsWith('EU')) && !d.ticker?.includes('=')
    );
    const data = preferredData ?? result.data[0];

    return {
      symbol: data?.ticker,
      exchange: data?.exchCode,
      name: data?.name
    };
  }

  async searchByName(query, preferredType) {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&lang=es-ES&quotesCount=5&newsCount=0&enableFuzzyQuery=true`;
    const data = await this.get(url);
    const quotes = data?.quotes ?? [];

    // Buscar el tipo preferido primero
    if (preferredType) {
      const hit = quotes.find((q) => q.quoteType === preferredType);
      if (hit?.symbol) return hit.symbol;
    }

    return quotes[0]?.symbol ?? null;
  }

  async fetchChart(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10y`;
    const data = await this.get(url);
    const result = data?.chart?.result?.[0];

    if (!result) {
      throw new HttpError(404, `Yahoo Finance: sin resultado de gráfico para ${symbol}`);
    }

    const meta = result.meta ?? {};
    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];

    const dailyPerformance = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        close: Number.isFinite(closes[i]) ? Number(closes[i].toFixed(4)) : null
      }))
      .filter((p) => p.date && p.close !== null);

    return { meta, dailyPerformance };
  }

  async get(url) {
    const response = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(12000)
    });

    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, `Yahoo Finance: acceso denegado (${response.status}). Las IPs del servidor pueden estar bloqueadas.`);
    }

    if (!response.ok) {
      throw new HttpError(502, `Yahoo Finance HTTP ${response.status}`);
    }

    return response.json();
  }
}

module.exports = { YahooFinanceHttpProvider };
