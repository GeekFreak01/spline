<p align="center">
  <img src="assets/logo.svg" width="112" alt="Spline">
</p>

<h1 align="center">Spline</h1>

<p align="center">
  <b>Lightweight font creation.</b><br>
  Draw letters with a brush or a pen, import SVG, kern your pairs<br>
  and get a ready TTF/OTF font without a long learning curve.
</p>

<p align="center">
  <img alt="Go" src="https://img.shields.io/badge/100%25-Go-00add8?style=flat-square&logo=go&logoColor=white">
  <img alt="Windows · macOS · Linux · Web" src="https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux%20%C2%B7%20Web-one%20file-2f7bf5?style=flat-square">
  <a href="https://github.com/GeekFreak01/spline/releases/latest"><img alt="Version" src="https://img.shields.io/github/v/release/GeekFreak01/spline?style=flat-square&label=version&color=3a3a3a"></a>
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-3a3a3a?style=flat-square">
  <img alt="English and Russian" src="https://img.shields.io/badge/language-EN%20%C2%B7%20RU-d69e2e?style=flat-square">
</p>

<p align="center">
  <a href="https://github.com/GeekFreak01/spline/releases/latest"><img alt="Download for Windows" src="https://img.shields.io/badge/Download%20for%20Windows-1e62c8?style=for-the-badge&logo=windows&logoColor=white" height="40"></a>
  &nbsp;
  <a href="https://spline.geekfreak.tv"><img alt="Open in the browser" src="https://img.shields.io/badge/Open%20in%20the%20browser-2b2b2b?style=for-the-badge&logo=googlechrome&logoColor=white" height="40"></a>
</p>

<p align="center">
  <a href="README.md">Русский</a> · <b>English</b> ·
  <a href="https://github.com/GeekFreak01/spline/releases">All releases</a> ·
  <a href="examples/demo.sp">Demo project</a>
</p>

<br>

<p align="center">
  <img src="docs/screenshots/en/editor.png" alt="The outline editor: the letter R with points and handles, rulers, grid and font lines, the Glyph, Selection, Path operations and Align panels on the right, the text preview below" width="100%">
  <br>
  <sub>The outline editor: points, handles, rulers and font lines, docked panels and a live text preview.<br>
  Demo project <a href="examples/demo.sp">examples/demo.sp</a>, built from the outlines of the open Go Regular font (© The Go Authors, BSD-style license).</sub>
</p>

