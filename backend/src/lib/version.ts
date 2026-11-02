import pkg from '../../package.json' with { type: 'json' };

/** Backend version, inlined into the production bundle at build time. */
export const APP_VERSION: string = pkg.version;
