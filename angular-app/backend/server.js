const express = require('express');
const { env } = require('./src/config/env');
const { attachSession, requireAuth } = require('./src/auth/auth.middleware');
const { createAuthRouter } = require('./src/routes/auth.routes');
const { createMorningstarRouter } = require('./src/routes/morningstar.routes');
const { createPortfolioRouter } = require('./src/routes/portfolio.routes');
const { createYahooRouter } = require('./src/routes/yahoo.routes');
const { PortfolioRepository } = require('./src/db/portfolio.repository');
const { PortfolioImportService } = require('./src/services/portfolio-import.service');
const { PortfolioQueryService } = require('./src/services/portfolio-query.service');

async function createApp() {
  const app = express();

  const portfolioRepository = new PortfolioRepository('main');
  const portfolioImportService = new PortfolioImportService(portfolioRepository);
  const portfolioQueryService = new PortfolioQueryService(portfolioRepository);
  const devaRepository = new PortfolioRepository('deva');
  const devaPortfolioQueryService = new PortfolioQueryService(devaRepository);

  await portfolioImportService.initialize();
  await portfolioQueryService.initialize();
  await devaPortfolioQueryService.initialize();

  app.use(express.json());
  app.use(attachSession());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'mi-cartera-backend' });
  });
  app.use('/api/auth', createAuthRouter());

  // Endpoint de actualización de precios — accesible desde el botón del frontend
  app.post('/api/portfolio/refresh', requireAuth(), async (req, res, next) => {
    try {
      const result = await portfolioQueryService.refreshPortfolioPrices();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/deva-portfolio/refresh', requireAuth(), async (req, res, next) => {
    try {
      const result = await devaPortfolioQueryService.refreshPortfolioPrices();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Endpoint de debug — comprueba lo que devuelve el servicio para un símbolo concreto
  // GET /api/debug/snapshot?id=SAN.MC&assetType=equity&idType=symbol
  // GET /api/debug/snapshot?id=0P0001DFE8.F&assetType=fund&idType=symbol
  app.get('/api/debug/snapshot', requireAuth(), async (req, res) => {
    const { id, assetType, idType = 'symbol' } = req.query;

    if (!id || !assetType) {
      res.status(400).json({ error: 'Se requieren los parámetros id y assetType' });
      return;
    }

    if (!['fund', 'equity'].includes(assetType)) {
      res.status(400).json({ error: 'assetType debe ser "fund" o "equity"' });
      return;
    }

    const { YahooFinanceService } = require('./src/services/yahoo-finance.service');
    const svc = new YahooFinanceService();
    const started = Date.now();

    try {
      let snapshot;
      if (assetType === 'fund') {
        snapshot = await svc.getFundSnapshot({ assetType, idType, id });
      } else {
        snapshot = await svc.getAssetDetails({ assetType, idType, id });
      }
      res.json({ ok: true, durationMs: Date.now() - started, id, assetType, idType, snapshot });
    } catch (error) {
      res.json({
        ok: false,
        durationMs: Date.now() - started,
        id,
        assetType,
        idType,
        error: error.message,
        stack: error.stack
      });
    }
  });

  // Cron job: actualiza precios — protegido con CRON_SECRET (sin JWT)
  app.get('/api/cron/refresh', async (req, res) => {
    const secret = env.cronSecret;
    const authHeader = req.headers.authorization ?? '';

    if (!secret || authHeader !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Cron secret invalido' });
      return;
    }

    const started = Date.now();

    try {
      const [mainResult, devaResult] = await Promise.allSettled([
        portfolioQueryService.refreshPortfolioPrices(),
        devaPortfolioQueryService.refreshPortfolioPrices()
      ]);

      res.json({
        executedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        main: mainResult.status === 'fulfilled' ? mainResult.value : { error: mainResult.reason?.message },
        deva: devaResult.status === 'fulfilled' ? devaResult.value : { error: devaResult.reason?.message }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rutas protegidas con JWT — requireAuth() aplicado a cada router
  app.use(
    '/api/portfolio',
    requireAuth(),
    createPortfolioRouter({
      importService: portfolioImportService,
      queryService: portfolioQueryService
    })
  );
  app.use(
    '/api/deva-portfolio',
    requireAuth(),
    createPortfolioRouter({
      importService: null,
      queryService: devaPortfolioQueryService,
      enableImport: false
    })
  );
  app.use('/api/morningstar', requireAuth(), createMorningstarRouter());
  app.use('/api/yahoo', requireAuth(), createYahooRouter());

  app.use((err, _req, res, _next) => {
    const status = err.statusCode || 500;
    res.status(status).json({
      error: err.message || 'Unexpected backend error'
    });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.API_PORT || 3000);

  createApp()
    .then((app) => {
      app.listen(port, () => {
        console.log(`Backend listening on http://localhost:${port}`);
      });
    })
    .catch((error) => {
      console.error('Failed to start backend', error);
      process.exit(1);
    });
}

module.exports = { createApp };
