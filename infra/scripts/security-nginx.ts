#!/usr/bin/env node
/**
 * Writes infra/nginx/security-headers.conf from shared/config/src/security-headers.ts:
 *   pnpm security:nginx
 * Run it after changing any security header, and commit the result (a backend test fails while
 * the file is out of date). Plain Node (type stripping), no dependencies.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NGINX_SNIPPET_PATH, nginxSecurityHeaders } from '../../shared/config/src/nginx-snippet.ts';

const target = fileURLToPath(new URL(`../../${NGINX_SNIPPET_PATH}`, import.meta.url));
writeFileSync(target, nginxSecurityHeaders());
process.stdout.write(`Wrote ${NGINX_SNIPPET_PATH}\n`);
