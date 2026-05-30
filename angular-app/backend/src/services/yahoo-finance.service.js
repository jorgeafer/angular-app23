const { env } = require('../config/env');
const { HttpError } = require('../errors/http-error');

function createDefaultProvider() {
  if (env.finnhubApiKey) {
    const { FinnhubProvider } = require('../providers/finnhub.provider');
    const { YahooFinanceHttpProvider } = require('../providers/yahoo-finance-http.provider');
    const { CompositeMarketDataProvider } = require('../providers/composite-market-data.provider');

    return new CompositeMarketDataProvider({
      fundProvider: new YahooFinanceHttpProvider(),       // Yahoo Finance HTTP para fondos
      equityProvider: new FinnhubProvider(env.finnhubApiKey) // Finnhub para acciones
    });
  }

  if (env.twelveDataApiKey) {
    const { TwelveDataProvider } = require('../providers/twelve-data.provider');
    return new TwelveDataProvider(env.twelveDataApiKey);
  }

  const { YahooFinanceProvider } = require('../providers/yahoo-finance.provider');
  return new YahooFinanceProvider();
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
