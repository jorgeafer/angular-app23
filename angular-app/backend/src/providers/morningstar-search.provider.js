const { HttpError } = require('../errors/http-error');

// Usa la API pública de búsqueda de Morningstar (sin credenciales)
class MorningstarSearchProvider {
  async getAssetDetails(request) {
    const performanceId = await this.searchFundByISIN(request.id, request.name);

    if (!performanceId) {
      throw new HttpError(404, `Morningstar: no se encontro el fondo ${request.name}`);
    }

    // Obtener datos del fondo usando el Performance ID
    const data = await this.fetchFundData(performanceId);
    const nav = data?.nav ?? data?.latestNav;

    if (!nav) {
      throw new HttpError(404, `Morningstar: sin NAV para ${request.name}`);
    }

    return {
      assetType: 'fund',
      requestedId: request.id,
      resolvedId: performanceId,
      resolvedIdType: 'performanceId',
      name: data?.name ?? request.name,
      isin: request.id,
      baseCurrency: data?.currency ?? 'EUR',
      nav,
      navDate: data?.navDate ?? new Date().toISOString().slice(0, 10),
      dailyPerformance: data?.dailyPerformance ?? [],
      topHoldings: [],
      geographicExposure: [],
      annualReturns: [],
      trailingReturns: {},
      portfolioBreakdown: {},
      riskIndicator: {}
    };
  }

  async getFundSnapshot(request) {
    return this.getAssetDetails(request);
  }

  async getMarketSeries(symbol) {
    return [];
  }

  async searchFundByISIN(isin, name) {
    try {
      // Endpoint de búsqueda de Morningstar (público)
      const url = new URL('https://www.morningstar.com/api/v2/search/securities');
      url.searchParams.append('q', isin);
      url.searchParams.append('types', 'FO');
      url.searchParams.append('limit', '5');

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const fund = data?.results?.[0];
      return fund?.id ?? null;
    } catch {
      return null;
    }
  }

  async fetchFundData(performanceId) {
    try {
      // API de snapshot de Morningstar
      const url = new URL('https://api-global.morningstar.com/sal-service/v1/fund/snapshot/v2');
      url.searchParams.append('id', performanceId);
      url.searchParams.append('idtype', 'msid');
      url.searchParams.append('languageId', 'es-ES');
      url.searchParams.append('locale', 'es_ES');
      url.searchParams.append('currencyId', 'EUR');

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return {
        name: data?.name,
        currency: data?.currency ?? 'EUR',
        nav: data?.nav,
        navDate: data?.navDate,
        dailyPerformance: Array.isArray(data?.dailyPerformance)
          ? data.dailyPerformance.map((p) => ({
              date: p.date,
              close: parseFloat(p.close)
            }))
          : []
      };
    } catch {
      return null;
    }
  }
}

module.exports = { MorningstarSearchProvider };
