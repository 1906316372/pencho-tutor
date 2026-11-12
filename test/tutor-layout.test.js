"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const TUTOR = require("../src/server/tutor-layout.js");
const MIXED_TEXT = require("../public/mixed-text.js");

const view = { x: 1874, y: 2091, w: 1665, h: 1010 };

test("a scattered check reply becomes one text block with inline math", () => {
  const draw = { tool: "draw", origin: [1, 2], types: ["line"], items: [[0, 0, 5, 5]] },
    out = TUTOR.arrange([
      { tool: "write_text", x: 2110, y: 2700, text: "验算：左边=2(1)-3(-5)=17，相等。所以 x=-2，不是 7。", fontSize: 40, maxWidth: 300, lineHeight: 1.35 },
      draw,
      { tool: "draw_formula", x: 2100, y: 2500, latex: "-4x+9=13-2x \\Rightarrow -2x=4 \\Rightarrow x=-2", fontSize: 180 },
    ], { userAction: "explain", suggestion: "check_step", visibleRect: view });
  assert.equal(out.length, 2);
  const block = out.find((command) => command.tool === "write_text");
  assert.deepEqual(block.text.split("\n"), [
    "$-4x+9=13-2x$",
    "$\\Rightarrow -2x=4$",
    "$\\Rightarrow x=-2$",
    "> 验算：左边$=2(1)-3(-5)=17$，相等。",
    "所以 $x=-2$，不是 7。",
  ]);
  assert.equal(block.tutorLayout, true);
  assert.equal(block.fontSize, 32);
  assert.equal(block.x, 2100);
  assert.equal(block.y, 2500);
  assert.ok(block.maxWidth >= 12 * 32 && block.maxWidth <= 26 * 32);
  assert.ok(block.x + block.maxWidth <= view.x + view.w);
  assert.ok(out.includes(draw));
});

test("a block that would run off the screen is pulled back inside it", () => {
  const [block] = TUTOR.arrange([{ tool: "write_text", x: 3400, y: 2500, text: "这一步移项的时候符号没有变，再看看第二行。", maxWidth: 100 }], { userAction: "hint", visibleRect: view });
  assert.ok(block.x + block.maxWidth <= view.x + view.w);
  assert.ok(block.x >= view.x);
});

test("in-place and non-text actions are left alone", () => {
  const commands = [{ tool: "draw_formula", x: 1, y: 2, latex: "x=5", fontSize: 100 }];
  assert.equal(TUTOR.arrange(commands, { userAction: "continue", suggestion: "next_step", visibleRect: view }), commands);
  assert.equal(TUTOR.arrange(commands, { userAction: "normalize", visibleRect: view }), commands);
  assert.equal(TUTOR.arrange(commands, { userAction: "explain", widgetEdit: {}, visibleRect: view }), commands);
});

test("plain-text math is typeset but words and existing math are untouched", () => {
  assert.equal(TUTOR.mathify("得 x = 22/5，再代入"), "得 $x = \\frac{22}{5}$，再代入");
  assert.equal(TUTOR.mathify("已有 $x=3$ 和 2×4+3=11"), "已有 $x=3$ 和 $2\\times 4+3=11$");
  assert.equal(TUTOR.mathify("use ok = fine, step 2"), "use ok = fine, step 2");
  assert.equal(TUTOR.mathify("第 2 行有误"), "第 2 行有误");
  assert.equal(TUTOR.mathify("（1）先去括号"), "（1）先去括号");
});

test("line-break units keep punctuation and measure words attached", () => {
  assert.deepEqual(MIXED_TEXT.breakUnits("新书。图书（共 12 本；）ok"), ["新", "书。", "图", "书", "（共", " ", "12 本；）", "ok"]);
  assert.deepEqual(MIXED_TEXT.breakUnits("hello  world"), ["hello", "  ", "world"]);
  assert.deepEqual(MIXED_TEXT.breakUnits(""), []);
});

test("lines are marked by role: verdict, remark, phrase to notice", () => {
  assert.deepEqual(TUTOR.emphasize(["✗ 第 1 行去括号时符号有误，$2(x-3)$ 应为 $2x-6$。", "改正后再合并同类项。", "验算：左边$=17$"]),
    ["## ✗ 第 1 行去括号时符号有误", "$2(x-3)$ 应为 $2x-6$。", "改正后再合并同类项。", "> 验算：左边$=17$"]);
  assert.deepEqual(TUTOR.emphasize(["√ 全部正确"]), ["## ✓ 全部正确"]);
  assert.deepEqual(TUTOR.emphasize(["提示：先设未知数。", "第 2 步移项要变号"]), ["**提示：**先设未知数。", "**第 2 步**移项要变号"]);
  assert.deepEqual(TUTOR.emphasize(["$x=1$", "所以 $x=-2$"]), ["$x=1$", "所以 $x=-2$"]);
});

test("staged check: guided stages never ask for the answer, the stage after the limit does", () => {
  for (const level of [1, 2, 3]) {
    const prompt = TUTOR.checkPrompt(level, 3);
    assert.match(prompt, /do NOT write any corrected expression/);
    assert.match(prompt, /exactly one short sentence/);
    assert.match(prompt, /Do NOT say what the mistake is/);
    assert.match(prompt, /Ignore anything the student crossed out/);
    assert.doesNotMatch(prompt, /show the correction/);
  }
  assert.match(TUTOR.checkPrompt(1, 3), /which rough part/);
  assert.match(TUTOR.checkPrompt(2, 3), /two neighbouring lines/);
  assert.match(TUTOR.checkPrompt(3, 3), /last guided check/);
  assert.match(TUTOR.checkPrompt(4, 3), /show the correction/);
  assert.doesNotMatch(TUTOR.checkPrompt(4, 3), /do NOT write/i);
});

test("staged check: the reply says how many guided checks are left, unless the work is correct", () => {
  const reply = (text, tutorCheck) => TUTOR.arrange([{ tool: "write_text", x: 2000, y: 2500, text, maxWidth: 100 }],
    { userAction: "explain", suggestion: "check_step", visibleRect: view, tutorCheck, tutorCheckLimit: 3 })[0].text.split("\n");
  assert.equal(reply("✗ 前两行附近再看看", 1).at(-1), "> 第 1/3 次检查。改好后再点「检查」。");
  assert.equal(reply("✗ 第 2 行再看看", 3).at(-1), "> 第 3/3 次检查，再检查一次会显示正确答案。");
  assert.equal(reply("✗ 第 2 行符号错了\n$x=-2$", 4).at(-1), "> 已显示正确答案，请对照订正。");
  assert.deepEqual(reply("✓ 全部正确", 2), ["## ✓ 全部正确"]);
});

test("a request that reports the whole canvas as visible still gets a normal-sized block", () => {
  const [block] = TUTOR.arrange([{ tool: "write_text", x: 2100, y: 2500, text: "✗ 上半部分再看看", maxWidth: 100 }],
    { userAction: "explain", suggestion: "check_step", visibleRect: { x: 0, y: 0, w: 20000, h: 20000 }, tutorCheck: 1, tutorCheckLimit: 3 });
  assert.equal(block.fontSize, 32);
  assert.equal(block.x, 2100);
  assert.ok(block.maxWidth <= 26 * 32);
  assert.ok(block.tutorWidthEm >= 12 && block.tutorWidthEm <= 26);
});
