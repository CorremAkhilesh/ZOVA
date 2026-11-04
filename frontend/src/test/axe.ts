import axeCore, { type AxeResults, type RunOptions } from 'axe-core';

/**
 * Runs axe-core on a rendered container. jsdom cannot compute layout, so color-contrast is off
 * by default here (contrast is covered by the token tests and Playwright).
 */
export function axe(container: Element, options: RunOptions = {}): Promise<AxeResults> {
  return axeCore.run(container, {
    ...options,
    rules: { 'color-contrast': { enabled: false }, ...options.rules },
  });
}

function describeViolations(results: AxeResults): string {
  return results.violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => `    - ${node.target.join(' ')}`).join('\n');
      return `• [${violation.impact ?? 'n/a'}] ${violation.id}: ${violation.help}\n  ${violation.helpUrl}\n${targets}`;
    })
    .join('\n\n');
}

export const axeMatchers = {
  toHaveNoViolations(received: AxeResults) {
    const count = received.violations.length;
    return {
      pass: count === 0,
      message: () =>
        count === 0
          ? 'Expected accessibility violations, but found none.'
          : `Expected no accessibility violations, found ${count}:\n\n${describeViolations(received)}`,
    };
  },
};

declare module 'vitest' {
  // Must match Vitest 5's own Matchers type parameters.
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toHaveNoViolations(): R;
  }
}
