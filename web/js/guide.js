// The guide page (guide.html): what every part of Spline does, in Russian
// and English. The panels themselves stay free of explanations; this is
// where they live.
import { icon } from './icons.js';

const T = {
  ru: {
    title: 'Руководство', heading: 'Руководство по Spline',
    intro: 'Что делает каждая часть редактора. Пометка «расширенный» — функция появляется после «Вид → Расширенный режим».',
    ext: 'расширенный',
  },
  en: {
    title: 'Guide', heading: 'The Spline guide',
    intro: 'What every part of the editor does. “Extended” marks what appears after View → Extended Mode.',
    ext: 'extended',
  },
};

// [icon, { ru, en } name, keys, { ru, en } text, extended?]
const S = [
  {
    id: 'start', icon: 'help', title: { ru: 'Начало', en: 'Getting started' },
    lead: { ru: 'Три вида и два режима.', en: 'Three views and two modes.' },
    items: [
      ['grid', { ru: 'Буквы', en: 'Glyphs' }, '', { ru: 'Все буквы шрифта плитками. Двойной щелчок по букве открывает редактор.', en: 'Every glyph of the font as a tile. Double-click a glyph to open the editor.' }],
      ['pen', { ru: 'Редактор', en: 'Editor' }, 'Esc', { ru: 'Холст одной буквы: инструменты слева, панели справа, просмотр текста внизу. Esc или кнопка с сеткой — обратно к буквам.', en: 'The canvas of one glyph: tools on the left, panels on the right, the text preview below. Esc or the grid button goes back to the glyphs.' }],
      ['kerning', { ru: 'Кернинг', en: 'Kerning' }, 'Ctrl+K', { ru: 'Расстояния между парами букв в живой строке.', en: 'The spacing of letter pairs in a live line of text.' }],
      ['settings', { ru: 'Простой и расширенный режим', en: 'Simple and extended mode' }, '', { ru: '«Вид → Расширенный режим» добавляет инструменты для серьёзной работы: мастера, якоря, компоненты, фильтры, OpenType. Простой режим остаётся без них.', en: 'View → Extended Mode adds the tools for serious work: masters, anchors, components, filters, OpenType. The simple mode stays without them.' }],
      ['save', { ru: 'Сохранение', en: 'Saving' }, 'Ctrl+S', { ru: 'Проект — файл .sp. Пока вы работаете, Spline ещё и сохраняет его в браузере, так что после сбоя ничего не пропадёт.', en: 'A project is an .sp file. While you work, Spline also keeps it in the browser, so nothing is lost after a crash.' }],
      ['type', { ru: 'Просмотр', en: 'Preview' }, '', { ru: 'Строка внизу набирает любой текст вашим шрифтом. «Буква в строке» показывает текущую букву среди других; недорисованные буквы приглушены.', en: 'The line below sets any text in your font. “Glyph in context” shows the current glyph among others; glyphs not drawn yet are dimmed.' }],
    ],
  },
  {
    id: 'glyphs', icon: 'grid', title: { ru: 'Буквы', en: 'Glyphs' },
    lead: { ru: 'Список букв и всё, что делается сразу с несколькими.', en: 'The glyph list and everything done to several glyphs at once.' },
    items: [
      ['rows', { ru: 'Категории, метки, готовность', en: 'Categories, labels, progress' }, '', { ru: 'Слева — алфавиты и группы знаков, цветные метки для фильтра и полоска «нарисовано».', en: 'On the left: scripts and symbol groups, colour labels to filter by and the “drawn” bar.' }],
      ['plus', { ru: 'Добавить буквы', en: 'Add glyphs' }, '', { ru: '«Буква → Добавить буквы…»: символы, коды вроде U+0410-044F или целые алфавиты.', en: 'Glyph → Add Glyphs…: characters, codes like U+0410-044F or whole alphabets.' }],
      ['open', { ru: 'Импорт', en: 'Import' }, 'Ctrl+V', { ru: 'Перетащите SVG на плитку или вставьте код из Figma и Illustrator. Файлы A.svg, uni0416.svg, Ж.svg сами находят свою букву. Готовый .ttf/.otf открывается как проект.', en: 'Drop an SVG on a tile or paste code from Figma or Illustrator. Files named A.svg, uni0416.svg, Ж.svg find their glyph. A .ttf/.otf opens as a project.' }],
      ['check', { ru: 'Пакетные команды', en: 'Batch commands' }, '', { ru: 'Выделите несколько букв (Shift, Ctrl): отступы, упрощение, отражение, теги и экспорт меняются у всех сразу.', en: 'Select several glyphs (Shift, Ctrl): spacing, simplify, flip, tags and export change for all of them.' }],
      ['rows', { ru: 'Таблица', en: 'Table' }, '', { ru: 'Буквы списком: имя, код, ширина, отступы, теги, заметки, «в шрифт». Правка прямо в ячейках, сортировка по столбцам.', en: 'Glyphs as a list: name, code, width, sidebearings, tags, notes, “export”. Edit right in the cells, sort by any column.' }, true],
    ],
  },
  {
    id: 'tools', icon: 'select', title: { ru: 'Инструменты', en: 'Tools' },
    lead: { ru: 'Строка слева в редакторе. Параметры инструмента — в строке над холстом.', en: 'The strip on the left of the editor. Tool options are in the bar above the canvas.' },
    items: [
      ['select', { ru: 'Выбор', en: 'Select' }, 'V', { ru: 'Выделяйте и тяните точки и усы. Shift — по 45°, двойной щелчок по линии — новая точка. Правый клик или удержание кнопки — рамка или лассо, Shift+V переключает.', en: 'Select and drag points and handles. Shift keeps 45°, double-click a line to add a point. Right-click or hold the button for rectangle or lasso; Shift+V switches.' }],
      ['pen', { ru: 'Перо', en: 'Pen' }, 'P', { ru: 'Щелчок — угол, протяжка — кривая. Щелчок по первой точке замыкает контур.', en: 'Click for a corner, drag for a curve. Click the first point to close the contour.' }],
      ['brush', { ru: 'Кисть', en: 'Brush' }, 'B', { ru: 'Рисует контур мазком, пересечения сливаются сами. Размер и стабилизатор — над холстом.', en: 'Draws an outline with a stroke; overlaps merge by themselves. Size and stabiliser are above the canvas.' }],
      ['eraser', { ru: 'Ластик', en: 'Eraser' }, 'E', { ru: 'Стирает часть контура. Shift — прямая линия.', en: 'Erases part of an outline. Shift draws a straight line.' }],
      ['rect', { ru: 'Прямоугольник и эллипс', en: 'Rectangle and ellipse' }, 'R · O', { ru: 'Тяните, чтобы нарисовать; Shift — квадрат или круг. Фигура внутри другой становится дыркой.', en: 'Drag to draw; Shift for a square or circle. A shape inside another becomes a hole.' }],
      ['knife', { ru: 'Нож', en: 'Knife' }, 'K', { ru: 'Режет фигуры линией насквозь.', en: 'Cuts shapes along a line drawn through them.' }],
      ['hand', { ru: 'Рука', en: 'Hand' }, 'H', { ru: 'Двигает холст. Колесо — масштаб, Shift+колесо — по горизонтали.', en: 'Moves the canvas. The wheel zooms, Shift+wheel scrolls sideways.' }],
      ['type', { ru: 'Текст', en: 'Text' }, 'T', { ru: 'Набирайте слово прямо на холсте: буква, которую правите, стоит среди соседей с их ширинами и кернингом. Двойной щелчок по соседу или Esc — править его, холст не сдвигается. Над холстом — поле «Строка»; буква без кода пишется как /имя.', en: 'Type a word right on the canvas: the glyph you edit stands among its neighbours with their widths and kerning. Double-click a neighbour or press Esc to edit it; the canvas stays put. The Line field above the canvas takes text; a glyph without a code is /name.' }],
      ['ruler', { ru: 'Линейка', en: 'Ruler' }, 'M', { ru: 'Длина и угол, а поперёк буквы — толщина штрихов и просветы.', en: 'Length and angle; across a glyph — stroke thickness and counters.' }, true],
      ['pixel', { ru: 'Пиксели', en: 'Pixels' }, 'G', { ru: 'Рисует клетками заданного размера; соседние клетки сливаются в один контур.', en: 'Draws in cells of a set size; touching cells merge into one outline.' }, true],
      ['transform', { ru: 'Свободная трансформация', en: 'Free transform' }, 'Ctrl+T', { ru: 'Рамка вокруг выделения: углы — масштаб, за рамкой — поворот, внутри — перемещение. Enter — применить.', en: 'A box around the selection: corners scale, outside rotates, inside moves. Enter applies.' }],
      ['magnet', { ru: 'Привязка', en: 'Snapping' }, 'F9 · F10', { ru: 'Кнопка-магнит над холстом: к сетке и к линиям шрифта.', en: 'The magnet button above the canvas: to the grid and to the font lines.' }],
    ],
  },
  {
    id: 'panels', icon: 'panelDock', title: { ru: 'Панели', en: 'Panels' },
    lead: { ru: 'Разделы справа от холста. Их можно двигать как в Photoshop.', en: 'The sections right of the canvas. They move around as in Photoshop.' },
    items: [
      ['pen', { ru: 'Буква', en: 'Glyph' }, '', { ru: 'Имя и код, отступы и ширина, метрические ключи, метка, кернинг-группы.', en: 'Name and code, sidebearings and width, metric keys, label, kerning groups.' }],
      ['select', { ru: 'Выделение', en: 'Selection' }, '', { ru: 'Точные координаты выделенных точек и размеры фигуры.', en: 'Exact coordinates of the selected points and the size of the shape.' }],
      ['opUnite', { ru: 'Контуры и выравнивание', en: 'Paths and alignment' }, 'Ctrl+Alt+U…', { ru: 'Объединить, вычесть, пересечь, исключить, разделить, убрать перекрытия; ниже — выравнивание и распределение относительно выделения или рамки буквы.', en: 'Unite, subtract, intersect, exclude, divide, remove overlap; below — align and distribute to the selection or the glyph box.' }],
      ['points', { ru: 'Точки', en: 'Points' }, 'Tab', { ru: 'Экстремумы, «в линию», разрезать и соединить, ровные усы, первая точка. Tab — следующая точка, Alt+перетаскивание — копия.', en: 'Extremes, align in a line, break and join, even handles, first point. Tab goes to the next point, Alt+drag copies.' }, true],
      ['knife', { ru: 'Ушки и отрезки', en: 'Ears and segments' }, 'Alt+Delete', { ru: '«Ушки» продлевают стороны острого угла крест-накрест, «Свести ушки» возвращает угол по пересечению. Alt+Delete удаляет отрезок между двумя соседними точками. Открытый конец, брошенный на другой конец, соединяется с ним.', en: 'Open Corner extends the sides of a sharp corner across each other; Reconnect turns them back into a corner where they cross. Alt+Delete deletes the segment between two neighbouring points. An open end dropped on another end joins it.' }, true],
      ['components', { ru: 'Компоненты', en: 'Components' }, '', { ru: 'Другая буква внутри этой как ссылка: À = A + `. Исправите A — À обновится сама.', en: 'Another glyph inside this one, as a link: À = A + `. Fix A and À follows.' }, true],
      ['transform', { ru: 'Трансформации', en: 'Transformations' }, '', { ru: 'Масштаб, поворот, наклон от базовой линии, отражение — числами.', en: 'Scale, rotate, slant from the baseline, flip — by numbers.' }],
      ['variants', { ru: 'Варианты и лигатуры', en: 'Alternates and ligatures' }, '', { ru: 'Буква меняет форму рядом с соседями (calt), несколько букв заменяются одним знаком (liga).', en: 'A glyph changes shape next to its neighbours (calt); several glyphs turn into one sign (liga).' }],
      ['image', { ru: 'Подложка', en: 'Underlay' }, '', { ru: 'Перетащите скан или фото буквы на холст и обведите его. В шрифт картинка не попадает.', en: 'Drop a scan or photo of a letter on the canvas and trace it. The picture never goes into the font.' }],
      ['spacing', { ru: 'Действия и Шрифт', en: 'Actions and Font' }, '', { ru: 'Ровные отступы, упрощение контура, импорт SVG; название и вертикальные метрики шрифта.', en: 'Even sidebearings, simplify outline, SVG import; the font name and vertical metrics.' }],
      ['panelDock', { ru: 'Места панелей', en: 'Panel places' }, '', { ru: 'Тяните заголовок раздела: вверх, влево, в полоску иконок или отдельным окном. Брошенный на заголовок другого раздела, он становится вкладкой; вкладку можно вытащить обратно. «Окно» показывает и прячет панели.', en: 'Drag a section header: to the top, to the left, into the icon strip or as a window. Dropped on another header it becomes a tab; drag the tab out to separate it. The Window menu shows and hides panels.' }],
      ['layers', { ru: 'Окна для редких дел', en: 'Windows for rare tasks' }, '', { ru: '«Окно → Якоря, Цвет, Умная деталь, Фон и снимки» открываются отдельными окнами и запоминают место.', en: 'Window → Anchors, Colour, Smart Part, Background open as separate windows and remember their place.' }, true],
    ],
  },
  {
    id: 'kerning', icon: 'kerning', title: { ru: 'Кернинг', en: 'Kerning' },
    lead: { ru: 'Печатайте прямо в строке, курсор между буквами выбирает пару.', en: 'Type right in the line; the cursor between two letters picks the pair.' },
    items: [
      ['kerning', { ru: 'Значение пары', en: 'Pair value' }, 'Alt+← →', { ru: 'Alt+стрелки — по 10, Alt+Shift — по 1, или тяните мышью. Синее — ближе, жёлтое — дальше, красное — слишком тесно.', en: 'Alt+arrows by 10, Alt+Shift by 1, or drag with the mouse. Blue is closer, yellow is wider, red is too tight.' }],
      ['grid', { ru: 'Группы', en: 'Groups' }, '', { ru: 'Буквы с одинаковой стороной (О, С, Е слева) кернятся вместе. «Группа» или «Буква» у пары решает, кому достанется значение. «Группы по форме» подбирает их сами.', en: 'Glyphs with the same side (O, C, E on the left) kern together. “Group” or “Letter” on a pair decides who gets the value. Shape Groups finds them for you.' }],
      ['spacing', { ru: 'Отступы', en: 'Sidebearings' }, '', { ru: 'Меняют саму букву во всех парах; кернинг — только эту пару.', en: 'Change the glyph itself in every pair; kerning changes only this pair.' }],
      ['check', { ru: 'Подсказки', en: 'Suggestions' }, '', { ru: 'Сравнивает просвет в каждой паре с HH, nn, НН, нн и предлагает значение. Это грубая оценка — проверяйте глазом.', en: 'Compares the gap of each pair with HH, nn and proposes a value. A rough estimate — check it by eye.' }],
      ['layers', { ru: 'Кернинг мастеров', en: 'Kerning per master' }, '', { ru: 'При нескольких мастерах у каждого свой кернинг: переключатель над строкой.', en: 'With several masters each has its own kerning: the switch is above the line.' }, true],
    ],
  },
  {
    id: 'extended', icon: 'sliders', title: { ru: 'Расширенный режим', en: 'Extended mode' },
    lead: { ru: 'Большие возможности для семейств и OpenType.', en: 'The big features for families and OpenType.' },
    items: [
      ['layers', { ru: 'Мастера', en: 'Masters' }, '', { ru: '«Буква → Мастера…»: одна буква в нескольких начертаниях на осях насыщенности и ширины. Новый мастер — копия основного; меняйте его, сохраняя число точек. Ползунок в просмотре смешивает их.', en: 'Glyph → Masters…: one glyph in several styles on the weight and width axes. A new master is a copy of the default; change it but keep the points. A slider in the preview blends them.' }, true],
      ['link', { ru: 'Все мастера сразу', en: 'All masters at once' }, '', { ru: 'Кнопки рядом с мастерами: «Все мастера» рисует другие мастера поверх и связывает одинаковые точки пунктиром, красным — то, что не смешается; «Править все мастера» добавляет и удаляет точки, режет и соединяет во всех мастерах сразу.', en: 'The buttons next to the masters: All masters draws the others on top with dotted links between matching points, red where they will not blend; Edit all masters adds and deletes points, cuts and joins in every master at once.' }, true],
      ['guide', { ru: 'Зоны выравнивания', en: 'Alignment zones' }, '', { ru: '«Параметры шрифта → Свес»: полосы над и под линиями шрифта. Точка на линии или в зоне — зелёное кольцо, промах на несколько единиц — оранжевое пунктирное.', en: 'Font Info → Overshoot: bands above and below the font lines. A point on a line or in its zone gets a green ring, a miss by a few units an orange dashed one.' }, true],
      ['palette', { ru: 'Цвет', en: 'Colour' }, '', { ru: 'Палитра и цвет для каждой фигуры. В шрифт пишутся COLR и CPAL; там, где цвета нет, буква остаётся обычной.', en: 'A palette and a colour for each shape. The font gets COLR and CPAL; where colour is not supported the glyph stays plain.' }, true],
      ['sliders', { ru: 'Умные детали', en: 'Smart parts' }, '', { ru: 'Деталь с ползунками: нарисуйте её крайние состояния («Длина», «Толщина»), а в буквах выбирайте значение.', en: 'A part with sliders: draw its extreme states (“Length”, “Weight”) and pick a value in each glyph.' }, true],
      ['anchor', { ru: 'Якоря', en: 'Anchors' }, '', { ru: '«Верх» у буквы и «_верх» у знака совпадают — знак встаёт на место, и в готовом шрифте тоже.', en: '“top” on a glyph and “_top” on a mark meet — the mark sits in place, in the finished font too.' }, true],
      ['type', { ru: 'Особая форма', en: 'Special form' }, '', { ru: '«Буква → Особая форма…»: капитель, виды цифр, индексы, числитель и знаменатель (дроби 1/2), ноль с чертой, стилистические наборы, болгарская и сербская формы. Функция OpenType появляется сама.', en: 'Glyph → Special Form…: small caps, figure styles, superscripts, numerators and denominators (1/2 fractions), slashed zero, stylistic sets, Bulgarian and Serbian forms. The OpenType feature appears by itself.' }, true],
      ['filter', { ru: 'Фильтры', en: 'Filters' }, '', { ru: '«Фильтр → Толщина, Скругление, Обводка, Усы»: у каждого своё окно, значение и «Предпросмотр». Окно можно двигать за заголовок.', en: 'Filter → Weight, Round, Stroke, Handles: each has its own window, value and Preview. Move the window by its title.' }, true],
      ['spacing', { ru: 'Метрические ключи', en: 'Metric keys' }, '', { ru: '=n — как у n, =o+10, =|o — противоположная сторона o, =| — как своя другая сторона. «Обновить метрики» применяет их.', en: '=n — same as n, =o+10, =|o — the opposite side of o, =| — same as its own other side. Update Metrics applies them.' }, true],
    ],
  },
  {
    id: 'export', icon: 'download', title: { ru: 'Экспорт', en: 'Export' },
    lead: { ru: '«Файл» и кнопка «Экспорт» вверху справа.', en: 'The File menu and the Export button at the top right.' },
    items: [
      ['download', { ru: 'TTF и OTF', en: 'TTF and OTF' }, '', { ru: 'TrueType и OpenType (CFF) с кернингом, вариантами, лигатурами и формами.', en: 'TrueType and OpenType (CFF) with kerning, alternates, ligatures and forms.' }],
      ['download', { ru: 'WOFF2 и WOFF', en: 'WOFF2 and WOFF' }, '', { ru: 'Для сайтов: WOFF2 меньше всего, WOFF — для старых браузеров.', en: 'For websites: WOFF2 is the smallest, WOFF is for old browsers.' }, true],
      ['open', { ru: 'UFO', en: 'UFO' }, '', { ru: 'Обмен с Glyphs, FontLab, RoboFont и fontmake: «Экспорт UFO» и «Открыть шрифт как проект». С мастерами — .zip с UFO на каждый мастер и .designspace.', en: 'Exchange with Glyphs, FontLab, RoboFont and fontmake: Export UFO and Open Font as Project. With masters it is a .zip with a UFO per master and a .designspace.' }, true],
      ['layers', { ru: 'Начертания и вариативный шрифт', en: 'Styles and a variable font' }, '', { ru: 'Из мастеров: отдельные TTF (Light, Medium…) или один вариативный, где меняются контуры и кернинг.', en: 'From the masters: separate TTFs (Light, Medium…) or one variable font where outlines and kerning vary.' }, true],
      ['check', { ru: 'Установить в систему', en: 'Install in the system' }, '', { ru: 'Шрифт сразу появляется в Word, Figma и Photoshop.', en: 'The font shows up in Word, Figma and Photoshop right away.' }],
    ],
  },
  {
    id: 'keys', icon: 'settings', title: { ru: 'Горячие клавиши', en: 'Shortcuts' },
    lead: { ru: 'Все сочетания и их замена — «Справка → Горячие клавиши» (F1).', en: 'All shortcuts and changing them: Help → Keyboard Shortcuts (F1).' },
    items: [
      ['save', { ru: 'Файл', en: 'File' }, 'Ctrl+O · Ctrl+S · Ctrl+Shift+S', { ru: 'Открыть, сохранить, сохранить как.', en: 'Open, save, save as.' }],
      ['undo', { ru: 'Правка', en: 'Edit' }, 'Ctrl+Z · Ctrl+Shift+Z · Ctrl+A', { ru: 'Отменить, повторить, выделить всё.', en: 'Undo, redo, select all.' }],
      ['zoomIn', { ru: 'Вид', en: 'View' }, '+ · − · 0 · Ctrl+R', { ru: 'Крупнее, мельче, вся буква, линейки.', en: 'Zoom in, zoom out, fit the glyph, rulers.' }],
      ['chevronRight', { ru: 'Между буквами', en: 'Between glyphs' }, 'PageUp · PageDown', { ru: 'Предыдущая и следующая буква в редакторе.', en: 'Previous and next glyph in the editor.' }],
    ],
  },
];