> [!NOTE]
> **The code was written almost entirely with the help of AI.** Ideas come from [Glyphs](https://glyphsapp.com) and [FontForge](https://github.com/fontforge/fontforge),
> but everything is kept as simple as possible: one program file, its own window without a browser, a project in one `.sp` file.

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#everything-in-the-box">Everything in the box</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#sp-files-share-your-projects">.sp files</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#how-it-works">How it works</a>
</p>

<br>

<table>
  <tr>
    <td width="25%" valign="top">
      <h3>🪶 Easy to start</h3>
      Familiar menus, tools and shortcuts from Photoshop, Illustrator and Glyphs. Download, open, draw: nothing to set up, nothing long to learn.
    </td>
    <td width="25%" valign="top">
      <h3>✍️ Brush and script</h3>
      Draw with a mouse or a stylus and the stroke becomes curves. Alternates and ligatures for handwriting fonts and their connections.
    </td>
    <td width="25%" valign="top">
      <h3>🔤 Kerning like Glyphs</h3>
      Pairs and groups, exceptions, groups found by letter shape and suggested values. You see who every rule affects.
    </td>
    <td width="25%" valign="top">
      <h3>📦 One file</h3>
      The program is a single Go executable that works offline. A project is a text <code>.sp</code> file, easy to send in a messenger.
    </td>
  </tr>
</table>

<br>

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/en/kerning.png" alt="Kerning view: the line AVATAR WAVY Typography LTYA, blue bars between letters show kerning, on the right the A V pair panel with Whole group or Only A" width="100%">
      <br>
      <sub>The kerning line: blue bars are pairs moved closer; on the right, whole group or this letter only.</sub>
      <h3>Kerning you can see</h3>
      Type text right in the window, the cursor between two letters picks the pair. <code>Alt+←/→</code> changes the value, or drag with the mouse. Bars between letters show the kerning: blue is tighter, yellow looser, red too tight.
      <br><br>
      Under each letter of the pair you see <b>who the value affects</b>: the whole group (with its letters) or this letter only. A list of all pairs with sorting, filters, Clean up and Compress. The font gets <code>GPOS</code> and <code>kern</code> tables.
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/en/groups.png" alt="The Groups by shape window: two columns for left and right sides of letters, each with group cards such as B D E F H K L M N P R U with Cyrillic Б В Г Е И К" width="100%">
      <br>
      <sub>Find groups by shape: Spline compared the edges of the letters and put similar ones together.</sub>
      <h3>Groups without the chores</h3>
      Kerning groups as in Glyphs: every letter has a left and a right side group, and one rule <code>@A — @V</code> works for all of them. The Kerning groups window shows them as cards, letters move with the mouse, a group can be renamed together with its pairs.
      <br><br>
      <b>Find groups by shape</b> compares the edges of the drawn letters and proposes groups. <b>Suggest kerning</b> proposes values for the pairs of the line, and you accept or skip them.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/en/variants.png" alt="Editing an alternate of the Cyrillic letter o: the Alternates and ligatures panel with the rule the letter after is блмн, the preview below" width="100%">
      <br>
      <sub>An alternate “o” for script: used instead of the main one before “б”, “л”, “м” or “н”.</sub>
      <h3>Alternates and ligatures for script</h3>
      An alternate is another shape of the same letter, for example an “o” with another connection. It takes its place by itself when the right letters stand before or after it. A ligature replaces several letters in a row with one shape.
      <br><br>
      The font gets the standard OpenType features <code>calt</code> and <code>liga</code>, applied right away by browsers, Word, Figma and Photoshop.
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/en/panels.png" alt="Panels in different places: Path operations and Align in a row on top, Transformations on the left, Font as an icon with its flyout open, Actions as a floating window" width="100%">
      <br>
      <sub>Panels on top, on the left, as an icon and floating.</sub>
      <h3>A workspace that fits you</h3>
      Like in Photoshop: drag a panel header and it becomes a window. Dock it on the right, on the left, into the icon strip (a click opens the panel) or on top, where Align and Path operations sit in one row.
      <br><br>
      The place it will dock to is outlined while you drag, and the layout is remembered. The <b>Window</b> menu shows and hides panels.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/en/keys.png" alt="The Keyboard Shortcuts window: commands grouped by File, Edit, Tools with their shortcuts; Free Transform has its own Alt+T" width="100%">
      <br>
      <sub>Keyboard shortcuts (F1): click a shortcut and press a new one.</sub>
      <h3>Shortcuts your way</h3>
      Any shortcut can be reassigned, even for commands that had none. A taken shortcut moves over, and menus and tooltips show the new keys right away.
      <br><br>
      Shortcuts work with any keyboard layout, including Russian. Modifiers like in Illustrator and Figma: <code>Shift</code> for 45°, <code>Ctrl</code>/<code>Alt</code> for a sharp corner.
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/en/glyphs.png" alt="The glyph overview: Latin and Cyrillic letters as tiles, categories, labels and progress on the left, the panel of the selected letter R on the right" width="100%">
      <br>
      <sub>Every letter of the font as a tile, with categories, labels and progress.</sub>
      <h3>The whole font at a glance</h3>
      Sections by category, colour labels, Unicode codes, drawn / not drawn filters. Sidebearings and groups can be changed right on the selected letters.
      <br><br>
      The live preview below sets any text in your font, letters not drawn yet are dimmed. Export to <code>.ttf</code> and <code>.otf</code>.
    </td>
  </tr>
</table>

## Everything in the box

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧰 Drawing</h3>
      Select · Pen (Bézier curves) · Brush with a stabilizer · Eraser · Rectangle · Ellipse · Knife · Hand · free transform <code>Ctrl+T</code> (scale, rotate, move, snapping) · path operations (unite, subtract, intersect, exclude, divide, remove overlap) · align and distribute relative to the selection, a key object or the glyph frame · exact coordinates of points and shapes · Simplify Outline removes extra points after the brush · underlay: drop a scan or photo of a letter and trace it · letters with diacritics (Й, Ё, À, é…) build themselves from the base letter and the mark.
    </td>
    <td width="50%" valign="top">
      <h3>📐 Grid, rulers, transformations</h3>
      Grid with an adjustable step and snapping (<code>F9</code>) · snapping to the font lines (<code>F10</code>) · rulers and guides <code>Ctrl+R</code>, like in Photoshop · transformations with live values: scale, rotate, slant from the baseline, flip · even sidebearings in one click.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🔁 Import and export</h3>
      SVG from Illustrator, Figma, Inkscape: as a file, by drag and drop or by pasting code (<code>Ctrl+V</code>); files named <code>A.svg</code>, <code>uni0416.svg</code>, <code>Ж.svg</code> go to their glyphs · glyphs from another <code>.sp</code> · a ready <code>.ttf</code>/<code>.otf</code> opens as a project · copying glyphs between projects · export to <code>.ttf</code> (TrueType) and <code>.otf</code> (CFF) with kerning, alternates and ligatures.
    </td>
    <td width="50%" valign="top">
      <h3>🪄 Comfort</h3>
      Autosave · undo and redo · its own window on Windows, no browser · dark and light themes · English and Russian · an icon and double-click for <code>.sp</code> files · font install into the system with one click · Cyrillic font names · an installer with a folder choice · a notice when a new version is out · also works as a website.
    </td>
  </tr>
</table>

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

**In the browser:** [spline.geekfreak.tv](https://spline.geekfreak.tv), nothing to install.

> [!TIP]
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

## `.sp` files: share your projects

A project is stored in a **`.sp`** file. It is plain text (JSON), so you can:

- **send it to a friend**: they open it with the Open button or simply drag it into the window;
- **open it with a double-click**: make `spline` the program for `.sp` files
  (or run `spline my-font.sp`), then Save writes straight back to that file;
- **take letters from someone else's project**: "Import Glyphs from .sp" adds them to your font;
- **copy letters**: select glyphs, press `Ctrl+C`, open another project and press `Ctrl+V`.
  You can even send the copied text in a messenger.

Example: [examples/hello.sp](examples/hello.sp). Your work is saved automatically, so an accidentally closed window loses nothing.

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
- `compose` marks a letter built from parts (`{ "base": "uni0418", "marks": ["breve"] }`), `composeOff` one drawn by hand;
  `image` is an underlay picture (not exported).
- `contextual` holds alternates: `{ "glyph": "o", "use": "o.alt", "prev": [], "next": ["b", "l"] }`;
  `ligatures` holds ligatures: `{ "glyphs": ["f", "i"], "use": "f_i" }`.
</details>

## Keyboard shortcuts

Shortcuts work with any keyboard layout, including Russian. Any of them can be changed: **Help → Keyboard Shortcuts** (`F1`), click a shortcut and press a new one. In a browser, Ctrl+T, Ctrl+W and Ctrl+N belong to the browser: pick another shortcut or switch to full screen (`F11`).

<details>
<summary>Default shortcuts</summary>

| Key | Action |
|---|---|
| `V` `P` `B` `E` `R` `O` `K` `H` | Select, pen, brush, eraser, rectangle, ellipse, knife, hand |
| `Ctrl+R` / `Ctrl+;` | Rulers / show guides |
| `Ctrl+K` | Kerning (`Alt+←/→` ±10, `Alt+Shift+←/→` ±1, `Alt+G` show group, `Ctrl+]` / `Ctrl+[` samples) |
| `Ctrl+T` | Free transform (`Ctrl+Z` inside cancels it) |
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
</details>

<details>
<summary>Modifiers, like in Illustrator and Figma</summary>

| Key | What it does |
|---|---|
| `Shift` | Straight lines and 45° angles: pen, dragging points and handles, a straight brush stroke, square and circle |
| `Ctrl` / `Alt` + drag a handle | Only this handle moves: one side of the point is curved, the other is not |
| `Ctrl` / `Alt` + click a handle | The handle is removed: this side of the point becomes sharp, the other stays round |
| `Ctrl` / `Alt` + click a point | Sharp corner on both sides |
| Pen: click the last point | A sharp exit from a round point; dragging with `Ctrl`/`Alt` sets only the outgoing handle |
| Double-click a point / a line | Toggle smooth / corner / add a point |
</details>

## How it works

```
spline (a single Go executable)
├── main.go               local server 127.0.0.1:7878
├── window_windows.go     the program window on WebView2 (Windows)
├── window_other.go       a Chrome/Edge app window (macOS, Linux)
├── internal/project      the .sp format: reading and validation
├── internal/fontgen      font building: TrueType (glyf) and OpenType/CFF, GPOS, GSUB
└── web/                  the interface (HTML/CSS/JS, no build step), embedded with go:embed
    ├── js/trace.js       brush: bitmap → outline → Bézier curve fitting
    ├── js/svg.js         SVG import (paths, shapes, arcs, transforms)
    ├── js/boolean.js     path operations (on Paper.js)
    ├── js/shape.js       letter profiles: groups by shape and kerning suggestions
    └── vendor/           Paper.js, bundled into the program (works offline)
```

- The server listens only on `127.0.0.1` and does not accept requests from other websites.
- No external dependencies at run time, everything works offline.
- The interface design is described in [design-system/spline/MASTER.md](design-system/spline/MASTER.md).

<details>
<summary>Development</summary>

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
</details>

Ideas and fixes are welcome: open an issue or a pull request.

## License

[MIT](LICENSE). Icons: [Lucide](https://lucide.dev) (ISC). Windows window: [go-webview2](https://github.com/jchv/go-webview2) (MIT). Path operations: [Paper.js](http://paperjs.org) (MIT).
