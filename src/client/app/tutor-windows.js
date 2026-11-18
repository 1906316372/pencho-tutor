  // ---------- Tutor windows (fork, student view) ----------
  // A student's tablet shows the canvas (the answer area) with three floating windows on top:
  //   Menu     - the page list, connection status, Settings, Fullscreen.
  //   Question - the question of the current page, with one numbered dot per question of the
  //              lesson (tap one to go to that question's page). It stays on screen while the
  //              student pans or zooms the canvas to find room to write.
  //   AI       - every AI reply of the current page (Check, Hint, Explain, Practice, Ask), in
  //              order and labelled ("第 2 次检查", "第 1 次提示"). Nothing the AI says is written
  //              on the canvas, so the page holds only the question and the student's own work.
  // Each window is dragged by its title bar, folded by tapping the bar, and remembers its place
  // on this tablet. The top bar they replace is hidden by studio-shell.css.
  const TUTOR_WINDOWS_KEY = "penecho.tutor.windows",
    TUTOR_QUESTIONS_KEY = "penecho.tutor.questions",
    TUTOR_RESULTS_KEY = "penecho.tutor.results",
    TUTOR_HINTS_KEY = "penecho.tutor.hints",
    // The bridge writes each question into its page's context.md (never drawn on the canvas),
    // first line this marker. Pages of an earlier lesson are renamed by the bridge: "[已归档] ..."
    // may be deleted by the student, "[待删除] ..." is deleted here right away (teacher's clean-up,
    // or room for a new lesson on a full tablet).
    TUTOR_QUESTION_MARK = "<!-- tutor-question -->",
    TUTOR_ARCHIVED = "[已归档]",
    TUTOR_DOOMED = "[待删除]",
    TUTOR_LOW_PAGES = 8,
    // Accent choices offered in the Menu window (names of the built-in Studio palettes).
    TUTOR_PALETTES = Object.freeze([["indigo", "#4f46e5"], ["azure", "#0284c7"], ["teal", "#0d9488"], ["forest", "#15803d"], ["amber", "#d97706"], ["rose", "#e11d48"]]),
    tutorWindows = { menu:null, question:null, hint:null, layout:{}, keys:{}, timer:0, hintImages:new Map(), rebuiltAt:0, purgeAt:0, purging:false };
  function tutorStored(key) {
    try { const value = JSON.parse(globalThis.localStorage?.getItem(key) || "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; }
  }
  function tutorStore(key, value) {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* private mode: the windows still work, they just forget */ }
  }
  // The bridge writes the question as the page's text object over MCP. Remember which object
  // it was, so an AI reply or the student's own text box is never mistaken for the question.
  function tutorNoteQuestion(documentId, objectId) {
    if (globalThis.PENECHO_CONFIG?.tutorMode !== true || !documentId || !objectId) return;
    const known = tutorStored(TUTOR_QUESTIONS_KEY);
    if (known[documentId]) return;
    known[documentId] = objectId;
    const ids = Object.keys(known);
    for (const id of ids.slice(0, Math.max(0, ids.length - 80))) delete known[id];
    tutorStore(TUTOR_QUESTIONS_KEY, known);
  }
  // A tutor reply that opens with a verdict is the result of Check on the current page:
  // "ok" once the work is judged correct, "try" while it is not. Kept per page on this tablet
  // so the progress dots keep their colour; a correct verdict also plays a short cheer.
  function tutorNoteCheck(text, page = "") {
    const verdict = /^\s*(?:##\s*)?([✓✗])/.exec(String(text || ""))?.[1], doc = page || canvasDocuments.activeId;
    if (!verdict || !doc) return;
    const now = Date.now(), last = tutorWindows.lastCheck;
    if (last && last.text === text && now - last.at < 3000) return;
    tutorWindows.lastCheck = { text, at:now };
    const results = tutorStored(TUTOR_RESULTS_KEY), ids = Object.keys(results);
    results[doc] = verdict === "✓" ? "ok" : "try";
    for (const id of ids.slice(0, Math.max(0, ids.length - 120))) delete results[id];
    tutorStore(TUTOR_RESULTS_KEY, results);
    tutorWindows.keys.steps = "";
    const win = tutorWindows.question?.win;
    if (verdict !== "✓" || !win || doc !== canvasDocuments.activeId) return;
    win.removeAttribute("data-cheer");
    void win.offsetWidth;
    win.setAttribute("data-cheer", "");
    clearTimeout(tutorWindows.cheerTimer);
    tutorWindows.cheerTimer = setTimeout(() => win.removeAttribute("data-cheer"), 2200);
  }
  // An AI reply on a student's tablet: keep its text for the AI window and take every command
  // out of the reply, so requestAI draws nothing on the canvas. Filed under the page the request
  // was sent from (the server echoes it), not the page showing when the reply arrives.
  // Returns null (the reply is drawn as usual) outside the student view or when it has no text.
  function tutorHintTake(data, options, action, automatic) {
    if (globalThis.PENECHO_CONFIG?.tutorMode !== true || typeof tutorStudentUi !== "function" || !tutorStudentUi()) return null;
    const commands = Array.isArray(data?.commands) ? data.commands : [], tool = command => command?.tool || command?.type || command?.name,
      block = commands.find(command => command?.tutorLayout === true && typeof command.text === "string"),
      text = String(block ? block.text : commands.map(command => tool(command) === "write_text" && typeof command.text === "string" ? command.text
        : tool(command) === "draw_formula" && typeof command.latex === "string" ? `$${command.latex}$` : "").filter(Boolean).join("\n")).trim().slice(0, 1000);
    // The student view never draws AI output: a reply with only drawings still leaves the canvas alone.
    if (!text && !commands.length) return null;
    const shown = text || tutorWindowText("(The AI replied with a drawing; it is not shown.)", "（AI 的回复是图形，这里不显示）");
    const info = data.tutor && typeof data.tutor === "object" ? data.tutor : {},
      page = String(info.page || canvasDocuments.activeId || ""),
      kind = String(info.kind || (automatic ? "auto" : options?.suggestion || action || "")),
      question = String(options?.question || options?.selectionQuestion || "").trim().slice(0, 200),
      entry = { kind, text:shown, at:Date.now(), ...(Number.isFinite(info.check) ? { check:info.check, limit:info.limit } : {}), ...(question ? { question } : {}) };
    data.commands = [];
    if (!page) return entry;
    const all = tutorStored(TUTOR_HINTS_KEY), list = Array.isArray(all[page]) ? all[page] : [];
    all[page] = [...list, entry].slice(-40);
    const ids = Object.keys(all);
    for (const id of ids.slice(0, Math.max(0, ids.length - 120))) delete all[id];
    tutorStore(TUTOR_HINTS_KEY, all);
    if (text) tutorNoteCheck(text, page);
    tutorWindows.keys.hints = "";
    tutorWindows.hintFresh = page;
    const win = tutorWindows.hint?.win;
    if (win && win.hasAttribute("data-folded") && page === String(canvasDocuments.activeId || "")) tutorWindowSave(win, { folded:false });
    return entry;
  }
  // "第 2 次检查", "第 1 次提示", "讲解", ... for the entries of one page, in order.
  function tutorHintLabels(list) {
    let hints = 0, checks = 0;
    return list.map(entry => {
      if (entry.kind === "check_step") {
        checks++;
        const n = Number.isFinite(entry.check) ? entry.check : checks;
        if (Number.isFinite(entry.limit) && n > entry.limit) return tutorWindowText(`Check ${n} · correction shown`, `第 ${n} 次检查 · 已给出订正`);
        return tutorWindowText(`Check ${n}`, `第 ${n} 次检查`) + (Number.isFinite(entry.limit) ? tutorWindowText(` of ${entry.limit}`, `（共 ${entry.limit} 次引导）`) : "");
      }
      if (entry.kind === "hint") { hints++; return tutorWindowText(`Hint ${hints}`, `第 ${hints} 次提示`); }
      if (entry.kind === "explain") return tutorWindowText("Explanation", "讲解");
      if (entry.kind === "practice") return tutorWindowText("Practice question", "练习题");
      if (entry.kind === "ask") return tutorWindowText("You asked", "提问") + (entry.question ? `：${entry.question.slice(0, 40)}` : "");
      return tutorWindowText("AI", "AI 回复");
    });
  }
  // Plain-text fallback until (or if never) the typeset rendering is ready.
  function tutorHintPlain(text) {
    return String(text || "").replace(/^\s*(?:##|>)\s*/gm, "").replace(/\*\*/g, "").replace(/\$([^$\n]+)\$/g, "$1");
  }
  function tutorHintRender(entry, width) {
    const key = `${entry.at}|${entry.text.length}|${width}`, cache = tutorWindows.hintImages;
    if (cache.has(key)) return cache.get(key);
    const job = typeof aiTextImage === "function"
      ? aiTextImage({ tool:"write_text", text:entry.text, fontSize:17, color:"#1f2937", maxWidth:width, lineHeight:1.5, tutorLayout:true }, width).catch(() => null)
      : Promise.resolve(null);
    cache.set(key, job);
    if (cache.size > 120) cache.delete(cache.keys().next().value);
    return job;
  }
  function tutorHintsRefresh() {
    const hint = tutorWindows.hint, doc = canvasDocuments.activeId,
      list = (tutorStored(TUTOR_HINTS_KEY)[doc] || []).filter(entry => entry && typeof entry.text === "string"),
      width = Math.max(160, Math.round(((hint.body.clientWidth || 300) - 24) / 20) * 20),
      key = `${state.language}|${doc}|${width}|${list.map(entry => entry.at).join(",")}`;
    if (key === tutorWindows.keys.hints) return;
    tutorWindows.keys.hints = key;
    hint.title.textContent = tutorWindowText("AI", "AI 提示");
    hint.note.textContent = list.length ? tutorWindowText(`${list.length} on this page`, `本题 ${list.length} 条`) : "";
    if (!list.length) {
      hint.body.replaceChildren(tutorWindowElement("p", "tutor-window-empty", tutorWindowText(
        "Replies to Check, Hint and the other AI buttons appear here, not on the canvas.",
        "点「检查」「提示」等按钮后，AI 的回复显示在这里，不会写在画布上。")));
      return;
    }
    const labels = tutorHintLabels(list), fresh = tutorWindows.hintFresh === doc;
    tutorWindows.hintFresh = "";
    hint.body.replaceChildren(...list.map((entry, index) => {
      const item = tutorWindowElement("article", "tutor-hint-item"), head = tutorWindowElement("div", "tutor-hint-label"),
        time = new Date(entry.at), content = tutorWindowElement("div", "tutor-hint-text", tutorHintPlain(entry.text));
      head.append(tutorWindowElement("b", "", labels[index]), tutorWindowElement("span", "", `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`));
      item.dataset.kind = entry.kind;
      if (fresh && index === list.length - 1) item.setAttribute("data-fresh", "");
      item.append(head, content);
      tutorHintRender(entry, width).then(image => {
        if (!image || !(image.width > 0) || !content.isConnected) return;
        const copy = tutorWindowElement("canvas", "tutor-hint-image");
        copy.width = image.width;
        copy.height = image.height;
        copy.getContext("2d").drawImage(image, 0, 0);
        copy.style.width = `${Math.round(image.logicalWidth || image.width / Math.max(1, typeof sharpRenderRatio === "function" ? sharpRenderRatio() : 1))}px`;
        copy.setAttribute("role", "img");
        copy.setAttribute("aria-label", tutorHintPlain(entry.text));
        content.replaceChildren(copy);
      });
      return item;
    }));
    hint.body.lastElementChild?.scrollIntoView?.({ block:"nearest" });
  }
  // The question of a page, from the context.md the bridge wrote (empty for other pages).
  function tutorQuestionContext(documentId = canvasDocuments.activeId) {
    const context = String(canvasDocuments.records.get(documentId)?.context || "").replace(/\r\n?/g, "\n");
    return context.startsWith(TUTOR_QUESTION_MARK) ? context.slice(TUTOR_QUESTION_MARK.length).trim() : "";
  }
  function tutorQuestionImage(text, width) {
    const key = `q|${text}|${width}`, cache = tutorWindows.hintImages;
    if (cache.has(key)) return cache.get(key);
    const job = typeof mixedTextImage === "function"
      ? mixedTextImage(text, 18, "#1f2937", width, 1.5, state.aiFont, typeof sharpRenderRatio === "function" ? sharpRenderRatio() : 1, false).catch(() => null)
      : Promise.resolve(null);
    cache.set(key, job);
    if (cache.size > 120) cache.delete(cache.keys().next().value);
    return job;
  }
  // A tap that lands right after the dots or the page list were rebuilt may have been meant for
  // what was there a moment before (the window grows when the dots appear): ignore it.
  function tutorTapSettled() { return Date.now() - tutorWindows.rebuiltAt >= 600; }
  // Pages a student may delete: not on screen, no open MCP session on it, and not a page of the
  // current lesson (only the bridge marks lesson pages as old). Bindings left by the bridge's
  // earlier sessionKeys do not count: those conversations are never resumed.
  function tutorPageDeletable(page) {
    if (!page || page.id === canvasDocuments.activeId) return false;
    if (typeof mcpRuntime !== "undefined" && mcpRuntime?.sessions && [...mcpRuntime.sessions.values()].some(session => !session.closed && session.documentId === page.id)) return false;
    const title = String(page.title || "");
    return title.startsWith(TUTOR_ARCHIVED) || title.startsWith(TUTOR_DOOMED) || !tutorLessonPage(title);
  }
  const tutorDeleting = new Set();
  // Delete a page that is not on screen (canvasDocumentsClose only closes the current page).
  async function tutorDeletePage(id) {
    const doc = canvasDocuments.records.get(id);
    if (!tutorPageDeletable(doc) || canvasDocuments.switching || (typeof snapshotLoadInProgress !== "undefined" && snapshotLoadInProgress)) return false;
    // One delete per page at a time: a second one would find the record gone and write the page back.
    if (tutorDeleting.has(id)) return false;
    tutorDeleting.add(id);
    try {
      const db = await canvasDocumentsDb();
      await canvasDocumentsBound(new Promise((resolve, reject) => {
        const tx = db.transaction("documents", "readwrite");
        tx.objectStore("documents").delete(id);
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error || Error("Could not delete the page. Retry."));
      }));
      const now = canvasDocuments.records.get(id);
      if (now !== doc || id === canvasDocuments.activeId || canvasDocuments.switching) {
        if (now || id === canvasDocuments.activeId) await canvasDocumentsPersist(now || doc);
        return false;
      }
    } finally {
      tutorDeleting.delete(id);
    }
    if (typeof mcpRuntime !== "undefined" && mcpRuntime?.sessions) for (const session of mcpRuntime.sessions.values()) if (session.documentId === id) session.closed = true;
    canvasDocuments.records.delete(id);
    for (const key of [TUTOR_HINTS_KEY, TUTOR_RESULTS_KEY, TUTOR_QUESTIONS_KEY]) {
      const stored = tutorStored(key);
      if (id in stored) { delete stored[id]; tutorStore(key, stored); }
    }
    canvasDocumentsRender();
    return true;
  }
  // Pages the bridge marked "[待删除]" go at once (checked every 2 s, one pass at a time).
  async function tutorPurgePages() {
    if (tutorWindows.purging || Date.now() - tutorWindows.purgeAt < 2000) return;
    tutorWindows.purgeAt = Date.now();
    const doomed = [...canvasDocuments.records.values()].filter(page => page.id !== canvasDocuments.activeId
      && (String(page.title || "").startsWith(TUTOR_DOOMED) || tutorBlankUntitled(page)));
    if (!doomed.length) return;
    tutorWindows.purging = true;
    try {
      for (const page of doomed) {             // check again: the page may have changed while earlier ones were deleted
        const now = canvasDocuments.records.get(page.id);
        if (now && now.id !== canvasDocuments.activeId && (String(now.title || "").startsWith(TUTOR_DOOMED) || tutorBlankUntitled(now))) await tutorDeletePage(page.id);
      }
    }
    catch (error) { debug("tutor-purge", { message:String(error?.message || error) }); }
    finally { tutorWindows.purging = false; }
  }
  // A blank untitled page left behind (the boot page of an earlier visit kept by a session): the student view
  // cannot make pages, so an empty untitled page that is not on screen is never the student's.
  function tutorBlankUntitled(page) {
    const meta = page?.metadata || page, item = page?.stored?.item;
    if (!page || page.id === canvasDocuments.activeId || !item || !Array.isArray(page.stored.tileEntries) || page.stored.tileEntries.length) return false;
    const titles = [meta.title, item.name].filter(Boolean);
    if (!titles.length || !titles.every(title => /^(untitled canvas|未命名画布)$/i.test(String(title).trim()))) return false;
    if (meta.context || item.projectId || page.locator || page.agentDraft || page.hasUserHistory || page.undo?.length || page.redo?.length) return false;
    return !["widgets", "images", "textBoxes", "animations", "preservedAssets"].some(key => item[key] != null && (!Array.isArray(item[key]) || item[key].length));
  }
  // Lesson pages are titled "<topic> · 共 8 题 · 第 3 题" (the total is optional).
  function tutorLessonPage(title) {
    const number = /第\s*(\d+)\s*题/.exec(title || ""), total = /共\s*(\d+)\s*题/.exec(title || "");
    return number ? { topic:String(title).split("·")[0].trim(), number:+number[1], total:total ? +total[1] : 0 } : null;
  }
  function tutorPageName(title) { return String(title || "").replace(/\s*·\s*共\s*\d+\s*题/, ""); }
  function tutorQuestionRecord() {
    const doc = canvasDocuments.activeId, boxes = Array.isArray(state.textBoxes) ? state.textBoxes : [],
      noted = tutorStored(TUTOR_QUESTIONS_KEY)[doc];
    if (noted) return boxes.find(box => box.id === noted) || null;
    // Pages made before this was recorded: on a lesson page the question is the first text object.
    const title = canvasDocuments.records.get(doc)?.title || "";
    if (!/第\s*\d+\s*题/.test(title)) return null;
    return [...boxes].sort((a, b) => (parseInt(String(a.id).slice(9), 10) || 0) - (parseInt(String(b.id).slice(9), 10) || 0))[0] || null;
  }
  function tutorWindowText(en, zh) { return state.language === "zh" ? zh : en; }
  function tutorWindowElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }
  function tutorWindowPlace(win) {
    const saved = tutorWindows.layout[win.dataset.window] || {}, rect = win.getBoundingClientRect(),
      maxX = Math.max(0, globalThis.innerWidth - Math.min(rect.width, 120)), maxY = Math.max(0, globalThis.innerHeight - 44),
      x = Math.max(0, Math.min(maxX, Number.isFinite(saved.x) ? saved.x : win.dataset.window === "question" ? 12 : globalThis.innerWidth - rect.width - 12)),
      y = Math.max(0, Math.min(maxY, Number.isFinite(saved.y) ? saved.y : win.dataset.window === "hint" ? Math.round(globalThis.innerHeight * 0.42) : 12));
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
    if (Number.isFinite(saved.w)) win.style.width = `${Math.max(200, Math.min(globalThis.innerWidth - 16, saved.w))}px`;
    win.toggleAttribute("data-folded", saved.folded === true);
  }
  function tutorWindowSave(win, change) {
    const name = win.dataset.window;
    tutorWindows.layout[name] = { ...tutorWindows.layout[name], ...change };
    tutorStore(TUTOR_WINDOWS_KEY, tutorWindows.layout);
    tutorWindowPlace(win);
  }
  // Drag by the title bar; a tap that does not move folds or unfolds the window.
  function tutorWindowDrag(win, handle, resize = false) {
    let grab = null;
    handle.addEventListener("pointerdown", event => {
      if (event.button > 0 || event.target instanceof Element && event.target.closest("button")) return;
      const rect = win.getBoundingClientRect();
      grab = { id:event.pointerId, x:event.clientX, y:event.clientY, left:rect.left, top:rect.top, width:rect.width, moved:false };
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("pointermove", event => {
      if (!grab || event.pointerId !== grab.id) return;
      const dx = event.clientX - grab.x, dy = event.clientY - grab.y;
      if (!grab.moved && Math.hypot(dx, dy) < 6) return;
      grab.moved = true;
      if (resize) win.style.width = `${Math.max(200, Math.min(globalThis.innerWidth - 16, grab.width + dx))}px`;
      else { win.style.left = `${grab.left + dx}px`; win.style.top = `${grab.top + dy}px`; }
    });
    const end = event => {
      if (!grab || event.pointerId !== grab.id) return;
      const rect = win.getBoundingClientRect(), moved = grab.moved;
      grab = null;
      if (resize) tutorWindowSave(win, moved ? { w:rect.width } : {});
      else tutorWindowSave(win, moved ? { x:rect.left, y:rect.top } : event.type === "pointerup" ? { folded:!win.hasAttribute("data-folded") } : {});
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  function tutorWindowCreate(name) {
    const win = tutorWindowElement("section", "tutor-window"), bar = tutorWindowElement("header", "tutor-window-bar"),
      title = tutorWindowElement("b", "tutor-window-title"), note = tutorWindowElement("span", "tutor-window-note"),
      fold = tutorWindowElement("i", "tutor-window-fold"), body = tutorWindowElement("div", "tutor-window-body");
    win.id = name === "menu" ? "tutorMenuWindow" : name === "hint" ? "tutorHintWindow" : "tutorQuestionWindow";
    win.dataset.window = name;
    fold.setAttribute("aria-hidden", "true");
    bar.append(tutorWindowElement("i", "tutor-window-grip"), title, note, fold);
    win.append(bar, body);
    // Nothing done on a window should reach the canvas underneath.
    for (const type of ["pointerdown", "wheel", "touchstart"]) win.addEventListener(type, event => event.stopPropagation(), { passive:true });
    tutorWindowDrag(win, bar);
    document.body.append(win);
    return { win, title, note, body };
  }
  function tutorWindowButton(label, forward, className = "") {
    const button = tutorWindowElement("button", className, label);
    button.type = "button";
    if (forward) button.dataset.shellForward = forward;
    return button;
  }
  function tutorWindowsRefresh() {
    const { menu, question } = tutorWindows, keys = tutorWindows.keys,
      pages = [...canvasDocuments.records.values()].sort((a, b) => (a.firstSeenAt || 0) - (b.firstSeenAt || 0) || a.id.localeCompare(b.id)),
      active = canvasDocuments.records.get(canvasDocuments.activeId),
      pagesKey = `${state.language}|${canvasDocuments.activeId}|${pages.map(page => `${page.id}:${page.title}:${tutorPageDeletable(page) ? 1 : 0}`).join("|")}`;
    if (pagesKey !== keys.pages) {
      keys.pages = pagesKey;
      menu.title.textContent = tutorWindowText("Menu", "菜单");
      menu.pagesLabel.textContent = tutorWindowText("Pages", "画布列表");
      menu.settings.textContent = tutorWindowText("Settings", "设置");
      menu.fullscreen.textContent = tutorWindowText("Fullscreen", "全屏");
      menu.keep.textContent = tutorWindowText("Keep AI writing", "保留 AI 内容");
      menu.discard.textContent = tutorWindowText("Discard", "丢弃");
      question.title.textContent = tutorWindowText("Question", "题目");
      tutorWindows.rebuiltAt = Date.now();
      menu.pages.replaceChildren(...pages.map(page => {
        const line = tutorWindowElement("div", "tutor-window-page-row"),
          row = tutorWindowButton(tutorPageName(page.title) || tutorWindowText("Untitled canvas", "未命名画布"), "", "tutor-window-page");
        if (page.id === canvasDocuments.activeId) row.setAttribute("aria-current", "page");
        row.addEventListener("click", () => { if (tutorTapSettled()) canvasDocumentsUiAction(async () => { await canvasDocumentsShow(page.id); }); });
        line.append(row);
        if (tutorPageDeletable(page)) {
          // Two taps: the first asks, the second deletes (window.confirm would block the MCP link).
          const del = tutorWindowButton("✕", "", "tutor-window-page-delete");
          del.setAttribute("aria-label", tutorWindowText("Delete this page", "删除这一页"));
          del.addEventListener("click", () => {
            if (!tutorTapSettled()) return;
            if (!del.hasAttribute("data-confirm")) {
              del.setAttribute("data-confirm", "");
              del.textContent = tutorWindowText("Delete?", "删除？");
              setTimeout(() => { if (del.isConnected) { del.removeAttribute("data-confirm"); del.textContent = "✕"; } }, 3000);
              return;
            }
            canvasDocumentsUiAction(() => tutorDeletePage(page.id));
          });
          line.append(del);
        }
        return line;
      }));
      menu.pages.querySelector("[aria-current]")?.scrollIntoView?.({ block:"nearest" });
      menu.colorLabel.textContent = tutorWindowText("Colour", "颜色");
      keys.steps = "";
    }
    // Progress through the lesson: one dot per question, coloured by how its check went.
    const lesson = tutorLessonPage(active?.title), results = tutorStored(TUTOR_RESULTS_KEY),
      mine = lesson ? pages.map(page => ({ page, at:tutorLessonPage(page.title) })).filter(item => item.at && item.at.topic === lesson.topic) : [],
      count = lesson ? Math.max(lesson.total, ...mine.map(item => item.at.number)) : 0,
      // Only this lesson's pages: renaming or deleting other pages must not rebuild the dots.
      stepsKey = lesson ? `${state.language}|${canvasDocuments.activeId}|${count}|${mine.map(item => `${item.page.id}:${item.at.number}:${results[item.page.id] || ""}`).join(",")}` : `none|${state.language}|${active?.title || ""}`;
    if (stepsKey !== keys.steps) {
      keys.steps = stepsKey;
      tutorWindows.rebuiltAt = Date.now();
      question.note.textContent = lesson ? tutorWindowText(`${lesson.number} of ${count}`, `第 ${lesson.number} / ${count} 题`) : tutorPageName(active?.title);
      // The row keeps its place even when empty, so the window does not grow under the pen.
      question.steps.hidden = count > 30;
      question.steps.replaceChildren(...(lesson && count <= 30 ? Array.from({ length:count }, (_, index) => {
        const item = mine.filter(entry => entry.at.number === index + 1).at(-1), dot = tutorWindowButton(String(index + 1), "", "tutor-window-step");
        dot.dataset.state = !item ? "ahead" : results[item.page.id] || "open";
        if (item?.page.id === canvasDocuments.activeId) dot.setAttribute("aria-current", "step");
        if (item) dot.addEventListener("click", () => { if (tutorTapSettled()) canvasDocumentsUiAction(async () => { await canvasDocumentsShow(item.page.id); }); });
        else dot.disabled = true;
        return dot;
      }) : []));
    }
    const palette = state.studioPalette || "";
    if (palette !== keys.palette) {
      keys.palette = palette;
      for (const swatch of menu.colors.children) swatch.setAttribute("aria-pressed", String(swatch.dataset.palette === palette));
    }
    const status = (canvasDocuments.error ? `${tutorWindowText("Canvas", "画布")}：${canvasDocuments.error}` : "")
        || document.querySelector("#status")?.textContent?.trim() || "",
      link = document.querySelector("#mcpToolbarToggle"),
      drafts = document.querySelector("#batchActions")?.hidden === false,
      linkKey = `${state.language}|${link?.dataset.state || ""}|${document.querySelector("#mcpToolbarStatus")?.textContent || ""}|${status}|${drafts}`;
    if (linkKey !== keys.link) {
      keys.link = linkKey;
      menu.link.dataset.state = link?.dataset.state || "off";
      menu.link.textContent = `${tutorWindowText("Teacher link", "老师端连接")}：${document.querySelector("#mcpToolbarStatus")?.textContent?.trim() || "—"}`;
      menu.note.textContent = status;
      menu.status.textContent = status;
      // The top bar's Keep / Discard for AI drafts lives here while the bar is hidden.
      menu.batch.hidden = !drafts;
    }
    // Room left on this tablet (a browser keeps at most CANVAS_DOCUMENT_LIMIT open pages).
    const used = canvasDocuments.records.size, limit = typeof CANVAS_DOCUMENT_LIMIT === "number" ? CANVAS_DOCUMENT_LIMIT : 64,
      capacityKey = `${state.language}|${limit - used < TUTOR_LOW_PAGES ? used : "ok"}`;
    if (capacityKey !== keys.capacity) {
      keys.capacity = capacityKey;
      menu.capacity.hidden = limit - used >= TUTOR_LOW_PAGES;
      menu.capacity.textContent = used >= limit
        ? tutorWindowText(`All ${limit} pages are used. The oldest pages of earlier lessons are removed when a new lesson starts.`, `画布页已满（${used} / ${limit}），开新课时会自动删除最旧的旧课页面。`)
        : tutorWindowText(`Pages almost full (${used} / ${limit}). Tap ✕ beside a page of an earlier lesson to delete it.`, `画布页快满了（已用 ${used} / ${limit}）。可以点旧课页面旁的 ✕ 删除。`);
    }
    // The question: from the page's context.md (the bridge's lesson pages), else the first text
    // object (pages made before 2026-11-15, when the question was written on the canvas).
    const asked = tutorQuestionContext(), record = asked ? null : tutorQuestionRecord(), image = record?.image,
      questionWidth = Math.max(160, Math.floor(((question.body.clientWidth || 400) - 20) / 20) * 20),
      questionKey = asked ? `ctx|${canvasDocuments.activeId}|${asked}|${questionWidth}|${state.language}`
        : record ? `${canvasDocuments.activeId}|${record.id}|${record.text}|${image?.width || 0}x${image?.height || 0}|${state.language}` : `none|${state.language}`;
    if (questionKey !== keys.question) {
      keys.question = questionKey;
      if (asked) {
        const plain = tutorWindowElement("p", "tutor-window-question-text", tutorHintPlain(asked));
        question.body.replaceChildren(plain);
        // The typesetter keeps only the first TEXT_INPUT_MAX_LENGTH characters: a longer question stays plain.
        if (asked.length <= (typeof TEXT_INPUT_MAX_LENGTH === "number" ? TEXT_INPUT_MAX_LENGTH : 2000)) tutorQuestionImage(asked, questionWidth).then(typeset => {
          if (!typeset || !(typeset.width > 0) || !plain.isConnected || keys.question !== questionKey) return;
          const copy = tutorWindowElement("canvas", "tutor-window-question tutor-window-question-typeset");
          copy.width = typeset.width;
          copy.height = typeset.height;
          copy.getContext("2d").drawImage(typeset, 0, 0);
          copy.style.width = `${Math.round(typeset.logicalWidth || typeset.width / Math.max(1, typeof sharpRenderRatio === "function" ? sharpRenderRatio() : 1))}px`;
          copy.setAttribute("role", "img");
          copy.setAttribute("aria-label", asked);
          question.body.replaceChildren(copy);
        });
      } else if (!record) {
        question.body.replaceChildren(tutorWindowElement("p", "tutor-window-empty", tutorWindowText("This page has no question.", "这一页没有题目。")));
      } else if (image && image.width > 0 && image.height > 0) {
        // Show the page's own rendering of the question (it already has the formulas typeset),
        // at about 20 px text regardless of how large it is on the canvas.
        const copy = tutorWindowElement("canvas", "tutor-window-question");
        copy.width = image.width;
        copy.height = image.height;
        copy.getContext("2d").drawImage(image, 0, 0);
        copy.style.width = `${Math.round(record.w * 20 / Math.max(1, record.fontSize))}px`;
        copy.setAttribute("role", "img");
        copy.setAttribute("aria-label", record.text);
        question.body.replaceChildren(copy);
      } else {
        question.body.replaceChildren(tutorWindowElement("p", "tutor-window-question-text", record.text));
      }
    }
  }
  // A student's tablet opens its workspace to the local MCP server by itself (the switch under
  // Settings > MCP that used to be tapped by hand on every tablet), and opens it again if it was
  // switched off or the page came back from the background. A dropped connection is retried by
  // mcpConnect's own back-off; this only covers the case where nothing is trying any more.
  function tutorAutoLink() {
    if (typeof mcpConnect !== "function" || typeof mcpRuntime === "undefined" || !mcpRuntime) return;
    if (mcpRuntime.wanted || mcpRuntime.socket || mcpRuntime.pageHidden || document.hidden) return;
    const now = Date.now();
    if (now - (tutorWindows.linkAt || 0) < 5000) return;
    tutorWindows.linkAt = now;
    try { mcpConnect(); } catch { /* tried again on a later tick */ }
  }
  function tutorWindowsInit() {
    if (typeof tutorStudentUi !== "function" || !tutorStudentUi() || tutorWindows.menu || !document.body) return;
    tutorWindows.layout = tutorStored(TUTOR_WINDOWS_KEY);
    const menu = tutorWindowCreate("menu"), question = tutorWindowCreate("question"), hint = tutorWindowCreate("hint"),
      row = tutorWindowElement("div", "tutor-window-row"), grip = tutorWindowElement("i", "tutor-window-resize"),
      hintGrip = tutorWindowElement("i", "tutor-window-resize");
    menu.pagesLabel = tutorWindowElement("div", "tutor-window-label");
    menu.pages = tutorWindowElement("div", "tutor-window-pages");
    menu.capacity = tutorWindowElement("div", "tutor-window-notice");
    menu.capacity.hidden = true;
    menu.link = tutorWindowElement("div", "tutor-window-link");
    menu.settings = tutorWindowButton("", "#settingsBtn");
    menu.fullscreen = tutorWindowButton("", "#fullscreenBtn");
    menu.batch = tutorWindowElement("div", "tutor-window-row");
    menu.keep = tutorWindowButton("", "#acceptBatch", "tutor-window-primary");
    menu.discard = tutorWindowButton("", "#rejectBatch");
    menu.batch.append(menu.discard, menu.keep);
    menu.status = tutorWindowElement("div", "tutor-window-status");
    menu.status.setAttribute("aria-hidden", "true");
    row.append(menu.settings, menu.fullscreen);
    menu.colorLabel = tutorWindowElement("div", "tutor-window-label");
    menu.colors = tutorWindowElement("div", "tutor-window-colors");
    for (const [name, color] of TUTOR_PALETTES) {
      const swatch = tutorWindowButton("", "", "tutor-window-swatch");
      swatch.dataset.palette = name;
      swatch.setAttribute("aria-label", name);
      swatch.style.background = color;
      swatch.addEventListener("click", () => { if (typeof applyStudioPalette === "function") applyStudioPalette(name); });
      menu.colors.append(swatch);
    }
    menu.body.append(menu.pagesLabel, menu.pages, menu.capacity, menu.link, row, menu.colorLabel, menu.colors, menu.status, menu.batch);
    // AGPL section 13: people using this over the network are offered the source of this build.
    // The archive is put in public/ when the build is packaged; without it there is no link.
    menu.about = tutorWindowElement("a", "tutor-window-about", tutorWindowText("Based on PenEcho · AGPL-3.0 · Source code", "基于 PenEcho 修改 · AGPL-3.0 · 源代码"));
    const sourceUrl = globalThis.PENECHO_CONFIG?.sourceUrl || "";
    menu.about.href = sourceUrl || "/source.zip";
    menu.about.hidden = !sourceUrl;
    if (sourceUrl) { menu.about.target = "_blank"; menu.about.rel = "noopener"; }
    menu.body.append(menu.about);
    if (typeof fetch === "function") fetch("/source.zip", { method:"HEAD" }).then(response => {
        if (!response.ok) return;
        menu.about.href = "/source.zip";
        menu.about.removeAttribute("target");
        menu.about.hidden = false;
    }).catch(() => {});
    question.steps = tutorWindowElement("div", "tutor-window-steps");
    question.cheer = tutorWindowElement("i", "tutor-window-cheer");
    question.cheer.setAttribute("aria-hidden", "true");
    question.body.before(question.steps);
    question.win.append(question.cheer);
    grip.setAttribute("aria-hidden", "true");
    question.win.append(grip);
    tutorWindowDrag(question.win, grip, true);
    hintGrip.setAttribute("aria-hidden", "true");
    hint.win.append(hintGrip);
    tutorWindowDrag(hint.win, hintGrip, true);
    tutorWindows.menu = menu;
    tutorWindows.question = question;
    tutorWindows.hint = hint;
    const refresh = () => {
      try { tutorAutoLink(); tutorWindowsRefresh(); tutorHintsRefresh(); void tutorPurgePages(); } catch (error) { debug("tutor-windows", { message:String(error?.message || error) }); }
    };
    refresh();
    for (const win of [menu.win, question.win, hint.win]) tutorWindowPlace(win);
    globalThis.addEventListener("resize", () => { for (const win of [menu.win, question.win, hint.win]) tutorWindowPlace(win); });
    tutorWindows.timer = setInterval(refresh, 500);
  }
  tutorWindowsInit();
