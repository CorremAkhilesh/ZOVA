#!/usr/bin/env node
/**
 * Prints a new Web Push (VAPID) key pair as env lines, in base64url (RFC 8292):
 *   pnpm vapid:gen
 * Paste both lines into backend/.env (or /srv/zuvo/<env>.env on the VPS). One pair per environment;
 * changing it makes every device subscribe again. Plain Node, no dependencies.
 */
import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const scalar = ecdh.getPrivateKey();
// A scalar with leading zero bytes comes back shorter: keep it 32 bytes.
const privateKey = Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]);

process.stdout.write(`VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}\n`);
process.stdout.write(`VAPID_PRIVATE_KEY=${privateKey.toString('base64url')}\n`);
