import type { createLowlight } from 'lowlight';
import type { ReactNode } from 'react';

/** lowlight's hast tree, typed without a direct dependency on `@types/hast`. */
export type HastRoot = ReturnType<ReturnType<typeof createLowlight>['highlight']>;
type HastNode = HastRoot['children'][number];

/** Only highlight.js class names pass through; anything else is dropped. */
const SAFE_CLASS = /^(?:hljs|language)(?:-[\w-]+)?$|^[\w-]+_$/;

function classNameOf(value: unknown): string | undefined {
  const list = Array.isArray(value) ? value : [value];
  const names = list.filter(
    (name): name is string => typeof name === 'string' && SAFE_CLASS.test(name),
  );
  return names.length > 0 ? names.join(' ') : undefined;
}

/**
 * Turns lowlight's hast tree into React elements: element → <span className>, text → string.
 * No HTML strings are ever produced or parsed; other node types (comments, doctypes) are dropped.
 */
export function hastToReact(nodes: readonly HastNode[], prefix = ''): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}${index}`;
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return null;
    return (
      <span key={key} className={classNameOf(node.properties.className)}>
        {hastToReact(node.children, `${key}.`)}
      </span>
    );
  });
}
