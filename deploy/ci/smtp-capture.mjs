// CI only (deploy/ci/upload-smoke.sh): a tiny SMTP server that accepts any login and writes each
// message to <dir>/<n>.eml, so the smoke test can read a sign-in code from a production build
// without a real mailbox. Plain text, no TLS: it only listens on the CI stack's private network.
//   node smtp-capture.mjs <dir> [port]
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const [dir = '/out', port = '2525'] = process.argv.slice(2);
let count = 0;

createServer((socket) => {
  let buffer = '';
  let data = null;
  const say = (line) => socket.write(`${line}\r\n`);
  say('220 zuvo-ci-smtp ready');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (let end = buffer.indexOf('\r\n'); end !== -1; end = buffer.indexOf('\r\n')) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (data !== null) {
        if (line === '.') {
          count += 1;
          writeFileSync(join(dir, `${count}.eml`), data.join('\n'));
          data = null;
          say('250 queued');
        } else data.push(line.startsWith('..') ? line.slice(1) : line);
        continue;
      }
      const verb = line.split(' ')[0].toUpperCase();
      if (verb === 'EHLO')
        socket.write('250-zuvo-ci-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
      else if (verb === 'HELO') say('250 zuvo-ci-smtp');
      else if (verb === 'AUTH' && /^AUTH LOGIN/i.test(line)) say('334 VXNlcm5hbWU6');
      else if (verb === 'AUTH') say('235 accepted');
      else if (verb === 'DATA') {
        data = [];
        say('354 end with <CRLF>.<CRLF>');
      } else if (verb === 'QUIT') {
        say('221 bye');
        socket.end();
      } else if (
        /^[A-Za-z0-9+/=]+$/.test(line) &&
        !['MAIL', 'RCPT', 'RSET', 'NOOP'].includes(verb)
      ) {
        // AUTH LOGIN: username, then password, both base64.
        say(line.length > 0 && socket.loginStep ? '235 accepted' : '334 UGFzc3dvcmQ6');
        socket.loginStep = true;
      } else say('250 ok');
    }
  });
  socket.on('error', () => undefined);
}).listen(Number(port), '0.0.0.0', () =>
  console.log(`smtp-capture on :${port}, writing to ${dir}`),
);
