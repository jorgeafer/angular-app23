const dotenv = require('dotenv');

dotenv.config();

const env = {
  provider: process.env.MORNINGSTAR_PROVIDER || 'mock',
  baseUrl: process.env.MORNINGSTAR_BASE_URL || '',
  apiKey: process.env.MORNINGSTAR_API_KEY || '',
  apiToken: process.env.MORNINGSTAR_API_TOKEN || '',
  timeoutMs: Number(process.env.MORNINGSTAR_TIMEOUT_MS || 10000),
  fundViewIds: (process.env.MORNINGSTAR_FUND_VIEW_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  equityViewIds: (process.env.MORNINGSTAR_EQUITY_VIEW_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  yahooAllowInsecureTls: process.env.YAHOO_ALLOW_INSECURE_TLS === 'true',
  auth: {
    username: process.env.AUTH_USERNAME || 'admin',
    password: process.env.AUTH_PASSWORD || 'admin1234',
    sessionTtlMs: Number(process.env.AUTH_SESSION_TTL_MS || 1000 * 60 * 60 * 12),
    cookieName: process.env.AUTH_COOKIE_NAME || 'portfolio_session',
    secureCookies: process.env.AUTH_SECURE_COOKIES === 'true'
  }
};

module.exports = { env };
