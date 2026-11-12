# Tutor-mode fork of PenEcho

This repository is a **modified version of PenEcho**. It is licensed, like the original, under **AGPL-3.0-only** (see `LICENSE` and `NOTICE`).

- This fork: https://github.com/1906316372/pencho-tutor
- Upstream: https://github.com/penecho/penecho
- Base: commit `1339981` (identical to the npm release `penecho@1.4.2`)

It is not an official PenEcho release, and the PenEcho project neither sponsors nor endorses it (see `TRADEMARKS.md`). In tutor mode it presents itself to students as "课堂画布" (Classroom Canvas). Still upstream's, and to be replaced before wider distribution: the pen-nib logo, "PenEcho" inside Settings and in the upstream documentation kept in this repository, and the npm package name (this fork is not published to npm).

## Changes (2026-11-11)

**Tutor mode**, switched on with the environment variable `PENECHO_TUTOR_MODE=1`. It is set for the whole server, so a student's device cannot turn it off.

- After the student stops writing, the suggestion bar always shows **Check (检查)** and **Hint (提示)** as its first two actions. Upstream ranks these suggestions dynamically, so Check often did not appear.
- Actions that reveal the result to the student, **Answer (解答)** and **Solve (求解)**, are removed from the suggestion bar and its "More suggestions" list, including follow-up suggestions after an AI result.
- Files changed: `src/server/main.js` (exposes `tutorMode` in `/api/config.js`), `src/client/app/smart-suggestions.js` (bar logic), and `public/app.js` (built with `node scripts/build-client.js`).

**Other ways of getting an answer are also locked down (enforced on the server):**
- `/api/ai/command`: requests with suggestion `answer` / `solve` are refused (403).
- Every other request gets `modelInput.tutorPolicy`, which tells the model not to give the final answer, the remaining steps, or a complete solution, and to give a hint or a guiding question instead. This covers Auto AI, the magic ball, the AI menu, lasso, typed questions, and Explain / Continue.
- These keep their original behaviour: Check (`check_step`), Hint, Next step, Typeset, Practice, Note, Organize, and Plot.
- The PenEcho Agent panel is closed: its WebSocket `/api/canvas-agent/socket` is refused, and its entry points are hidden in the front end. Animate and Prototype depend on the Agent, so they are hidden from the suggestion bar as well.
**Layout (applies whether or not tutor mode is on):**
- The bottom toolbar (hand / pen / eraser …) now sits flush on the bottom edge of the screen. Upstream it floats 16px above the edge, and in portrait it rose even higher because it was centred against the taller side clusters. The zoom cluster and the AI cluster in the corners are bottom-aligned with it. The change is a block appended to the end of `public/studio-shell.css`. It needs no rebuild; refreshing the page is enough.

- In local tests, 129/130 pass. The one failure is a Windows symlink permission issue (`mcp-http-client-config.test.js`); it fails the same way on the unmodified upstream code and has nothing to do with this change.

**Telling tablets apart (tutor mode only, 2026-11-11):**
- Each browser keeps one stable canvas id in `localStorage` (`penecho.tutorDeviceId`). Upstream creates a new id on every page load, so a classroom tool could not recognise a student's tablet after a refresh. Opening two tabs in the same browser now replaces the older tab's connection.
- `penecho_list_canvases` also returns the tablet's LAN address (`ip`), so AI requests in the server log can be matched to a tablet.
- Files changed: `src/client/app/mcp-runtime.js`, `src/server/mcp/service.js`, `public/app.js` (rebuilt).
- MCP tests: 467/476 pass; the 6 failures are Windows symlink / file-mode checks that also fail on unmodified upstream.

