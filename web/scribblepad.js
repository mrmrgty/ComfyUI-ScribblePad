import { app } from "/scripts/app.js";

/**
 * ScribblePad (CodeMirror 6 edition)
 *
 * Notes:
 * - Uses ESM CDN modules to avoid a build step in ComfyUI custom_nodes.
 * - Keeps the native Comfy widget hidden but synchronized for workflow serialization.
 */

const DEFAULT_THEME = {
  bg: "#0f111a",
  fg: "#c0caf5",
  comment: "#565f89",
};

function isCommentLine(line, prefix, mode) {
  if (!prefix) return false;
  return mode === "strict"
    ? line.startsWith(prefix)
    : line.trimStart().startsWith(prefix);
}

async function api(path, init = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let body;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw new Error(body.error || `${res.status}`);
  }
  return await res.json();
}

function minimizeNativeWidget(widget) {
  if (!widget) return;
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
}

async function loadCM6() {
  const [
    stateMod,
    viewMod,
    commandsMod,
    languageMod,
    searchMod,
    autocompMod,
  ] = await Promise.all([
    import("https://esm.sh/@codemirror/state@6.4.1"),
    import("https://esm.sh/@codemirror/view@6.28.1"),
    import("https://esm.sh/@codemirror/commands@6.6.0"),
    import("https://esm.sh/@codemirror/language@6.10.2"),
    import("https://esm.sh/@codemirror/search@6.5.6"),
    import("https://esm.sh/@codemirror/autocomplete@6.18.1"),
  ]);

  return {
    ...stateMod,
    ...viewMod,
    ...commandsMod,
    ...languageMod,
    ...searchMod,
    ...autocompMod,
  };
}

