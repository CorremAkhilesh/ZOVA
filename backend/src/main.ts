import { buildApp } from './app.ts';
import { type Env, EnvError, loadEnv } from './config/env.ts';
import { handleShutdown } from './lib/shutdown.ts';

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

async function main() {
  const env = loadEnvOrExit();
  const app = await buildApp(env);
  handleShutdown(app.log, () => app.close());
  const host = env.HOST ?? (env.NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0');
  await app.listen({ host, port: env.PORT });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `API failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
