const { env } = require('../config/env');
const { buildClearSessionCookie, parseCookies } = require('./auth.cookies');

function attachSession(sessionManager) {
  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[env.auth.cookieName];
    const session = sessionManager.getSession(token);

    req.authToken = token || null;
    req.authSession = session;

    if (!session && token) {
      res.append('Set-Cookie', buildClearSessionCookie(env.auth));
    }

    next();
  };
}

function requireAuth() {
  return (req, res, next) => {
    if (req.authSession) {
      next();
      return;
    }

    res.status(401).json({
      error: 'Authentication required'
    });
  };
}

module.exports = {
  attachSession,
  requireAuth
};
