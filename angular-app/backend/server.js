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
  app.use('/api', requireAuth());

  app.use(
    '/api/portfolio',
    createPortfolioRouter({
      importService: portfolioImportService,
      queryService: portfolioQueryService
    })
  );
  app.use(
    '/api/deva-portfolio',
    createPortfolioRouter({
      importService: null,
      queryService: devaPortfolioQueryService,
      enableImport: false
    })
  );
  app.use('/api/morningstar', createMorningstarRouter());
  app.use('/api/yahoo', createYahooRouter());

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
