export interface TextSelection {
  value: string;
  start: number;
  end: number;
}

const SPACE = /\s/;

function splitEdges(line: string): { lead: string; core: string; trail: string } {
  const lead = /^\s*/.exec(line)?.[0] ?? '';
  const core = line.slice(lead.length).trimEnd();
  return { lead, core, trail: line.slice(lead.length + core.length) };
}

function isWrapped(core: string, marker: string): boolean {
  return core.length >= marker.length * 2 && core.startsWith(marker) && core.endsWith(marker);
}

/** Caret only: inserts a marker pair with the caret inside, or removes an empty pair around it. */
function atCaret(value: string, pos: number, marker: string): TextSelection {
  const m = marker.length;
  if (value.slice(pos - m, pos) === marker && value.slice(pos, pos + m) === marker) {
    return { value: value.slice(0, pos - m) + value.slice(pos + m), start: pos - m, end: pos - m };
  }
  return {
    value: value.slice(0, pos) + marker + marker + value.slice(pos),
    start: pos + m,
    end: pos + m,
  };
}

/**
 * Ctrl/Cmd+B / I for the composer. Wraps the selection in `marker`, leaving spaces at its edges
 * outside (`"hello "` → `"*hello* "`), or toggles the marker off when the selection is already
 * wrapped (markers just outside it or at its own edges). A multi-line selection is wrapped line
 * by line, since a marker pair never spans lines. Returns the new value and selection.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
): TextSelection {
  const m = marker.length;
  let s = Math.max(0, Math.min(start, end, value.length));
  let e = Math.min(value.length, Math.max(start, end, 0));
  while (s < e && SPACE.test(value[s] ?? '')) s++;
  while (e > s && SPACE.test(value[e - 1] ?? '')) e--;
  if (s === e) return atCaret(value, s, marker);

  const selected = value.slice(s, e);
  const multiLine = selected.includes('\n');
  if (!multiLine && value.slice(s - m, s) === marker && value.slice(e, e + m) === marker) {
    const next = value.slice(0, s - m) + selected + value.slice(e + m);
    return { value: next, start: s - m, end: e - m };
  }

  const lines = selected.split('\n').map(splitEdges);
  const filled = lines.filter((line) => line.core.length > 0);
  const unwrap = filled.every((line) => isWrapped(line.core, marker));
  const replaced = lines
    .map(({ lead, core, trail }) => {
      if (core.length === 0) return lead + trail;
      const inner = unwrap ? core.slice(m, core.length - m) : marker + core + marker;
      return lead + inner + trail;
    })
    .join('\n');
  const next = value.slice(0, s) + replaced + value.slice(e);
  if (multiLine) return { value: next, start: s, end: s + replaced.length };
  // One line: keep just the text selected, so pressing the shortcut again toggles it off.
  return unwrap
    ? { value: next, start: s, end: s + replaced.length }
    : { value: next, start: s + m, end: s + m + selected.length };
}