app.registerExtension({
  name: "ComfyUI.ScribblePad",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "ScribblePad") return;

    const CM = await loadCM6();

    const {
      EditorState,
      Compartment,
      RangeSetBuilder,
      StateField,
      EditorView,
      Decoration,
      keymap,
      lineNumbers,
      drawSelection,
      highlightActiveLine,
      highlightActiveLineGutter,
      rectangularSelection,
      crosshairCursor,
      dropCursor,
      history,
      historyKeymap,
      defaultKeymap,
      indentWithTab,
      bracketMatching,
      foldGutter,
      foldKeymap,
      closeBrackets,
      closeBracketsKeymap,
      searchKeymap,
      autocompletion,
      completionKeymap,
    } = CM;

    const onNodeCreated = nodeType.prototype.onNodeCreated;

    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);

      const textWidget = this.widgets?.find((w) => w.name === "text");
      const prefixWidget = this.widgets?.find((w) => w.name === "comment_prefix");
      const modeWidget = this.widgets?.find((w) => w.name === "comment_mode");

      if (!textWidget) return result;
      minimizeNativeWidget(textWidget);

      const state = {
        presets: [],
        loadedPreset: "",
        theme: { ...DEFAULT_THEME },
      };

      const panel = document.createElement("div");
      panel.className = "scribblepad-panel";
      panel.style.cssText = `
        display:flex;
        flex-direction:column;
        gap:6px;
        background:${state.theme.bg};
        color:${state.theme.fg};
        padding:8px;
        border-radius:8px;
      `;

      const controls = document.createElement("div");
      controls.style.cssText = "display:flex; gap:6px; align-items:center; flex-wrap:wrap;";

      const presetSearch = document.createElement("input");
      presetSearch.placeholder = "preset search";

      const presetSelect = document.createElement("select");
      const refreshPresetOptions = () => {
        const q = (presetSearch.value || "").toLowerCase();
        presetSelect.innerHTML = "";

        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "(preset)";
        presetSelect.appendChild(blank);

        state.presets
          .filter((p) => !q || p.name.toLowerCase().includes(q))
          .forEach((p) => {
            const opt = document.createElement("option");
            opt.value = p.name;
            opt.textContent = p.name;
            presetSelect.appendChild(opt);
          });
      };

      const presetName = document.createElement("input");
      presetName.placeholder = "preset name";

      const btnLoad = document.createElement("button");
      btnLoad.textContent = "Load";

      const btnSave = document.createElement("button");
      btnSave.textContent = "Save/Update";

      const btnDelete = document.createElement("button");
      btnDelete.textContent = "Delete";

      const btnExport = document.createElement("button");
      btnExport.textContent = "Export";

      controls.append(
        presetSearch,
        presetSelect,
        presetName,
        btnLoad,
        btnSave,
        btnDelete,
        btnExport
      );

      const themeRow = document.createElement("div");
      themeRow.style.cssText = "display:flex; gap:6px; align-items:center;";

      const bgInput = document.createElement("input");
      bgInput.type = "color";
      bgInput.value = state.theme.bg;

      const fgInput = document.createElement("input");
      fgInput.type = "color";
      fgInput.value = state.theme.fg;

      const commentInput = document.createElement("input");
      commentInput.type = "color";
      commentInput.value = state.theme.comment;

      themeRow.append("BG", bgInput, "FG", fgInput, "Comment", commentInput);

      const editorHost = document.createElement("div");
      editorHost.style.cssText = "border:1px solid #2a2f45; border-radius:6px; overflow:hidden; min-height:340px;";

      panel.append(controls, themeRow, editorHost);

      const themeCompartment = new Compartment();
      const commentCompartment = new Compartment();

      const commentDecorations = (prefixProvider, modeProvider) =>
        StateField.define({
          create(state) {
            const builder = new RangeSetBuilder();
            const prefix = prefixProvider();
            const mode = modeProvider();
            for (let i = 1; i <= state.doc.lines; i++) {
              const line = state.doc.line(i);
              if (isCommentLine(line.text, prefix, mode)) {
                builder.add(
                  line.from,
                  line.to,
                  Decoration.mark({ class: "sp-comment-line" })
                );
              }
            }
            return builder.finish();
          },
          update(deco, tr) {
            if (!tr.docChanged && !tr.reconfigured) return deco;
            const builder = new RangeSetBuilder();
            const prefix = prefixProvider();
            const mode = modeProvider();
            for (let i = 1; i <= tr.state.doc.lines; i++) {
              const line = tr.state.doc.line(i);
              if (isCommentLine(line.text, prefix, mode)) {
                builder.add(
                  line.from,
                  line.to,
                  Decoration.mark({ class: "sp-comment-line" })
                );
              }
            }
            return builder.finish();
          },
          provide: (f) => EditorView.decorations.from(f),
        });

      const makeTheme = () =>
        EditorView.theme({
          "&": {
            backgroundColor: bgInput.value,
            color: fgInput.value,
            height: "340px",
          },
          ".cm-scroller": {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "13px",
            lineHeight: "1.45",
          },
          ".cm-content": {
            caretColor: fgInput.value,
          },
          ".cm-gutters": {
            backgroundColor: bgInput.value,
            color: "#6b7190",
            border: "none",
          },
          ".cm-activeLine": {
            backgroundColor: "rgba(255,255,255,0.04)",
          },
          ".sp-comment-line": {
            color: commentInput.value,
          },
        });

      const toggleLineComment = (view) => {
        const prefix = prefixWidget?.value || "//";
        const changes = [];

        const ranges = view.state.selection.ranges;
        for (const range of ranges) {
          const fromLine = view.state.doc.lineAt(range.from).number;
          const toLine = view.state.doc.lineAt(range.to).number;

          let allCommented = true;
          for (let ln = fromLine; ln <= toLine; ln++) {
            const line = view.state.doc.line(ln).text;
            if (!line.trimStart().startsWith(prefix)) {
              allCommented = false;
              break;
            }
          }

          for (let ln = fromLine; ln <= toLine; ln++) {
            const line = view.state.doc.line(ln);
            if (allCommented) {
              const idx = line.text.indexOf(prefix);
              if (idx >= 0) {
                changes.push({
                  from: line.from + idx,
                  to: line.from + idx + prefix.length,
                  insert: "",
                });
              }
            } else {
              changes.push({ from: line.from, to: line.from, insert: prefix });
            }
          }
        }

        if (changes.length) {
          view.dispatch({ changes, userEvent: "input" });
          return true;
        }
        return false;
      };

      const editorView = new EditorView({
        state: EditorState.create({
          doc: textWidget.value || "",
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            history(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            foldGutter(),
            rectangularSelection(),
            crosshairCursor(),
            highlightActiveLine(),
            bracketMatching(),
            closeBrackets(),
            autocompletion(),
            keymap.of([
              indentWithTab,
              {
                key: "Mod-/",
                run: toggleLineComment,
              },
              ...closeBracketsKeymap,
              ...defaultKeymap,
              ...searchKeymap,
              ...historyKeymap,
              ...foldKeymap,
              ...completionKeymap,
            ]),
            EditorView.lineWrapping,
            EditorView.updateListener.of((vu) => {
              if (vu.docChanged) {
                textWidget.value = vu.state.doc.toString();
              }
            }),
            themeCompartment.of(makeTheme()),
            commentCompartment.of(
              commentDecorations(
                () => prefixWidget?.value || "//",
                () => modeWidget?.value || "loose"
              )
            ),
          ],
        }),
        parent: editorHost,
      });

      const reconfigureTheme = () => {
        panel.style.background = bgInput.value;
        panel.style.color = fgInput.value;

        editorView.dispatch({
          effects: themeCompartment.reconfigure(makeTheme()),
        });
      };

      const reconfigureCommentDecorations = () => {
        editorView.dispatch({
          effects: commentCompartment.reconfigure(
            commentDecorations(
              () => prefixWidget?.value || "//",
              () => modeWidget?.value || "loose"
            )
          ),
        });
      };

      const loadPresets = async () => {
        const data = await api("/scribblepad/presets");
        state.presets = data.presets || [];
        refreshPresetOptions();
      };

      btnLoad.onclick = () => {
        const name = presetSelect.value;
        if (!name) return;

        const found = state.presets.find((p) => p.name === name);
        if (!found) return;

        editorView.dispatch({
          changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: found.text || "",
          },
        });

        state.loadedPreset = name;
        presetName.value = name;

        const mergedTheme = { ...DEFAULT_THEME, ...(found.theme || {}) };
        bgInput.value = mergedTheme.bg;
        fgInput.value = mergedTheme.fg;
        commentInput.value = mergedTheme.comment;

        reconfigureTheme();
        reconfigureCommentDecorations();
      };

      btnSave.onclick = async () => {
        const name = (presetName.value || "").trim();
        if (!name) return;

        const data = await api("/scribblepad/presets", {
          method: "POST",
          body: JSON.stringify({
            name,
            text: editorView.state.doc.toString(),
            theme: {
              bg: bgInput.value,
              fg: fgInput.value,
              comment: commentInput.value,
            },
          }),
        });

        state.presets = data.presets || [];
        state.loadedPreset = name;
        refreshPresetOptions();
        presetSelect.value = name;
      };

      btnDelete.onclick = async () => {
        const name = presetSelect.value || (presetName.value || "").trim();
        if (!name) return;

        const data = await api(`/scribblepad/presets/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });

        state.presets = data.presets || [];
        if (state.loadedPreset === name) state.loadedPreset = "";
        refreshPresetOptions();
      };

      btnExport.onclick = async () => {
        const data = await api("/scribblepad/presets");
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "scribblepad-presets.json";
        a.click();
        URL.revokeObjectURL(url);
      };

      presetSearch.addEventListener("input", refreshPresetOptions);
      [bgInput, fgInput, commentInput].forEach((el) => {
        el.addEventListener("input", () => {
          reconfigureTheme();
          reconfigureCommentDecorations();
        });
      });

      const modeObserver = () => reconfigureCommentDecorations();
      const originalPrefixCallback = prefixWidget.callback;
      const originalModeCallback = modeWidget.callback;

      prefixWidget.callback = (...args) => {
        originalPrefixCallback?.(...args);
        modeObserver();
      };
      modeWidget.callback = (...args) => {
        originalModeCallback?.(...args);
        modeObserver();
      };

      const host = this.addDOMWidget("scribblepad", "scribblepad", panel, {
        serialize: false,
        hideOnZoom: false,
      });
      host.computeSize = () => [Math.max(700, this.size[0]), 500];

      loadPresets()
        .then(() => {
          reconfigureTheme();
          reconfigureCommentDecorations();
        })
        .catch(console.error);

      return result;
    };
  },
});
