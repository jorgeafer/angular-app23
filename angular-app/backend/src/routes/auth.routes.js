const crypto = require('crypto');
const express = require('express');
const { env } = require('../config/env');
const { buildClearSessionCookie, buildSessionCookie } = require('../auth/auth.cookies');

function createAuthRouter(sessionManager) {
  const router = express.Router();

  router.get('/session', (req, res) => {
    if (!req.authSession) {
      res.status(401).json({ authenticated: false });
      return;
    }

    res.json({
      authenticated: true,
      username: req.authSession.username
    });
  });

  router.post('/login', (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!isValidCredentials(username, password)) {
      res.status(401).json({
        error: 'Usuario o contrasena incorrectos'
      });
      return;
    }

    const session = sessionManager.createSession(env.auth.username);

    res.append('Set-Cookie', buildSessionCookie(session.token, env.auth));
    res.json({
      authenticated: true,
      username: session.username
    });
  });

  router.post('/logout', (req, res) => {
    sessionManager.revokeSession(req.authToken);
    res.append('Set-Cookie', buildClearSessionCookie(env.auth));
    res.json({ authenticated: false });
  });

  return router;
}

function isValidCredentials(username, password) {
  return safeEqual(username, env.auth.username) && safeEqual(password, env.auth.password);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = { createAuthRouter };
