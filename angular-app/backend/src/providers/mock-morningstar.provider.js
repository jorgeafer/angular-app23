class MockMorningstarProvider {
  isMockProvider() {
    return true;
  }

  async getAssetDetails(request) {
    if (request.assetType === 'fund') {
      return {
        assetType: 'fund',
        requestedId: request.id,
        resolvedId: request.id,
        resolvedIdType: request.idType,
        performanceId: 'F0GBR04MOCK',
        name: 'Mock Global Equity Fund',
        isin: request.idType === 'isin' ? request.id : 'ES000MOCKFUND1',
        category: 'Renta variable global',
        domicile: 'Luxembourg',
        baseCurrency: 'EUR',
        nav: 14.37,
        navDate: '2026-03-31',
        aum: 248000000,
        benchmark: 'MSCI World NR EUR',
        riskRating: '4',
        sustainabilityRating: 'Above Average',
        expenseRatio: 0.85,
        trailingReturns: {
          oneMonth: '2.1%',
          threeMonths: '5.6%',
          ytd: '7.4%',
          oneYear: '11.8%',
          threeYearsAnnualized: '6.3%'
        },
        portfolioBreakdown: {
          equity: '92%',
          cash: '4%',
          europe: '31%',
          northAmerica: '49%'
        }
      };
    }

    return {
      assetType: 'equity',
      requestedId: request.id,
      resolvedId: request.id,
      resolvedIdType: request.idType,
      performanceId: '0P000MOCKEQ',
      name: 'Mock Listed Equity',
      isin: request.idType === 'isin' ? request.id : 'US000MOCKEQ1',
      ticker: request.idType === 'ticker' ? request.id : 'MOCK',
      exchange: 'XNAS',
      currency: 'USD',
      latestPrice: 128.44,
      latestPriceDate: '2026-03-31',
      marketCap: 32500000000,
      sector: 'Technology',
      industry: 'Software',
      country: 'United States',
      valuationMetrics: {
        peRatio: 24.8,
        priceToBook: 5.2,
        evToEbitda: 16.1
      },
      financialsSummary: {
        revenueGrowth: '12.4%',
        operatingMargin: '18.9%',
        roe: '21.3%'
      }
    };
  }
}

module.exports = { MockMorningstarProvider };
