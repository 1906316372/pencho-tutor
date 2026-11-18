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
- One block per reply (tutor mode only): for Check, Hint, Explain, Practice, typed questions (Ask) and the automatic replies, `src/server/tutor-layout.js` merges the model's `write_text` and `draw_formula` commands into one text block. Formulas become inline `$...$`, chained steps are split one per line, plain-text math such as `2(1)-3(-5)=17` is typeset, the font size comes from the student's viewport (about 52 characters across the screen), and the width fits the longest line. `modelInput.tutorReplyFormat` asks the model for this format in the first place. The client renders such a block with the mixed-text renderer.
- Colour and size by importance (tutor replies only): the server marks each line's role and the client styles it. The verdict line is 1.18× and bold, green for ✓, red for ✗, amber otherwise; the phrase to notice (`**...**`, or an automatic 「第 N 行/步」 and the 「提示：」 label) is bold orange; a verification or side remark (验算 / 注 …) is 0.86× and grey; body text keeps the user's AI colour. Code: `emphasize` in `src/server/tutor-layout.js`, `TUTOR_TONE` in `src/client/app/ai-runtime.js`.
- Tests: `test/tutor-layout.test.js` (8 pass).

**Staged Check, strike tool (tutor mode only, 2026-11-11):**
- Check no longer gives the correction straight away. The first three checks on a page only guide (see the note below for what each says) — never a corrected step or the result. The next check shows the full correction. Each reply ends with a line such as 「第 2/3 次检查」. The count is per tablet address and page, kept in memory; `PENECHO_TUTOR_CHECK_LIMIT` changes the 3. Code: `checkPrompt` / `checkFooter` in `src/server/tutor-layout.js`, the counter in `src/server/main.js`; the client sends the page id as `tutorPage`.
- The `ai` log line now also carries `suggestion`, and for a check `tutorCheck` and `tutorCheckLimit` (since 2026-11-14 every tutor request also logs `tutorPage`, `tutorKind` and `tutorReply`; see below).
- Strike tool: a button after the eraser in the bottom dock draws a straight red line (it reuses the line shape tool). Every tutor request carries `modelInput.tutorStrikePolicy`: struck-out writing is withdrawn, not an error. Check and Hint stay available while the tool is on. Code: `src/client/app/smart-suggestions.js`, style in `public/studio-shell.css`.
- Fix: the rules that hide the PenEcho Agent entry points were injected as a style element, which the page's Content Security Policy blocked, so the Agent button was still visible (the socket was already refused). They are now in `public/studio-shell.css` under `:root[data-tutor-mode]`.
- After the first tablet test (same day): the guided checks now only say where to look, in one short sentence (rough part → two neighbouring lines → the line), never what kind of mistake it is. A tutor reply's size is chosen on the client from the student's handwriting (`tutorInkHeight`: 0.55 × the 80th-percentile stroke height, kept between about 15 and 26 screen px) and its width from `tutorWidthEm`; some requests report the whole 20000-unit canvas as `visibleRect`, which had produced enormous text. Shape-tool fix (also affects upstream's shape tools): the pointer of a finished shape gesture was never released, so after a finger-drawn line the next touch counted as a second finger and zoomed the canvas (`releaseShapePointer` in `src/client/app/ui-bootstrap.js`); a pen-drawn shape now also rejects the palm.
- Full suite: 3079/3121 pass; the 36 failures are Windows symlink / fsync permissions, the missing `elkjs` dev dependency, line-ending and time-zone checks, and one check that the Agent socket is open (closed on purpose in tutor mode).

**Student view (tutor mode only, 2026-11-11):**
- A tablet (any address other than localhost) gets a reduced interface; the teacher's computer opened as `localhost` keeps everything, and `?student=1` previews the student view there.
- Hidden: Share, Cloud, the welcome examples, the automatic tour and what's-new dialog, the AI settings cluster (Auto AI, effort, AI colour), and the dock's view-mode, lasso, text, shapes, image and clipboard tools; in the More menu: Notes & cards, examples, Export PNG, Paste.
- Kept: hand, pen, eraser, strike, ink colour and size, undo/redo, zoom, the canvas list, MCP status, Settings.
- Removed (since 2026-11-14): every way to add or close a page (New canvas in the top bar, the More menu, the navigator, the history panel and the shortcut; closing a page). The teacher's bridge makes one page per question; the student moves between them with the dots in the Question window. `openNewCanvasDialog` and `requestCanvasTransition` refuse in the student view (`src/client/app/persistence.js`); the entry points are hidden under `:root[data-tutor-student]`.
- The suggestion bar's overflow offers only Explain and Practice besides Check and Hint (in every tutor-mode view). Next step, which writes the next line of the solution, is no longer offered.
- Code: `tutorStudentUi` in `src/client/app/core.js`, the tutor block in `src/client/app/smart-suggestions.js`, rules under `:root[data-tutor-student]` in `public/studio-shell.css`.

### Student windows

On a student's tablet the canvas is the answer area; three windows float above it (on screens wider than 700 px the top bar is gone as well).

- **Question**: the question of the current page, shown at a fixed reading size. It stays on screen while the student pans or zooms the canvas. The corner handle changes its width.
- **Menu**: the page list (tap to switch), the MCP link status, Settings, Fullscreen, the status line, and Keep / Discard while AI drafts are pending.
- **AI** (since 2026-11-14): every AI reply of the current page; see the next section.
- All three are dragged by the title bar, fold to the title bar on a tap, and remember their place per tablet (`localStorage`, `penecho.tutor.windows`).
- The question comes from the page's `context.md` (since 2026-11-15): the bridge writes it there with `penecho_patch_file`, first line `<!-- tutor-question -->`; nothing is drawn on the canvas. The window typesets it with the mixed-text renderer (`tutorQuestionContext`). Older pages: the first text object an MCP client created on the page (`tutorNoteQuestion`).
- A student's tablet opens its workspace to the local MCP server by itself and re-opens it if it was switched off (`tutorAutoLink`); nobody has to tap Settings > MCP on each tablet. The teacher's localhost view is unchanged.
- Code: `src/client/app/tutor-windows.js`, rules under `.tutor-window` in `public/studio-shell.css`.

### AI replies go to the AI window, not onto the canvas (2026-11-14)

On a student's tablet nothing the AI says is written on the page, so the page holds only the question and the student's own continuous work.

- Every reply in the student view (Check, Hint, Explain, Practice, Ask, automatic) is taken out of the response before it is drawn (`tutorHintTake` in `src/client/app/tutor-windows.js`, called from `requestAI` in `src/client/app/ai-runtime.js`). No draft, no Keep / Discard, nothing in the undo history. A reply without any text (only marks or a widget) is still drawn as before.
- The AI window lists the replies of the current page, oldest first, each labelled 「第 2 次检查（共 3 次引导）」, 「第 1 次提示」, 「讲解」, 「练习题」, 「提问：…」 with the time, typeset with the same renderer as before (MathJax). A new reply unfolds the window and flashes. Kept per page on the tablet (`localStorage`, `penecho.tutor.hints`, 40 replies per page, 120 pages).
- The reply is filed under the page the request came from. The server now returns `tutor: {kind, page, check, limit}` with each tutor reply, and the `ai` log line carries `tutorPage`, `tutorKind` and `tutorReply` (the reply text, at most 1000 characters) for every tutor request. The log is how the teacher's bridge sees what the AI told each student; it stays on the teacher's computer (`~/.penecho/logs`). Upstream does not log model text.
- `practice` and `ask` were added to the replies `tutor-layout.js` merges into one block, so they come as one text too.
- The teacher's localhost view is unchanged (replies are drawn on the canvas).

### Colour and progress in the student windows

- The question window shows "question 3 of 8" and one dot per question: green when Check judged the page correct, amber when it was checked and is not right yet, grey when not checked yet, dashed when the page does not exist. A dot opens its page; since 2026-11-14 the bridge makes all pages of a lesson at the start, so every dot can be tapped from the first minute. The lesson and its size are read from the page title (`<topic> · 共 8 题 · 第 3 题`); results are kept per tablet (`penecho.tutor.results`).
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

### Question off the canvas, page clean-up, whole-page Check (2026-11-15)

- **Question**: every tutor AI request carries the page's question as `tutorQuestion` (from `context.md`, at most 3000 characters); the server keeps it in `canonicalPayload` and adds `modelInput.tutorQuestion` with a note that it is not on the canvas.
- **No jumping to other pages**: in the student view, MCP writes to another page never move the tablet there ("follow latest" is off, `noteStudioMcpContentUpdate` in `src/client/app/studio-navigator.js`), and "N new items · open" is hidden. The dots row keeps its place even when empty, is rebuilt only when this lesson's pages change, and a tap within 600 ms after the dots or the page list were rebuilt is ignored.
- **Old pages**: the bridge renames pages of earlier lessons. `[已归档] …` = the student may delete it: a ✕ beside it in the Menu window's page list, two taps (no `window.confirm`, which would block the MCP link). `[待删除] …` = deleted at once (checked every 2 s): the teacher's clean-up, or room for a new lesson on a full tablet. Pages that are not lesson pages (the student's own) may be deleted too; the page on screen and the current lesson's pages may not. Deleting removes the page from IndexedDB (`tutorDeletePage`). With fewer than 8 of the 64 page slots free, the Menu window says so.
- **Whole-page Check and Hint**: in the student view both send the bounding box of everything on the page as the target (`tutorWholePageBox` in `smart-suggestions.js`, with `captureWholeInput`), instead of only the strokes written since the last request with the rest dimmed. Large pages are sent at lower resolution (the image stays within 2048 × 1536). The check prompt says "all of the student's work on the page".
- **Hint gives no step away**: Hint is no longer exempt from `TUTOR_POLICY`, and in tutor mode its `actionMeaning` is `TUTOR_LAYOUT.HINT_PROMPT` (name the rule or the place to look; never a transformed expression, value or the next line).
- **A Check/Hint is not cancelled by more writing or a page switch once the request has been sent** (2026-11-15; a page switch during the short preparation before sending still cancels it). While a Check/Hint from another page is still waiting, the Check/Hint bar on the new page appears only after that reply arrives (one request at a time): in the student view `supersedeActiveAI` ignores `user-input-started` and `recognition-invalidated` while every live request is manual; the reply goes to the AI window under the page it was asked on (`tutorHintTake` runs before the stale-page check), and the request's ink is consumed only if the student is still on that page and has not written since. A reply with only drawings is not drawn either (the AI window says so). `tutorDeletePage` runs once per page at a time, so a double tap or the purge cannot write a deleted page back.
- **Back on the lesson page after reopening** (2026-11-15): in the student view the active page is also kept in `localStorage` (`penecho.tutorActivePage`, written in `canvasDocumentsRememberActive`, never for an untitled page; read in `canvasDocumentsStartDraft` only when the tab's sessionStorage has nothing), so closing the tab or the browser brings the student back to the page they were on. Empty untitled pages that are not on screen (`tutorBlankUntitled`: no ink, objects, context or history) are deleted by `tutorPurgePages` with the "[待删除]" pages.
- **Student-view fixes** (2026-11-16):
  - The navigator's "…" menu (close others / close all) and the per-row close are hidden in the student view; a close the student view refuses now calls the transition's `onCancel`, so the menu is not left disabled.
  - `vh` fallbacks before the `dvh` heights of the windows (WebView < 108).
  - The question window's cache key is the text itself, not its length.
  - Questions longer than `TEXT_INPUT_MAX_LENGTH` are shown as plain text instead of being cut by the typesetter.
  - The typeset question uses `box-sizing:border-box` and a floored width, so it no longer overflows sideways.
  - The Menu window shows canvas errors (`canvasDocuments.error`).
  - The `ai` log line's `tutorReply` falls back to the raw `write_text` / `draw_formula` texts when no layout block was made.
