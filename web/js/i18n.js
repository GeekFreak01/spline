// Interface translations. Add a language by copying the "en" block.
const dict = {
  ru: {
    appTagline: 'Редактор шрифтов', skip: 'Перейти к содержимому',
    importGlyphs: 'Взять буквы из другого файла .sp',
    new: 'Новый', open: 'Открыть', save: 'Сохранить', export: 'Скачать шрифт',
    exportTTF: 'TTF — для Windows, Mac и сайтов', exportOTF: 'OTF — с плавными кривыми',
    fontInfo: 'Настройки шрифта', help: 'Подсказки', language: 'Язык',
    search: 'Найти букву', categories: 'Категории', colors: 'Метки',
    all: 'Все', upper: 'Заглавные A–Z', lower: 'Строчные a–z', cyrUpper: 'Заглавные А–Я', cyrLower: 'Строчные а–я',
    digits: 'Цифры', punct: 'Знаки', other: 'Другие', empty: 'Ещё не нарисованы', done: 'Готовые',
    progress: 'Нарисовано {n} из {total}',
    addGlyph: 'Добавить букву', addGlyphHint: 'Впишите один или несколько символов, например: ЁёҚқ€',
    deleteGlyph: 'Удалить', drawGlyph: 'Рисовать', noSelection: 'Выберите букву, чтобы увидеть её здесь',
    glyph: 'Буква', name: 'Имя', unicode: 'Код', width: 'Ширина', lsb: 'Отступ слева', rsb: 'Отступ справа',
    color: 'Метка', noColor: 'Без метки',
    tools: 'Инструменты',
    toolSelect: 'Выбор', toolPen: 'Перо', toolBrush: 'Кисть', toolEraser: 'Ластик',
    toolRect: 'Квадрат', toolEllipse: 'Круг', toolHand: 'Рука',
    tipSelect: 'Двигайте точки и фигуры. Двойной щелчок по линии добавит точку.',
    tipPen: 'Щёлкайте, чтобы ставить точки. Потяните, чтобы сделать кривую. Щёлкните первую точку, чтобы замкнуть.',
    tipBrush: 'Рисуйте букву как кистью — линии станут кривыми сами.',
    tipEraser: 'Стирайте лишнее.',
    tipRect: 'Потяните, чтобы нарисовать прямоугольник. Shift — квадрат.',
    tipEllipse: 'Потяните, чтобы нарисовать овал. Shift — круг.',
    tipHand: 'Перетаскивайте холст. Колёсико — масштаб.',
    brushSize: 'Толщина кисти', guide: 'Буква-подсказка', autoSpacing: 'Ровные отступы',
    flipH: 'Отразить ↔', flipV: 'Отразить ↕', clear: 'Очистить', back: 'Все буквы',
    prev: 'Предыдущая буква', next: 'Следующая буква',
    zoomIn: 'Приблизить', zoomOut: 'Отдалить', zoomFit: 'Показать целиком',
    undo: 'Отменить', redo: 'Вернуть',
    preview: 'Проверка шрифта', previewText: 'Съешь же ещё этих мягких французских булок. Hello, World! 0123456789',
    previewSize: 'Размер', previewError: 'Не получилось собрать шрифт', previewEmpty: 'Нарисуйте хотя бы одну букву — и здесь появится ваш шрифт',
    family: 'Название шрифта', style: 'Начертание', designer: 'Автор', version: 'Версия',
    metrics: 'Линии', ascender: 'Верх (выносные)', capHeight: 'Высота заглавных', xHeight: 'Высота строчных', descender: 'Низ (выносные)',
    cancel: 'Отмена', ok: 'Готово', create: 'Создать', add: 'Добавить', delete: 'Удалить',
    newTitle: 'Новый шрифт', newSets: 'Какие буквы добавить',
    setLatin: 'Латиница', setCyrillic: 'Кириллица', setDigits: 'Цифры', setPunct: 'Знаки препинания',
    confirmNew: 'Начать новый шрифт? Несохранённые изменения пропадут.',
    confirmDelete: 'Удалить выбранные буквы ({n})?', confirmClear: 'Стереть рисунок этой буквы?',
    saved: 'Сохранено', savedAs: 'Файл сохранён: {name}', exported: 'Шрифт скачан: {name}',
    opened: 'Открыт проект «{name}»', openError: 'Не удалось открыть файл: {err}',
    pasted: 'Вставлено букв: {n}', copied: 'Скопировано — можно вставить в другой проект (Ctrl+V)',
    restored: 'Восстановлена ваша последняя работа',
    dropHere: 'Отпустите файл .sp, чтобы открыть',
    exists: 'Такие буквы уже есть', badUnicode: 'Неверный символ',
    guideLines: { asc: 'верх', cap: 'заглавные', x: 'строчные', base: 'линия', desc: 'низ' },
    shortcuts: 'Горячие клавиши',
    helpIntro: 'Выберите букву двойным щелчком и нарисуйте её кистью или пером. Когда будет готово — нажмите «Скачать шрифт» и установите его.',
    keysList: [
      ['V', 'Выбор'], ['P', 'Перо'], ['B', 'Кисть'], ['E', 'Ластик'], ['R', 'Квадрат'], ['O', 'Круг'], ['H / Пробел', 'Рука'],
      ['Ctrl+Z / Ctrl+Y', 'Отменить / вернуть'], ['Стрелки', 'Сдвинуть точки (Shift — на 10)'],
      ['Delete', 'Удалить точки'], ['Ctrl+C / Ctrl+V', 'Копировать / вставить'], ['PageUp / PageDown', 'Соседняя буква'],
      ['Esc', 'Назад ко всем буквам'], ['Ctrl+S', 'Сохранить'],
    ],
    unsaved: 'Есть несохранённые изменения',
    colorNames: { red: 'красная', orange: 'оранжевая', yellow: 'жёлтая', green: 'зелёная', blue: 'синяя', purple: 'фиолетовая' },
  },
  en: {
    appTagline: 'Font editor', skip: 'Skip to content',
    importGlyphs: 'Take letters from another .sp file',
    new: 'New', open: 'Open', save: 'Save', export: 'Download font',
    exportTTF: 'TTF — for Windows, Mac and websites', exportOTF: 'OTF — with smooth curves',
    fontInfo: 'Font settings', help: 'Tips', language: 'Language',
    search: 'Find a letter', categories: 'Categories', colors: 'Labels',
    all: 'All', upper: 'Uppercase A–Z', lower: 'Lowercase a–z', cyrUpper: 'Uppercase А–Я', cyrLower: 'Lowercase а–я',
    digits: 'Digits', punct: 'Punctuation', other: 'Other', empty: 'Not drawn yet', done: 'Finished',
    progress: '{n} of {total} drawn',
    addGlyph: 'Add letter', addGlyphHint: 'Type one or more characters, e.g. ÄÖÜß€',
    deleteGlyph: 'Delete', drawGlyph: 'Draw', noSelection: 'Pick a letter to see it here',
    glyph: 'Letter', name: 'Name', unicode: 'Code', width: 'Width', lsb: 'Left space', rsb: 'Right space',
    color: 'Label', noColor: 'No label',
    tools: 'Tools',
    toolSelect: 'Select', toolPen: 'Pen', toolBrush: 'Brush', toolEraser: 'Eraser',
    toolRect: 'Rectangle', toolEllipse: 'Ellipse', toolHand: 'Hand',
    tipSelect: 'Move points and shapes. Double-click a line to add a point.',
    tipPen: 'Click to place points. Drag to make a curve. Click the first point to close.',
    tipBrush: 'Paint the letter like with a brush — lines turn into curves by themselves.',
    tipEraser: 'Erase what you do not need.',
    tipRect: 'Drag to draw a rectangle. Shift makes a square.',
    tipEllipse: 'Drag to draw an ellipse. Shift makes a circle.',
    tipHand: 'Drag the canvas. Mouse wheel zooms.',
    brushSize: 'Brush size', guide: 'Guide letter', autoSpacing: 'Even spacing',
    flipH: 'Flip ↔', flipV: 'Flip ↕', clear: 'Clear', back: 'All letters',
    prev: 'Previous letter', next: 'Next letter',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomFit: 'Fit to screen',
    undo: 'Undo', redo: 'Redo',
    preview: 'Try your font', previewText: 'The quick brown fox jumps over the lazy dog. Привет, мир! 0123456789',
    previewSize: 'Size', previewError: 'Could not build the font', previewEmpty: 'Draw at least one letter and your font will appear here',
    family: 'Font name', style: 'Style', designer: 'Designer', version: 'Version',
    metrics: 'Guide lines', ascender: 'Ascender', capHeight: 'Cap height', xHeight: 'x-height', descender: 'Descender',
    cancel: 'Cancel', ok: 'Done', create: 'Create', add: 'Add', delete: 'Delete',
    newTitle: 'New font', newSets: 'Which letters to add',
    setLatin: 'Latin', setCyrillic: 'Cyrillic', setDigits: 'Digits', setPunct: 'Punctuation',
    confirmNew: 'Start a new font? Unsaved changes will be lost.',
    confirmDelete: 'Delete the selected letters ({n})?', confirmClear: 'Erase the drawing of this letter?',
    saved: 'Saved', savedAs: 'File saved: {name}', exported: 'Font downloaded: {name}',
    opened: 'Opened “{name}”', openError: 'Could not open the file: {err}',
    pasted: 'Letters pasted: {n}', copied: 'Copied — you can paste it into another project (Ctrl+V)',
    restored: 'Your last work was restored',
    dropHere: 'Drop a .sp file to open it',
    exists: 'These letters already exist', badUnicode: 'Invalid character',
    guideLines: { asc: 'ascender', cap: 'caps', x: 'x-height', base: 'baseline', desc: 'descender' },
    shortcuts: 'Keyboard shortcuts',
    helpIntro: 'Double-click a letter and draw it with the brush or the pen. When you are done, press “Download font” and install it.',
    keysList: [
      ['V', 'Select'], ['P', 'Pen'], ['B', 'Brush'], ['E', 'Eraser'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['H / Space', 'Hand'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Arrows', 'Nudge points (Shift = 10)'],
      ['Delete', 'Delete points'], ['Ctrl+C / Ctrl+V', 'Copy / paste'], ['PageUp / PageDown', 'Neighbour letter'],
      ['Esc', 'Back to all letters'], ['Ctrl+S', 'Save'],
    ],
    unsaved: 'You have unsaved changes',
    colorNames: { red: 'red', orange: 'orange', yellow: 'yellow', green: 'green', blue: 'blue', purple: 'purple' },
  },
};

let lang = 'ru';
try {
  lang = localStorage.getItem('spline.lang') || (navigator.language.startsWith('ru') ? 'ru' : 'en');
} catch { /* storage unavailable */ }
if (!dict[lang]) lang = 'en';

const listeners = new Set();

export function t(key, vars) {
  let s = dict[lang][key] ?? dict.en[key] ?? key;
  if (vars && typeof s === 'string') {
    s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }
  return s;
}

export function getLang() { return lang; }

export function setLang(l) {
  if (!dict[l]) return;
  lang = l;
  try { localStorage.setItem('spline.lang', l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  applyStatic();
  listeners.forEach((fn) => fn());
}

export function onLangChange(fn) { listeners.add(fn); }

// Fills elements marked with data-i18n / data-i18n-title / data-i18n-placeholder.
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute('aria-label', t(el.dataset.i18nTitle));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}
