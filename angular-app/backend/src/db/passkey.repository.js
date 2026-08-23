const { query, queryOne } = require('./postgres');

async function ensurePasskeyTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS passkey_credentials (
      id           TEXT PRIMARY KEY,
      public_key   TEXT NOT NULL,
      counter      INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS passkey_challenges (
      id         TEXT PRIMARY KEY DEFAULT 'singleton',
      challenge  TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
}

async function saveChallenge(challenge) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO passkey_challenges (id, challenge, expires_at)
     VALUES ('singleton', $1, $2)
     ON CONFLICT (id) DO UPDATE SET challenge = EXCLUDED.challenge, expires_at = EXCLUDED.expires_at`,
    [challenge, expiresAt]
  );
}

async function consumeChallenge() {
  const row = await queryOne(
    `DELETE FROM passkey_challenges WHERE id = 'singleton' AND expires_at > NOW() RETURNING challenge`
  );
  return row?.challenge ?? null;
}

async function saveCredential({ id, publicKey, counter }) {
  await query(
    `INSERT INTO passkey_credentials (id, public_key, counter)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET public_key = EXCLUDED.public_key, counter = EXCLUDED.counter`,
    [id, publicKey, counter]
  );
}

async function getCredential() {
  return queryOne('SELECT id, public_key, counter FROM passkey_credentials LIMIT 1');
}

async function updateCounter(id, counter) {
  await query('UPDATE passkey_credentials SET counter = $2 WHERE id = $1', [id, counter]);
}

async function deleteCredential() {
  await query('DELETE FROM passkey_credentials');
}

module.exports = { ensurePasskeyTables, saveChallenge, consumeChallenge, saveCredential, getCredential, updateCounter, deleteCredential };
