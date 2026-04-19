const express = require('express');
const { env } = require('./src/config/env');
const { attachSession, requireAuth } = require('./src/auth/auth.middleware');
const { SessionManager } = require('./src/auth/session-manager');
const { createAuthRouter } = require('./src/routes/auth.routes');
const { createMorningstarRouter } = require('./src/routes/morningstar.routes');
const { createPortfolioRouter } = require('./src/routes/portfolio.routes');
const { createYahooRouter } = require('./src/routes/yahoo.routes');
const { PortfolioRepository } = require('./src/db/portfolio.repository');
const { PortfolioImportService } = require('./src/services/portfolio-import.service');
const { PortfolioQueryService } = require('./src/services/portfolio-query.service');

async function bootstrap() {
  const app = express();
  const port = Number(process.env.API_PORT || 3000);
  const sessionManager = new SessionManager({
    sessionTtlMs: env.auth.sessionTtlMs
  });
  const portfolioImportService = new PortfolioImportService();
  const portfolioQueryService = new PortfolioQueryService(portfolioImportService.repository);
  const devaRepository = new PortfolioRepository('deva-portfolio.db');
  const devaPortfolioQueryService = new PortfolioQueryService(devaRepository);

  await portfolioImportService.initialize();
  await portfolioQueryService.initialize();
  await devaPortfolioQueryService.initialize();

  app.use(express.json());
  app.use(attachSession(sessionManager));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'morningstar-backend' });
  });
  app.use('/api/auth', createAuthRouter(sessionManager));
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

  app.listen(port, () => {
    console.log(`Morningstar backend listening on http://localhost:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap backend', error);
  process.exit(1);
});
