const express = require('express');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { sign } = require('../auth/jwt');
const { env } = require('../config/env');
const {
  saveChallenge,
  consumeChallenge,
  saveCredential,
  getCredential,
  updateCounter,
  deleteCredential
} = require('../db/passkey.repository');

function getRpConfig() {
  return {
    rpName: env.passkey.rpName,
    rpID: env.passkey.rpId,
    origin: env.passkey.origin
  };
}

function createPasskeyRouter(requireAuth) {
  const router = express.Router();

  // Begin registration — must be authenticated (password login first)
  router.post('/register-options', requireAuth(), async (_req, res) => {
    try {
      const { rpName, rpID } = getRpConfig();
      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: new TextEncoder().encode(env.auth.username),
        userName: env.auth.username,
        userDisplayName: env.auth.username,
        attestationType: 'none',
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred'
        }
      });
      await saveChallenge(options.challenge);
      res.json(options);
    } catch (err) {
      console.error('passkey register-options error:', err);
      res.status(500).json({ error: 'Error generating registration options' });
    }
  });

  // Complete registration — must be authenticated
  router.post('/register', requireAuth(), async (req, res) => {
    try {
      const { rpID, origin } = getRpConfig();
      const expectedChallenge = await consumeChallenge();
      if (!expectedChallenge) {
        res.status(400).json({ error: 'Challenge expired or not found' });
        return;
      }

      const verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true
      });

      if (!verification.verified || !verification.registrationInfo) {
        res.status(400).json({ error: 'Registration verification failed' });
        return;
      }

      const { credential } = verification.registrationInfo;
      await saveCredential({
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter
      });

      res.json({ registered: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('passkey register error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // Begin authentication — public
  router.post('/auth-options', async (_req, res) => {
    try {
      const { rpID } = getRpConfig();
      const stored = await getCredential();

      if (!stored) {
        res.status(404).json({ error: 'No passkey registered' });
        return;
      }

      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: [{ id: stored.id }],
        userVerification: 'required'
      });
      await saveChallenge(options.challenge);
      res.json(options);
    } catch (err) {
      console.error('passkey auth-options error:', err);
      res.status(500).json({ error: 'Error generating authentication options' });
    }
  });

  // Complete authentication — public, returns JWT on success
  router.post('/authenticate', async (req, res) => {
    try {
      const { rpID, origin } = getRpConfig();
      const expectedChallenge = await consumeChallenge();
      if (!expectedChallenge) {
        res.status(400).json({ error: 'Challenge expired or not found' });
        return;
      }

      const stored = await getCredential();
      if (!stored) {
        res.status(404).json({ error: 'No passkey registered' });
        return;
      }

      const verification = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: stored.id,
          publicKey: new Uint8Array(Buffer.from(stored.public_key, 'base64url')),
          counter: stored.counter
        }
      });

      if (!verification.verified) {
        res.status(401).json({ error: 'Authentication failed' });
        return;
      }

      await updateCounter(stored.id, verification.authenticationInfo.newCounter);

      const token = sign({ username: env.auth.username }, env.auth.sessionTtlMs);
      res.json({ authenticated: true, username: env.auth.username, token });
    } catch (err) {
      console.error('passkey authenticate error:', err);
      res.status(500).json({ error: 'Error completing authentication' });
    }
  });

  // Delete passkey — must be authenticated
  router.delete('/credential', requireAuth(), async (_req, res) => {
    try {
      await deleteCredential();
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: 'Error deleting passkey' });
    }
  });

  // Check if passkey is registered — public
  router.get('/status', async (_req, res) => {
    try {
      const stored = await getCredential();
      res.json({ registered: !!stored });
    } catch {
      res.json({ registered: false });
    }
  });

  return router;
}

module.exports = { createPasskeyRouter };
