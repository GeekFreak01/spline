# Spline

**Облегчённое создание шрифтов.**
Рисуйте буквы кистью или пером, импортируйте SVG и экспортируйте готовый TTF/OTF без долгого изучения программы.

*Lightweight font creation. [English below](#english).*

Идеи взяты из [Glyphs](https://glyphsapp.com) и [FontForge](https://github.com/fontforge/fontforge),
но всё сделано максимально просто: один файл программы, никакой установки, своё окно без браузера.

---

## Как запустить

1. Скачайте программу для своей системы на странице [Releases](https://github.com/GeekFreak01/spline/releases):
   - Windows: `spline-windows-amd64.exe`
   - macOS: `spline-macos-arm64` (Apple M1/M2/M3) или `spline-macos-amd64` (Intel)
   - Linux: `spline-linux-amd64`
2. Запустите её двойным щелчком. Откроется окно редактора.
   - **Windows 10/11**: собственное окно программы (движок WebView2, уже встроен в Windows), без браузера и без консоли.
   - **macOS / Linux**: отдельное окно Chrome или Edge в режиме приложения, без вкладок и адресной строки.
   - Если ничего из этого нет, редактор откроется в обычном браузере.
3. Чтобы выйти, просто закройте окно.

> Windows может показать «Windows защитила ваш компьютер»: «Подробнее» → «Выполнить в любом случае».
> На macOS при первом запуске: правый клик по файлу → «Открыть». На Linux/macOS: `chmod +x spline-*`.

### Собрать самому

Нужен [Go](https://go.dev/dl/) 1.22 или новее:

```bash
go run github.com/GeekFreak01/spline@latest
```

или из исходников:

```bash
git clone https://github.com/GeekFreak01/spline
cd spline
go run .
```

## Что умеет

| | |
|---|---|
| **Интерфейс** | Тёмная рабочая среда как в Photoshop/Glyphs: меню, панель параметров, инструменты, панели справа, строка состояния с координатами. Есть светлая тема |
| **Сетка букв** | Разделы по категориям, цветные метки, коды Unicode, размер плиток, фильтры «нарисованы / не нарисованы» |
| **Кисть и ластик** | Рисуйте мышью или пером: мазок превращается в кривые и вливается в контур векторным объединением (ластик вычитает), остальная часть контура не меняется. Стабилизатор убирает дрожание руки |
| **Перо** | Кривые Безье: щелчок ставит угол, протяжка делает кривую |
| **Прямоугольник и эллипс** | Фигура внутри другой фигуры становится дыркой (как в «О») |
| **Импорт SVG** | Из Illustrator, Figma, Inkscape: меню «Файл → Импорт SVG», перетаскивание в окно или вставка SVG-кода (`Ctrl+V`). Заливки переносятся точно, рисунки из обводок обводятся в контуры. Файлы `A.svg`, `uni0416.svg`, `Ж.svg` сами попадают в нужные буквы |
| **Точные координаты** | Панель «Выделение»: X/Y точки и её усов или X, Y, ширина, высота выделенных фигур (с сохранением пропорций). Размер фигуры виден при рисовании |
| **Сетка и привязка** | Настраиваемый шаг сетки, основные линии через 5 шагов. Привязка к узлам сетки (`F9`) и к линиям: базовая, высоты строчных и прописных, выносные, края ширины (`F10`) |
| **Нож** | Проведите линию через фигуру, и контур разрежется на отдельные части с общим краем, без зазора (`K`, Shift — 45°) |
| **Свободная трансформация** | `Ctrl+T`, как в Photoshop: рамка с маркерами, стрелки двигают на 1 (Shift — на 10). Углы и стороны масштабируют (Shift — пропорции, Alt — от центра), за рамкой поворот (Shift — по 15°), внутри перемещение. Точные %, ° в панели параметров; Enter — применить, Esc — отмена |
| **Линейки и направляющие** | `Ctrl+R`, как в Photoshop: линейки в единицах шрифта. Тяните из линейки, чтобы создать направляющую, обратно на линейку, чтобы удалить; двойной щелчок задаёт точное значение. К направляющим прилипают точки и фигуры, они сохраняются в `.sp` |
| **Кернинг** | Режим «Кернинг» (`Ctrl+K`): печатайте строку прямо в окне, курсор между буквами выбирает пару. `Alt+←/→` — ±10, `Alt+Shift+←/→` — ±1, можно тянуть мышью или вписать число. Список всех пар с поиском. В шрифт записывается `GPOS` и `kern` |
| **Операции с контурами** | Объединить, вычесть верхнюю, пересечение, исключить, разделить, убрать перекрытия, как в векторных редакторах |
| **Трансформации** | Масштаб, поворот, наклон, отражение для выделенных точек или целых букв |
| **Метрики** | Отступы слева/справа и ширина числами, «ровные отступы» одной кнопкой |
| **Просмотр** | Любой текст вашим шрифтом в реальном времени; недорисованные буквы приглушены |
| **Экспорт** | `.ttf` и `.otf`, устанавливаются в Windows, macOS и Linux |
| **Языки** | Русский и английский |

### Модификаторы, как в Illustrator и Figma

| Клавиша | Что делает |
|---|---|
| `Shift` | Прямые линии и углы, кратные 45°: перо, перетаскивание точек и усов, прямой мазок кистью, квадрат и круг |
| `Ctrl` / `Alt` + тянуть ус | Двигается только этот ус: с одной стороны точки кривая, с другой нет |
| `Ctrl` / `Alt` + щелчок по усу | Ус удаляется: эта сторона точки становится острой, другая остаётся скруглённой |
| `Ctrl` / `Alt` + щелчок по точке | Острый угол с обеих сторон |
| Перо: щелчок по последней точке | Острый выход из скруглённой точки; протяжка с `Ctrl`/`Alt` задаёт только исходящий ус |
| Двойной щелчок по точке / линии | Переключить «гладкая / угловая» / добавить точку |

Работа автоматически сохраняется, так что случайно закрытое окно ничего не испортит.

## Файлы `.sp`: делитесь проектами

Проект хранится в файле **`.sp`**. Это обычный текст (JSON), поэтому его можно:

- **отправить другу**: он откроет файл кнопкой «Открыть» или просто перетащит его в окно;
- **открыть двойным щелчком**: назначьте `spline` программой для файлов `.sp`
  (или запустите `spline мой-шрифт.sp`), тогда «Сохранить» будет записывать прямо в этот файл;
- **взять буквы из чужого проекта**: «Взять буквы из другого файла .sp» добавит их в ваш шрифт;
- **копировать буквы**: выделите буквы, нажмите `Ctrl+C`, откройте другой проект и нажмите `Ctrl+V`.
  Можно даже отправить скопированный текст в мессенджере.

Пример: [examples/hello.sp](examples/hello.sp).

<details>
<summary>Формат файла .sp</summary>

```json
{
  "format": "spline",
  "version": 1,
  "info": { "familyName": "Мой шрифт", "styleName": "Regular", "unitsPerEm": 1000,
            "ascender": 800, "descender": -200, "xHeight": 500, "capHeight": 700 },
  "glyphs": [
    { "name": "A", "unicode": 65, "advance": 620, "color": "green",
      "contours": [ { "closed": true, "nodes": [
        { "x": 0, "y": 0 },
        { "x": 300, "y": 700, "in": { "x": 250, "y": 700 }, "out": { "x": 350, "y": 700 }, "smooth": true }
      ] } ] }
  ]
}
```

- Координаты в единицах шрифта (1000 на кегль), ось Y смотрит вверх, базовая линия `y = 0`.
- `nodes` — опорные точки; `in`/`out` — абсолютные координаты «усиков» кривой Безье.
  Если у соседних точек нет `out`/`in`, между ними прямая линия.
- Направление контуров не важно: Spline сам решает, где заливка, а где дырка.
</details>

## Горячие клавиши

| Клавиша | Действие |
|---|---|
| `V` `P` `B` `E` `R` `O` `K` `H` | Выбор, перо, кисть, ластик, прямоугольник, эллипс, нож, рука |
| `Ctrl+R` / `Ctrl+;` | Линейки / показать направляющие |
| `Ctrl+K` | Кернинг (`Alt+←/→` ±10, `Alt+Shift+←/→` ±1) |
| `Ctrl+T` | Свободная трансформация (в окне программы; в браузере — меню «Правка») |
| `F1` | Список горячих клавиш |
| `F9` / `F10` | Привязка к сетке / к линиям |
| `Ctrl+Alt+U` `M` `I` `E` `D` `O` | Объединить, вычесть, пересечь, исключить, разделить, убрать перекрытия |
| `Пробел` (зажать) | Двигать холст |
| `Ctrl+Z` / `Ctrl+Shift+Z` (или `Ctrl+Y`) | Отменить / повторить |
| Стрелки (`Shift` — по 10) | Сдвинуть выбранные точки |
| `Delete` | Удалить точки |
| `PageUp` / `PageDown` | Соседняя буква |
| `Esc` | Назад ко всем буквам |
| `Ctrl+S` / `Ctrl+Shift+S` | Сохранить / сохранить как |
| `Ctrl+O` | Открыть |

Сочетания работают при любой раскладке, в том числе русской.

## Как это устроено

```
spline (один исполняемый файл на Go)
├── main.go               локальный сервер 127.0.0.1:7878
├── window_windows.go     окно программы на WebView2 (Windows)
├── window_other.go       окно Chrome/Edge в режиме приложения (macOS, Linux)
├── internal/project      формат .sp: чтение и проверка
├── internal/fontgen      сборка шрифта: TrueType (glyf) и OpenType/CFF
└── web/                  интерфейс (HTML/CSS/JS без сборки), встроен через go:embed
    ├── js/trace.js       кисть: растр → контур → подгонка кривых Безье
    ├── js/svg.js         импорт SVG (пути, фигуры, дуги, трансформации)
    ├── js/boolean.js     операции с контурами (на Paper.js)
    └── vendor/           Paper.js, встроен в программу (работает офлайн)
```

- Сервер слушает только `127.0.0.1` и не принимает запросы от других сайтов.
- Никаких внешних зависимостей во время работы, всё работает офлайн.
- Дизайн интерфейса описан в [design-system/spline/MASTER.md](design-system/spline/MASTER.md).

### Разработка

```bash
go run . --dev        # интерфейс читается с диска, правки видны после обновления страницы
go test ./...         # проверка сборки шрифтов
```

Флаги: `--browser` (открыть в обычном браузере), `--port 7878`, `--no-browser` (только сервер), `--dev`.

Собрать Windows-версию без консольного окна:

```bash
go build -ldflags "-H=windowsgui" -o spline.exe .
```

Идеи и исправления приветствуются: открывайте issue или pull request.

---

## English

**Spline** makes font creation lightweight: a simple font editor with a professional dark workspace, inspired by Glyphs and FontForge.

- Download a binary from [Releases](https://github.com/GeekFreak01/spline/releases) and run it: the editor opens in its own window (WebView2 on Windows, a Chrome/Edge app window on macOS/Linux, the browser as a fallback).
  Or run `go run github.com/GeekFreak01/spline@latest`.
- Draw letters with the **brush** (strokes become smooth Bézier curves), **eraser**, **pen**, **rectangle** and **ellipse**.
- **Import SVG** from Illustrator/Figma/Inkscape (menu, drag & drop, or paste SVG code); `A.svg` / `uni0416.svg` go to the matching glyph.
- Standard modifiers: **Shift** constrains to 45°, **Ctrl/Alt** breaks or removes one handle (curved on one side, sharp on the other).
- Transformations (scale, rotate, slant, flip), sidebearing metrics, dark and light themes.
- Exact coordinates of points, handles and shapes; configurable grid with snapping to grid intersections (F9) and guide lines (F10).
- Photoshop-style rulers (Ctrl+R) with draggable guides saved in the project.
- Knife tool (K) and Photoshop-style free transform (Ctrl+T: scale, rotate, move with exact values; arrow keys nudge).
- Kerning view (Ctrl+K): type a line, Alt+arrows adjust the pair at the cursor; exported as GPOS and kern tables.
- Path operations: unite, subtract, intersect, exclude, divide, remove overlap. Brush strokes are merged by vector union, so the rest of the outline keeps its curves.
- A faint **guide letter** helps you trace; the **preview** shows your real font as you draw.
- **Download font** exports `.ttf` (TrueType) or `.otf` (OpenType/CFF).
- Projects are plain-JSON **`.sp` files**: send them to friends, open them by double-click (`spline file.sp`),
  drag & drop them into the window, import letters from another project, or copy/paste letters with `Ctrl+C`/`Ctrl+V`.
- Interface in Russian and English.

Development: `go run . --dev`, tests: `go test ./...`.

## Лицензия / License

[MIT](LICENSE). Иконки: [Lucide](https://lucide.dev) (ISC). Окно на Windows: [go-webview2](https://github.com/jchv/go-webview2) (MIT). Операции с контурами: [Paper.js](http://paperjs.org) (MIT).
