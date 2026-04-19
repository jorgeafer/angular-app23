const express = require('express');
const { MorningstarService } = require('../services/morningstar.service');

function createMorningstarRouter(service = new MorningstarService()) {
  const router = express.Router();

  router.get('/assets', async (req, res, next) => {
    try {
      const payload = await service.getAssetDetails({
        assetType: req.query.assetType,
        idType: req.query.idType,
        id: req.query.id
      });

      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createMorningstarRouter };
