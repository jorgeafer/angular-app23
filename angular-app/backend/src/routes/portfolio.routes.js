const express = require('express');
const { HttpError } = require('../errors/http-error');
const { PortfolioImportService } = require('../services/portfolio-import.service');
const { PortfolioQueryService } = require('../services/portfolio-query.service');

function createPortfolioRouter({
  importService = new PortfolioImportService(),
  queryService = new PortfolioQueryService(),
  enableImport = true
} = {}) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const dataset = await queryService.getPortfolioDataset({
        asOfDate: req.query.date
      });
      res.json(dataset);
    } catch (error) {
      next(error);
    }
  });

  router.get('/assets/:id', async (req, res, next) => {
    try {
      const asset = await queryService.getAssetById(req.params.id);

      if (!asset) {
        throw new HttpError(404, 'Asset not found');
      }

      res.json(asset);
    } catch (error) {
      next(error);
    }
  });

  router.post('/assets', async (req, res, next) => {
    try {
      const asset = await queryService.createFundPosition(req.body);
      res.status(201).json(asset);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/assets/:id', async (req, res, next) => {
    try {
      const asset = await queryService.updateAssetValue(req.params.id, req.body);
      res.json(asset);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/assets/:id', async (req, res, next) => {
    try {
      const result = await queryService.deleteFundPosition(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/assets/:id/operations', async (req, res, next) => {
    try {
      const operations = await queryService.getAssetOperations(req.params.id);
      res.json(operations);
    } catch (error) {
      next(error);
    }
  });

  router.post('/assets/:id/operations', async (req, res, next) => {
    try {
      const operations = await queryService.createAssetOperation(req.params.id, req.body);
      res.status(201).json(operations);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/assets/:id/operations/:operationId', async (req, res, next) => {
    try {
      const operations = await queryService.updateAssetOperation(req.params.id, req.params.operationId, req.body);
      res.json(operations);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/assets/:id/operations/:operationId', async (req, res, next) => {
    try {
      const operations = await queryService.deleteAssetOperation(req.params.id, req.params.operationId);
      res.json(operations);
    } catch (error) {
      next(error);
    }
  });

  if (enableImport && importService) {
    router.post('/import', async (_req, res, next) => {
      try {
        const result = await importService.syncFromExcelIfNeeded(true);
        res.json(result);
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}

module.exports = { createPortfolioRouter };
