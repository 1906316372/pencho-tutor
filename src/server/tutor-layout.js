"use strict";
// Tutor-mode reply layout (fork addition).
//
// Upstream lets the model scatter a reply over several commands: small write_text boxes with
// plain-text math and separate draw_formula objects that the client enlarges to at least twice
// the text size. On a student's tablet that reads as one giant formula next to tiny notes that
// wrap in the middle of an expression. In tutor mode a reply is instead one text block:
// short lines, math inline as $...$, one font size chosen from the student's viewport, and a
// width that fits the longest line.

const TEXT_ACTIONS = new Set(["auto", "hint", "explain", "answer", "continue"]);
// practice and ask too: on a student's tablet every AI reply goes to the hint window as one text block.
const TEXT_SUGGESTIONS = new Set(["check_step", "hint", "explain", "practice", "ask"]);
const MAX_TEXT = 1000;

// Appended to modelInput for the requests applies() accepts.
const FORMAT = "TUTOR REPLY FORMAT (overrides any instruction to use draw_formula or to put corrections beside the source). "
  + "Return exactly one write_text command and no draw_formula command. The student reads it on a tablet, so make it scannable: "
  + "line 1 is the verdict or the hint itself in one short sentence (start with ✓ when the work is all correct, ✗ when something is wrong); "
  + "then at most four more lines, each one short sentence or one equation. Separate lines with \\n. "
  + "Write every mathematical expression, even a single variable or number with an operator, as LaTeX between dollar signs, for example $-4x+9=13-2x$ or $x=\\frac{22}{5}$; "
  + "never write math as plain text such as 2(1)-3(-5)=17. Put one equation per line and never chain steps on one line with arrows. "
  + "No Markdown headings, lists or tables. Name the place of an error in words (for example 「第 2 行」). "
  + "Wrap the one phrase the student most needs to notice (where the error is, or the key idea) in **double asterisks**; at most one per reply. "
  + "Put a verification or side remark, if any, on its own last line starting with \u9a8c\u7b97\uff1a or \u6ce8\uff1a. "
  + "Place the block in blank space below the student's work, left-aligned with it.";

// The strike tool draws a straight red line. Struck-out work is withdrawn, not wrong.
const STRIKE_POLICY = "Handwriting crossed out with a straight line (usually red) has been withdrawn by the student. "
  + "Treat it as deleted: do not read it as part of the work, do not report it as an error and do not mention it.";

// Check in tutor mode is staged. The first `limit` checks only guide: each one narrows down
// where to look but never gives a corrected step or the result. The check after that shows
// the full correction. `level` is 1 for the first check of a page.
function checkPrompt(level, limit) {
  const common = "Check all of the student's own handwritten work on the page (latestInput covers the whole page): verify every step and the result independently. "
    + "Ignore anything the student crossed out. If every remaining step and the result are correct, reply with one short confirmation starting with \u2713 and nothing else. Otherwise start with \u2717. ";
  if (level > limit) {
    return common + `The student has already used all ${limit} guided checks, so now show the correction: say where each error is, `
      + "then write the corrected steps and the correct final result, one equation per line.";
  }
  const stage = level <= 1
    ? "This is the first check: say only which rough part of the work to look at again (for example the upper half, the lower half, or the middle)."
    : level >= limit
      ? "This is the last guided check: say only which line or step to look at again (for example line 2)."
      : "Say only which two neighbouring lines to look at again (for example lines 2 and 3).";
  return common + stage + " Reply with exactly one short sentence of at most 20 Chinese characters and nothing else. "
    + "Do NOT say what the mistake is or what kind of mistake it is, do NOT name a rule, method or thing to re-check, do NOT ask a leading question, "
    + "and do NOT write any corrected expression, corrected step, correct value or the final result. The student must find the mistake alone.";
}

// Hint in tutor mode (replaces the usual Hint behaviour): point the way, never write the step.
const HINT_PROMPT = "Tutor hint (this replaces the usual Hint behaviour). Read all of the student's work on the page and the question (tutorQuestion, if given). "
  + "Give one short hint for the next step only: name the rule, idea or place to look at, or ask one guiding question. "
  + "Do NOT write any transformed expression, equation, value or the next line of working, and never the result. At most two short sentences.";

function checkFooter(level, limit) {
  if (!(level >= 1) || !(limit >= 1)) return "";
  if (level > limit) return "> \u5df2\u663e\u793a\u6b63\u786e\u7b54\u6848\uff0c\u8bf7\u5bf9\u7167\u8ba2\u6b63\u3002";
  return `> \u7b2c ${level}/${limit} \u6b21\u68c0\u67e5` + (level === limit ? "\uff0c\u518d\u68c0\u67e5\u4e00\u6b21\u4f1a\u663e\u793a\u6b63\u786e\u7b54\u6848\u3002" : "\u3002\u6539\u597d\u540e\u518d\u70b9\u300c\u68c0\u67e5\u300d\u3002");
}

