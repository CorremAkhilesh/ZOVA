// vitest-axe 0.1 only augments the legacy `Vi` namespace; register its matcher for Vitest 5.
import 'vitest';

declare module 'vitest' {
  // biome-ignore lint/suspicious/noExplicitAny: must match Vitest's own declaration
  interface Assertion<T = any> {
    toHaveNoViolations(): T;
  }
}
