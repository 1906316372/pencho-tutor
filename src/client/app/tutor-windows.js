  // ---------- Tutor windows (fork, student view) ----------
  // A student's tablet shows the canvas (the answer area) with two floating windows on top:
  //   Menu     - the page list, New canvas, connection status, Settings, Fullscreen.
  //   Question - the question of the current page. It stays on screen while the student
  //              pans or zooms the canvas to find room to write.
  // Each window is dragged by its title bar, folded by tapping the bar, and remembers its place
  // on this tablet. The top bar they replace is hidden by studio-shell.css.
  const TUTOR_WINDOWS_KEY = "penecho.tutor.windows",
    TUTOR_QUESTIONS_KEY = "penecho.tutor.questions",
    TUTOR_RESULTS_KEY = "penecho.tutor.results",
    // Accent choices offered in the Menu window (names of the built-in Studio palettes).
    TUTOR_PALETTES = Object.freeze([["indigo", "#4f46e5"], ["azure", "#0284c7"], ["teal", "#0d9488"], ["forest", "#15803d"], ["amber", "#d97706"], ["rose", "#e11d48"]]),
    tutorWindows = { menu:null, question:null, layout:{}, keys:{}, timer:0 };
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
  function tutorNoteCheck(text) {
    const verdict = /^\s*(?:##\s*)?([✓✗])/.exec(String(text || ""))?.[1], doc = canvasDocuments.activeId;
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
    if (verdict !== "✓" || !win) return;
    win.removeAttribute("data-cheer");
    void win.offsetWidth;
    win.setAttribute("data-cheer", "");
    clearTimeout(tutorWindows.cheerTimer);
    tutorWindows.cheerTimer = setTimeout(() => win.removeAttribute("data-cheer"), 2200);
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
      x = Math.max(0, Math.min(maxX, Number.isFinite(saved.x) ? saved.x : win.dataset.window === "menu" ? globalThis.innerWidth - rect.width - 12 : 12)),
      y = Math.max(0, Math.min(maxY, Number.isFinite(saved.y) ? saved.y : 12));
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
    win.id = name === "menu" ? "tutorMenuWindow" : "tutorQuestionWindow";
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
      pagesKey = `${state.language}|${canvasDocuments.activeId}|${pages.map(page => `${page.id}:${page.title}`).join("|")}`;
    if (pagesKey !== keys.pages) {
      keys.pages = pagesKey;
      menu.title.textContent = tutorWindowText("Menu", "菜单");
      menu.pagesLabel.textContent = tutorWindowText("Pages", "画布列表");
      menu.next.textContent = tutorWindowText("New canvas", "新建画布");
      menu.settings.textContent = tutorWindowText("Settings", "设置");
      menu.fullscreen.textContent = tutorWindowText("Fullscreen", "全屏");
      menu.keep.textContent = tutorWindowText("Keep AI writing", "保留 AI 内容");
      menu.discard.textContent = tutorWindowText("Discard", "丢弃");
      question.title.textContent = tutorWindowText("Question", "题目");
      menu.pages.replaceChildren(...pages.map(page => {
        const row = tutorWindowButton(tutorPageName(page.title) || tutorWindowText("Untitled canvas", "未命名画布"), "", "tutor-window-page");
        if (page.id === canvasDocuments.activeId) row.setAttribute("aria-current", "page");
        row.addEventListener("click", () => canvasDocumentsUiAction(async () => { await canvasDocumentsShow(page.id); }));
        return row;
      }));
      menu.pages.querySelector("[aria-current]")?.scrollIntoView?.({ block:"nearest" });
      menu.colorLabel.textContent = tutorWindowText("Colour", "颜色");
      keys.steps = "";
    }
    // Progress through the lesson: one dot per question, coloured by how its check went.
    const lesson = tutorLessonPage(active?.title), results = tutorStored(TUTOR_RESULTS_KEY),
      mine = lesson ? pages.map(page => ({ page, at:tutorLessonPage(page.title) })).filter(item => item.at && item.at.topic === lesson.topic) : [],
      count = lesson ? Math.max(lesson.total, ...mine.map(item => item.at.number)) : 0,
      stepsKey = lesson ? `${pagesKey}|${mine.map(item => results[item.page.id] || "").join(",")}` : `none|${active?.title || ""}`;
    if (stepsKey !== keys.steps) {
      keys.steps = stepsKey;
      question.note.textContent = lesson ? tutorWindowText(`${lesson.number} of ${count}`, `第 ${lesson.number} / ${count} 题`) : tutorPageName(active?.title);
      question.steps.hidden = !lesson || count > 30;
      question.steps.replaceChildren(...(lesson && count <= 30 ? Array.from({ length:count }, (_, index) => {
        const item = mine.filter(entry => entry.at.number === index + 1).at(-1), dot = tutorWindowButton(String(index + 1), "", "tutor-window-step");
        dot.dataset.state = !item ? "ahead" : results[item.page.id] || "open";
        if (item?.page.id === canvasDocuments.activeId) dot.setAttribute("aria-current", "step");
        if (item) dot.addEventListener("click", () => canvasDocumentsUiAction(async () => { await canvasDocumentsShow(item.page.id); }));
        else dot.disabled = true;
        return dot;
      }) : []));
    }
    const palette = state.studioPalette || "";
    if (palette !== keys.palette) {
      keys.palette = palette;
      for (const swatch of menu.colors.children) swatch.setAttribute("aria-pressed", String(swatch.dataset.palette === palette));
    }
    const status = document.querySelector("#status")?.textContent?.trim() || "",
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
    const record = tutorQuestionRecord(), image = record?.image,
      questionKey = record ? `${canvasDocuments.activeId}|${record.id}|${record.text}|${image?.width || 0}x${image?.height || 0}|${state.language}` : `none|${state.language}`;
    if (questionKey !== keys.question) {
      keys.question = questionKey;
      if (!record) {
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
    const menu = tutorWindowCreate("menu"), question = tutorWindowCreate("question"),
      row = tutorWindowElement("div", "tutor-window-row"), grip = tutorWindowElement("i", "tutor-window-resize");
    menu.pagesLabel = tutorWindowElement("div", "tutor-window-label");
    menu.pages = tutorWindowElement("div", "tutor-window-pages");
    menu.next = tutorWindowButton("", "#newCanvasBtn", "tutor-window-primary");
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
    menu.body.append(menu.pagesLabel, menu.pages, menu.next, menu.link, row, menu.colorLabel, menu.colors, menu.status, menu.batch);
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
    tutorWindows.menu = menu;
    tutorWindows.question = question;
    const refresh = () => {
      try { tutorAutoLink(); tutorWindowsRefresh(); } catch (error) { debug("tutor-windows", { message:String(error?.message || error) }); }
    };
    refresh();
    tutorWindowPlace(menu.win);
    tutorWindowPlace(question.win);
    globalThis.addEventListener("resize", () => { tutorWindowPlace(menu.win); tutorWindowPlace(question.win); });
    tutorWindows.timer = setInterval(refresh, 500);
  }
  tutorWindowsInit();
