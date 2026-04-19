const { env } = require('../config/env');
const { HttpError } = require('../errors/http-error');

class DwsMorningstarProvider {
  isMockProvider() {
    return false;
  }

  async getAssetDetails(request) {
    validateDwsEnv();

    const viewIds = request.assetType === 'fund' ? env.fundViewIds : env.equityViewIds;
    const payload = {
      investments: [
        {
          id: request.id,
          idType: mapIdentifierType(request.idType)
        }
      ],
      views: viewIds.map((viewId) => ({ viewId }))
    };

    const response = await fetchWithTimeout(buildInvestmentsUrl(), {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new HttpError(response.status, `Morningstar DWS error (${response.status})`);
    }

    return normalizeDwsResponse(request, data);
  }
}

function validateDwsEnv() {
  if (!env.baseUrl) {
    throw new HttpError(500, 'MORNINGSTAR_BASE_URL is not configured');
  }

  if (!env.apiToken) {
    throw new HttpError(500, 'MORNINGSTAR_API_TOKEN is not configured');
  }

  if (!env.fundViewIds.length || !env.equityViewIds.length) {
    throw new HttpError(500, 'MORNINGSTAR_FUND_VIEW_IDS and MORNINGSTAR_EQUITY_VIEW_IDS must be configured');
  }
}

function buildInvestmentsUrl() {
  const base = env.baseUrl.endsWith('/') ? env.baseUrl.slice(0, -1) : env.baseUrl;
  return `${base}/direct-web-services/v1/investments`;
}

function buildHeaders() {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.apiToken}`
  };

  if (env.apiKey) {
    headers['x-api-key'] = env.apiKey;
  }

  return headers;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new HttpError(504, 'Morningstar upstream timeout');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapIdentifierType(idType) {
  const map = {
    isin: 'isin',
    ticker: 'tradingSymbol',
    symbol: 'tradingSymbol',
    performanceId: 'performanceId'
  };

  return map[idType] || idType;
}

function normalizeDwsResponse(request, data) {
  const investment = extractInvestmentNode(data);

  if (!investment) {
    throw new HttpError(404, 'Morningstar returned no investment data');
  }

  const flat = flattenObject(investment);

  if (request.assetType === 'fund') {
    return {
      assetType: 'fund',
      requestedId: request.id,
      resolvedId: firstValue(flat, ['identifiers.performanceid', 'performanceid', 'identifiers.isin']) || request.id,
      resolvedIdType: request.idType,
      performanceId: firstValue(flat, ['identifiers.performanceid', 'performanceid']),
      name: firstValue(flat, ['name', 'legalname', 'displayname', 'investmentname']),
      isin: firstValue(flat, ['identifiers.isin', 'isin']),
      category: firstValue(flat, ['categoryname', 'category', 'morningstarcategory']),
      domicile: firstValue(flat, ['domicile', 'domicilecountry', 'countryofregistration']),
      baseCurrency: firstValue(flat, ['basecurrency', 'currency', 'pricecurrency']),
      nav: firstNumber(flat, ['nav', 'latestnav', 'price', 'latestprice']),
      navDate: firstValue(flat, ['navdate', 'pricedate', 'latestpricedate']),
      aum: firstNumber(flat, ['aum', 'netassets', 'totalnetassets']),
      benchmark: firstValue(flat, ['benchmark', 'primarybenchmark', 'benchmarkname']),
      riskRating: firstValue(flat, ['riskrating', 'morningstarriskrating']),
      sustainabilityRating: firstValue(flat, ['sustainabilityrating', 'esgrating']),
      expenseRatio: firstNumber(flat, ['expenseratio', 'netexpenseratio', 'ongoingcharge']),
      trailingReturns: collectMetrics(flat, [
        'onemonth',
        'threemonth',
        'ytd',
        'oneyear',
        'threeyear',
        'fiveyear',
        'tenyear'
      ]),
      portfolioBreakdown: collectMetrics(flat, [
        'equity',
        'fixedincome',
        'cash',
        'northamerica',
        'europe',
        'asia',
        'emergingmarkets'
      ])
    };
  }

  return {
    assetType: 'equity',
    requestedId: request.id,
    resolvedId: firstValue(flat, ['identifiers.performanceid', 'performanceid', 'identifiers.isin']) || request.id,
    resolvedIdType: request.idType,
    performanceId: firstValue(flat, ['identifiers.performanceid', 'performanceid']),
    name: firstValue(flat, ['name', 'legalname', 'displayname', 'companyname']),
    isin: firstValue(flat, ['identifiers.isin', 'isin']),
    ticker: firstValue(flat, ['identifiers.tradingsymbol', 'tradingsymbol', 'ticker']),
    exchange: firstValue(flat, ['exchange', 'exchangeid', 'exchangename']),
    currency: firstValue(flat, ['currency', 'pricecurrency', 'basecurrency']),
    latestPrice: firstNumber(flat, ['latestprice', 'price', 'closeprice']),
    latestPriceDate: firstValue(flat, ['latestpricedate', 'pricedate', 'closepricedate']),
    marketCap: firstNumber(flat, ['marketcap', 'marketcapitalization']),
    sector: firstValue(flat, ['sector', 'sectorname']),
    industry: firstValue(flat, ['industry', 'industryname']),
    country: firstValue(flat, ['country', 'countryofrisk', 'exchangecountry']),
    valuationMetrics: collectMetrics(flat, [
      'peratio',
      'pricetobook',
      'evtoebitda',
      'pricecashflow',
      'dividendyield'
    ]),
    financialsSummary: collectMetrics(flat, [
      'revenuegrowth',
      'earningsgrowth',
      'operatingmargin',
      'netmargin',
      'roe',
      'roa'
    ])
  };
}

function extractInvestmentNode(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  if (Array.isArray(data.investments) && data.investments.length) {
    return data.investments[0];
  }

  if (Array.isArray(data.items) && data.items.length) {
    return data.items[0];
  }

  if (Array.isArray(data.data) && data.data.length) {
    return data.data[0];
  }

  return data;
}

function flattenObject(value, prefix = '', target = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenObject(item, `${prefix}${index}.`, target));
    return target;
  }

  if (value && typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      flattenObject(nestedValue, `${prefix}${String(key).toLowerCase()}.`, target);
    }
    return target;
  }

  const normalizedKey = prefix.replace(/\.$/, '');
  if (normalizedKey) {
    target[normalizedKey] = value;
  }
  return target;
}

function firstValue(flat, candidates) {
  for (const candidate of candidates) {
    const match = lookupFlatValue(flat, candidate);
    if (match !== undefined && match !== null && match !== '') {
      return String(match);
    }
  }

  return undefined;
}

function firstNumber(flat, candidates) {
  for (const candidate of candidates) {
    const match = lookupFlatValue(flat, candidate);
    const parsed = parseNumeric(match);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function collectMetrics(flat, keys) {
  const metrics = {};

  for (const key of keys) {
    const match = lookupFlatValue(flat, key);
    if (match !== undefined && match !== null && match !== '') {
      metrics[key] = typeof match === 'number' ? match : String(match);
    }
  }

  return metrics;
}

function lookupFlatValue(flat, candidate) {
  const normalized = candidate.toLowerCase();

  if (flat[normalized] !== undefined) {
    return flat[normalized];
  }

  const exactSuffix = Object.keys(flat).find((key) => key.endsWith(`.${normalized}`) || key === normalized);
  if (exactSuffix) {
    return flat[exactSuffix];
  }

  const loose = Object.keys(flat).find((key) => key.includes(normalized));
  if (loose) {
    return flat[loose];
  }

  return undefined;
}

function parseNumeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const cleaned = value.replace(/[^0-9,.-]/g, '');
  if (!cleaned) {
    return undefined;
  }

  const normalized = cleaned.includes(',') && cleaned.includes('.')
    ? (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? cleaned.replace(/\./g, '').replace(/,/g, '.') : cleaned.replace(/,/g, ''))
    : cleaned.replace(/,/g, '.');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

module.exports = { DwsMorningstarProvider };