**Readable AI replies (2026-11-11):**
- Text wrapping (always on): lines now break between Chinese characters instead of only at spaces, closing punctuation never starts a line, and a number stays with its measure word. Applies to AI text and to typed / MCP text boxes. Code: `breakUnits` in `public/mixed-text.js`, used by `layoutText` and `mixedTextImage` in `src/client/app/ai-runtime.js`.
- Inline math in text boxes (always on): a formula inside text is sized from MathJax's own metrics and sits on the text baseline; fractions are set full size. Upstream scaled every inline formula to the same height and centred it in the row. Standalone `draw_formula` objects are unchanged.
- One block per reply (tutor mode only): for Check, Hint, Explain and the automatic replies, `src/server/tutor-layout.js` merges the model's `write_text` and `draw_formula` commands into one text block. Formulas become inline `$...$`, chained steps are split one per line, plain-text math such as `2(1)-3(-5)=17` is typeset, the font size comes from the student's viewport (about 52 characters across the screen), and the width fits the longest line. `modelInput.tutorReplyFormat` asks the model for this format in the first place. The client renders such a block with the mixed-text renderer.
- Colour and size by importance (tutor replies only): the server marks each line's role and the client styles it. The verdict line is 1.18× and bold, green for ✓, red for ✗, amber otherwise; the phrase to notice (`**...**`, or an automatic 「第 N 行/步」 and the 「提示：」 label) is bold orange; a verification or side remark (验算 / 注 …) is 0.86× and grey; body text keeps the user's AI colour. Code: `emphasize` in `src/server/tutor-layout.js`, `TUTOR_TONE` in `src/client/app/ai-runtime.js`.
- Tests: `test/tutor-layout.test.js` (8 pass).

