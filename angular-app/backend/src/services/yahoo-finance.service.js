const { env } = require('../config/env');
const { HttpError } = require('../errors/http-error');

function createDefaultProvider() {
  const { YahooFinanceHttpProvider } = require('../providers/yahoo-finance-http.provider');
  const yf = new YahooFinanceHttpProvider();

  // Proveedor compuesto: Morningstar para fondos, Yahoo Finance HTTP para acciones
  const provider = {
    async getAssetDetails(request) {
      if (request.assetType === 'fund') {
        return this.getFundSnapshot(request);
      }
      // Acciones: Yahoo Finance
      try {
        return await yf.getAssetDetails(request);
      } catch (error) {
        // Fallback a Finnhub si está disponible
        if (env.finnhubApiKey) {
          const { FinnhubProvider } = require('../providers/finnhub.provider');
          return new FinnhubProvider(env.finnhubApiKey).getAssetDetails(request);
        }
        throw error;
      }
    },

    async getFundSnapshot(request) {
      const morningstarId = extractMorningstarId(request.yahooSymbol ?? request.id);

      // 1. Si DWS está configurado y tenemos performance ID, combinar:
      //    - DWS para el VL actual (T+1)
      //    - Yahoo para el histórico del gráfico
      if (env.provider === 'dws' && morningstarId) {
        try {
          const { DwsMorningstarProvider } = require('../providers/dws-morningstar.provider');
          const dws = new DwsMorningstarProvider();
          const [dwsSnap, yahooSnap] = await Promise.allSettled([
            dws.getAssetDetails({ ...request, assetType: 'fund', idType: 'performanceId', id: morningstarId }),
            yf.getFundSnapshot(request)
          ]);

          const dws_ = dwsSnap.status === 'fulfilled' ? dwsSnap.value : null;
          const yahoo_ = yahooSnap.status === 'fulfilled' ? yahooSnap.value : null;

          if (dws_?.nav != null) {
            return {
              ...(yahoo_ ?? {}),
              ...dws_,
              // Preservar el histórico de Yahoo para el gráfico de la ficha
              dailyPerformance: yahoo_?.dailyPerformance ?? dws_.dailyPerformance ?? []
            };
          }
        } catch {
          // Si falla todo, continuar con el flujo normal
        }
      }

      // 2. Morningstar scraper público (puede estar bloqueado desde Vercel)
      if (morningstarId) {
        try {
          const { MorningstarScraperProvider } = require('../providers/morningstar-scraper.provider');
          const ms = new MorningstarScraperProvider();
          const snap = await ms.getFundSnapshot({ ...request, idType: 'performanceId', id: morningstarId });
          if (snap?.nav != null || snap?.dailyPerformance?.length > 0) return snap;
        } catch {}
      }

      // 3. Yahoo Finance (datos históricos, puede ir con lag T+2/T+3)
      try {
        return await yf.getFundSnapshot(request);
      } catch (yahooError) {
        if (request.idType === 'isin') {
          try {
            const { MorningstarSearchProvider } = require('../providers/morningstar-search.provider');
            const ms = new MorningstarSearchProvider();
            return await ms.getFundSnapshot(request);
          } catch {}
        }
        if (env.finnhubApiKey) {
          try {
            const { FinnhubProvider } = require('../providers/finnhub.provider');
            return new FinnhubProvider(env.finnhubApiKey).getFundSnapshot(request);
          } catch {}
        }
        throw yahooError;
      }
    },

    async getMarketSeries(symbol) {
      try {
        return await yf.getMarketSeries(symbol);
      } catch (error) {
        // Fallback a Finnhub para benchmarks
        if (env.finnhubApiKey) {
          const { FinnhubProvider } = require('../providers/finnhub.provider');
          return new FinnhubProvider(env.finnhubApiKey).getMarketSeries(symbol);
        }
        throw error;
      }
    }
  };

  return provider;
}

class YahooFinanceService {
  constructor(provider = createDefaultProvider()) {
    this.provider = provider;
  }

  async getAssetDetails(request) {
    validateRequest(request);
    return this.provider.getAssetDetails(request);
  }

  async getFundSnapshot(request) {
    validateRequest(request);

    if (request.assetType !== 'fund') {
      throw new HttpError(400, 'getFundSnapshot only supports funds');
    }

    return this.provider.getFundSnapshot(request);
  }

  async getMarketSeries(symbol) {
    if (!symbol || typeof symbol !== 'string') {
      throw new HttpError(400, 'symbol is required');
    }

    return this.provider.getMarketSeries(symbol);
  }
}

// Los símbolos de Yahoo del tipo 0P0001DFE8.F contienen el performance ID de Morningstar.
// Extraerlo permite consultar Morningstar directamente sin búsqueda previa.
function extractMorningstarId(symbolOrId) {
  if (!symbolOrId || typeof symbolOrId !== 'string') return null;
  const match = symbolOrId.match(/^(0P[A-Z0-9]+)(?:\.F)?$/i);
  return match ? match[1].toUpperCase() : null;
}

function validateRequest(request) {
  const validAssetTypes = new Set(['fund', 'equity']);
  const validIdTypes = new Set(['isin', 'ticker', 'symbol', 'performanceId']);

  if (!validAssetTypes.has(request.assetType)) {
    throw new HttpError(400, 'assetType must be "fund" or "equity"');
  }

  if (!validIdTypes.has(request.idType)) {
    throw new HttpError(400, 'idType is invalid');
  }

  if (!request.id || typeof request.id !== 'string') {
    throw new HttpError(400, 'id is required');
  }
}

module.exports = { YahooFinanceService };
