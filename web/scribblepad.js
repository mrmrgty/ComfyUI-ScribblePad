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
      const [stateMod, viewMod, commandsMod, languageMod, searchMod, autocompMod] = await Promise.all([
        import("https://esm.sh/@codemirror/state@6.4.1"),
        import("https://esm.sh/@codemirror/view@6.28.1"),
        import("https://esm.sh/@codemirror/commands@6.6.0"),
        import("https://esm.sh/@codemirror/language@6.10.2"),
        import("https://esm.sh/@codemirror/search@6.5.6"),
        import("https://esm.sh/@codemirror/autocomplete@6.18.1"),
      ]);
      return { ...stateMod, ...viewMod, ...commandsMod, ...languageMod, ...searchMod, ...autocompMod };
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

function setupPlainFallback(editorHost, textWidget, theme) {
  const ta = document.createElement("textarea");
  ta.value = textWidget.value || "";
  ta.style.cssText = `width:100%; min-height:340px; box-sizing:border-box; border:none; outline:none; resize:vertical; padding:10px; background:${theme.bg}; color:${theme.fg}; font:13px/1.45 ui-monospace, monospace;`;
  ta.addEventListener("input", () => (textWidget.value = ta.value));
  editorHost.appendChild(ta);
  return {
    setText(v) { ta.value = v || ""; textWidget.value = ta.value; },
    getText() { return ta.value || ""; },
    refreshComments() {},
    applyTheme(t) { ta.style.background = t.bg; ta.style.color = t.fg; },
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

      const state = { presets: [], theme: { ...DEFAULT_THEME } };
      const panel = document.createElement("div");
      panel.style.cssText = `display:flex; flex-direction:column; gap:6px; background:${state.theme.bg}; color:${state.theme.fg}; padding:8px; border-radius:8px;`;

      const controls = document.createElement("div");
      controls.style.cssText = "display:flex; gap:6px; align-items:center; flex-wrap:wrap;";
      const presetSearch = document.createElement("input"); presetSearch.placeholder = "preset search";
      const presetSelect = document.createElement("select");
      const presetName = document.createElement("input"); presetName.placeholder = "preset name";
      const btnLoad = document.createElement("button"); btnLoad.textContent = "Load";
      const btnSave = document.createElement("button"); btnSave.textContent = "Save/Update";
      const btnDelete = document.createElement("button"); btnDelete.textContent = "Delete";
      controls.append(presetSearch, presetSelect, presetName, btnLoad, btnSave, btnDelete);

      const themeRow = document.createElement("div");
      themeRow.style.cssText = "display:flex; gap:6px; align-items:center; flex-wrap:wrap;";
      const bgSel = selectFromPalette(PALETTE.bg, state.theme.bg);
      const fgSel = selectFromPalette(PALETTE.fg, state.theme.fg);
      const cmSel = selectFromPalette(PALETTE.comment, state.theme.comment);
      const resetThemeBtn = document.createElement("button");
      resetThemeBtn.textContent = "Theme: Reset";
      themeRow.append("BG", bgSel, "FG", fgSel, "Comment", cmSel, resetThemeBtn);

      const editorHost = document.createElement("div");
      editorHost.style.cssText = "border:1px solid #2a2f45; border-radius:6px; overflow:hidden; min-height:340px;";
      panel.append(controls, themeRow, editorHost);

      const host = this.addDOMWidget("scribblepad", "scribblepad", panel, { serialize: false, hideOnZoom: false });
      host.computeSize = () => [Math.max(700, this.size[0]), 500];

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

      let backend = null;
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
          "&": { backgroundColor: bgSel.value, color: fgSel.value, height: "340px" },
          ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "13px", lineHeight: "1.45" },
          ".cm-content": { caretColor: fgSel.value },
          ".cm-gutters": { backgroundColor: bgSel.value, color: "#6b7190", border: "none" },
          ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.04)" },
          ".cm-line.sp-comment-line": { color: `${cmSel.value} !important` },
        });

        const toggleLineComment = (view) => {
          const prefix = getPrefix();
          const changes = [];
          for (const range of view.state.selection.ranges) {
            const fromLine = view.state.doc.lineAt(range.from).number;
            const toLine = view.state.doc.lineAt(range.to).number;
            let all = true;
            for (let n = fromLine; n <= toLine; n++) {
              if (!view.state.doc.line(n).text.trimStart().startsWith(prefix)) { all = false; break; }
            }
            for (let n = fromLine; n <= toLine; n++) {
              const line = view.state.doc.line(n);
              if (!all) changes.push({ from: line.from, to: line.from, insert: prefix });
              else {
                const i = line.text.indexOf(prefix);
                if (i >= 0) changes.push({ from: line.from + i, to: line.from + i + prefix.length, insert: "" });
              }
            }
          }
          if (!changes.length) return false;
          view.dispatch({ changes, userEvent: "input" });
          return true;
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
                { key: "Mod-/", run: toggleLineComment },
                { key: "Ctrl-/", run: toggleLineComment },
                ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap,
              ]),
              EditorView.domEventHandlers({
                keydown: (event, v) => {
                  if ((event.ctrlKey || event.metaKey) && (event.key === "/" || event.code === "Slash")) {
                    event.preventDefault();
                    return toggleLineComment(v);
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
          setText(v) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v || "" } }); },
          getText() { return view.state.doc.toString(); },
          refreshComments() { view.dispatch({ effects: commentCompartment.reconfigure(commentField()) }); },
          applyTheme() {
            panel.style.background = bgSel.value;
            panel.style.color = fgSel.value;
            view.dispatch({ effects: themeCompartment.reconfigure(themeExt()) });
          },
        };
      } catch (err) {
        console.error("[ScribblePad] CM6 unavailable, using plain fallback", err);
        backend = setupPlainFallback(editorHost, textWidget, { bg: bgSel.value, fg: fgSel.value });
      }

      const applyTheme = () => {
        backend.applyTheme({ bg: bgSel.value, fg: fgSel.value, comment: cmSel.value });
        backend.refreshComments();
      };

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