**Staged Check, strike tool (tutor mode only, 2026-11-11):**
- Check no longer gives the correction straight away. The first three checks on a page only guide (see the note below for what each says) — never a corrected step or the result. The next check shows the full correction. Each reply ends with a line such as 「第 2/3 次检查」. The count is per tablet address and page, kept in memory; `PENECHO_TUTOR_CHECK_LIMIT` changes the 3. Code: `checkPrompt` / `checkFooter` in `src/server/tutor-layout.js`, the counter in `src/server/main.js`; the client sends the page id as `tutorPage`.
- The `ai` log line now also carries `suggestion`, and for a check `tutorCheck`, `tutorCheckLimit` and `tutorPage`.
- Strike tool: a button after the eraser in the bottom dock draws a straight red line (it reuses the line shape tool). Every tutor request carries `modelInput.tutorStrikePolicy`: struck-out writing is withdrawn, not an error. Check and Hint stay available while the tool is on. Code: `src/client/app/smart-suggestions.js`, style in `public/studio-shell.css`.
- Fix: the rules that hide the PenEcho Agent entry points were injected as a style element, which the page's Content Security Policy blocked, so the Agent button was still visible (the socket was already refused). They are now in `public/studio-shell.css` under `:root[data-tutor-mode]`.
- After the first tablet test (same day): the guided checks now only say where to look, in one short sentence (rough part → two neighbouring lines → the line), never what kind of mistake it is. A tutor reply's size is chosen on the client from the student's handwriting (`tutorInkHeight`: 0.55 × the 80th-percentile stroke height, kept between about 15 and 26 screen px) and its width from `tutorWidthEm`; some requests report the whole 20000-unit canvas as `visibleRect`, which had produced enormous text. Shape-tool fix (also affects upstream's shape tools): the pointer of a finished shape gesture was never released, so after a finger-drawn line the next touch counted as a second finger and zoomed the canvas (`releaseShapePointer` in `src/client/app/ui-bootstrap.js`); a pen-drawn shape now also rejects the palm.
- Full suite: 3079/3121 pass; the 36 failures are Windows symlink / fsync permissions, the missing `elkjs` dev dependency, line-ending and time-zone checks, and one check that the Agent socket is open (closed on purpose in tutor mode).

**Student view (tutor mode only, 2026-11-11):**
- A tablet (any address other than localhost) gets a reduced interface; the teacher's computer opened as `localhost` keeps everything, and `?student=1` previews the student view there.
- Hidden: Share, Cloud, the welcome examples, the automatic tour and what's-new dialog, the AI settings cluster (Auto AI, effort, AI colour), and the dock's view-mode, lasso, text, shapes, image and clipboard tools; in the More menu: Notes & cards, examples, Export PNG, Paste.
- Kept: hand, pen, eraser, strike, ink colour and size, undo/redo, zoom, the canvas list, MCP status, Settings.
- Added: a "New canvas" button in the top bar (the way to the next question).
- The suggestion bar's overflow offers only Explain and Practice besides Check and Hint (in every tutor-mode view). Next step, which writes the next line of the solution, is no longer offered.
- Code: `tutorStudentUi` in `src/client/app/core.js`, the tutor block in `src/client/app/smart-suggestions.js`, rules under `:root[data-tutor-student]` in `public/studio-shell.css`.

### Student windows

On a student's tablet (screens wider than 700 px) the top bar is gone. The canvas is the answer area and fills the screen; two windows float above it.

- **Question**: the question of the current page, shown at a fixed reading size. It stays on screen while the student pans or zooms the canvas. The corner handle changes its width.
- **Menu**: the page list (tap to switch), New canvas, the MCP link status, Settings, Fullscreen, the status line, and Keep / Discard while AI drafts are pending.
- Both are dragged by the title bar, fold to the title bar on a tap, and remember their place per tablet (`localStorage`, `penecho.tutor.windows`).
- The question is the first text object an MCP client creates on a page (`tutorNoteQuestion`, called from `create_text`); the copy on the canvas is unchanged.
- A student's tablet opens its workspace to the local MCP server by itself and re-opens it if it was switched off (`tutorAutoLink`); nobody has to tap Settings > MCP on each tablet. The teacher's localhost view is unchanged.
- Code: `src/client/app/tutor-windows.js`, rules under `.tutor-window` in `public/studio-shell.css`.

### Colour and progress in the student windows

- The question window shows "question 3 of 8" and one dot per question: green when Check judged the page correct, amber when it was checked and is not right yet, grey when opened but not checked, dashed when not reached. A dot opens its page. The lesson and its size are read from the page title (`<topic> · 共 8 题 · 第 3 题`); results are kept per tablet (`penecho.tutor.results`).
- A correct Check plays a two-second green tick on the question window (`tutorNoteCheck`, called when a tutor reply arrives).
- The Menu window offers six accent colours (the built-in Studio palettes); title bars and buttons follow the choice.
- No ranking, points or decorative pictures: colour only carries state.

### Name, access code and source link (for handing the build to another teacher)

- With tutor mode on, the build shows its own name in the page title, the brand and the access page: "课堂画布", or `PENECHO_PRODUCT_NAME`. The pen-nib logo and "PenEcho" inside Settings are still the originals.
- `PENECHO_TUTOR_ACCESS_PIN` (six digits) fixes the access code at start-up, so no tablet can get in first and choose one.
- A Chinese-language device that never chose a language starts in Chinese (canvas and access page).
- The student Menu window always carries a source link ("基于 PenEcho 修改 · AGPL-3.0 · 源代码"); see the next section.

## Source code for users (AGPL §13)

Students use this modified version over the network, so they are offered its complete source code from inside the app: the link at the bottom of the Menu window.

- It points to `PENECHO_SOURCE_URL`, by default this repository (https://github.com/1906316372/pencho-tutor).
- If the build contains `public/source.zip`, the link downloads that file instead, so it also works in a classroom without internet access. A packaged build should include it.
- **If you change the code and let others use your version, publish your source and set `PENECHO_SOURCE_URL` to it** (or ship a matching `public/source.zip`). The default link is only correct for an unmodified copy of this repository.

## Build and start

Needs Node.js 22.19 or newer.

```sh
npm ci --omit=dev --ignore-scripts
node scripts/build-client.js
PENECHO_TUTOR_MODE=1 PENECHO_JEVISION_ENABLED=0 node cli.js
```

On Windows PowerShell:

```powershell
$env:PENECHO_TUTOR_MODE = "1"; $env:PENECHO_JEVISION_ENABLED = "0"; node cli.js
```

Then open http://localhost:3888 on the teacher's computer, and `http://<that computer's LAN address>:3888` on the tablets.

| Variable | Meaning |
|---|---|
| `PENECHO_TUTOR_MODE=1` | Turns everything in this file on. Without it the build behaves like upstream, apart from the changes marked "always on". |
| `PENECHO_JEVISION_ENABLED=0` | Keeps upstream's cloud suggestions off, so handwriting is not sent to penecho.ai. |
| `PENECHO_PRODUCT_NAME` | Name shown to students. Default "课堂画布". |
| `PENECHO_TUTOR_ACCESS_PIN` | Six digits. Fixes the access code; otherwise the first visitor after each start chooses it. |
| `PENECHO_TUTOR_CHECK_LIMIT` | Guided checks per page before the correction is shown. Default 3. |
| `PENECHO_SOURCE_URL` | Where the source link in the Menu window points. Default this repository. |
