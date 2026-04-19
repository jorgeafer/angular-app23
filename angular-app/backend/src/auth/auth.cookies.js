function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const separatorIndex = pair.indexOf('=');

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = decodeURIComponent(pair.slice(0, separatorIndex).trim());
      const value = decodeURIComponent(pair.slice(separatorIndex + 1).trim());

      cookies[key] = value;
      return cookies;
    }, {});
}

function buildSessionCookie(token, authConfig) {
  const maxAge = Math.max(Math.floor(authConfig.sessionTtlMs / 1000), 0);
  const parts = [
    `${encodeURIComponent(authConfig.cookieName)}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];

  if (authConfig.secureCookies) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function buildClearSessionCookie(authConfig) {
  const parts = [
    `${encodeURIComponent(authConfig.cookieName)}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];

  if (authConfig.secureCookies) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

module.exports = {
  parseCookies,
  buildSessionCookie,
  buildClearSessionCookie
};
