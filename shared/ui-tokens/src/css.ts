import {
  duration,
  easing,
  fontFamily,
  fontSize,
  fontWeight,
  radius,
  spacing,
  type Theme,
  themes,
  zIndex,
} from './tokens.ts';

type Declarations = Array<[name: string, value: string]>;

const HEADER = `/*
 * GENERATED FILE — DO NOT EDIT.
 * Source: shared/ui-tokens/src/*.ts
 * Regenerate: pnpm --filter @zuvo/ui-tokens generate
 */`;

function kebab(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/\./g, '_')
    .toLowerCase();
}

function prefixed(prefix: string, values: Record<string, string>): Declarations {
  return Object.entries(values).map(([key, value]) => [`--${prefix}-${kebab(key)}`, value]);
}

function themeDeclarations(theme: Theme): Declarations {
  return [...prefixed('color', theme.colors), ...prefixed('shadow', theme.shadows)];
}

function scaleDeclarations(): Declarations {
  const textSizes = Object.entries(fontSize).flatMap(
    ([key, { size, lineHeight }]): Declarations => [
      [`--text-${key}`, size],
      [`--text-${key}--line-height`, lineHeight],
    ],
  );
  return [
    ...prefixed('font', fontFamily),
    ...textSizes,
    ...prefixed('font-weight', fontWeight),
    ...prefixed('radius', radius),
    ...prefixed('space', spacing),
    ...prefixed('duration', duration),
    ...prefixed('ease', easing),
    ...prefixed('z', zIndex),
  ];
}

function block(selector: string, colorScheme: string, declarations: Declarations): string {
  const lines = declarations.map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n  color-scheme: ${colorScheme};\n${lines.join('\n')}\n}`;
}

/** Builds tokens.css: scales + light theme on :root, dark theme on [data-theme="dark"]. */
export function generateTokensCss(): string {
  const root = block(':root', 'light', [
    ...themeDeclarations(themes.light),
    ...scaleDeclarations(),
  ]);
  const dark = block('[data-theme="dark"]', 'dark', themeDeclarations(themes.dark));
  return `${HEADER}\n\n${root}\n\n${dark}\n`;
}
