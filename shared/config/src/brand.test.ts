import { describe, expect, it } from 'vitest';
import { brand } from './brand.ts';

const HEX_COLOR = /^#[0-9A-F]{6}$/;

describe('brand', () => {
  it('uses the agreed primary color', () => {
    expect(brand.colors.primary).toBe('#4F46E5');
  });

  it('uses uppercase 6-digit hex colors', () => {
    for (const color of Object.values(brand.colors)) {
      expect(color).toMatch(HEX_COLOR);
    }
  });

  it('serves every product domain under the organization domain', () => {
    const { organization, ...productDomains } = brand.domains;
    for (const domain of Object.values(productDomains)) {
      expect(domain.endsWith(`.${organization}`)).toBe(true);
    }
  });

  it('uses an organization email for support', () => {
    expect(brand.supportEmail.endsWith(`@${brand.domains.organization}`)).toBe(true);
  });
});
