const { env } = require('../config/env');
const { HttpError } = require('../errors/http-error');
const { DwsMorningstarProvider } = require('./dws-morningstar.provider');
const { MockMorningstarProvider } = require('./mock-morningstar.provider');

function createMorningstarProvider() {
  if (env.provider === 'mock') {
    return new MockMorningstarProvider();
  }

  if (env.provider === 'dws') {
    return new DwsMorningstarProvider();
  }

  throw new HttpError(500, `Unsupported MORNINGSTAR_PROVIDER "${env.provider}"`);
}

module.exports = { createMorningstarProvider };
