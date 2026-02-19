import { app } from "/scripts/app.js";

const DEFAULT_THEME = { bg: "#0f111a", fg: "#c0caf5", comment: "#565f89" };
const PALETTE = {
  bg: ["#0f111a", "#111111", "#1a1b26", "#202020", "#f7f7f7"],
  fg: ["#c0caf5", "#e5e9f0", "#d8dee9", "#111111", "#f8f8f2"],
  comment: ["#565f89", "#6b7280", "#7f8ea3", "#4b5563", "#9ca3af"],
};

function isCommentLine(line, prefix, mode) {
  if (!prefix) return false;
  return mode === "strict" ? line.startsWith(prefix) : line.trimStart().startsWith(prefix);
}

function shouldToggleComment(event) {
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.code === "Slash" || event.code === "NumpadDivide") return true;
  if (event.key === "/") return true;
  return false;
}

function toggleLinesInText(text, selStart, selEnd, prefix) {
  const start = Math.max(0, selStart ?? 0);
  const end = Math.max(start, selEnd ?? start);
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nlAfterEnd = text.indexOf("\n", end);
  const blockEnd = nlAfterEnd === -1 ? text.length : nlAfterEnd;
  const block = text.slice(lineStart, blockEnd);
  const lines = block.split("\n");
  const allCommented = lines.every((l) => l.trimStart().startsWith(prefix));

  const out = lines.map((l) => {
    if (!allCommented) return `${prefix}${l}`;
    const i = l.indexOf(prefix);
    return i >= 0 ? l.slice(0, i) + l.slice(i + prefix.length) : l;
  }).join("\n");

  const newText = text.slice(0, lineStart) + out + text.slice(blockEnd);
  return { newText, newSelStart: lineStart, newSelEnd: lineStart + out.length };
}

async function api(path, init = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch {}
    throw new Error(body.error || `${res.status}`);
  }
  return await res.json();
}

function minimizeNativeWidget(widget) {
  if (!widget) return;
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
}

let cm6Promise = null;
async function loadCM6() {
  if (!cm6Promise) {
    cm6Promise = (async () => {
      try {
        const [stateMod, viewMod, commandsMod, languageMod, searchMod, autocompMod] = await Promise.all([
          import("https://esm.sh/@codemirror/state@6.4.1"),
          import("https://esm.sh/@codemirror/view@6.28.1"),
          import("https://esm.sh/@codemirror/commands@6.6.0"),
          import("https://esm.sh/@codemirror/language@6.10.2"),
          import("https://esm.sh/@codemirror/search@6.5.6"),
          import("https://esm.sh/@codemirror/autocomplete@6.18.1"),
        ]);
        return { ...stateMod, ...viewMod, ...commandsMod, ...languageMod, ...searchMod, ...autocompMod };
      } catch {
        const [stateMod, viewMod, commandsMod, languageMod, searchMod, autocompMod] = await Promise.all([
          import("https://cdn.jsdelivr.net/npm/@codemirror/state@6.4.1/dist/index.js"),
          import("https://cdn.jsdelivr.net/npm/@codemirror/view@6.28.1/dist/index.js"),
          import("https://cdn.jsdelivr.net/npm/@codemirror/commands@6.6.0/dist/index.js"),
          import("https://cdn.jsdelivr.net/npm/@codemirror/language@6.10.2/dist/index.js"),
          import("https://cdn.jsdelivr.net/npm/@codemirror/search@6.5.6/dist/index.js"),
          import("https://cdn.jsdelivr.net/npm/@codemirror/autocomplete@6.18.1/dist/index.js"),
        ]);
        return { ...stateMod, ...viewMod, ...commandsMod, ...languageMod, ...searchMod, ...autocompMod };
      }
    })();
  }
  return cm6Promise;
}

function selectFromPalette(values, current) {
  const el = document.createElement("select");
  values.forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  });
  if (values.includes(current)) el.value = current;
  return el;
}

