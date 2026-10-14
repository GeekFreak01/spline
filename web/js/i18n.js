// Interface translations. Add a language by copying the "en" block.
const dict = {
  ru: {
    menuFile: 'Файл', menuEdit: 'Правка', menuView: 'Вид', menuGlyph: 'Буква', menuHelp: 'Справка',
    new: 'Новый шрифт…', open: 'Открыть…', importSvg: 'Импорт SVG…', importSp: 'Взять буквы из .sp…',
    save: 'Сохранить', saveAs: 'Сохранить как…', export: 'Экспорт', exportTTF: 'Экспорт TTF', exportOTF: 'Экспорт OTF',
    undo: 'Отменить', redo: 'Повторить', cut: 'Вырезать', copy: 'Копировать', paste: 'Вставить',
    selectAll: 'Выделить всё', delete: 'Удалить',
    zoomIn: 'Увеличить', zoomOut: 'Уменьшить', zoomFit: 'Показать целиком',
    showGuide: 'Буква-подсказка', showGrid: 'Сетка', themeDark: 'Тёмная тема', themeLight: 'Светлая тема', language: 'Язык',
    addGlyph: 'Добавить буквы…', deleteGlyph: 'Удалить букву', drawGlyph: 'Открыть в редакторе',
    fontInfo: 'Параметры шрифта…', autoSpacing: 'Ровные отступы', flipH: 'Отразить по горизонтали', flipV: 'Отразить по вертикали',
    clear: 'Очистить контуры', shortcuts: 'Горячие клавиши', about: 'Spline на GitHub',
    search: 'Поиск', categories: 'Категории', colors: 'Метки', progressTitle: 'Готовность',
    progress: 'Нарисовано {n} из {total}',
    all: 'Все', upper: 'Латиница, прописные', lower: 'Латиница, строчные', cyrUpper: 'Кириллица, прописные', cyrLower: 'Кириллица, строчные',
    digits: 'Цифры', punct: 'Знаки', other: 'Другие', empty: 'Не нарисованы', done: 'Нарисованы',
    noSelection: 'Нет выделения', glyph: 'Буква', glyphs: 'буквы',
    name: 'Имя', unicode: 'Unicode', width: 'Ширина', lsb: 'Слева', rsb: 'Справа',
    color: 'Метка', noColor: 'Без метки',
    dimensions: 'Размеры', transform: 'Трансформации', actions: 'Действия', fontSection: 'Шрифт',
    scale: 'Масштаб', rotate: 'Поворот', slant: 'Наклон', apply: 'Применить',
    transformHint: 'Применяется к выделенным точкам или ко всей букве',
    toolSelect: 'Выбор', toolPen: 'Перо', toolBrush: 'Кисть', toolEraser: 'Ластик',
    toolRect: 'Прямоугольник', toolEllipse: 'Эллипс', toolHand: 'Рука',
    tipSelect: 'Тяните точки и усы. Shift — по 45°. Ctrl/Alt+тянуть ус — только одна сторона; Ctrl/Alt+щелчок по усу — острый угол с этой стороны. Двойной щелчок по линии — новая точка.',
    tipPen: 'Щелчок — угол, протяжка — кривая. Shift — 45°. Щелчок по последней точке — острый выход; Ctrl/Alt+протяжка — только исходящий ус. Щелчок по первой точке замыкает контур.',
    tipBrush: 'Рисуйте мышью или пером. Shift — прямой мазок. Пересечения сливаются автоматически.',
    tipEraser: 'Стирает часть контура. Shift — прямая линия.',
    tipRect: 'Тяните, чтобы нарисовать. Shift — квадрат. Фигура внутри другой становится дыркой.',
    tipEllipse: 'Тяните, чтобы нарисовать. Shift — круг. Фигура внутри другой становится дыркой.',
    tipHand: 'Перемещение холста. Колесо — масштаб, Shift+колесо — по горизонтали.',
    tipGrid: 'Двойной щелчок по букве открывает редактор. Перетащите сюда .sp или .svg.',
    stabilizer: 'Стабилизатор', stabilizerTip: 'Сглаживает дрожание руки: мазок тянется за курсором',
    gridStep: 'Шаг', snap: 'Привязка:', snapGrid: 'к сетке', snapGuides: 'к линиям',
    snapGridTip: 'Точки встают в узлы сетки', snapGuidesTip: 'Точки прилипают к базовой линии, высотам и краям ширины',
    selection: 'Выделение', selectionHint: 'Выделите точки инструментом «Выбор», чтобы задать точные координаты',
    handleIn: 'Входящий ус', handleOut: 'Исходящий ус', w: 'Ш', h: 'В', keepRatio: 'Сохранять пропорции',
    pointsSelected: 'Выбрано точек: {n}',
    pathOps: 'Контуры', pathOpsHint: 'Работает с выделенными фигурами (или со всеми). Вычитание: верхняя фигура вырезается из остальных.',
    pathOpNeedTwo: 'Выделите хотя бы две фигуры',
    opUnite: 'Объединить', opSubtract: 'Вычесть верхнюю', opIntersect: 'Пересечение', opExclude: 'Исключить пересечение',
    opDivide: 'Разделить', opRemoveOverlap: 'Убрать перекрытия',
    brushSize: 'Размер', guide: 'Подсказка', grid: 'Сетка', back: 'Все буквы (Esc)',
    prev: 'Предыдущая буква', next: 'Следующая буква', tileSize: 'Размер плиток',
    preview: 'Просмотр', previewText: 'Съешь же ещё этих мягких французских булок. The quick brown fox jumps over the lazy dog 0123456789',
    previewSize: 'Кегль', previewError: 'Не удалось собрать шрифт', previewEmpty: 'Нарисуйте хотя бы одну букву, чтобы увидеть шрифт',
    family: 'Название', style: 'Начертание', designer: 'Автор', version: 'Версия',
    metrics: 'Вертикальные метрики', ascender: 'Ascender', capHeight: 'Высота прописных', xHeight: 'Высота строчных', descender: 'Descender',
    cancel: 'Отмена', ok: 'OK', create: 'Создать', add: 'Добавить',
    addGlyphHint: 'Символы для добавления, например ЁёҚқ€',
    newTitle: 'Новый шрифт', newSets: 'Наборы символов',
    setLatin: 'Латиница', setCyrillic: 'Кириллица', setDigits: 'Цифры', setPunct: 'Знаки препинания',
    confirmNew: 'Есть несохранённые изменения. Продолжить без сохранения?',
    confirmDelete: 'Удалить выбранные буквы ({n})?', confirmClear: 'Удалить все контуры этой буквы?',
    savedAs: 'Сохранено: {name}', exported: 'Экспортировано: {name}',
    opened: 'Открыт «{name}»', openError: 'Не удалось открыть файл: {err}',
    pasted: 'Вставлено букв: {n}', copied: 'Скопировано в буфер обмена',
    restored: 'Восстановлена последняя сессия', dropHere: 'Отпустите файлы .sp или .svg',
    exists: 'Эти символы уже есть в шрифте',
    svgImported: 'SVG → «{name}»', svgTraced: 'SVG с обводками → контуры «{name}»',
    svgNoTarget: '{file}: выберите букву или назовите файл по букве (A.svg, uni0416.svg)',
    svgError: '{file}: {err}',
    guideLines: { asc: 'ascender', cap: 'cap height', x: 'x-height', base: 'baseline', desc: 'descender' },
    selectedCount: 'Выбрано: {sel} · Букв: {n}/{total}',
    keysList: [
      ['V · P · B · E · R · O · H', 'Выбор, перо, кисть, ластик, прямоугольник, эллипс, рука'],
      ['Пробел (удерживать)', 'Временно «рука»'],
      ['Shift', 'Прямые линии и углы по 45°, квадрат/круг'],
      ['F9 / F10', 'Привязка к сетке / к линиям'],
      ['Ctrl+Alt+U · M · I · E · D · O', 'Объединить, вычесть, пересечь, исключить, разделить, убрать перекрытия'],
      ['Ctrl / Alt', 'Работа с одной стороной точки: разорвать ус, острый угол'],
      ['Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y)', 'Отменить / повторить'],
      ['Стрелки, Shift+стрелки', 'Сдвиг точек на 1 / 10'],
      ['Delete', 'Удалить точки'], ['Ctrl+A', 'Выделить всё'],
      ['Ctrl+C / Ctrl+X / Ctrl+V', 'Копировать / вырезать / вставить (в т. ч. SVG-код)'],
      ['PageUp / PageDown', 'Соседняя буква'], ['+ / − / 0', 'Масштаб / целиком'],
      ['Esc', 'Назад к сетке'], ['Ctrl+S / Ctrl+Shift+S', 'Сохранить / сохранить как'], ['Ctrl+O', 'Открыть'],
    ],
    unsaved: 'Есть несохранённые изменения',
    colorNames: { red: 'красная', orange: 'оранжевая', yellow: 'жёлтая', green: 'зелёная', blue: 'синяя', purple: 'фиолетовая' },
  },
  en: {
    menuFile: 'File', menuEdit: 'Edit', menuView: 'View', menuGlyph: 'Glyph', menuHelp: 'Help',
    new: 'New Font…', open: 'Open…', importSvg: 'Import SVG…', importSp: 'Import Glyphs from .sp…',
    save: 'Save', saveAs: 'Save As…', export: 'Export', exportTTF: 'Export TTF', exportOTF: 'Export OTF',
    undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste',
    selectAll: 'Select All', delete: 'Delete',
    zoomIn: 'Zoom In', zoomOut: 'Zoom Out', zoomFit: 'Fit to Window',
    showGuide: 'Guide Letter', showGrid: 'Grid', themeDark: 'Dark Theme', themeLight: 'Light Theme', language: 'Language',
    addGlyph: 'Add Glyphs…', deleteGlyph: 'Delete Glyph', drawGlyph: 'Open in Editor',
    fontInfo: 'Font Info…', autoSpacing: 'Even Sidebearings', flipH: 'Flip Horizontally', flipV: 'Flip Vertically',
    clear: 'Clear Outlines', shortcuts: 'Keyboard Shortcuts', about: 'Spline on GitHub',
    search: 'Search', categories: 'Categories', colors: 'Labels', progressTitle: 'Progress',
    progress: '{n} of {total} drawn',
    all: 'All', upper: 'Latin, uppercase', lower: 'Latin, lowercase', cyrUpper: 'Cyrillic, uppercase', cyrLower: 'Cyrillic, lowercase',
    digits: 'Numbers', punct: 'Punctuation & symbols', other: 'Other', empty: 'Not drawn', done: 'Drawn',
    noSelection: 'No selection', glyph: 'Glyph', glyphs: 'glyphs',
    name: 'Name', unicode: 'Unicode', width: 'Width', lsb: 'Left', rsb: 'Right',
    color: 'Label', noColor: 'No label',
    dimensions: 'Dimensions', transform: 'Transformations', actions: 'Actions', fontSection: 'Font',
    scale: 'Scale', rotate: 'Rotate', slant: 'Slant', apply: 'Apply',
    transformHint: 'Applies to the selected points or the whole glyph',
    toolSelect: 'Select', toolPen: 'Pen', toolBrush: 'Brush', toolEraser: 'Eraser',
    toolRect: 'Rectangle', toolEllipse: 'Ellipse', toolHand: 'Hand',
    tipSelect: 'Drag points and handles. Shift snaps to 45°. Ctrl/Alt+drag a handle moves one side only; Ctrl/Alt+click a handle makes that side sharp. Double-click a line to add a point.',
    tipPen: 'Click for a corner, drag for a curve. Shift snaps to 45°. Click the last point for a sharp exit; Ctrl/Alt+drag sets only the outgoing handle. Click the first point to close.',
    tipBrush: 'Paint with mouse or stylus. Shift draws a straight stroke. Overlaps merge automatically.',
    tipEraser: 'Erases part of the outline. Shift draws a straight line.',
    tipRect: 'Drag to draw. Shift makes a square. A shape inside another shape becomes a hole.',
    tipEllipse: 'Drag to draw. Shift makes a circle. A shape inside another shape becomes a hole.',
    tipHand: 'Pan the canvas. Wheel zooms, Shift+wheel scrolls horizontally.',
    tipGrid: 'Double-click a glyph to edit it. Drop .sp or .svg files here.',
    stabilizer: 'Stabilizer', stabilizerTip: 'Smooths hand jitter: the stroke trails behind the pointer',
    gridStep: 'Step', snap: 'Snap:', snapGrid: 'to grid', snapGuides: 'to guides',
    snapGridTip: 'Points land on grid intersections', snapGuidesTip: 'Points stick to the baseline, heights and sidebearings',
    selection: 'Selection', selectionHint: 'Select points with the Select tool to set exact coordinates',
    handleIn: 'Incoming handle', handleOut: 'Outgoing handle', w: 'W', h: 'H', keepRatio: 'Keep proportions',
    pointsSelected: 'Points selected: {n}',
    pathOps: 'Path operations', pathOpsHint: 'Works on the selected shapes (or all). Subtract cuts the top shape out of the others.',
    pathOpNeedTwo: 'Select at least two shapes',
    opUnite: 'Unite', opSubtract: 'Subtract front', opIntersect: 'Intersect', opExclude: 'Exclude overlap',
    opDivide: 'Divide', opRemoveOverlap: 'Remove overlap',
    brushSize: 'Size', guide: 'Guide', grid: 'Grid', back: 'All glyphs (Esc)',
    prev: 'Previous glyph', next: 'Next glyph', tileSize: 'Tile size',
    preview: 'Preview', previewText: 'The quick brown fox jumps over the lazy dog. Съешь же ещё этих мягких французских булок 0123456789',
    previewSize: 'Size', previewError: 'Could not build the font', previewEmpty: 'Draw at least one glyph to preview the font',
    family: 'Family name', style: 'Style', designer: 'Designer', version: 'Version',
    metrics: 'Vertical metrics', ascender: 'Ascender', capHeight: 'Cap height', xHeight: 'x-height', descender: 'Descender',
    cancel: 'Cancel', ok: 'OK', create: 'Create', add: 'Add',
    addGlyphHint: 'Characters to add, e.g. ÄÖÜß€',
    newTitle: 'New Font', newSets: 'Character sets',
    setLatin: 'Latin', setCyrillic: 'Cyrillic', setDigits: 'Numbers', setPunct: 'Punctuation',
    confirmNew: 'You have unsaved changes. Continue without saving?',
    confirmDelete: 'Delete the selected glyphs ({n})?', confirmClear: 'Delete all outlines of this glyph?',
    savedAs: 'Saved: {name}', exported: 'Exported: {name}',
    opened: 'Opened “{name}”', openError: 'Could not open the file: {err}',
    pasted: 'Glyphs pasted: {n}', copied: 'Copied to clipboard',
    restored: 'Last session restored', dropHere: 'Drop .sp or .svg files',
    exists: 'These characters already exist',
    svgImported: 'SVG → “{name}”', svgTraced: 'Stroked SVG → outlines of “{name}”',
    svgNoTarget: '{file}: select a glyph or name the file after it (A.svg, uni0416.svg)',
    svgError: '{file}: {err}',
    guideLines: { asc: 'ascender', cap: 'cap height', x: 'x-height', base: 'baseline', desc: 'descender' },
    selectedCount: 'Selected: {sel} · Glyphs: {n}/{total}',
    keysList: [
      ['V · P · B · E · R · O · H', 'Select, pen, brush, eraser, rectangle, ellipse, hand'],
      ['Space (hold)', 'Temporary hand'],
      ['Shift', 'Straight lines and 45° angles, square/circle'],
      ['F9 / F10', 'Snap to grid / to guides'],
      ['Ctrl+Alt+U · M · I · E · D · O', 'Unite, subtract, intersect, exclude, divide, remove overlap'],
      ['Ctrl / Alt', 'Work on one side of a point: break handle, sharp corner'],
      ['Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y)', 'Undo / redo'],
      ['Arrows, Shift+arrows', 'Nudge points by 1 / 10'],
      ['Delete', 'Delete points'], ['Ctrl+A', 'Select all'],
      ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste (SVG code too)'],
      ['PageUp / PageDown', 'Neighbour glyph'], ['+ / − / 0', 'Zoom / fit'],
      ['Esc', 'Back to the grid'], ['Ctrl+S / Ctrl+Shift+S', 'Save / save as'], ['Ctrl+O', 'Open'],
    ],
    unsaved: 'Unsaved changes',
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
