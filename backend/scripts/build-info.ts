// Docker build only ("meta" stage of deploy/docker/*.Dockerfile, run by plain `node`, which strips the
// types): writes build-info.json from the few .git files .dockerignore lets into the build context.
//   node backend/scripts/build-info.ts <git dir> <output file>
// No commit found (no .git in the context): "unknown". The build never fails because of it.
import { writeFileSync } from 'node:fs';
import { readGitCommit } from '../src/lib/git-commit.ts';

const [gitDir = '.git', out = 'build-info.json'] = process.argv.slice(2);
const sha = readGitCommit(gitDir);
const info = { commit: sha ? sha.slice(0, 7) : 'unknown', builtAt: new Date().toISOString() };
writeFileSync(out, `${JSON.stringify(info)}\n`);
process.stdout.write(`build-info: ${JSON.stringify(info)}
`);
