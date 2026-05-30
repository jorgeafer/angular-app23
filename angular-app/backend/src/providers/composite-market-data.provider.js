class CompositeMarketDataProvider {
  constructor({ fundProvider, equityProvider }) {
    this.fundProvider = fundProvider;
    this.equityProvider = equityProvider;
  }

  async getAssetDetails(request) {
    const provider = request.assetType === 'fund' ? this.fundProvider : this.equityProvider;
    return provider.getAssetDetails(request);
  }

  async getFundSnapshot(request) {
    return this.fundProvider.getFundSnapshot(request);
  }

  async getMarketSeries(symbol) {
    // Los símbolos de benchmark (SPY, URTH) son ETFs/acciones
    return this.equityProvider.getMarketSeries(symbol);
  }
}

module.exports = { CompositeMarketDataProvider };
