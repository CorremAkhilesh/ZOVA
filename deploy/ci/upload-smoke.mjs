// CI only (deploy/ci/upload-smoke.sh): a REAL photo upload against the production images, through
// the real host Nginx site, as the app does it: sign in with an emailed code, POST /v1/uploads,
// chunks, complete, send the message over Socket.IO, then read it back and download the file.
// No packages: Node's fetch, and Socket.IO spoken over its HTTP long-polling transport.
//   MAIL_DIR=<dir> NODE_TLS_REJECT_UNAUTHORIZED=0 node deploy/ci/upload-smoke.mjs
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORIGIN = 'https://zuvo.corremadvisory.com';
const EMAIL = `ci-upload-${Date.now()}@corremadvisory.com`;
/** A valid 10×10 PNG: the server checks magic bytes and decodes pictures. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNk+M+ABIwMDAwAFAoBAX1Nz8QAAAAASUVORK5CYII=',
  'base64',
);
const cookies = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(step, detail) {
  console.log(`::error title=Real upload::${step}: ${detail}`);
  process.exit(1);
}

/** One request as the browser makes it: same origin, cookies, and no silent redirects. */
async function call(method, path, { json, body, headers = {} } = {}) {
  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      origin: ORIGIN,
      accept: 'application/json',
      cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : body,
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const at = pair.indexOf('=');
    cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const text = await response.text();
  if (response.status >= 300 && response.status < 400) {
    const where = response.headers.get('location');
    fail(
      `${method} ${path}`,
      `redirected (${response.status} to ${where}): the browser would retry it as GET without its body`,
    );
  }
  return { status: response.status, text, data: text.startsWith('{') ? JSON.parse(text) : text };
}

async function expectOk(method, path, options) {
  const result = await call(method, path, options);
  if (result.status !== 200)
    fail(`${method} ${path}`, `${result.status} ${result.text.slice(0, 300)}`);
  return result.data;
}

async function codeFromMail(dir) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const file of readdirSync(dir)) {
      const mail = readFileSync(join(dir, file), 'utf8');
      const code = /^Subject: (\d{6}) /m.exec(mail)?.[1];
      if (code && mail.includes(EMAIL)) return code;
    }
    await sleep(500);
  }
  return fail('sign-in code', `no email for ${EMAIL} reached the capture server`);
}

/** RFC 9562 UUIDv7, as the app makes its clientMsgIds. */
function uuidv7() {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Socket.IO over Engine.IO v4 long-polling: connect, emit with an ack, wait for the ack. */
async function emitWithAck(event, payload) {
  const base = '/socket.io/?EIO=4&transport=polling';
  const open = await expectOk('GET', `${base}&t=${Date.now()}`);
  const sid = JSON.parse(String(open).slice(1)).sid;
  const url = `${base}&sid=${sid}`;
  const post = (packets) =>
    expectOk('POST', url, {
      body: packets,
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    });
  const packets = async () => String(await expectOk('GET', `${url}&t=${Date.now()}`)).split('\x1e');
  await post('40');
  const connected = await packets();
  if (!connected.some((packet) => packet.startsWith('40')))
    fail('socket connect', connected.join(' | '));
  await post(`421${JSON.stringify([event, payload])}`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const packet of await packets()) {
      if (packet === '2') await post('3');
      if (packet.startsWith('431')) return JSON.parse(packet.slice(3))[0];
    }
  }
  return fail(event, 'no answer from the server');
}

const mailDir = process.env.MAIL_DIR;
if (!mailDir) fail('setup', 'MAIL_DIR is not set');

console.log(`--- sign in as ${EMAIL}`);
await expectOk('POST', '/v1/auth/otp/request', { json: { email: EMAIL } });
await expectOk('POST', '/v1/auth/otp/verify', {
  json: { email: EMAIL, code: await codeFromMail(mailDir) },
});
const { chat } = await expectOk('GET', '/v1/chats/self');

console.log('--- POST /v1/uploads (init), two chunks, complete');
const init = await call('POST', '/v1/uploads', {
  json: { kind: 'image', name: 'ci.png', mime: 'image/png', size: PNG.length },
});
if (init.status !== 200) fail('POST /v1/uploads', `${init.status} ${init.text.slice(0, 300)}`);
const { uploadId } = init.data;
if (!/^[0-9a-f]{24}$/.test(uploadId ?? '')) fail('POST /v1/uploads', `no upload id: ${init.text}`);
let offset = (await expectOk('GET', `/v1/uploads/${uploadId}`)).offset;
for (const chunk of [PNG.subarray(0, 40), PNG.subarray(40)]) {
  const state = await expectOk('PATCH', `/v1/uploads/${uploadId}`, {
    body: chunk,
    headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': String(offset) },
  });
  offset = state.offset;
}
if (offset !== PNG.length) fail('chunks', `the server has ${offset} of ${PNG.length} bytes`);
const { media } = await expectOk('POST', `/v1/uploads/${uploadId}/complete`);

console.log('--- send it to Saved Messages over Socket.IO, then read it back');
const clientMsgId = uuidv7();
const ack = await emitWithAck('message:send', {
  chatId: chat.id,
  clientMsgId,
  mediaIds: [media.id],
});
if (!ack?.ok) fail('message:send', JSON.stringify(ack));
const history = await expectOk('GET', `/v1/chats/${chat.id}/messages`);
const sent = history.items.find((item) => item.clientMsgId === clientMsgId);
if (sent?.media?.id !== media.id) fail('history', 'the message with the photo is not in the chat');
const { url } = await expectOk('GET', `/v1/media/${media.id}/link`);
const file = await fetch(new URL(url, ORIGIN), {
  headers: { cookie: [...cookies].map(([n, v]) => `${n}=${v}`).join('; ') },
});
const bytes = Buffer.from(await file.arrayBuffer());
if (file.status !== 200 || !bytes.equals(PNG))
  fail('download', `${file.status}, ${bytes.length} bytes`);
console.log(
  `real upload OK: upload ${uploadId} -> media ${media.id} -> message ${ack.data.messageId}`,
);
