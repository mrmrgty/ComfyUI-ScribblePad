import { app } from "/scripts/app.js";

const DEFAULT_THEME = { bg: "#0f111a", fg: "#c0caf5", comment: "#565f89" };

function isCommentLine(line, prefix, mode) {
  if (!prefix) return false;
  return mode === "strict" ? line.startsWith(prefix) : line.trimStart().startsWith(prefix);
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
async function importFrom(base) {
  const [stateMod, viewMod, commandsMod, languageMod, searchMod, autocompMod] = await Promise.all([
    import(`${base}/@codemirror/state@6.4.1`),
    import(`${base}/@codemirror/view@6.28.1`),
    import(`${base}/@codemirror/commands@6.6.0`),
    import(`${base}/@codemirror/language@6.10.2`),
    import(`${base}/@codemirror/search@6.5.6`),
    import(`${base}/@codemirror/autocomplete@6.18.1`),
  ]);
  return { ...stateMod, ...viewMod, ...commandsMod, ...languageMod, ...searchMod, ...autocompMod };
}

async function loadCM6() {
  if (!cm6Promise) {
    cm6Promise = (async () => {
      try {
        return await importFrom("https://esm.sh");
      } catch {
        return await importFrom("https://cdn.jsdelivr.net/npm");
      }
    })();
  }
  return cm6Promise;
}

function setupFallbackEditor(editorHost, textWidget, getPrefix, getMode, themeInputs) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative; min-height:340px;";

  const hl = document.createElement("pre");
  hl.style.cssText = `margin:0; position:absolute; inset:0; pointer-events:none; white-space:pre-wrap; word-break:break-word; padding:10px; font:13px/1.45 ui-monospace, monospace;`;

  const ta = document.createElement("textarea");
  ta.value = textWidget.value || "";
  ta.spellcheck = false;
  ta.style.cssText = `position:absolute; inset:0; width:100%; height:100%; border:none; outline:none; resize:none; box-sizing:border-box; padding:10px; background:transparent; color:transparent; -webkit-text-fill-color:transparent; font:13px/1.45 ui-monospace, monospace;`;

  const render = () => {
    const prefix = getPrefix();
    const mode = getMode();
    const fg = themeInputs.fg.value;
    const cm = themeInputs.comment.value;
    const lines = (ta.value || "").split("\n");
    hl.innerHTML = lines
      .map((line) => `<span style="color:${isCommentLine(line, prefix, mode) ? cm : fg}">${escapeHtml(line || " ")}</span>`)
      .join("\n");
    textWidget.value = ta.value || "";
  };

  const applyTheme = () => {
    wrap.style.background = themeInputs.bg.value;
    ta.style.caretColor = themeInputs.fg.value;
    render();
  };

  ta.addEventListener("input", render);
  ta.addEventListener("scroll", () => {
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  });
  ta.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === "/" || ev.code === "Slash")) {
      ev.preventDefault();
      const prefix = getPrefix();
      const txt = ta.value;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      const ls = txt.lastIndexOf("\n", s - 1) + 1;
      const le = txt.indexOf("\n", e);
      const be = le === -1 ? txt.length : le;
      const block = txt.slice(ls, be).split("\n");
      const all = block.every((l) => l.trimStart().startsWith(prefix));
      const out = block.map((l) => {
        if (!all) return `${prefix}${l}`;
        const i = l.indexOf(prefix);
        return i >= 0 ? l.slice(0, i) + l.slice(i + prefix.length) : l;
      }).join("\n");
      ta.value = txt.slice(0, ls) + out + txt.slice(be);
      ta.selectionStart = ls;
      ta.selectionEnd = ls + out.length;
      render();
    }
  });

  wrap.append(hl, ta);
  editorHost.appendChild(wrap);
  applyTheme();

  return {
    setText(v) { ta.value = v || ""; render(); },
    getText() { return ta.value || ""; },
    refreshComments: render,
    applyTheme,
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

      const state = { presets: [], loadedPreset: "", theme: { ...DEFAULT_THEME } };
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
      const btnExport = document.createElement("button"); btnExport.textContent = "Export";
      controls.append(presetSearch, presetSelect, presetName, btnLoad, btnSave, btnDelete, btnExport);

      const themeRow = document.createElement("div");
      themeRow.style.cssText = "display:flex; gap:6px; align-items:center;";
      const bgInput = document.createElement("input"); bgInput.type = "color"; bgInput.value = state.theme.bg;
      const fgInput = document.createElement("input"); fgInput.type = "color"; fgInput.value = state.theme.fg;
      const commentInput = document.createElement("input"); commentInput.type = "color"; commentInput.value = state.theme.comment;
      themeRow.append("BG", bgInput, "FG", fgInput, "Comment", commentInput);

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

      let cm = null;
      let fallback = null;

      const getPrefix = () => prefixWidget?.value || "//";
      const getMode = () => modeWidget?.value || "loose";

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
          "&": { backgroundColor: bgInput.value, color: fgInput.value, height: "340px" },
          ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "13px", lineHeight: "1.45" },
          ".cm-content": { caretColor: fgInput.value },
          ".cm-gutters": { backgroundColor: bgInput.value, color: "#6b7190", border: "none" },
          ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.04)" },
          ".cm-line.sp-comment-line": { color: commentInput.value + " !important" },
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
                { key: "Cmd-/", run: toggleLineComment },
                ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap,
              ]),
              EditorView.domEventHandlers({
                keydown: (event, view) => {
                  if ((event.ctrlKey || event.metaKey) && (event.key === "/" || event.code === "Slash")) {
                    event.preventDefault();
                    return toggleLineComment(view);
                  }
                  return false;
                },
              }),
              EditorView.updateListener.of((vu) => {
                if (vu.docChanged) textWidget.value = vu.state.doc.toString();
              }),
              themeCompartment.of(themeExt()),
              commentCompartment.of(commentField()),
            ],
          }),
          parent: editorHost,
        });

        cm = {
          setText(v) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v || "" } });
          },
          getText() { return view.state.doc.toString(); },
          refreshComments() {
            view.dispatch({ effects: commentCompartment.reconfigure(commentField()) });
          },
          applyTheme() {
            panel.style.background = bgInput.value;
            panel.style.color = fgInput.value;
            view.dispatch({ effects: themeCompartment.reconfigure(themeExt()) });
          },
        };
      } catch (e) {
        console.error("[ScribblePad] CM6 unavailable; fallback editor enabled", e);
        fallback = setupFallbackEditor(editorHost, textWidget, getPrefix, getMode, { bg: bgInput, fg: fgInput, comment: commentInput });
      }

      const active = () => cm || fallback;

      btnLoad.onclick = () => {
        const name = presetSelect.value;
        if (!name) return;
        const p = state.presets.find((x) => x.name === name);
        if (!p) return;
        active()?.setText(p.text || "");
        state.loadedPreset = name;
        presetName.value = name;
        const t = { ...DEFAULT_THEME, ...(p.theme || {}) };
        bgInput.value = t.bg; fgInput.value = t.fg; commentInput.value = t.comment;
        active()?.applyTheme();
        active()?.refreshComments();
      };

      btnSave.onclick = async () => {
        const name = (presetName.value || "").trim();
        if (!name) return;
        const data = await api("/scribblepad/presets", {
          method: "POST",
          body: JSON.stringify({
            name,
            text: active()?.getText() || "",
            theme: { bg: bgInput.value, fg: fgInput.value, comment: commentInput.value },
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

      btnExport.onclick = async () => {
        const data = await api("/scribblepad/presets");
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "scribblepad-presets.json"; a.click();
        URL.revokeObjectURL(url);
      };

      presetSearch.addEventListener("input", refreshPresetOptions);
      [bgInput, fgInput, commentInput].forEach((el) => el.addEventListener("input", () => {
        active()?.applyTheme();
        active()?.refreshComments();
      }));

      const rehighlight = () => active()?.refreshComments();
      [prefixWidget, modeWidget].forEach((w) => {
        if (!w) return;
        const orig = w.callback;
        w.callback = (...args) => { orig?.(...args); rehighlight(); };
      });

      await loadPresets();
      active()?.applyTheme();
      active()?.refreshComments();

      return result;
    };
  },
});
