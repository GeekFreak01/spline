# Spline

**Простой редактор шрифтов, в котором справится даже школьник.**
Нарисуй буквы кистью или пером, нажми «Скачать шрифт» и установи его на компьютер.

*A friendly font editor simple enough for school kids. [English below](#english).*

Идеи взяты из [Glyphs](https://glyphsapp.com) и [FontForge](https://github.com/fontforge/fontforge),
но всё сделано максимально просто: один файл программы, никакой установки.

---

## Как запустить

1. Скачайте программу для своей системы на странице [Releases](https://github.com/GeekFreak01/spline/releases):
   - Windows: `spline-windows-amd64.exe`
   - macOS: `spline-macos-arm64` (Apple M1/M2/M3) или `spline-macos-amd64` (Intel)
   - Linux: `spline-linux-amd64`
2. Запустите её. Редактор сам откроется в браузере.
3. Чтобы выйти, закройте чёрное окно программы.

> На macOS при первом запуске: правый клик по файлу → «Открыть».
> На Linux/macOS, возможно, понадобится `chmod +x spline-*`.

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
| **Кисть** | Рисуйте букву как кистью: линии сами превращаются в гладкие кривые |
| **Ластик** | Стирайте лишнее, кривые пересчитываются автоматически |
| **Перо** | Точные кривые Безье: щелчок ставит угол, протяжка делает плавную точку |
| **Квадрат и круг** | Готовые фигуры; фигура внутри другой фигуры становится дыркой (как в «О») |
| **Выбор** | Двигайте точки и «усики», двойной щелчок по линии добавляет точку |
| **Буква-подсказка** | Бледная буква на фоне, чтобы было по чему обводить |
| **Проверка шрифта** | Пишите любой текст и сразу видите свой шрифт; недорисованные буквы серые |
| **Скачать шрифт** | `.ttf` или `.otf`, которые устанавливаются в Windows, macOS и Linux |
| **Языки** | Русский и английский интерфейс |

Работа сохраняется в браузере автоматически, так что случайно закрытая вкладка ничего не испортит.

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
| `B` `E` `P` `V` `R` `O` `H` | Кисть, ластик, перо, выбор, квадрат, круг, рука |
| `Пробел` (зажать) | Двигать холст |
| `Ctrl+Z` / `Ctrl+Y` | Отменить / вернуть |
| Стрелки (`Shift` — по 10) | Сдвинуть выбранные точки |
| `Delete` | Удалить точки |
| `PageUp` / `PageDown` | Соседняя буква |
| `Esc` | Назад ко всем буквам |
| `Ctrl+S` | Сохранить |

## Как это устроено

```
spline (один исполняемый файл на Go)
├── main.go               локальный веб-сервер 127.0.0.1:7878 + открытие браузера
├── internal/project      формат .sp: чтение и проверка
├── internal/fontgen      сборка шрифта: TrueType (glyf) и OpenType/CFF
└── web/                  интерфейс (HTML/CSS/JS без сборки), встроен через go:embed
    └── js/trace.js       кисть: растр → контур → подгонка кривых Безье
```

- Сервер слушает только `127.0.0.1` и не принимает запросы от других сайтов.
- Никаких внешних зависимостей во время работы (кроме шрифтов интерфейса из Google Fonts, без них тоже работает).
- Дизайн интерфейса описан в [design-system/spline/MASTER.md](design-system/spline/MASTER.md).

### Разработка

```bash
go run . --dev        # интерфейс читается с диска, правки видны после обновления страницы
go test ./...         # проверка сборки шрифтов
```

Флаги: `--port 7878`, `--no-browser`, `--dev`.

Идеи и исправления приветствуются: открывайте issue или pull request.

---

## English

**Spline** is a font editor for kids and beginners, inspired by Glyphs and FontForge.

- Download a binary from [Releases](https://github.com/GeekFreak01/spline/releases) and run it: the editor opens in your browser.
  Or run `go run github.com/GeekFreak01/spline@latest`.
- Draw letters with the **brush** (strokes become smooth Bézier curves), **eraser**, **pen**, **rectangle** and **ellipse**.
- A faint **guide letter** helps you trace; the **preview** shows your real font as you draw.
- **Download font** exports `.ttf` (TrueType) or `.otf` (OpenType/CFF).
- Projects are plain-JSON **`.sp` files**: send them to friends, open them by double-click (`spline file.sp`),
  drag & drop them into the window, import letters from another project, or copy/paste letters with `Ctrl+C`/`Ctrl+V`.
- Interface in Russian and English.

Development: `go run . --dev`, tests: `go test ./...`.

## Лицензия / License

[MIT](LICENSE). Иконки: [Lucide](https://lucide.dev) (ISC).
