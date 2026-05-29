const { verify } = require('./jwt');

function attachSession() {
  return (req, _res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verify(token) : null;

    req.authToken = token;
    req.authSession = payload ? { username: payload.username } : null;

    next();
  };
}

function requireAuth() {
  return (req, res, next) => {
    if (req.authSession) {
      next();
      return;
    }

    res.status(401).json({ error: 'Authentication required' });
  };
}

module.exports = { attachSession, requireAuth };
