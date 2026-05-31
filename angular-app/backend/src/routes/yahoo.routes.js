const express = require('express');
const { YahooFinanceService } = require('../services/yahoo-finance.service');

function createYahooRouter(service = new YahooFinanceService()) {
  const router = express.Router();

  router.get('/assets', async (req, res, next) => {
    try {
      const payload = await service.getAssetDetails({
        assetType: req.query.assetType,
        idType: req.query.idType,
        id: req.query.id,
        yahooSymbol: req.query.yahooSymbol,
        name: req.query.name
      });

      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createYahooRouter };