function applies(payload) {
  if (!payload || payload.widgetEdit || payload.userAction === "normalize" || payload.userAction === "plot") return false;
  return payload.suggestion ? TEXT_SUGGESTIONS.has(payload.suggestion) : TEXT_ACTIONS.has(payload.userAction);
}

function finiteBox(box) {
  return box && [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w > 0 && box.h > 0 ? box : null;
}

// Split a formula at top-level implication arrows so each step gets its own line.
function formulaSteps(latex) {
  const steps = [];
  let depth = 0,
    start = 0;
  const arrow = /^\\(?:Rightarrow|Longrightarrow|implies|Leftrightarrow|iff)(?![A-Za-z])/;
  for (let index = 0; index < latex.length; index++) {
    const char = latex[index];
    if (char === "{") depth++;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === "\\" && depth === 0) {
      const match = arrow.exec(latex.slice(index));
      if (match) {
        steps.push(latex.slice(start, index));
        start = index;
        index += match[0].length - 1;
      }
    }
  }
  steps.push(latex.slice(start));
  return steps.map((step) => step.replace(/\\(?:quad|qquad|,|;|:)(?![A-Za-z])/g, " ").trim()).filter(Boolean);
}

function formulaLines(latex) {
  const source = String(latex || "").replace(/\s+/g, " ").trim().replace(/^\$+|\$+$/g, "").replace(/^\\[([]|\\[)\]]$/g, "").trim();
  if (!source || source.includes("$")) return source ? [source] : [];
  return formulaSteps(source).map((step) => `$${step}$`);
}

function textLines(text) {
  return String(text || "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).filter((line, index, all) => line.trim() || (index > 0 && all[index - 1].trim()));
}

// Models often ignore the format and write math as plain text ("左边=2(1)-3(-5)=17").
// Wrap such runs in $...$ so they are typeset. A run is numbers, single letters, operators and
// parentheses only, and must contain both an operator and an operand; words are left alone.
const PLAIN_MATH = /(?<![A-Za-z0-9$\\])(?:\d+(?:\.\d+)?|[A-Za-z](?![A-Za-z])|[+\-−×÷*/=<>≤≥^()]| (?=[\dA-Za-z+\-−×÷*/=<>≤≥(]))+/g;
function mathifyPlain(text) {
  return text.replace(PLAIN_MATH, (run) => {
    const body = run.trim();
    if (body.length < 3 || !/[=+\-−×÷*/<>≤≥^]/.test(body) || !/[\dA-Za-z]/.test(body)) return run;
    let depth = 0;
    for (const char of body) {
      if (char === "(") depth++;
      else if (char === ")" && --depth < 0) return run;
    }
    if (depth) return run;
    const tex = body
      .replace(/−/g, "-").replace(/×|\*/g, "\\times ").replace(/÷/g, "\\div ")
      .replace(/≤/g, "\\le ").replace(/≥/g, "\\ge ")
      .replace(/(?<![\d.)A-Za-z])(\d+)\/(\d+)(?![\d.(A-Za-z])/g, "\\frac{$1}{$2}")
      .replace(/\s+/g, " ").trim();
    return run.slice(0, run.length - run.trimStart().length) + "$" + tex + "$" + run.slice(run.trimEnd().length);
  });
}
function mathify(line) {
  if (/`|\\\(|\\\[/.test(line)) return line;
  // Odd-indexed pieces are existing $...$ math and stay as they are.
  return line.split(/(\$\$?[^$]*\$\$?)/).map((piece, index) => index % 2 ? piece : mathifyPlain(piece)).join("");
}

// Mark each line with its role so the client can size and colour it by importance:
// "## " the verdict (larger; green, red or amber), "> " a side remark (smaller, grey),
// **...** the phrase to notice (orange). Everything else is body text.
const OK_MARK = /^[\u2713\u2714\u221a]\s*/, BAD_MARK = /^[\u2717\u2718]\s*/;
const REMARK = /^[\uff08(]?(?:\u9a8c\u7b97|\u68c0\u9a8c|\u4ee3\u5165\u9a8c\u8bc1|\u6ce8\u610f|\u5907\u6ce8|\u6ce8|PS)\s*[\uff1a:]/i;
const HINT_LABEL = /^(\u63d0\u793a|\u601d\u8def|\u60f3\u4e00\u60f3)\s*[\uff1a:]\s*/;
function emphasize(lines) {
  const out = [];
  let verdictDone = false;
  for (const source of lines) {
    let line = source.replace(/^\s*(?:#{1,3}|>|[-+*])\s+/, "");
    if (!line.trim()) {
      out.push("");
      continue;
    }
    if (!verdictDone) {
      verdictDone = true;
      const mark = OK_MARK.test(line) ? "\u2713 " : BAD_MARK.test(line) ? "\u2717 " : "";
      if (mark) {
        const body = line.replace(OK_MARK, "").replace(BAD_MARK, "").replace(/\*\*/g, ""),
          // A long verdict keeps its first clause as the headline; the rest becomes body text.
          cut = lineWidthEm(body) > 20 ? body.search(/[\u3002\uff1b\uff0c\uff1a;,:]/) : -1;
        if (cut > 0 && cut < body.length - 1) {
          out.push(`## ${mark}${body.slice(0, cut)}`, body.slice(cut + 1).trim());
        } else out.push(`## ${mark}${body}`);
        continue;
      }
      const label = HINT_LABEL.exec(line);
      if (label && !line.startsWith("**")) {
        out.push(`**${label[1]}\uff1a**${line.slice(label[0].length)}`);
        continue;
      }
    }
    if (REMARK.test(line)) {
      // A conclusion tacked onto the remark ("...。所以 x=-2") is body text, not a side note.
      const plain = line.replace(/\*\*/g, ""),
        turn = plain.search(/[。；](?=\s*(?:所以|因此|故|可见))/);
      if (turn > 0 && turn < plain.length - 1) out.push(`> ${plain.slice(0, turn + 1)}`, plain.slice(turn + 1).trim());
      else out.push(`> ${plain}`);
      continue;
    }
    // Where the error is: always worth a highlight if the model gave none.
    if (!line.includes("**")) line = line.replace(/\u7b2c\s*[\d\u4e00-\u5341]+\s*[\u884c\u6b65]/, (place) => `**${place}**`);
    out.push(line);
  }
  return out;
}