function createFallbackEditor(editorHost, textWidget, getPrefix, getMode, themeValues) {
  const ta = document.createElement("textarea");
  ta.value = textWidget.value || "";
  ta.style.cssText = `width:100%; min-height:340px; box-sizing:border-box; border:none; outline:none; resize:vertical; padding:10px; background:${themeValues.bg()}; color:${themeValues.fg()}; font:13px/1.45 ui-monospace, monospace;`;

  ta.addEventListener("input", () => { textWidget.value = ta.value; });
  ta.addEventListener("keydown", (ev) => {
    if (shouldToggleComment(ev)) {
      ev.preventDefault();
      const out = toggleLinesInText(ta.value, ta.selectionStart, ta.selectionEnd, getPrefix());
      ta.value = out.newText;
      ta.selectionStart = out.newSelStart;
      ta.selectionEnd = out.newSelEnd;
      textWidget.value = ta.value;
    }
  });

  editorHost.appendChild(ta);

  return {
    mode: "fallback",
    setText(v) { ta.value = v || ""; textWidget.value = ta.value; },
    getText() { return ta.value || ""; },
    refreshComments() {},
    applyTheme() {
      ta.style.background = themeValues.bg();
      ta.style.color = themeValues.fg();
      ta.style.caretColor = themeValues.fg();
    },
    toggleCommentSelection() {
      const out = toggleLinesInText(ta.value, ta.selectionStart, ta.selectionEnd, getPrefix());
      ta.value = out.newText;
      ta.selectionStart = out.newSelStart;
      ta.selectionEnd = out.newSelEnd;
      textWidget.value = ta.value;
    },
  };
}

