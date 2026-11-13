import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, axeMatchers } from './axe';

describe('axe helper', () => {
  it('passes accessible markup', async () => {
    const { container } = render(
      <main>
        <h1>Title</h1>
        <button type="button">Save</button>
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('reports violations with rule id, help link and target', async () => {
    const { container } = render(
      <main>
        <button type="button" />
        {/* biome-ignore lint/a11y/useAltText: deliberately inaccessible to prove detection */}
        <img src="x.png" />
      </main>,
    );
    const results = await axe(container);
    const outcome = axeMatchers.toHaveNoViolations(results);
    expect(outcome.pass).toBe(false);
    const message = outcome.message();
    expect(message).toContain('button-name');
    expect(message).toContain('image-alt');
    expect(message).toContain('https://dequeuniversity.com/rules/axe/');
  });
});
