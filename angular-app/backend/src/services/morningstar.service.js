const { HttpError } = require('../errors/http-error');
const { createMorningstarProvider } = require('../providers/morningstar-provider.factory');

class MorningstarService {
  constructor(provider = createMorningstarProvider()) {
    this.provider = provider;
  }

  isMockProvider() {
    return typeof this.provider?.isMockProvider === 'function' ? this.provider.isMockProvider() : false;
  }

  async getAssetDetails(request) {
    validateRequest(request);
    return this.provider.getAssetDetails(request);
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

module.exports = { MorningstarService };
