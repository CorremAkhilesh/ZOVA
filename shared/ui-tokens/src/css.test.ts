import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateTokensCss } from './css.ts';
import { darkColors, lightColors } from './tokens.ts';

const committedCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('tokens.css', () => {
  it('is up to date with tokens.ts (run `pnpm --filter @zuvo/ui-tokens generate`)', () => {
    expect(committedCss.replace(/\r\n/g, '\n')).toBe(generateTokensCss());
  });

  it('defines the brand color on :root', () => {
    expect(committedCss).toContain(`--color-brand: ${lightColors.brand};`);
  });

  it('overrides colors under [data-theme="dark"]', () => {
    const darkBlock = committedCss.slice(committedCss.indexOf('[data-theme="dark"]'));
    expect(darkBlock).toContain(`--color-surface: ${darkColors.surface};`);
  });

  it('converts camelCase keys to kebab-case variables', () => {
    expect(committedCss).toContain('--color-bubble-outgoing-text:');
    expect(committedCss).toContain('--text-2xl--line-height:');
    expect(committedCss).toContain('--space-0_5:');
  });
});
