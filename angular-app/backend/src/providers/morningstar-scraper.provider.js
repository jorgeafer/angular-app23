const { HttpError } = require('../errors/http-error');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Origin': 'https://www.morningstar.es',
  'Referer': 'https://www.morningstar.es/'
};

const TEN_YEARS_AGO = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const TODAY = () => new Date().toISOString().slice(0, 10);

class MorningstarScraperProvider {
  // ── Public interface ──────────────────────────────────────────────────────

  async getAssetDetails(request) {
    const { performanceId, name } = await this.resolvePerformanceId(request.id, request.idType);
    const [navHistory, fundInfo] = await Promise.all([
      this.fetchNavHistory(performanceId).catch(() => []),
      this.fetchFundInfo(performanceId).catch(() => null)
    ]);

    const latestPoint = navHistory.at(-1);

    return {
      assetType: 'fund',
      requestedId: request.id,
      resolvedId: performanceId,
      resolvedIdType: 'performanceId',
      name: fundInfo?.name ?? name,
      isin: request.idType === 'isin' ? request.id : undefined,
      baseCurrency: fundInfo?.currency ?? 'EUR',
      nav: latestPoint?.close,
      navDate: latestPoint?.date,
      aum: fundInfo?.aum,
      expenseRatio: fundInfo?.expenseRatio,
      family: fundInfo?.family,
      category: fundInfo?.category,
      country: fundInfo?.domicile,
      riskRating: fundInfo?.riskRating,
      dailyPerformance: navHistory,
      topHoldings: fundInfo?.topHoldings ?? [],
      geographicExposure: [],
      annualReturns: [],
      trailingReturns: {},
      portfolioBreakdown: {},
      riskIndicator: {}
    };
  }

  async getFundSnapshot(request) {
    const { performanceId, name } = await this.resolvePerformanceId(request.id, request.idType);
    const navHistory = await this.fetchNavHistory(performanceId).catch(() => []);
    const latestPoint = navHistory.at(-1);

    return {
      assetType: 'fund',
      requestedId: request.id,
      resolvedId: performanceId,
      resolvedIdType: 'performanceId',
      name,
      isin: request.idType === 'isin' ? request.id : undefined,
      nav: latestPoint?.close,
      navDate: latestPoint?.date,
      dailyPerformance: navHistory,
      topHoldings: [],
      geographicExposure: [],
      annualReturns: [],
      trailingReturns: {},
      portfolioBreakdown: {},
      riskIndicator: {}
    };
  }

  async getMarketSeries(_symbol) {
    return [];
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  async resolvePerformanceId(id, idType) {
    if (idType === 'performanceId') {
      return { performanceId: id, name: id };
    }

    const url = `https://www.morningstar.com/api/v2/search/securities?q=${encodeURIComponent(id)}&types=FO&limit=3&page=1`;
    const data = await this.fetch(url);

    const result = data?.results?.find((r) => r.type === 'FO') ?? data?.results?.[0];

    if (!result?.id) {
      throw new HttpError(404, `Morningstar: no se encontro el fondo para ${id}`);
    }

    return { performanceId: result.id, name: result.name ?? id };
  }

  async fetchNavHistory(performanceId) {
    const endDate = TODAY();

    // Intento 1: API global de Morningstar (COMPACTJSON)
    try {
      const url = [
        'https://api-global.morningstar.com/sal-service/v1/fund/performance/nav/v2',
        `?id=${encodeURIComponent(performanceId)}&idtype=msid`,
        `&currencyId=EUR&startDate=${TEN_YEARS_AGO}&endDate=${endDate}`,
        '&frequency=daily&outputType=COMPACTJSON&languageId=es-ES'
      ].join('');

      const data = await this.fetch(url);
      const points = parseCompactJson(data);

      if (points.length > 0) return points;
    } catch {}

    // Intento 2: API de herramientas Morningstar España
    try {
      const url = [
        `https://tools.morningstar.es/api/rest.svc/6zndkvon41/timeseries_price/${encodeURIComponent(performanceId)}`,
        `?id=${encodeURIComponent(performanceId)}%7C0`,
        `&currencyId=EUR&idtype=msid`,
        `&frequency=daily&startDate=${TEN_YEARS_AGO}&endDate=${endDate}`,
        '&outputType=COMPACTJSON'
      ].join('');

      const data = await this.fetch(url);
      const points = parseCompactJson(data);

      if (points.length > 0) return points;
    } catch {}

    return [];
  }

  async fetchFundInfo(performanceId) {
    const url = [
      'https://api-global.morningstar.com/sal-service/v1/fund/snapshot/v2',
      `?id=${encodeURIComponent(performanceId)}&idtype=msid`,
      '&languageId=es-ES&locale=es_ES&currencyId=EUR'
    ].join('');

    const data = await this.fetch(url);

    if (!data) return null;

    return {
      name: data.name,
      currency: data.currency,
      family: data.fundFamily ?? data.branding?.name,
      category: data.categoryName ?? data.globalCategoryName,
      domicile: data.domicile,
      aum: data.totalNetAssets ?? undefined,
      expenseRatio: data.ongoingCharge ?? data.expenseRatio ?? undefined,
      riskRating: data.riskRating ?? undefined,
      topHoldings: (data.topHoldings ?? [])
        .slice(0, 10)
        .map((h) => ({
          name: h.securityName ?? h.holdingName,
          symbol: h.secId ?? undefined,
          weight: typeof h.weighting === 'number' ? h.weighting : undefined
        }))
        .filter((h) => h.name)
    };
  }

  async fetch(url) {
    const response = await globalThis.fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(12000)
    });

    if (response.status === 404) {
      throw new HttpError(404, 'Morningstar: recurso no encontrado');
    }

    if (!response.ok) {
      throw new HttpError(502, `Morningstar scraper HTTP ${response.status}`);
    }

    return response.json();
  }
}

function parseCompactJson(data) {
  if (!data) return [];

  // Formato 1: { d: [[timestamp, price], ...] }
  if (Array.isArray(data.d)) {
    return data.d
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map((p) => ({
        date: new Date(p[0]).toISOString().slice(0, 10),
        close: Number(Number(p[1]).toFixed(4))
      }))
      .filter((p) => p.date && Number.isFinite(p.close));
  }

  // Formato 2: { Series: [{ DataPoints: [[timestamp, price], ...] }] }
  if (Array.isArray(data.Series)) {
    const series = data.Series[0];
    if (Array.isArray(series?.DataPoints)) {
      return series.DataPoints
        .filter((p) => Array.isArray(p) && p.length >= 2)
        .map((p) => ({
          date: new Date(p[0]).toISOString().slice(0, 10),
          close: Number(Number(p[1]).toFixed(4))
        }))
        .filter((p) => p.date && Number.isFinite(p.close));
    }
  }

  return [];
}

module.exports = { MorningstarScraperProvider };
