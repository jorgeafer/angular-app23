const express = require('express');
const multer = require('multer');
const { HttpError } = require('../errors/http-error');
const { PortfolioImportService } = require('../services/portfolio-import.service');
const { PortfolioQueryService } = require('../services/portfolio-query.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

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
      const section = String(req.body?.section || '').toUpperCase();
      const asset = section === 'ACCIONES'
        ? await queryService.createEquityPosition(req.body)
        : await queryService.createFundPosition(req.body);
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

  router.post('/refresh', async (_req, res, next) => {
    try {
      const result = await queryService.refreshPortfolioPrices();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  if (enableImport && importService) {
    router.get('/import/preview', async (_req, res, next) => {
      try {
        const preview = await importService.previewFromDatabase();
        res.json(preview);
      } catch (error) {
        next(error);
      }
    });

    router.post('/import', upload.single('file'), async (req, res, next) => {
      try {
        if (!req.file) {
          throw new HttpError(400, 'Se requiere un fichero Excel (.xlsx)');
        }
        const result = await importService.syncFromWorkbookBuffer(req.file.buffer);
        res.json(result);
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}

module.exports = { createPortfolioRouter };
