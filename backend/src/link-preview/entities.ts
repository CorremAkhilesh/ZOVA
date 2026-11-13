/** Named entities that realistically appear in titles and descriptions. Unknown ones stay as-is. */
const NAMED = new Map<string, string>(
  Object.entries({
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
    copy: '©',
    reg: '®',
    trade: '™',
    hellip: '…',
    mdash: '—',
    ndash: '–',
    lsquo: '‘',
    rsquo: '’',
    sbquo: '‚',
    ldquo: '“',
    rdquo: '”',
    bdquo: '„',
    laquo: '«',
    raquo: '»',
    bull: '•',
    middot: '·',
    euro: '€',
    pound: '£',
    yen: '¥',
    cent: '¢',
    rupee: '₹',
    deg: '°',
    times: '×',
    divide: '÷',
    plusmn: '±',
    para: '¶',
    sect: '§',
    iexcl: '¡',
    iquest: '¿',
    aacute: 'á',
    eacute: 'é',
    iacute: 'í',
    oacute: 'ó',
    uacute: 'ú',
    agrave: 'à',
    egrave: 'è',
    auml: 'ä',
    ouml: 'ö',
    uuml: 'ü',
    szlig: 'ß',
    ntilde: 'ñ',
    ccedil: 'ç',
    Aacute: 'Á',
    Eacute: 'É',
    Auml: 'Ä',
    Ouml: 'Ö',
    Uuml: 'Ü',
    Ntilde: 'Ñ',
    Ccedil: 'Ç',
    zwj: '\u200d',
    zwnj: '\u200c',
  }),
);

function fromCodePoint(codePoint: number): string {
  const invalid =
    !Number.isFinite(codePoint) ||
    codePoint === 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff);
  return invalid ? '\ufffd' : String.fromCodePoint(codePoint);
}

/** Decodes HTML character references (`&amp;`, `&#39;`, `&#x27;`, …). Single pass, no recursion. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));?/g,
    (match, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (decimal !== undefined) return fromCodePoint(Number.parseInt(decimal, 10));
      if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16));
      return (name !== undefined && NAMED.get(name)) || match;
    },
  );
}
