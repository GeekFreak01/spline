<p align="center"><img src="assets/logo.svg" width="128" alt="Spline"></p>

<h1 align="center">Spline</h1>

<p align="center"><a href="README.md">Русский</a> · <b>English</b></p>

**Lightweight font creation.**
Draw letters with a brush or a pen, import SVG and export a ready TTF/OTF font without a long learning curve.

> The code was written almost entirely with the help of AI.

![Glyph overview](docs/screenshots/en/glyphs.png)

| Outline editor | Kerning |
|---|---|
| ![Editor](docs/screenshots/en/editor.png) | ![Kerning](docs/screenshots/en/kerning.png) |
| **Panels: on top, on the left, as an icon and floating** | **Keyboard shortcuts (F1), reassignable** |
| ![Panels](docs/screenshots/en/panels.png) | ![Keyboard shortcuts](docs/screenshots/en/keys.png) |

<sub>The screenshots show the demo project [examples/demo.sp](examples/demo.sp), built from the outlines of the open Go Regular font (© The Go Authors, BSD-style license) with `go run ./tools/mkdemo`.</sub>

Ideas come from [Glyphs](https://glyphsapp.com) and [FontForge](https://github.com/fontforge/fontforge),
but everything is kept as simple as possible: one program file, nothing to set up, its own window without a browser.

---

## Getting started

**Windows (recommended):** download **`Spline-Setup-<version>.exe`** from [Releases](https://github.com/GeekFreak01/spline/releases/latest) and run it. The installer asks where to install and for whom (just you, without administrator rights, or all users), creates shortcuts and associates `.sp` files with Spline. Uninstall it from Settings → Apps.

**Without installing (portable)** or on macOS / Linux:

1. Download the program for your system from [Releases](https://github.com/GeekFreak01/spline/releases):
   - Windows: `spline-windows-amd64.exe`
   - macOS: `spline-macos-arm64` (Apple M1/M2/M3) or `spline-macos-amd64` (Intel)
   - Linux: `spline-linux-amd64`
2. Double-click it. The editor window opens.
   - **Windows 10/11**: the program's own window (WebView2 engine, built into Windows), no browser and no console.
   - **macOS / Linux**: a separate Chrome or Edge window in app mode, without tabs or an address bar.
   - If neither is available, the editor opens in your regular browser.
3. To quit, just close the window.

> Windows may show "Windows protected your PC": click "More info" → "Run anyway".
> On macOS, the first time: right-click the file → "Open". On Linux/macOS: `chmod +x spline-*`.

### Updates

Spline checks once a day whether a new version is out (and on Help → Check for Updates). If there is one, the status bar shows "Version … available". A click on it opens the latest release on GitHub: download `Spline-Setup-<version>.exe` and run it, it installs over the old version in the same folder. When you already have the latest version, the badge is not shown.

### Icon for `.sp` files (Windows)

Menu **File → Associate .sp Files with Spline**: project files get the Spline icon and the "Spline project" type, and open with a double-click. The change is made only for your Windows user, no administrator rights are needed. If you moved `spline.exe` to another folder, choose the command again.

### Build it yourself

You need [Go](https://go.dev/dl/) 1.22 or newer:

```bash
go run github.com/GeekFreak01/spline@latest
```

or from source:

```bash
git clone https://github.com/GeekFreak01/spline
cd spline
go run .
```

## Features

| | |
|---|---|
| **Interface** | A dark workspace like Photoshop/Glyphs: menus, options bar, tools, docked panels on the right, a status bar with coordinates. A light theme is available too |
| **Panels** | Like in Photoshop: drag a panel header and it becomes a floating window. Dock it to the right column, to the left of the work area, into the icon strip next to the right column (a click on the icon opens the panel), or on top, where Align and Path operations sit in one row. The place it will dock to is outlined while you drag. The **Window** menu shows and hides panels |
| **Glyph overview** | Sections by category, colour labels, Unicode codes, tile size, "drawn / not drawn" filters |
| **Brush and eraser** | Draw with a mouse or a stylus: the stroke turns into curves and is merged into the outline by a vector union (the eraser subtracts), the rest of the outline does not change. The stabilizer removes hand jitter |
| **Pen** | Bézier curves: a click places a corner, a drag makes a curve |
| **Rectangle and ellipse** | A shape inside another shape becomes a hole (like in "O") |
| **SVG import** | From Illustrator, Figma, Inkscape: File → Import SVG, drag and drop into the window, or paste SVG code (`Ctrl+V`). Fills are converted exactly, drawings made of strokes are traced into outlines. Files named `A.svg`, `uni0416.svg`, `Ж.svg` go to the matching glyphs automatically |
| **Exact coordinates** | The Selection panel: X/Y of a point and its handles, or X, Y, width and height of the selected shapes (optionally keeping proportions). The size of a shape is shown while drawing |
| **Grid and snapping** | Adjustable grid step, major lines every 5 steps. Snapping to grid intersections (`F9`) and to guide lines: baseline, x-height, cap height, ascender, descender, sidebearings (`F10`) |
| **Knife** | Draw a line across a shape and the outline is cut into separate pieces sharing the same edge, without a gap (`K`, Shift for 45°) |
| **Free transform** | `Ctrl+T`, like in Photoshop: a box with handles, arrow keys move by 1 (Shift by 10). Corners and sides scale (Shift keeps proportions, Alt scales from the centre), outside the box rotates (Shift in 15° steps), inside moves. Exact %, ° in the options bar; Enter applies, Esc cancels |
| **Rulers and guides** | `Ctrl+R`, like in Photoshop: rulers in font units. Drag out of a ruler to create a guide, drag it back onto the ruler to delete it; double-click sets an exact value. Points and shapes snap to guides, and guides are saved in the `.sp` file |
| **Kerning** | The Kerning view (`Ctrl+K`): type a line right in the window, the cursor between two letters picks the pair. `Alt+←/→` by ±10, `Alt+Shift+←/→` by ±1, or drag with the mouse or type a number. A list of all pairs with search. The font gets `GPOS` and `kern` tables |
| **Kerning groups** | Kerning classes, like in Glyphs: every glyph has a left and a right side group (for example A, À, А in group `A`). One rule `@A — @V` works for all glyphs of the groups; a single glyph can get an exception (including "0"). Priority: glyph+glyph, glyph+group, group+glyph, group+group. "Groups from base letter" sets groups in one click The Kerning groups window shows all groups as cards, letters are moved with the mouse. "Find groups by shape" compares letter edges and proposes groups. "Suggest kerning" proposes values for the pairs of the line: accept or skip them. |
| **Alternates and ligatures** | For script and handwriting fonts: an alternate (another shape of a letter, e.g. an “o” with another connection) takes its place when the right letters stand before or after it. A ligature replaces several letters in a row with one shape. The font gets the standard OpenType features `calt` and `liga`, applied by browsers, Word, Figma and Photoshop right away |
| **Align** | Left, right, top, bottom, centres and both centres at once; distribute three or more shapes with equal gaps. Relative to the selection, a key object (click a selected shape again, like in Illustrator) or the glyph frame |
| **Path operations** | Unite, subtract front, intersect, exclude, divide, remove overlap, like in vector editors |
| **Transformations** | Scale, rotate, slant, flip for the selected points or whole glyphs. Values are live: a field shows the result relative to the original outline (150 % then 120 % gives 120 %, not 180 %), Reset puts it back |
| **Metrics** | Left/right sidebearings and width as numbers, "even sidebearings" in one click |
| **Preview** | Any text in your font in real time; glyphs that are not drawn yet are dimmed |
| **Export** | `.ttf` and `.otf`, installable on Windows, macOS and Linux |
| **Languages** | Russian and English |

### Modifiers, like in Illustrator and Figma

| Key | What it does |
|---|---|
| `Shift` | Straight lines and 45° angles: pen, dragging points and handles, a straight brush stroke, square and circle |
| `Ctrl` / `Alt` + drag a handle | Only this handle moves: one side of the point is curved, the other is not |
| `Ctrl` / `Alt` + click a handle | The handle is removed: this side of the point becomes sharp, the other stays round |
| `Ctrl` / `Alt` + click a point | Sharp corner on both sides |
| Pen: click the last point | A sharp exit from a round point; dragging with `Ctrl`/`Alt` sets only the outgoing handle |
| Double-click a point / a line | Toggle smooth / corner / add a point |

Your work is saved automatically, so an accidentally closed window loses nothing.

## `.sp` files: share your projects

A project is stored in a **`.sp`** file. It is plain text (JSON), so you can:

- **send it to a friend**: they open it with the Open button or simply drag it into the window;
- **open it with a double-click**: make `spline` the program for `.sp` files
  (or run `spline my-font.sp`), then Save writes straight back to that file;
- **take letters from someone else's project**: "Import Glyphs from .sp" adds them to your font;
- **copy letters**: select glyphs, press `Ctrl+C`, open another project and press `Ctrl+V`.
  You can even send the copied text in a messenger.

Example: [examples/hello.sp](examples/hello.sp).

<details>
<summary>The .sp file format</summary>

```json
{
  "format": "spline",
  "version": 1,
  "info": { "familyName": "My Font", "styleName": "Regular", "unitsPerEm": 1000,
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

- Coordinates are in font units (1000 per em), the Y axis points up, the baseline is `y = 0`.
- `nodes` are anchor points; `in`/`out` are absolute positions of the Bézier handles.
  If neighbouring points have no `out`/`in`, the segment between them is a straight line.
- Contour direction does not matter: Spline decides itself what is filled and what is a hole.
- `kernLeft` / `kernRight` of a glyph are its left and right side kerning groups.
  In `kerning`, a key `@name` means a group: `"kerning": { "@A": { "@V": -70 }, "T": { "@o": -80 } }`.
</details>

## Keyboard shortcuts

| Key | Action |
|---|---|
| `V` `P` `B` `E` `R` `O` `K` `H` | Select, pen, brush, eraser, rectangle, ellipse, knife, hand |
| `Ctrl+R` / `Ctrl+;` | Rulers / show guides |
| `Ctrl+K` | Kerning (`Alt+←/→` ±10, `Alt+Shift+←/→` ±1) |
| `Ctrl+T` | Free transform (in the app window; in a browser use the Edit menu) |
| `F1` | Keyboard shortcuts: list and reassign |
| `F9` / `F10` | Snap to grid / to guides |
| `Ctrl+Alt+U` `M` `I` `E` `D` `O` | Unite, subtract, intersect, exclude, divide, remove overlap |
| `Space` (hold) | Pan the canvas |
| `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) | Undo / redo |
| Arrows (`Shift` for 10) | Move the selected points |
| `Delete` | Delete points |
| `PageUp` / `PageDown` | Neighbouring glyph |
| `Esc` | Back to all glyphs |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / save as |
| `Ctrl+O` | Open |

Shortcuts work with any keyboard layout, including Russian. Any shortcut can be changed: Help → Keyboard Shortcuts (`F1`), click a shortcut and press a new one. In a browser, Ctrl+T, Ctrl+W and Ctrl+N belong to the browser: pick another shortcut or switch to full screen (`F11`).

## How it works

```
spline (a single Go executable)
├── main.go               local server 127.0.0.1:7878
├── window_windows.go     the program window on WebView2 (Windows)
├── window_other.go       a Chrome/Edge app window (macOS, Linux)
├── internal/project      the .sp format: reading and validation
├── internal/fontgen      font building: TrueType (glyf) and OpenType/CFF
└── web/                  the interface (HTML/CSS/JS, no build step), embedded with go:embed
    ├── js/trace.js       brush: bitmap → outline → Bézier curve fitting
    ├── js/svg.js         SVG import (paths, shapes, arcs, transforms)
    ├── js/boolean.js     path operations (on Paper.js)
    └── vendor/           Paper.js, bundled into the program (works offline)
```

- The server listens only on `127.0.0.1` and does not accept requests from other websites.
- No external dependencies at run time, everything works offline.
- The interface design is described in [design-system/spline/MASTER.md](design-system/spline/MASTER.md).

### Development

```bash
go run . --dev        # the interface is read from disk, changes show up after a page reload
go test ./...         # font building tests
```

Installer: `installer/spline.iss` (Inno Setup 6), built automatically for every release; locally run `iscc /DAppVersion=1.0.0 installer\spline.iss` after building `dist/spline.exe`.

The icons (`assets/logo.svg`, `assets/file.svg`) are embedded into `spline.exe` with `go generate` (it creates `rsrc_windows_*.syso`).

Flags: `--view "#kern"` / `--view "#glyph=A"` (open a view right away), `--browser` (open in the regular browser), `--port 7878`, `--no-browser` (server only), `--dev`.

Build the Windows version without a console window:

```bash
go build -ldflags "-H=windowsgui" -o spline.exe .
```

Ideas and fixes are welcome: open an issue or a pull request.

## License

[MIT](LICENSE). Icons: [Lucide](https://lucide.dev) (ISC). Windows window: [go-webview2](https://github.com/jchv/go-webview2) (MIT). Path operations: [Paper.js](http://paperjs.org) (MIT).