app.registerExtension({
  name: "ComfyUI.ScribblePad",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "ScribblePad") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;

    nodeType.prototype.onNodeCreated = async function () {
      const result = onNodeCreated?.apply(this, arguments);
      const textWidget = this.widgets?.find((w) => w.name === "text");
      const prefixWidget = this.widgets?.find((w) => w.name === "comment_prefix");
      const modeWidget = this.widgets?.find((w) => w.name === "comment_mode");
      if (!textWidget) return result;

      minimizeNativeWidget(textWidget);

      const state = { presets: [] };
      const panel = document.createElement("div");
      panel.style.cssText = `display:flex; flex-direction:column; gap:6px; background:${DEFAULT_THEME.bg}; color:${DEFAULT_THEME.fg}; padding:8px; border-radius:8px;`;

      const controls = document.createElement("div");
      controls.style.cssText = "display:flex; gap:6px; align-items:center; flex-wrap:wrap;";
      const presetSearch = document.createElement("input"); presetSearch.placeholder = "preset search";
      const presetSelect = document.createElement("select");
      const presetName = document.createElement("input"); presetName.placeholder = "preset name";
      const btnLoad = document.createElement("button"); btnLoad.textContent = "Load";
      const btnSave = document.createElement("button"); btnSave.textContent = "Save/Update";
      const btnDelete = document.createElement("button"); btnDelete.textContent = "Delete";
      const btnComment = document.createElement("button"); btnComment.textContent = "Comment/Uncomment";
      const status = document.createElement("span");
      status.style.cssText = "font-size:11px; opacity:0.85; padding:2px 6px; border:1px solid #3a3f58; border-radius:999px;";
      controls.append(presetSearch, presetSelect, presetName, btnLoad, btnSave, btnDelete, btnComment, status);

      const themeRow = document.createElement("div");
      themeRow.style.cssText = "display:flex; gap:6px; align-items:center; flex-wrap:wrap;";
      const bgSel = selectFromPalette(PALETTE.bg, DEFAULT_THEME.bg);
      const fgSel = selectFromPalette(PALETTE.fg, DEFAULT_THEME.fg);
      const cmSel = selectFromPalette(PALETTE.comment, DEFAULT_THEME.comment);
      const resetThemeBtn = document.createElement("button"); resetThemeBtn.textContent = "Theme: Reset";
      themeRow.append("BG", bgSel, "FG", fgSel, "Comment", cmSel, resetThemeBtn);

      const editorHost = document.createElement("div");
      editorHost.style.cssText = "border:1px solid #2a2f45; border-radius:6px; overflow:hidden; min-height:340px;";

      panel.append(controls, themeRow, editorHost);
      const host = this.addDOMWidget("scribblepad", "scribblepad", panel, { serialize: false, hideOnZoom: false });
      host.computeSize = () => [Math.max(760, this.size[0]), 520];

      const refreshPresetOptions = () => {
        const q = (presetSearch.value || "").toLowerCase();
        presetSelect.innerHTML = "";
        const blank = document.createElement("option"); blank.value = ""; blank.textContent = "(preset)"; presetSelect.appendChild(blank);
        state.presets.filter((p) => !q || p.name.toLowerCase().includes(q)).forEach((p) => {
          const opt = document.createElement("option"); opt.value = p.name; opt.textContent = p.name; presetSelect.appendChild(opt);
        });
      };

      const loadPresets = async () => {
        const data = await api("/scribblepad/presets");
        state.presets = data.presets || [];
        refreshPresetOptions();
      };

      const getPrefix = () => prefixWidget?.value || "//";
      const getMode = () => modeWidget?.value || "loose";
      const themeValues = { bg: () => bgSel.value, fg: () => fgSel.value, comment: () => cmSel.value };

      let backend;

      try {
        const CM = await loadCM6();
        const {
          EditorState, Compartment, RangeSetBuilder, StateField, EditorView, Decoration, keymap,
          lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter,
          rectangularSelection, crosshairCursor, dropCursor, history, historyKeymap,
          defaultKeymap, indentWithTab, bracketMatching, foldGutter, foldKeymap,
          closeBrackets, closeBracketsKeymap, searchKeymap, autocompletion, completionKeymap,
        } = CM;

        const themeCompartment = new Compartment();
        const commentCompartment = new Compartment();

        const commentField = () => StateField.define({
          create(st) {
            const b = new RangeSetBuilder();
            for (let i = 1; i <= st.doc.lines; i++) {
              const line = st.doc.line(i);
              if (isCommentLine(line.text, getPrefix(), getMode())) {
                b.add(line.from, line.from, Decoration.line({ attributes: { class: "sp-comment-line" } }));
              }
            }
            return b.finish();
          },
          update(_, tr) {
            const b = new RangeSetBuilder();
            for (let i = 1; i <= tr.state.doc.lines; i++) {
              const line = tr.state.doc.line(i);
              if (isCommentLine(line.text, getPrefix(), getMode())) {
                b.add(line.from, line.from, Decoration.line({ attributes: { class: "sp-comment-line" } }));
              }
            }
            return b.finish();
          },
          provide: (f) => EditorView.decorations.from(f),
        });

        const themeExt = () => EditorView.theme({
          "&": { backgroundColor: themeValues.bg(), color: themeValues.fg(), height: "360px" },
          ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "13px", lineHeight: "1.45" },
          ".cm-content": { caretColor: themeValues.fg() },
          ".cm-gutters": { backgroundColor: themeValues.bg(), color: "#6b7190", border: "none" },
          ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.04)" },
          ".cm-line.sp-comment-line": { color: `${themeValues.comment()} !important` },
        });

        const toggleLineCommentCM = (view) => {
          const sels = view.state.selection.ranges;
          if (!sels.length) return false;

          const changes = [];
          for (const range of sels) {
            const out = toggleLinesInText(
              view.state.doc.toString(),
              range.from,
              range.to,
              getPrefix()
            );
            changes.length = 0;
            changes.push({ from: 0, to: view.state.doc.length, insert: out.newText });
            view.dispatch({ changes, selection: { anchor: out.newSelStart, head: out.newSelEnd }, userEvent: "input" });
            return true;
          }
          return false;
        };

        const view = new EditorView({
          state: EditorState.create({
            doc: textWidget.value || "",
            extensions: [
              lineNumbers(), highlightActiveLineGutter(), history(), drawSelection(), dropCursor(),
              EditorState.allowMultipleSelections.of(true), foldGutter(), rectangularSelection(), crosshairCursor(),
              highlightActiveLine(), bracketMatching(), closeBrackets(), autocompletion(), EditorView.lineWrapping,
              keymap.of([
                indentWithTab,
                { key: "Mod-/", run: toggleLineCommentCM },
                { key: "Ctrl-/", run: toggleLineCommentCM },
                { key: "Cmd-/", run: toggleLineCommentCM },
                ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap,
              ]),
              EditorView.domEventHandlers({
                keydown: (event, v) => {
                  if (shouldToggleComment(event)) {
                    event.preventDefault();
                    return toggleLineCommentCM(v);
                  }
                  return false;
                },
              }),
              EditorView.updateListener.of((vu) => { if (vu.docChanged) textWidget.value = vu.state.doc.toString(); }),
              themeCompartment.of(themeExt()),
              commentCompartment.of(commentField()),
            ],
          }),
          parent: editorHost,
        });

        backend = {
          mode: "cm6",
          setText(v) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v || "" } }); },
          getText() { return view.state.doc.toString(); },
          refreshComments() { view.dispatch({ effects: commentCompartment.reconfigure(commentField()) }); },
          applyTheme() {
            panel.style.background = themeValues.bg();
            panel.style.color = themeValues.fg();
            view.dispatch({ effects: themeCompartment.reconfigure(themeExt()) });
          },
          toggleCommentSelection() {
            toggleLineCommentCM(view);
          },
        };
      } catch (err) {
        console.error("[ScribblePad] CM6 unavailable, using fallback", err);
        backend = createFallbackEditor(editorHost, textWidget, getPrefix, getMode, themeValues);
      }

      status.textContent = backend.mode === "cm6" ? "CM6 active" : "Fallback active";

      const applyTheme = () => {
        backend.applyTheme();
        backend.refreshComments();
      };

      btnComment.onclick = () => backend.toggleCommentSelection();

      btnLoad.onclick = () => {
        const name = presetSelect.value;
        if (!name) return;
        const p = state.presets.find((x) => x.name === name);
        if (!p) return;
        backend.setText(p.text || "");
        const t = { ...DEFAULT_THEME, ...(p.theme || {}) };
        bgSel.value = PALETTE.bg.includes(t.bg) ? t.bg : DEFAULT_THEME.bg;
        fgSel.value = PALETTE.fg.includes(t.fg) ? t.fg : DEFAULT_THEME.fg;
        cmSel.value = PALETTE.comment.includes(t.comment) ? t.comment : DEFAULT_THEME.comment;
        presetName.value = name;
        applyTheme();
      };

      btnSave.onclick = async () => {
        const name = (presetName.value || "").trim();
        if (!name) return;
        const data = await api("/scribblepad/presets", {
          method: "POST",
          body: JSON.stringify({
            name,
            text: backend.getText(),
            theme: { bg: bgSel.value, fg: fgSel.value, comment: cmSel.value },
          }),
        });
        state.presets = data.presets || [];
        refreshPresetOptions();
        presetSelect.value = name;
      };

      btnDelete.onclick = async () => {
        const name = presetSelect.value || (presetName.value || "").trim();
        if (!name) return;
        const data = await api(`/scribblepad/presets/${encodeURIComponent(name)}`, { method: "DELETE" });
        state.presets = data.presets || [];
        refreshPresetOptions();
      };

      [bgSel, fgSel, cmSel].forEach((el) => el.addEventListener("change", applyTheme));
      resetThemeBtn.onclick = () => {
        bgSel.value = DEFAULT_THEME.bg;
        fgSel.value = DEFAULT_THEME.fg;
        cmSel.value = DEFAULT_THEME.comment;
        applyTheme();
      };

      [prefixWidget, modeWidget].forEach((w) => {
        if (!w) return;
        const orig = w.callback;
        w.callback = (...args) => { orig?.(...args); backend.refreshComments(); };
      });

      presetSearch.addEventListener("input", refreshPresetOptions);

      await loadPresets();
      applyTheme();

      return result;
    };
  },
});
