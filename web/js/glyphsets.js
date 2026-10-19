// Character sets offered for a new font and category rules for the sidebar.

const range = (a, b) => {
  const out = [];
  for (let c = a.codePointAt(0); c <= b.codePointAt(0); c++) out.push(String.fromCodePoint(c));
  return out;
};

export const SETS = {
  latin: [...range('A', 'Z'), ...range('a', 'z')],
  // ¨ and ˘ are the marks of Ё and Й: drawn once, they build those letters.
  cyrillic: [...range('А', 'Е'), 'Ё', ...range('Ж', 'Я'), ...range('а', 'е'), 'ё', ...range('ж', 'я'), '¨', '˘'],
  digits: range('0', '9'),
  punct: [' ', ...'.,:;!?-–—\'"«»()[]/&@#%*+=_<>€$№'],
  // Western European letters with accents; they build themselves from the
  // base letter and the mark.
  accents: [...'`´ˆ˜¨˚¸ı', ...'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ'],
};

// Readable names for common symbols; letters and digits use themselves.
const NAMES = {
  ' ': 'space', '.': 'period', ',': 'comma', ':': 'colon', ';': 'semicolon', '!': 'exclam', '?': 'question',
  '-': 'hyphen', '–': 'endash', '—': 'emdash', '\'': 'quotesingle', '"': 'quotedbl', '«': 'guillemetleft',
  '»': 'guillemetright', '(': 'parenleft', ')': 'parenright', '[': 'bracketleft', ']': 'bracketright',
  '/': 'slash', '&': 'ampersand', '@': 'at', '#': 'numbersign', '%': 'percent', '*': 'asterisk', '+': 'plus',
  '=': 'equal', '_': 'underscore', '<': 'less', '>': 'greater', '€': 'Euro', '$': 'dollar', '№': 'numero',
  '`': 'grave', '´': 'acute', 'ˆ': 'circumflex', '˜': 'tilde', '¨': 'dieresis', '˚': 'ring', '¸': 'cedilla',
  '˘': 'breve', 'ˇ': 'caron', '˙': 'dotaccent', '¯': 'macron', '˝': 'hungarumlaut', '˛': 'ogonek', 'ı': 'dotlessi',
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
};

export function glyphNameFor(ch) {
  if (NAMES[ch]) return NAMES[ch];
  if (/^[A-Za-z]$/.test(ch)) return ch;
  const cp = ch.codePointAt(0);
  return cp > 0xffff ? `u${cp.toString(16).toUpperCase()}` : `uni${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function defaultAdvance(ch) {
  if (ch === ' ') return 250;
  if (/[`´ˆ˜¨˚¸˘ˇ˙¯˝˛]/.test(ch)) return 300;
  if (/[.,:;!'|]/.test(ch)) return 260;
  if (/[a-zа-яё]/.test(ch)) return 520;
  if (/[0-9]/.test(ch)) return 560;
  if (/[ЖШЩЮMWФЫ]/.test(ch)) return 760;
  return 620;
}

export const CATEGORIES = [
  { id: 'all', test: () => true },
  { id: 'upper', test: (c) => /^[A-Z]$/.test(c) },
  { id: 'lower', test: (c) => /^[a-z]$/.test(c) },
  { id: 'cyrUpper', test: (c) => /^[А-ЯЁ]$/.test(c) },
  { id: 'cyrLower', test: (c) => /^[а-яё]$/.test(c) },
  { id: 'digits', test: (c) => /^[0-9]$/.test(c) },
  { id: 'punct', test: (c) => /^[\p{P}\p{S}\p{Zs}]$/u.test(c) },
  { id: 'other', test: (c) => !/^[A-Za-zА-ЯЁа-яё0-9\p{P}\p{S}\p{Zs}]$/u.test(c) },
];

export const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