let lang = new URLSearchParams(location.search).get('lang');
try { lang ||= localStorage.getItem('spline.lang'); } catch { /* storage off */ }
if (lang !== 'ru' && lang !== 'en') lang = navigator.language?.startsWith('ru') ? 'ru' : 'en';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const keys = (k) => (k ? k.split(' · ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ') : '');

function render() {
  const t = T[lang];
  document.documentElement.lang = lang;
  document.title = `Spline — ${t.title}`;
  document.getElementById('topTitle').textContent = t.title;
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === lang));
  document.getElementById('toc').innerHTML = S.map((s) => `<a href="#${s.id}">${icon(s.icon, 16)}<span>${esc(s.title[lang])}</span></a>`).join('');
  document.getElementById('guide').innerHTML = `<h1>${esc(t.heading)}</h1><p class="intro">${esc(t.intro)}</p>`
    + S.map((s) => `<section id="${s.id}">
      <h2>${icon(s.icon, 20)}${esc(s.title[lang])}</h2>
      <p class="lead">${esc(s.lead[lang])}</p>
      <div class="items">${s.items.map(([ic, name, k, text, ext]) => `<div class="item">
        <div class="ic">${icon(ic, 18)}</div>
        <div><h3>${esc(name[lang])} ${keys(k)}${ext ? `<span class="ext">${esc(t.ext)}</span>` : ''}</h3><p>${esc(text[lang])}</p></div>
      </div>`).join('')}</div>
    </section>`).join('');
  markCurrent();
}

// The section being read is marked in the contents.
function markCurrent() {
  let cur = S[0].id;
  for (const s of S) if (document.getElementById(s.id).getBoundingClientRect().top < 120) cur = s.id;
  document.querySelectorAll('#toc a').forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === `#${cur}`));
}

document.querySelector('.langs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lang]');
  if (!b || b.dataset.lang === lang) return;
  lang = b.dataset.lang;
  try { localStorage.setItem('spline.lang', lang); } catch { /* storage off */ }
  render();
});
window.addEventListener('scroll', markCurrent, { passive: true });
render();
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
