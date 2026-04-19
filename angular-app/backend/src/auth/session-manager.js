const crypto = require('crypto');

class SessionManager {
  constructor({ sessionTtlMs }) {
    this.sessionTtlMs = sessionTtlMs;
    this.sessions = new Map();
  }

  createSession(username) {
    this.purgeExpiredSessions();

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.sessionTtlMs;

    this.sessions.set(token, { username, expiresAt });

    return {
      token,
      username,
      expiresAt
    };
  }

  getSession(token) {
    if (!token) {
      return null;
    }

    const session = this.sessions.get(token);

    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  revokeSession(token) {
    if (!token) {
      return;
    }

    this.sessions.delete(token);
  }

  purgeExpiredSessions() {
    const now = Date.now();

    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token);
      }
    }
  }
}

module.exports = { SessionManager };