// Rough rendered width of one line, in em. CJK and full-width forms are 1em, the rest about half.
function lineWidthEm(line) {
  const visible = String(line)
    .replace(/\\(?:d?frac|sqrt|left|right|text|mathrm|mathbf|operatorname)(?![A-Za-z])/g, "")
    .replace(/\\[A-Za-z]+/g, "x")
    .replace(/[${}^_\\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/^(?:## |> )/, "");
  let width = 0;
  for (const char of visible) width += /[⺀-鿿豈-﫿︰-﹏＀-￯←-⇿✓✗]/.test(char) ? 1 : 0.64;
  return width * (String(line).startsWith("## ") ? 1.2 : String(line).startsWith("> ") ? 0.86 : 1);
}

// Merge the reply's write_text and draw_formula commands into one block; other commands
// (draw annotations, plots, erasers) pass through untouched.
function arrange(commands, payload) {
  if (!Array.isArray(commands) || !applies(payload)) return commands;
  const flow = commands.filter((command) => (command?.tool === "write_text" && typeof command.text === "string" && command.text.trim()
      || command?.tool === "draw_formula" && typeof command.latex === "string" && command.latex.trim())
      && Number.isFinite(command.x) && Number.isFinite(command.y));
  if (!flow.length) return commands;
  const view = finiteBox(payload.visibleRect) || finiteBox(payload.captureRect);
  if (!view) return commands;
  const ordered = [...flow].sort((a, b) => a.y - b.y || a.x - b.x),
    lines = emphasize(ordered.flatMap((command) => command.tool === "write_text" ? textLines(command.text).map(mathify) : formulaLines(command.latex)));
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  // A staged check that found a problem ends with how many guided checks are left.
  const footer = payload.suggestion === "check_step" && !/^## \u2713/.test(lines[0] || "") ? checkFooter(payload.tutorCheck, payload.tutorCheckLimit) : "";
  if (footer) lines.push(footer);
  const text = lines.join("\n").slice(0, MAX_TEXT);
  if (!text.trim()) return commands;
  // The client makes the final choice of size and width (it knows the student's handwriting
  // size and the real viewport) from tutorWidthEm. The numbers here are a fallback: about 52
  // characters across the screen. Some requests report the whole 20000-unit canvas as the
  // visible area; that says nothing about the screen, so it is ignored.
  const known = view.w <= 6000,
    fontSize = known ? Math.round(Math.max(24, Math.min(80, view.w / 52))) : 32,
    margin = fontSize * 1.5,
    longest = Math.max(...lines.map(lineWidthEm)),
    widthEm = Math.max(12, Math.min(26, longest + 2)),
    room = known ? Math.max(fontSize * 8, view.w - margin * 2) : fontSize * 26,
    maxWidth = Math.round(Math.min(room, fontSize * widthEm)),
    left = Math.min(...flow.map((command) => command.x)),
    top = Math.min(...flow.map((command) => command.y)),
    x = Math.round(known ? Math.max(view.x + margin / 2, Math.min(left, view.x + view.w - margin / 2 - maxWidth)) : left),
    y = Math.round(Math.max(0, top)),
    block = { tool: "write_text", x: Math.max(0, x), y, text, fontSize, maxWidth, lineHeight: 1.5, tutorLayout: true, tutorWidthEm: Math.round(widthEm * 10) / 10 };
  const first = commands.indexOf(ordered[0]);
  return commands.flatMap((command, index) => index === first ? [block] : flow.includes(command) ? [] : [command]);
}

module.exports = { FORMAT, STRIKE_POLICY, HINT_PROMPT, checkPrompt, checkFooter, applies, arrange, formulaLines, lineWidthEm, mathify, emphasize };
