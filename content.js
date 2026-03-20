(function () {
  "use strict";

  // Clean up previous instance (e.g., after extension reload)
  if (window.__sdCleanup) {
    try { window.__sdCleanup(); } catch (e) {}
  }

  // ─── State ───────────────────────────────────────────────────────────
  const state = {
    editActive: false,
    selectedEl: null,
    hoveredEl: null,
    dragging: false,
    dragData: null,
    undoStack: [],
    redoStack: [],
    pastedItems: [],
    resizeTarget: null,
    textEditing: null,
    textEditInfo: null,
    clipboardEl: null,
    activeTool: "select",
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    strokeWidth: 2,
    strokeStyle: "solid",
    fontSize: 20,
    drawingData: null,
  };

  // Forward declarations — overridden after actual definitions exist
  function createToolbar() { if (typeof createEditorBar === "function") createEditorBar(); }
  function hideToolbar() { hideStatusToast(); }
  let _statusToast = null;
  function showToolbar(msg) {
    if (!msg) return;
    if (_statusToast) { _statusToast.remove(); _statusToast = null; }
    const el = document.createElement("div");
    el.textContent = msg;
    Object.assign(el.style, {
      position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
      background: "rgba(30,30,30,0.88)", color: "#fff", padding: "8px 18px",
      borderRadius: "8px", fontSize: "13px", fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif",
      zIndex: "2147483647", pointerEvents: "none", whiteSpace: "nowrap",
      transition: "opacity .3s", opacity: "1",
    });
    document.body.appendChild(el);
    _statusToast = el;
  }
  function hideStatusToast() {
    if (_statusToast) {
      _statusToast.style.opacity = "0";
      const el = _statusToast;
      setTimeout(() => el.remove(), 300);
      _statusToast = null;
    }
  }

  // ─── Utility ─────────────────────────────────────────────────────────
  function isBlankCanvas() {
    return location.pathname.endsWith("blank.html");
  }

  function getContentBounds() {
    const els = document.querySelectorAll(".sd-pasted");
    let maxX = window.innerWidth;
    let maxY = window.innerHeight;
    els.forEach((el) => {
      if (!el.isConnected) return;
      const left = parseFloat(el.style.left) || 0;
      const top = parseFloat(el.style.top) || 0;
      const w = el.offsetWidth || parseFloat(el.style.width) || 0;
      const h = el.offsetHeight || parseFloat(el.style.height) || 0;
      maxX = Math.max(maxX, left + w + 20);
      maxY = Math.max(maxY, top + h + 20);
    });
    return { width: Math.ceil(maxX), height: Math.ceil(maxY) };
  }

  function isExtensionEl(el) {
    if (!el) return false;
    return (
      el.classList?.contains("sd-pasted") ||
      el.classList?.contains("sd-resize-handle") ||
      el.classList?.contains("sd-rotate-handle") ||
      el.classList?.contains("sd-line-handle") ||

      el.classList?.contains("sd-text-overlay") ||
      el.classList?.contains("sd-editor-bar") ||
      el.classList?.contains("sd-toolbar-grip") ||
      el.classList?.contains("sd-svg-overlay") ||
      el.classList?.contains("sd-eraser-cursor") ||
      el.classList?.contains("sd-eraser-trail-svg") ||
      el.closest?.(".sd-pasted") ||
      el.closest?.(".sd-resize-handle-container") ||
      el.closest?.(".sd-toolbar-wrapper") ||
      el.closest?.(".sd-subtoolbar")
    );
  }

  function hasTextContent(el) {
    if (!el || !el.childNodes) return false;
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true;
    }
    for (const child of el.children) {
      if (hasTextContent(child)) return true;
    }
    return false;
  }

  function isShapeContainer(el) {
    if (!el.classList.contains("sd-drawn")) return false;
    const svg = el.querySelector("svg");
    if (!svg) return false;
    return svg.querySelector("rect, ellipse, circle") !== null;
  }

  function pushUndo(action) {
    state.undoStack.push(action);
    state.redoStack = [];
  }

  function getActionEl(action) {
    if (action.el) return action.el;
    if (action.styles && action.styles[0]) return action.styles[0].el;
    return null;
  }

  function undoLast() {
    if (state.textEditing) return;
    if (state.undoStack.length === 0) {
      showToolbar("Nothing to undo");
      setTimeout(hideToolbar, 1000);
      return;
    }

    clearSelection();
    const action = state.undoStack.pop();

    // Snapshot current values for redo
    switch (action.type) {
      case "move":
      case "resize":
        action._newStyles = action.styles.map((s) => ({ el: s.el, prop: s.prop, value: s.el.style[s.prop] }));
        break;
      case "textEdit":
        action._newValue = action.el.innerHTML;
        break;
      case "rotate":
        action._newTransform = action.el.style.transform;
        break;
      case "lineEdit":
        action._newHTML = action.el.innerHTML;
        action._newLeft = action.el.style.left;
        action._newTop = action.el.style.top;
        action._newWidth = action.el.style.width;
        action._newHeight = action.el.style.height;
        break;
    }

    switch (action.type) {
      case "move": {
        action.styles.forEach((s) => {
          s.el.style[s.prop] = s.oldValue;
        });
        const moveEl = action.styles[0]?.el;
        if (moveEl && !state.undoStack.some((a) => getActionEl(a) === moveEl)) {
          moveEl.classList.remove("sd-text-edited");
        }
        break;
      }
      case "paste": {
        const el = action.el;
        const idx = state.pastedItems.indexOf(el);
        if (idx !== -1) state.pastedItems.splice(idx, 1);
        if (el.isConnected) el.remove();
        break;
      }
      case "textEdit": {
        action.el.innerHTML = action.oldValue;
        action.el.classList.remove("sd-text-edited");
        break;
      }
      case "textWrap": {
        const wrapper = action.wrapper;
        if (wrapper.isConnected) {
          const parent = wrapper.parentNode;
          while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
          wrapper.remove();
        }
        const overlay = action.overlay;
        const idx = state.pastedItems.indexOf(overlay);
        if (idx !== -1) state.pastedItems.splice(idx, 1);
        if (overlay.isConnected) overlay.remove();
        break;
      }
      case "delete": {
        if (action.isPasted) {
          const parent = action.parent || document.body;
          parent.appendChild(action.el);
          state.pastedItems.push(action.el);
        } else {
          action.el.style.display = action.oldDisplay || "";
        }
        break;
      }
      case "resize": {
        action.styles.forEach((s) => {
          s.el.style[s.prop] = s.oldValue;
        });
        const resizeEl = action.styles[0]?.el;
        if (resizeEl && !state.undoStack.some((a) => getActionEl(a) === resizeEl)) {
          resizeEl.classList.remove("sd-text-edited");
        }
        break;
      }
      case "rotate": {
        action.el.style.transform = action.oldTransform;
        if (!state.undoStack.some((a) => getActionEl(a) === action.el)) {
          action.el.classList.remove("sd-text-edited");
        }
        break;
      }
      case "lineEdit": {
        action.el.innerHTML = action.oldHTML;
        action.el.style.left = action.oldLeft;
        action.el.style.top = action.oldTop;
        action.el.style.width = action.oldWidth;
        action.el.style.height = action.oldHeight;
        if (!state.undoStack.some((a) => getActionEl(a) === action.el)) {
          action.el.classList.remove("sd-text-edited");
        }
        break;
      }
    }

    state.redoStack.push(action);
    showToolbar("Undone — Ctrl+Shift+Z to redo");
    setTimeout(hideToolbar, 1500);
  }

  function redoLast() {
    if (state.textEditing) return;
    if (state.redoStack.length === 0) {
      showToolbar("Nothing to redo");
      setTimeout(hideToolbar, 1000);
      return;
    }

    clearSelection();
    const action = state.redoStack.pop();

    switch (action.type) {
      case "move":
      case "resize": {
        if (action._newStyles) {
          action._newStyles.forEach((s) => { s.el.style[s.prop] = s.value; });
        }
        const el = action.styles[0]?.el;
        if (el && !el.classList.contains("sd-pasted")) {
          el.classList.add("sd-text-edited");
        }
        break;
      }
      case "paste": {
        (action.parent || document.body).appendChild(action.el);
        state.pastedItems.push(action.el);
        break;
      }
      case "textEdit": {
        if (action._newValue != null) action.el.innerHTML = action._newValue;
        if (!action.el.classList.contains("sd-pasted")) {
          action.el.classList.add("sd-text-edited");
        }
        break;
      }
      case "textWrap": {
        // Cannot reliably redo textWrap
        break;
      }
      case "delete": {
        if (action.isPasted) {
          const idx = state.pastedItems.indexOf(action.el);
          if (idx !== -1) state.pastedItems.splice(idx, 1);
          if (action.el.isConnected) action.el.remove();
        } else {
          action.el.style.display = "none";
        }
        break;
      }
      case "rotate": {
        if (action._newTransform != null) action.el.style.transform = action._newTransform;
        if (!action.el.classList.contains("sd-pasted")) {
          action.el.classList.add("sd-text-edited");
        }
        break;
      }
      case "lineEdit": {
        if (action._newHTML != null) action.el.innerHTML = action._newHTML;
        if (action._newLeft != null) action.el.style.left = action._newLeft;
        if (action._newTop != null) action.el.style.top = action._newTop;
        if (action._newWidth != null) action.el.style.width = action._newWidth;
        if (action._newHeight != null) action.el.style.height = action._newHeight;
        if (!action.el.classList.contains("sd-pasted")) {
          action.el.classList.add("sd-text-edited");
        }
        break;
      }
    }

    state.undoStack.push(action);
    showToolbar("Redone");
    setTimeout(hideToolbar, 1000);
  }

  function clearSelection() {
    if (state.selectedEl) {
      state.selectedEl.classList.remove("sd-selected", "sd-line-selected");
      removeResizeHandles();
      state.selectedEl = null;
      updateSubToolbar();
    }
  }

  function detectElementType(el) {
    if (!el) return null;
    if (!el.classList.contains("sd-pasted") && !el.classList.contains("sd-drawn")) return null;
    // Text-only pasted element (no SVG)
    if (!el.querySelector("svg") && hasTextContent(el)) return "text";
    const svg = el.querySelector("svg");
    if (!svg) return null;
    if (svg.querySelector("rect")) return "rect";
    if (svg.querySelector("ellipse, circle")) return "circle";
    if (svg.querySelector("polyline")) return "arrow";
    if (svg.querySelector("line") && !svg.querySelector("polyline")) return "line";
    if (svg.querySelector("path")) return "draw";
    return null;
  }

  function selectElement(el) {
    clearSelection();
    state.selectedEl = el;
    el.classList.add("sd-selected");

    const elType = detectElementType(el);
    if (elType === "line" || elType === "arrow") {
      el.classList.add("sd-line-selected");
      addLineHandles(el);
    } else {
      addResizeHandles(el);
    }

    if (elType && TOOL_PROPS[elType]) {
      showSubToolbarForType(elType, el);
    } else {
      updateSubToolbar();
    }
  }

  // ─── Element Selection (hover + click) ──────────────────────────────
  function onMouseOverElement(e) {
    if (!state.editActive || state.dragging || state.textEditing) return;
    if (state.activeTool !== "select") return;
    const el = e.target;
    if (isExtensionEl(el) || el === document.body || el === document.documentElement) return;
    if (state.hoveredEl && state.hoveredEl !== el) {
      state.hoveredEl.classList.remove("sd-hover-highlight");
    }
    state.hoveredEl = el;
    el.classList.add("sd-hover-highlight");
  }

  function onMouseOutElement(e) {
    if (!state.editActive) return;
    const el = e.target;
    if (el === state.hoveredEl) {
      el.classList.remove("sd-hover-highlight");
      state.hoveredEl = null;
    }
  }

  function onClickElement(e) {
    if (!state.editActive || state.textEditing) return;
    if (state.activeTool === "eraser") return;
    if (state.activeTool !== "select") return;
    const el = e.target;
    if (isExtensionEl(el)) return;
    if (el === document.body || el === document.documentElement) {
      clearSelection();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (state.hoveredEl) state.hoveredEl.classList.remove("sd-hover-highlight");
    selectElement(el);
  }

  // ─── Double-click to enter inline text editing ──────────────────────
  function exitTextEditing() {
    if (!state.textEditing) return;
    const el = state.textEditing;
    const info = state.textEditInfo;
    const isPasted = info && info.isPasted;

    window.getSelection()?.removeAllRanges();

    el.classList.remove("sd-text-editing");

    if (isPasted) {
      // Pasted items keep contenteditable but restore move cursor
      el.style.cursor = "move";
      el.style.userSelect = "none";
    } else {
      el.setAttribute("contenteditable", "false");
      el.removeAttribute("contenteditable");
      el.style.cursor = "";
      el.style.userSelect = "";
    }

    document.removeEventListener("keydown", onTextEditKeydown, true);
    el.removeEventListener("input", onTextInput);

    // If shape text overlay is empty, remove it
    if (info && info.shapeContainer && !el.textContent.trim()) {
      el.remove();
    }

    const changed = info && el.innerHTML !== info.originalText;
    if (changed) {
      if (!isPasted) {
        el.classList.add("sd-text-edited");
      }
      pushUndo({ type: "textEdit", el, oldValue: info.originalText });
    }

    state.textEditing = null;
    state.textEditInfo = null;
    hideToolbar();
  }

  function onTextInput() {
    positionResizeOverlay();
  }

  function onTextEditKeydown(e) {
    if (e.key === "Escape") {
      // Revert text to original on Escape
      if (state.textEditing && state.textEditInfo) {
        state.textEditing.innerHTML = state.textEditInfo.originalText;
      }
      exitTextEditing();
      showToolbar("Text edit cancelled");
      setTimeout(hideToolbar, 1200);
    }
  }

  function onDblClick(e) {
    if (!state.editActive) return;

    // Handle double-click on drawn shapes to add/edit text inside
    const drawnEl = e.target.closest?.(".sd-drawn");
    if (drawnEl && isShapeContainer(drawnEl)) {
      e.preventDefault();
      e.stopPropagation();

      let textOverlay = drawnEl.querySelector(".sd-shape-text");
      if (!textOverlay) {
        textOverlay = document.createElement("div");
        textOverlay.className = "sd-shape-text";
        Object.assign(textOverlay.style, {
          position: "absolute",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "8px",
          boxSizing: "border-box",
          color: "#000000",
          fontSize: "20px",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          fontWeight: "500",
          lineHeight: "1.3",
          wordWrap: "break-word",
          overflowWrap: "break-word",
          overflow: "hidden",
          pointerEvents: "auto",
          zIndex: "1",
        });
        drawnEl.style.position = "absolute";
        drawnEl.appendChild(textOverlay);
      }

      textOverlay.setAttribute("contenteditable", "true");
      state.textEditing = textOverlay;
      state.textEditInfo = {
        originalText: textOverlay.innerHTML,
        isPasted: true,
        shapeContainer: drawnEl,
      };
      textOverlay.style.userSelect = "text";
      textOverlay.style.cursor = "text";
      textOverlay.classList.add("sd-text-editing");
      textOverlay.focus();

      document.addEventListener("keydown", onTextEditKeydown, true);
      textOverlay.addEventListener("input", onTextInput);
      showToolbar("Type inside shape — click outside to commit, Esc to cancel");
      return;
    }

    // Handle double-click on pasted items for inline editing
    const pastedEl = e.target.closest?.(".sd-pasted");
    if (pastedEl && hasTextContent(pastedEl)) {
      e.preventDefault();
      e.stopPropagation();

      if (!pastedEl.getAttribute("contenteditable")) {
        pastedEl.setAttribute("contenteditable", "true");
      }

      state.textEditing = pastedEl;
      state.textEditInfo = {
        originalText: pastedEl.innerHTML,
        isPasted: true,
      };

      pastedEl.style.userSelect = "text";
      pastedEl.style.cursor = "text";
      pastedEl.classList.add("sd-text-editing");
      pastedEl.focus();

      document.addEventListener("keydown", onTextEditKeydown, true);
      pastedEl.addEventListener("input", onTextInput);

      showToolbar("Editing text — click outside to commit, Esc to cancel");
      return;
    }

    // Handle double-click on any page text element
    if (isExtensionEl(e.target)) return;
    const el = e.target;
    if (el === document.body || el === document.documentElement) return;
    if (!hasTextContent(el)) return;

    e.preventDefault();
    e.stopPropagation();

    exitTextEditing();
    clearSelection();

    state.textEditing = el;
    state.textEditInfo = {
      originalText: el.innerHTML,
      tracked: false,
    };

    el.setAttribute("contenteditable", "true");
    el.classList.add("sd-text-editing");
    el.style.cursor = "text";
    el.style.userSelect = "text";
    el.focus();

    document.addEventListener("keydown", onTextEditKeydown, true);
    el.addEventListener("input", onTextInput);

    showToolbar("Editing text — click outside to commit, Esc to cancel");
  }

  function onClickOutsideTextEdit(e) {
    if (!state.textEditing) return;
    if (state.textEditing.contains(e.target)) return;
    if (isExtensionEl(e.target)) return;
    exitTextEditing();
  }

  // ─── Drag & Move ────────────────────────────────────────────────────
  function onDragStart(e) {
    if (!state.editActive || state.textEditing) return;
    if (!state.selectedEl) return;
    const el = state.selectedEl;
    if (e.target !== el && !el.contains(e.target) && !isExtensionEl(e.target)) return;
    if (e.target.classList?.contains("sd-resize-handle") || e.target.classList?.contains("sd-rotate-handle")) return;

    e.preventDefault();
    state.dragging = true;

    const isPasted = el.classList.contains("sd-pasted");
    const savedStyles = [];

    if (isPasted || el.style.position === "absolute") {
      savedStyles.push({ el, prop: "left", oldValue: el.style.left });
      savedStyles.push({ el, prop: "top", oldValue: el.style.top });
      state.dragData = {
        el,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: parseFloat(el.style.left) || 0,
        origTop: parseFloat(el.style.top) || 0,
        mode: "absolute",
        savedStyles,
      };
    } else {
      const computed = window.getComputedStyle(el);
      const origPosition = computed.position;
      const origTop = parseFloat(computed.top) || 0;
      const origLeft = parseFloat(computed.left) || 0;

      if (origPosition === "static") {
        savedStyles.push({ el, prop: "position", oldValue: el.style.position });
        el.style.position = "relative";
      }
      savedStyles.push({ el, prop: "top", oldValue: el.style.top });
      savedStyles.push({ el, prop: "left", oldValue: el.style.left });

      state.dragData = {
        el,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: origPosition === "static" ? 0 : origLeft,
        origTop: origPosition === "static" ? 0 : origTop,
        mode: "relative",
        savedStyles,
      };
    }

    el.classList.add("sd-dragging");
    showToolbar("Dragging...");
  }

  function onDragMove(e) {
    if (!state.dragging || !state.dragData) return;
    e.preventDefault();
    const d = state.dragData;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    d.el.style.left = (d.origLeft + dx) + "px";
    d.el.style.top = (d.origTop + dy) + "px";
    positionResizeOverlay();
  }

  function onDragEnd() {
    if (!state.dragging) return;
    state.dragging = false;
    if (state.dragData) {
      state.dragData.el.classList.remove("sd-dragging");
      const dx = Math.abs(parseFloat(state.dragData.el.style.left) - state.dragData.origLeft);
      const dy = Math.abs(parseFloat(state.dragData.el.style.top) - state.dragData.origTop);
      if (dx > 1 || dy > 1) {
        pushUndo({ type: "move", styles: state.dragData.savedStyles });
        if (!state.dragData.el.classList.contains("sd-pasted")) {
          state.dragData.el.classList.add("sd-text-edited");
        }
      }
    }
    state.dragData = null;
    showToolbar("Moved — Ctrl+Z to undo");
    setTimeout(hideToolbar, 1500);
  }

  // ─── Clipboard Paste ────────────────────────────────────────────────
  function onPaste(e) {
    if (!state.editActive) return;
    // Let the browser handle paste inside contenteditable text editing
    if (state.textEditing) return;
    // Let the browser handle paste inside a focused contenteditable pasted item
    const activeEl = document.activeElement;
    if (activeEl && activeEl.getAttribute("contenteditable") === "true" && activeEl.closest(".sd-pasted")) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    e.preventDefault();

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        createPastedImage(url);
        return;
      }
    }

    const text = e.clipboardData.getData("text/plain");
    if (text) {
      createPastedText(text);
    }
  }

  function getStyleSource() {
    // Use the selected element or the hovered element as style reference
    const ref = state.selectedEl || state.hoveredEl;
    if (!ref || ref === document.body || ref === document.documentElement) return null;
    if (ref.classList.contains("sd-pasted") || ref.classList.contains("sd-toolbar")) return null;
    return ref;
  }

  function createPastedText(text) {
    const el = document.createElement("div");
    el.className = "sd-pasted";
    el.setAttribute("contenteditable", "true");
    el.textContent = text;

    const source = getStyleSource();
    const computed = source ? window.getComputedStyle(source) : null;

    Object.assign(el.style, {
      position: "absolute",
      left: (window.scrollX + window.innerWidth / 2 - 100) + "px",
      top: (window.scrollY + window.innerHeight / 2 - 20) + "px",
      zIndex: "2147483640",
      background: "transparent",
      border: "1px dashed #4f46e5",
      padding: computed ? computed.padding : "8px 12px",
      borderRadius: "4px",
      fontSize: computed ? computed.fontSize : "14px",
      fontFamily: computed ? computed.fontFamily : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontWeight: computed ? computed.fontWeight : "normal",
      fontStyle: computed ? computed.fontStyle : "normal",
      lineHeight: computed ? computed.lineHeight : "normal",
      letterSpacing: computed ? computed.letterSpacing : "normal",
      color: computed ? computed.color : "#1a1a2e",
      textDecoration: computed ? computed.textDecoration : "none",
      textTransform: computed ? computed.textTransform : "none",
      cursor: "move",
      maxWidth: "400px",
      wordWrap: "break-word",
      userSelect: "none",
    });
    document.body.appendChild(el);
    el.classList.add("sd-text-edited");
    state.pastedItems.push(el);
    pushUndo({ type: "paste", el });
    selectElement(el);
    showToolbar("Text pasted — drag to move, double-click to edit");
    setTimeout(hideToolbar, 2000);
  }

  function createPastedImage(url) {
    const container = document.createElement("div");
    container.className = "sd-pasted";
    Object.assign(container.style, {
      position: "absolute",
      left: (window.scrollX + window.innerWidth / 2 - 150) + "px",
      top: (window.scrollY + window.innerHeight / 2 - 100) + "px",
      zIndex: "2147483640",
      cursor: "move",
      border: "1px dashed #4f46e5",
      display: "inline-block",
      userSelect: "none",
    });

    const img = document.createElement("img");
    img.src = url;
    img.style.display = "block";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.pointerEvents = "none";
    img.draggable = false;
    container.appendChild(img);

    img.onload = () => {
      const w = Math.min(img.naturalWidth, 400);
      const h = img.naturalHeight * (w / img.naturalWidth);
      container.style.width = w + "px";
      container.style.height = h + "px";
    };

    document.body.appendChild(container);
    container.classList.add("sd-text-edited");
    state.pastedItems.push(container);
    pushUndo({ type: "paste", el: container });
    selectElement(container);
    showToolbar("Image pasted — drag to move, handles to resize");
    setTimeout(hideToolbar, 2000);
  }

  // ─── Resize Handles ─────────────────────────────────────────────────
  let resizeHandleContainer = null;

  function removeResizeHandles() {
    if (resizeHandleContainer) {
      resizeHandleContainer.remove();
      resizeHandleContainer = null;
    }
    state.resizeTarget = null;
  }

  function positionResizeOverlay() {
    if (!resizeHandleContainer || !state.resizeTarget) return;
    if (resizeHandleContainer.classList.contains("sd-line-handles")) {
      positionLineHandles();
      return;
    }
    const rect = state.resizeTarget.getBoundingClientRect();
    Object.assign(resizeHandleContainer.style, {
      top: (rect.top + window.scrollY) + "px",
      left: (rect.left + window.scrollX) + "px",
      width: rect.width + "px",
      height: rect.height + "px",
    });
  }

  function addResizeHandles(targetEl) {
    removeResizeHandles();
    state.resizeTarget = targetEl;

    resizeHandleContainer = document.createElement("div");
    resizeHandleContainer.className = "sd-resize-handle-container";

    const rect = targetEl.getBoundingClientRect();
    Object.assign(resizeHandleContainer.style, {
      position: "absolute",
      top: (rect.top + window.scrollY) + "px",
      left: (rect.left + window.scrollX) + "px",
      width: rect.width + "px",
      height: rect.height + "px",
      pointerEvents: "none",
      zIndex: "2147483645",
    });

    const HANDLE_SIZE = 12;
    const HANDLE_OFFSET = -(HANDLE_SIZE / 2) + "px";
    const HANDLE_CENTER = "calc(50% - " + (HANDLE_SIZE / 2) + "px)";

    const positions = [
      { name: "nw", cursor: "nw-resize", top: HANDLE_OFFSET, left: HANDLE_OFFSET },
      { name: "n",  cursor: "n-resize",  top: HANDLE_OFFSET, left: HANDLE_CENTER },
      { name: "ne", cursor: "ne-resize", top: HANDLE_OFFSET, right: HANDLE_OFFSET },
      { name: "e",  cursor: "e-resize",  top: HANDLE_CENTER, right: HANDLE_OFFSET },
      { name: "se", cursor: "se-resize", bottom: HANDLE_OFFSET, right: HANDLE_OFFSET },
      { name: "s",  cursor: "s-resize",  bottom: HANDLE_OFFSET, left: HANDLE_CENTER },
      { name: "sw", cursor: "sw-resize", bottom: HANDLE_OFFSET, left: HANDLE_OFFSET },
      { name: "w",  cursor: "w-resize",  top: HANDLE_CENTER, left: HANDLE_OFFSET },
    ];

    positions.forEach((pos) => {
      const handle = document.createElement("div");
      handle.className = "sd-resize-handle";
      handle.dataset.direction = pos.name;
      Object.assign(handle.style, {
        position: "absolute",
        width: HANDLE_SIZE + "px",
        height: HANDLE_SIZE + "px",
        background: "#4f46e5",
        border: "2px solid #fff",
        borderRadius: "3px",
        cursor: pos.cursor,
        pointerEvents: "auto",
        zIndex: "2147483646",
        boxSizing: "border-box",
      });
      if (pos.top) handle.style.top = pos.top;
      if (pos.bottom) handle.style.bottom = pos.bottom;
      if (pos.left) handle.style.left = pos.left;
      if (pos.right) handle.style.right = pos.right;

      handle.addEventListener("mousedown", onResizeStart);
      resizeHandleContainer.appendChild(handle);
    });

    // ── Rotate handle: circle above top-center with a connecting line ──
    const ROTATE_DISTANCE = 28;

    const rotateLine = document.createElement("div");
    rotateLine.className = "sd-rotate-handle";
    Object.assign(rotateLine.style, {
      position: "absolute",
      top: -(ROTATE_DISTANCE) + "px",
      left: "50%",
      width: "1px",
      height: ROTATE_DISTANCE + "px",
      background: "#4f46e5",
      pointerEvents: "none",
      zIndex: "2147483646",
      transform: "translateX(-0.5px)",
    });
    resizeHandleContainer.appendChild(rotateLine);

    const rotateHandle = document.createElement("div");
    rotateHandle.className = "sd-rotate-handle";
    const ROTATE_SIZE = 14;
    Object.assign(rotateHandle.style, {
      position: "absolute",
      top: -(ROTATE_DISTANCE + ROTATE_SIZE / 2) + "px",
      left: "calc(50% - " + (ROTATE_SIZE / 2) + "px)",
      width: ROTATE_SIZE + "px",
      height: ROTATE_SIZE + "px",
      background: "#fff",
      border: "2px solid #4f46e5",
      borderRadius: "50%",
      cursor: "grab",
      pointerEvents: "auto",
      zIndex: "2147483646",
      boxSizing: "border-box",
    });
    rotateHandle.addEventListener("mousedown", onRotateStart);
    resizeHandleContainer.appendChild(rotateHandle);

    document.body.appendChild(resizeHandleContainer);
  }

  // ─── Rotate ──────────────────────────────────────────────────────────
  let rotateData = null;

  function getCurrentRotation(el) {
    const transform = el.style.transform || "";
    const match = transform.match(/rotate\(([-\d.]+)deg\)/);
    return match ? parseFloat(match[1]) : 0;
  }

  function setRotation(el, deg) {
    const transform = (el.style.transform || "").replace(/rotate\([^)]*\)\s*/g, "").trim();
    el.style.transform = (transform ? transform + " " : "") + "rotate(" + deg + "deg)";
  }

  function onRotateStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = state.selectedEl;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
    const origRotation = getCurrentRotation(el);

    rotateData = {
      el,
      centerX,
      centerY,
      startAngle,
      origRotation,
      oldTransform: el.style.transform || "",
    };

    document.addEventListener("mousemove", onRotateMove, true);
    document.addEventListener("mouseup", onRotateEnd, true);
  }

  function onRotateMove(e) {
    if (!rotateData) return;
    e.preventDefault();
    const d = rotateData;
    const currentAngle = Math.atan2(e.clientY - d.centerY, e.clientX - d.centerX) * (180 / Math.PI);
    let deg = d.origRotation + (currentAngle - d.startAngle);

    // Snap to 0/90/180/270 when within 5 degrees
    if (e.shiftKey) {
      deg = Math.round(deg / 45) * 45;
    } else {
      const snapPoints = [0, 90, 180, 270, -90, -180, -270, 360];
      for (const sp of snapPoints) {
        if (Math.abs(deg - sp) < 5) { deg = sp; break; }
      }
    }

    setRotation(d.el, deg);
    positionResizeOverlay();
  }

  function onRotateEnd() {
    if (rotateData) {
      const d = rotateData;
      const newTransform = d.el.style.transform || "";
      if (newTransform !== d.oldTransform) {
        pushUndo({ type: "rotate", el: d.el, oldTransform: d.oldTransform });
        if (!d.el.classList.contains("sd-pasted")) {
          d.el.classList.add("sd-text-edited");
        }
      }
    }
    rotateData = null;
    document.removeEventListener("mousemove", onRotateMove, true);
    document.removeEventListener("mouseup", onRotateEnd, true);
    if (state.resizeTarget) {
      positionResizeOverlay();
    }
    showToolbar("Rotated — Ctrl+Z to undo");
    setTimeout(hideToolbar, 1500);
  }

  let resizeData = null;

  // Given an element's top-left (left,top), size (w,h), and rotation (rad)
  // around its center, compute the page-space position of a local-space
  // fractional anchor point (ax,ay) where (0,0)=top-left, (1,1)=bottom-right.
  function rotatedAnchor(left, top, w, h, rot, ax, ay) {
    const cx = left + w / 2;
    const cy = top + h / 2;
    const lx = (ax - 0.5) * w;
    const ly = (ay - 0.5) * h;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    return {
      x: cx + lx * cosR - ly * sinR,
      y: cy + lx * sinR + ly * cosR,
    };
  }

  // The 8 directions in clockwise order, used for rotation remapping.
  const DIR_ORDER = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

  // Remap a handle direction to account for element rotation.
  // Handles are placed on the bounding box in screen space, but their
  // data-direction labels assume no rotation. A 90° CW rotation means
  // the screen-space "east" handle is actually the element's local "south".
  function remapDirection(dir, angleDeg) {
    const steps = Math.round(((angleDeg % 360) + 360) % 360 / 45);
    if (steps === 0) return dir;
    const idx = DIR_ORDER.indexOf(dir);
    if (idx === -1) return dir;
    return DIR_ORDER[((idx - steps) % 8 + 8) % 8];
  }

  // Map handle direction to the anchor point that should stay fixed
  // (the corner opposite to the handle being dragged).
  // Coordinates are in local space: (0,0)=top-left, (1,1)=bottom-right.
  function anchorForDirection(dir) {
    switch (dir) {
      case "nw": return { ax: 1, ay: 1 };
      case "n":  return { ax: 0.5, ay: 1 };
      case "ne": return { ax: 0, ay: 1 };
      case "e":  return { ax: 0, ay: 0.5 };
      case "se": return { ax: 0, ay: 0 };
      case "s":  return { ax: 0.5, ay: 0 };
      case "sw": return { ax: 1, ay: 0 };
      case "w":  return { ax: 1, ay: 0.5 };
      default:   return { ax: 0, ay: 0 };
    }
  }

  function onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!state.resizeTarget) return;

    const target = state.resizeTarget;
    const handleDir = e.target.dataset.direction;
    const isImg = target.tagName === "IMG" || !!target.querySelector?.("img");
    const computed = window.getComputedStyle(target);

    const savedStyles = [
      { el: target, prop: "width", oldValue: target.style.width },
      { el: target, prop: "height", oldValue: target.style.height },
      { el: target, prop: "left", oldValue: target.style.left },
      { el: target, prop: "top", oldValue: target.style.top },
      { el: target, prop: "maxWidth", oldValue: target.style.maxWidth },
      { el: target, prop: "overflow", oldValue: target.style.overflow },
      { el: target, prop: "position", oldValue: target.style.position },
    ];

    if (computed.position === "static") {
      target.style.position = "relative";
    }

    const selectedEl = state.selectedEl || target;
    const angleDeg = getCurrentRotation(selectedEl);
    const rotation = angleDeg * Math.PI / 180;

    // Remap the handle direction so the resize logic works in local space
    const direction = remapDirection(handleDir, angleDeg);

    const cssW = parseFloat(computed.width) || target.offsetWidth;
    const cssH = parseFloat(computed.height) || target.offsetHeight;
    const origLeft = parseFloat(computed.left) || 0;
    const origTop = parseFloat(computed.top) || 0;

    const anchor = anchorForDirection(direction);
    const anchorPt = rotatedAnchor(origLeft, origTop, cssW, cssH, rotation, anchor.ax, anchor.ay);

    resizeData = {
      target,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      origWidth: cssW,
      origHeight: cssH,
      aspectRatio: cssW / cssH,
      origLeft,
      origTop,
      isImg,
      savedStyles,
      rotation,
      anchor,
      anchorPt,
    };

    document.addEventListener("mousemove", onResizeMove, true);
    document.addEventListener("mouseup", onResizeEnd, true);
  }

  function onResizeMove(e) {
    if (!resizeData) return;
    e.preventDefault();

    const d = resizeData;
    const rawDx = e.clientX - d.startX;
    const rawDy = e.clientY - d.startY;

    // Rotate mouse delta into the element's local coordinate space
    const cosR = Math.cos(-d.rotation);
    const sinR = Math.sin(-d.rotation);
    const dx = rawDx * cosR - rawDy * sinR;
    const dy = rawDx * sinR + rawDy * cosR;

    const isCorner = ["nw", "ne", "se", "sw"].includes(d.direction);
    const keepAspect = d.isImg && isCorner && !e.shiftKey;

    let newW = d.origWidth;
    let newH = d.origHeight;

    switch (d.direction) {
      case "e":
        newW = Math.max(20, d.origWidth + dx);
        break;
      case "w":
        newW = Math.max(20, d.origWidth - dx);
        break;
      case "s":
        newH = Math.max(20, d.origHeight + dy);
        break;
      case "n":
        newH = Math.max(20, d.origHeight - dy);
        break;
      case "se":
        newW = Math.max(20, d.origWidth + dx);
        if (keepAspect) newH = newW / d.aspectRatio;
        else newH = Math.max(20, d.origHeight + dy);
        break;
      case "sw":
        newW = Math.max(20, d.origWidth - dx);
        if (keepAspect) newH = newW / d.aspectRatio;
        else newH = Math.max(20, d.origHeight + dy);
        break;
      case "ne":
        newW = Math.max(20, d.origWidth + dx);
        if (keepAspect) {
          newH = newW / d.aspectRatio;
        } else {
          newH = Math.max(20, d.origHeight - dy);
        }
        break;
      case "nw":
        newW = Math.max(20, d.origWidth - dx);
        if (keepAspect) {
          newH = newW / d.aspectRatio;
        } else {
          newH = Math.max(20, d.origHeight - dy);
        }
        break;
    }

    d.target.style.width = newW + "px";
    d.target.style.height = newH + "px";
    d.target.style.maxWidth = "none";
    d.target.style.overflow = "hidden";

    // Keep the anchor corner fixed: compute where it would land with the new
    // size at the original left/top, then shift to pin it in place.
    const newAnchorPt = rotatedAnchor(d.origLeft, d.origTop, newW, newH, d.rotation, d.anchor.ax, d.anchor.ay);
    const corrLeft = d.origLeft + (d.anchorPt.x - newAnchorPt.x);
    const corrTop = d.origTop + (d.anchorPt.y - newAnchorPt.y);
    d.target.style.left = corrLeft + "px";
    d.target.style.top = corrTop + "px";

    positionResizeOverlay();
  }

  function onResizeEnd() {
    if (resizeData) {
      const d = resizeData;
      const movedW = Math.abs(parseFloat(d.target.style.width) - d.origWidth);
      const movedH = Math.abs(parseFloat(d.target.style.height) - d.origHeight);
      if (movedW > 1 || movedH > 1) {
        pushUndo({ type: "resize", styles: d.savedStyles });
        if (!d.target.classList.contains("sd-pasted")) {
          d.target.classList.add("sd-text-edited");
        }
      }
    }
    resizeData = null;
    document.removeEventListener("mousemove", onResizeMove, true);
    document.removeEventListener("mouseup", onResizeEnd, true);
    if (state.resizeTarget) {
      positionResizeOverlay();
    }
  }

  // ─── Line / Arrow Endpoint Handles ──────────────────────────────────
  function getLineEndpoints(container) {
    const svg = container.querySelector("svg");
    if (!svg) return null;
    const vb = svg.getAttribute("viewBox").split(" ").map(Number);
    const left = parseFloat(container.style.left);
    const top = parseFloat(container.style.top);
    const g = svg.querySelector("g");
    const lineEl = g ? g.querySelector("line") : svg.querySelector("line");
    if (!lineEl) return null;
    const x1 = parseFloat(lineEl.getAttribute("x1"));
    const y1 = parseFloat(lineEl.getAttribute("y1"));
    const x2 = parseFloat(lineEl.getAttribute("x2"));
    const y2 = parseFloat(lineEl.getAttribute("y2"));
    const offsetX = left - vb[0];
    const offsetY = top - vb[1];
    return {
      x1: x1 + offsetX, y1: y1 + offsetY,
      x2: x2 + offsetX, y2: y2 + offsetY,
      isArrow: !!svg.querySelector("polyline"),
    };
  }

  function rebuildLineFromEndpoints(container, x1, y1, x2, y2) {
    const svg = container.querySelector("svg");
    const g = svg.querySelector("g");
    const isArrow = !!svg.querySelector("polyline");
    const pad = 4;
    const w = Math.max(Math.abs(x2 - x1), 1) + pad * 2;
    const h = Math.max(Math.abs(y2 - y1), 1) + pad * 2;
    const vbX = Math.min(x1, x2) - pad;
    const vbY = Math.min(y1, y2) - pad;

    container.style.left = vbX + "px";
    container.style.top = vbY + "px";
    container.style.width = w + "px";
    container.style.height = h + "px";
    svg.setAttribute("viewBox", vbX + " " + vbY + " " + w + " " + h);

    const lineEl = g ? g.querySelector("line") : svg.querySelector("line");
    lineEl.setAttribute("x1", x1);
    lineEl.setAttribute("y1", y1);
    lineEl.setAttribute("x2", x2);
    lineEl.setAttribute("y2", y2);

    if (isArrow) {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 14;
      const a1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const a1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const a2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const a2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
      svg.querySelector("polyline").setAttribute(
        "points", a1x + "," + a1y + " " + x2 + "," + y2 + " " + a2x + "," + a2y
      );
    }
  }

  const LINE_HANDLE_SIZE = 14;

  function addLineHandles(el) {
    removeResizeHandles();
    state.resizeTarget = el;
    const endpoints = getLineEndpoints(el);
    if (!endpoints) return;

    resizeHandleContainer = document.createElement("div");
    resizeHandleContainer.className = "sd-resize-handle-container sd-line-handles";
    Object.assign(resizeHandleContainer.style, {
      position: "absolute",
      top: "0", left: "0", width: "0", height: "0",
      pointerEvents: "none",
      zIndex: "2147483645",
    });

    ["start", "end"].forEach((which) => {
      const handle = document.createElement("div");
      handle.className = "sd-line-handle";
      handle.dataset.endpoint = which;
      const px = which === "start" ? endpoints.x1 : endpoints.x2;
      const py = which === "start" ? endpoints.y1 : endpoints.y2;
      Object.assign(handle.style, {
        position: "absolute",
        width: LINE_HANDLE_SIZE + "px",
        height: LINE_HANDLE_SIZE + "px",
        background: "#4f46e5",
        border: "2px solid #fff",
        borderRadius: "50%",
        cursor: "crosshair",
        pointerEvents: "auto",
        zIndex: "2147483646",
        boxSizing: "border-box",
        left: (px - LINE_HANDLE_SIZE / 2) + "px",
        top: (py - LINE_HANDLE_SIZE / 2) + "px",
      });
      handle.addEventListener("mousedown", onLineHandleStart);
      resizeHandleContainer.appendChild(handle);
    });

    document.body.appendChild(resizeHandleContainer);
  }

  function positionLineHandles() {
    if (!resizeHandleContainer || !state.resizeTarget) return;
    const endpoints = getLineEndpoints(state.resizeTarget);
    if (!endpoints) return;
    const handles = resizeHandleContainer.querySelectorAll(".sd-line-handle");
    handles.forEach((h) => {
      const which = h.dataset.endpoint;
      const px = which === "start" ? endpoints.x1 : endpoints.x2;
      const py = which === "start" ? endpoints.y1 : endpoints.y2;
      h.style.left = (px - LINE_HANDLE_SIZE / 2) + "px";
      h.style.top = (py - LINE_HANDLE_SIZE / 2) + "px";
    });
  }

  let lineHandleData = null;

  function onLineHandleStart(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!state.resizeTarget) return;
    const el = state.resizeTarget;
    const which = e.target.dataset.endpoint;
    const endpoints = getLineEndpoints(el);
    if (!endpoints) return;

    lineHandleData = {
      el,
      which,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      origX: which === "start" ? endpoints.x1 : endpoints.x2,
      origY: which === "start" ? endpoints.y1 : endpoints.y2,
      otherX: which === "start" ? endpoints.x2 : endpoints.x1,
      otherY: which === "start" ? endpoints.y2 : endpoints.y1,
      savedHTML: el.innerHTML,
      savedLeft: el.style.left,
      savedTop: el.style.top,
      savedWidth: el.style.width,
      savedHeight: el.style.height,
    };
    document.addEventListener("mousemove", onLineHandleMove, true);
    document.addEventListener("mouseup", onLineHandleEnd, true);
  }

  function onLineHandleMove(e) {
    if (!lineHandleData) return;
    e.preventDefault();
    const d = lineHandleData;
    const dx = e.clientX - d.startMouseX;
    const dy = e.clientY - d.startMouseY;
    const newX = d.origX + dx;
    const newY = d.origY + dy;
    let x1, y1, x2, y2;
    if (d.which === "start") {
      x1 = newX; y1 = newY; x2 = d.otherX; y2 = d.otherY;
    } else {
      x1 = d.otherX; y1 = d.otherY; x2 = newX; y2 = newY;
    }
    rebuildLineFromEndpoints(d.el, x1, y1, x2, y2);
    positionLineHandles();
  }

  function onLineHandleEnd(e) {
    document.removeEventListener("mousemove", onLineHandleMove, true);
    document.removeEventListener("mouseup", onLineHandleEnd, true);
    if (lineHandleData) {
      const d = lineHandleData;
      const moved = Math.abs(e.clientX - d.startMouseX) + Math.abs(e.clientY - d.startMouseY);
      if (moved > 1) {
        pushUndo({
          type: "lineEdit",
          el: d.el,
          oldHTML: d.savedHTML,
          oldLeft: d.savedLeft,
          oldTop: d.savedTop,
          oldWidth: d.savedWidth,
          oldHeight: d.savedHeight,
        });
        d.el.classList.add("sd-text-edited");
      }
    }
    lineHandleData = null;
  }

  // ─── Screenshot Prep ────────────────────────────────────────────────
  function prepareScreenshot(showHighlights) {
    exitTextEditing();
    clearSelection();
    hideToolbar();
    document.body.classList.add("sd-capturing");
    if (!showHighlights) {
      state.pastedItems.forEach((el) => {
        if (el.isConnected) {
          el.dataset.sdBorder = el.style.border;
          el.style.border = "none";
        }
      });
      document.querySelectorAll(".sd-text-edited").forEach((el) => {
        el.classList.remove("sd-text-edited");
        el.classList.add("sd-text-edited-hidden");
      });
    }
  }

  function restoreAfterScreenshot() {
    document.body.classList.remove("sd-capturing");
    state.pastedItems.forEach((el) => {
      if (el.isConnected && el.dataset.sdBorder) {
        el.style.border = el.dataset.sdBorder;
        delete el.dataset.sdBorder;
      }
    });
    document.querySelectorAll(".sd-text-edited-hidden").forEach((el) => {
      el.classList.remove("sd-text-edited-hidden");
      el.classList.add("sd-text-edited");
    });
  }

  // ─── Reset ──────────────────────────────────────────────────────────
  function resetAll() {
    exitTextEditing();
    clearSelection();

    while (state.undoStack.length > 0) {
      const action = state.undoStack.pop();
      switch (action.type) {
        case "move":
          action.styles.forEach((s) => { s.el.style[s.prop] = s.oldValue; });
          if (action.styles[0]?.el) action.styles[0].el.classList.remove("sd-text-edited");
          break;
        case "paste": {
          const el = action.el;
          const idx = state.pastedItems.indexOf(el);
          if (idx !== -1) state.pastedItems.splice(idx, 1);
          if (el.isConnected) el.remove();
          break;
        }
        case "textEdit":
          action.el.innerHTML = action.oldValue;
          action.el.classList.remove("sd-text-edited");
          break;
        case "textWrap": {
          const wrapper = action.wrapper;
          if (wrapper.isConnected) {
            const parent = wrapper.parentNode;
            while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
            wrapper.remove();
          }
          const overlay = action.overlay;
          const idx = state.pastedItems.indexOf(overlay);
          if (idx !== -1) state.pastedItems.splice(idx, 1);
          if (overlay.isConnected) overlay.remove();
          break;
        }
        case "delete": {
          if (action.isPasted) {
            // pasted items removed by delete don't need restoring on full reset
          } else {
            action.el.style.display = action.oldDisplay || "";
          }
          break;
        }
        case "resize": {
          action.styles.forEach((s) => { s.el.style[s.prop] = s.oldValue; });
          if (action.styles[0]?.el) action.styles[0].el.classList.remove("sd-text-edited");
          break;
        }
        case "rotate": {
          action.el.style.transform = action.oldTransform;
          action.el.classList.remove("sd-text-edited");
          break;
        }
      }
    }

    state.pastedItems.forEach((el) => {
      if (el.isConnected) el.remove();
    });
    state.pastedItems = [];
    state.redoStack = [];

    document.querySelectorAll(".sd-hover-highlight").forEach((el) => {
      el.classList.remove("sd-hover-highlight");
    });
    document.querySelectorAll(".sd-text-editing").forEach((el) => {
      el.classList.remove("sd-text-editing");
      el.removeAttribute("contenteditable");
      el.style.userSelect = "";
      el.style.cursor = "";
    });
    document.querySelectorAll(".sd-text-edited").forEach((el) => {
      el.classList.remove("sd-text-edited");
    });

    hideToolbar();
    state.editActive = false;
  }

  // ─── Copy / Paste Element ────────────────────────────────────────────
  function copyToClipboard() {
    if (!state.selectedEl) return;
    const el = state.selectedEl;
    const computed = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    state.clipboardEl = {
      node: el.cloneNode(true),
      computed: {
        fontSize: computed.fontSize,
        fontFamily: computed.fontFamily,
        fontWeight: computed.fontWeight,
        fontStyle: computed.fontStyle,
        lineHeight: computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        textDecoration: computed.textDecoration,
        textTransform: computed.textTransform,
        whiteSpace: computed.whiteSpace,
        padding: computed.padding,
      },
      width: rect.width,
    };

    showToolbar("Copied — Ctrl+V to paste");
    setTimeout(hideToolbar, 1200);
  }

  function pasteFromClipboard() {
    if (!state.clipboardEl) {
      showToolbar("Nothing copied — select an element and Ctrl+C first");
      setTimeout(hideToolbar, 1500);
      return;
    }

    const { node, computed, width } = state.clipboardEl;
    const clone = node.cloneNode(true);
    clone.classList.remove("sd-selected", "sd-hover-highlight", "sd-resize-handle-container");
    clone.classList.add("sd-pasted");

    // Remove any leftover resize handle containers inside the clone
    clone.querySelectorAll(".sd-resize-handle-container").forEach((h) => h.remove());

    Object.keys(computed).forEach((prop) => {
      clone.style[prop] = computed[prop];
    });

    clone.style.position = "absolute";
    clone.style.left = (window.scrollX + window.innerWidth / 2 - width / 2) + "px";
    clone.style.top = (window.scrollY + window.innerHeight / 2 - 20) + "px";
    clone.style.width = width + "px";
    clone.style.zIndex = "2147483640";
    clone.style.cursor = "move";
    clone.style.border = "1px dashed #4f46e5";
    clone.style.userSelect = "none";

    if (hasTextContent(clone)) {
      clone.setAttribute("contenteditable", "true");
    }

    document.body.appendChild(clone);
    clone.classList.add("sd-text-edited");
    state.pastedItems.push(clone);
    pushUndo({ type: "paste", el: clone });
    selectElement(clone);
    showToolbar("Pasted — drag to move, corners to resize");
    setTimeout(hideToolbar, 1500);
  }

  // ─── Eraser ─────────────────────────────────────────────────────────
  let eraserCursor = null;
  let eraserDragging = false;
  let eraserTrailSvg = null;
  let eraserTrailEl = null;
  let eraserTrailPoints = [];
  let eraserTrailTimeout = null;
  const ERASER_RADIUS = 14;
  const ERASER_TAIL_LEN = 24;

  function createEraserCursor() {
    if (eraserCursor) return;
    eraserCursor = document.createElement("div");
    eraserCursor.className = "sd-eraser-cursor";
    document.body.appendChild(eraserCursor);
  }

  function removeEraserCursor() {
    if (eraserCursor) { eraserCursor.remove(); eraserCursor = null; }
    removeEraserTrail();
  }

  function removeEraserTrail() {
    if (eraserTrailTimeout) { clearTimeout(eraserTrailTimeout); eraserTrailTimeout = null; }
    if (eraserTrailSvg) { eraserTrailSvg.remove(); eraserTrailSvg = null; eraserTrailEl = null; }
    eraserTrailPoints = [];
  }

  function moveEraserCursor(e) {
    if (!eraserCursor) return;
    eraserCursor.style.left = e.clientX + "px";
    eraserCursor.style.top = e.clientY + "px";
    const overToolbar = e.target.closest?.(".sd-toolbar-wrapper");
    eraserCursor.style.opacity = overToolbar ? "0" : "1";
  }

  function buildTaperPolygon(pts, maxW) {
    if (pts.length < 2) return "";
    const count = pts.length;
    const left = [];
    const right = [];
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 1;
      const halfW = (t * t) * (maxW / 2);
      const p = pts[i];
      let dx = 0, dy = -1;
      if (i < count - 1) {
        dx = pts[i + 1].x - p.x;
        dy = pts[i + 1].y - p.y;
      } else {
        dx = p.x - pts[i - 1].x;
        dy = p.y - pts[i - 1].y;
      }
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      left.push({ x: p.x + nx * halfW, y: p.y + ny * halfW });
      right.push({ x: p.x - nx * halfW, y: p.y - ny * halfW });
    }
    right.reverse();
    const all = left.concat(right);
    return "M" + all.map((p) => p.x + "," + p.y).join(" L") + " Z";
  }

  function startEraserTrail(x, y) {
    removeEraserTrail();
    eraserTrailSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    eraserTrailSvg.setAttribute("class", "sd-eraser-trail-svg");
    Object.assign(eraserTrailSvg.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: document.documentElement.scrollWidth + "px",
      height: document.documentElement.scrollHeight + "px",
      zIndex: "2147483638",
      pointerEvents: "none",
      overflow: "visible",
    });
    eraserTrailEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    eraserTrailEl.setAttribute("fill", "rgba(239, 68, 68, 0.35)");
    eraserTrailEl.setAttribute("stroke", "none");
    eraserTrailSvg.appendChild(eraserTrailEl);
    document.body.appendChild(eraserTrailSvg);
    eraserTrailPoints = [{ x: x + window.scrollX, y: y + window.scrollY }];
  }

  function extendEraserTrail(x, y) {
    if (!eraserTrailEl) return;
    eraserTrailPoints.push({ x: x + window.scrollX, y: y + window.scrollY });
    if (eraserTrailPoints.length > ERASER_TAIL_LEN) {
      eraserTrailPoints = eraserTrailPoints.slice(-ERASER_TAIL_LEN);
    }
    eraserTrailEl.setAttribute("d", buildTaperPolygon(eraserTrailPoints, ERASER_RADIUS * 2));
  }

  function revertElementEdits(el) {
    const relevantUndos = [];
    for (let i = state.undoStack.length - 1; i >= 0; i--) {
      const action = state.undoStack[i];
      const actionEl = getActionEl(action);
      if (actionEl === el) {
        relevantUndos.push(i);
      }
    }
    for (const idx of relevantUndos) {
      const action = state.undoStack[idx];
      switch (action.type) {
        case "move":
        case "resize":
          action.styles.forEach((s) => { s.el.style[s.prop] = s.oldValue; });
          break;
        case "rotate":
          action.el.style.transform = action.oldTransform;
          break;
        case "textEdit":
          action.el.innerHTML = action.oldValue;
          break;
        case "lineEdit":
          action.el.innerHTML = action.oldHTML;
          action.el.style.left = action.oldLeft;
          action.el.style.top = action.oldTop;
          action.el.style.width = action.oldWidth;
          action.el.style.height = action.oldHeight;
          break;
        case "delete":
          if (!action.isPasted && action.el.style.display === "none") {
            action.el.style.display = action.oldDisplay || "";
          }
          break;
      }
      state.undoStack.splice(idx, 1);
    }
    if (relevantUndos.length > 0) {
      el.classList.remove("sd-text-edited");
    }
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function isEraserHittingElement(ex, ey, el) {
    const type = detectElementType(el);
    if (type !== "line" && type !== "arrow") return true;
    const svg = el.querySelector("svg");
    if (!svg) return true;
    const rect = el.getBoundingClientRect();
    const vb = svg.getAttribute("viewBox").split(" ").map(Number);
    const sx = rect.width / vb[2];
    const sy = rect.height / vb[3];
    const lineEl = svg.querySelector("g > line") || svg.querySelector("line");
    if (!lineEl) return true;
    const lx1 = parseFloat(lineEl.getAttribute("x1"));
    const ly1 = parseFloat(lineEl.getAttribute("y1"));
    const lx2 = parseFloat(lineEl.getAttribute("x2"));
    const ly2 = parseFloat(lineEl.getAttribute("y2"));
    const vx1 = rect.left + (lx1 - vb[0]) * sx;
    const vy1 = rect.top + (ly1 - vb[1]) * sy;
    const vx2 = rect.left + (lx2 - vb[0]) * sx;
    const vy2 = rect.top + (ly2 - vb[1]) * sy;
    const strokeW = parseFloat(lineEl.getAttribute("stroke-width") || "2");
    if (distToSegment(ex, ey, vx1, vy1, vx2, vy2) <= strokeW / 2) return true;
    if (type === "arrow") {
      const polyline = svg.querySelector("polyline");
      if (polyline) {
        const pts = polyline.getAttribute("points").split(/[\s,]+/).map(Number);
        if (pts.length >= 6) {
          const ax1 = rect.left + (pts[0] - vb[0]) * sx;
          const ay1 = rect.top + (pts[1] - vb[1]) * sy;
          const ax2 = rect.left + (pts[2] - vb[0]) * sx;
          const ay2 = rect.top + (pts[3] - vb[1]) * sy;
          const ax3 = rect.left + (pts[4] - vb[0]) * sx;
          const ay3 = rect.top + (pts[5] - vb[1]) * sy;
          if (distToSegment(ex, ey, ax1, ay1, ax2, ay2) <= strokeW / 2) return true;
          if (distToSegment(ex, ey, ax2, ay2, ax3, ay3) <= strokeW / 2) return true;
        }
      }
    }
    return false;
  }

  function eraseElementsAtPoint(x, y) {
    const eraserRect = {
      left: x - ERASER_RADIUS,
      top: y - ERASER_RADIUS,
      right: x + ERASER_RADIUS,
      bottom: y + ERASER_RADIUS,
    };

    let erased = false;

    const toErase = [];
    state.pastedItems.forEach((el) => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      if (r.right >= eraserRect.left && r.left <= eraserRect.right &&
          r.bottom >= eraserRect.top && r.top <= eraserRect.bottom) {
        if (!isEraserHittingElement(x, y, el)) return;
        toErase.push(el);
      }
    });

    toErase.forEach((el) => {
      const idx = state.pastedItems.indexOf(el);
      if (idx !== -1) state.pastedItems.splice(idx, 1);
      const parent = el.parentNode || document.body;
      el.remove();
      pushUndo({ type: "delete", el, parent, isPasted: true });
      erased = true;
    });

    const pastedSet = new Set(state.pastedItems);
    const toRevert = new Set();
    for (let i = state.undoStack.length - 1; i >= 0; i--) {
      const action = state.undoStack[i];
      if (!action) continue;
      const actionEl = getActionEl(action);
      if (!actionEl || !actionEl.isConnected || pastedSet.has(actionEl) || toRevert.has(actionEl)) continue;
      const r = actionEl.getBoundingClientRect();
      if (r.right < eraserRect.left || r.left > eraserRect.right ||
          r.bottom < eraserRect.top || r.top > eraserRect.bottom) continue;
      if (!isEraserHittingElement(x, y, actionEl)) continue;
      toRevert.add(actionEl);
    }
    toRevert.forEach((actionEl) => {
      revertElementEdits(actionEl);
      erased = true;
    });

    return erased;
  }

  function onEraserMouseDown(e) {
    if (state.activeTool !== "eraser") return;
    if (isExtensionEl(e.target) && !e.target.closest?.(".sd-pasted")) return;
    e.preventDefault();
    e.stopPropagation();
    eraserDragging = true;
    clearSelection();
    startEraserTrail(e.clientX, e.clientY);
    eraseElementsAtPoint(e.clientX, e.clientY);
    document.addEventListener("mousemove", onEraserMouseMove, true);
    document.addEventListener("mouseup", onEraserMouseUp, true);
  }

  function onEraserMouseMove(e) {
    if (!eraserDragging) return;
    e.preventDefault();
    extendEraserTrail(e.clientX, e.clientY);
    eraseElementsAtPoint(e.clientX, e.clientY);
  }

  function onEraserMouseUp(e) {
    eraserDragging = false;
    document.removeEventListener("mousemove", onEraserMouseMove, true);
    document.removeEventListener("mouseup", onEraserMouseUp, true);
    if (eraserTrailEl) {
      const fadingSvg = eraserTrailSvg;
      eraserTrailEl.style.transition = "opacity 0.4s";
      eraserTrailEl.style.opacity = "0";
      eraserTrailSvg = null;
      eraserTrailEl = null;
      eraserTrailPoints = [];
      eraserTrailTimeout = setTimeout(() => { if (fadingSvg) fadingSvg.remove(); eraserTrailTimeout = null; }, 400);
    }
  }

  // ─── Delete Element ────────────────────────────────────────────────
  function deleteSelectedElement() {
    if (!state.selectedEl) return;
    const el = state.selectedEl;
    const isPasted = el.classList.contains("sd-pasted");

    clearSelection();

    if (isPasted) {
      const idx = state.pastedItems.indexOf(el);
      if (idx !== -1) state.pastedItems.splice(idx, 1);
      const parent = el.parentNode || document.body;
      el.remove();
      pushUndo({ type: "delete", el, parent, isPasted: true });
    } else {
      const parent = el.parentNode;
      const next = el.nextSibling;
      const oldDisplay = el.style.display;
      el.style.display = "none";
      pushUndo({ type: "delete", el, parent, next, oldDisplay, isPasted: false });
    }

    showToolbar("Deleted — Ctrl+Z to undo");
    setTimeout(hideToolbar, 1500);
  }


  // ─── SVG Rasterization (for html2canvas compatibility) ──────────────
  function rasterizeDrawnSvgs() {
    const entries = [];
    document.querySelectorAll(".sd-drawn").forEach((container) => {
      const svg = container.querySelector("svg");
      if (!svg) return;
      const w = container.offsetWidth || parseInt(container.style.width) || 100;
      const h = container.offsetHeight || parseInt(container.style.height) || 100;
      const clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", w);
      clone.setAttribute("height", h);
      entries.push({ container, svg, w, h, clone });
    });
    return Promise.all(entries.map((entry) => {
      return new Promise((resolve) => {
        const svgStr = new XMLSerializer().serializeToString(entry.clone);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = entry.w;
          c.height = entry.h;
          c.style.cssText = "width:100%;height:100%;display:block;";
          c.getContext("2d").drawImage(img, 0, 0, entry.w, entry.h);
          entry.container.replaceChild(c, entry.svg);
          entry.canvas = c;
          resolve(entry);
        };
        img.onerror = () => resolve(entry);
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
      });
    }));
  }

  function restoreDrawnSvgs(entries) {
    entries.forEach((entry) => {
      if (entry.canvas && entry.canvas.parentElement === entry.container) {
        entry.container.replaceChild(entry.svg, entry.canvas);
      }
    });
  }

  // ─── Full Page Screenshot (html2canvas) ────────────────────────────
  function takeFullPageScreenshot(showHighlights) {
    exitTextEditing();
    clearSelection();
    hideToolbar();
    document.body.classList.add("sd-capturing");

    if (!showHighlights) {
      state.pastedItems.forEach((el) => {
        if (el.isConnected) {
          el.dataset.sdBorder = el.style.border;
          el.style.border = "none";
        }
      });
      document.querySelectorAll(".sd-text-edited").forEach((el) => {
        el.classList.remove("sd-text-edited");
        el.classList.add("sd-text-edited-hidden");
      });
    }

    if (typeof html2canvas === "undefined") {
      restoreAfterScreenshot();
      return Promise.resolve(null);
    }

    let scrollW, scrollH;
    if (isBlankCanvas()) {
      const bounds = getContentBounds();
      scrollW = bounds.width;
      scrollH = bounds.height;
    } else {
      scrollW = document.documentElement.scrollWidth;
      scrollH = document.documentElement.scrollHeight;
    }
    const opts = {
      useCORS: true,
      allowTaint: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: scrollW,
      windowHeight: scrollH,
      width: scrollW,
      height: scrollH,
    };

    let svgEntries = [];
    return rasterizeDrawnSvgs().then((entries) => {
      svgEntries = entries;
      return html2canvas(document.body, opts).then((canvas) => {
        restoreDrawnSvgs(svgEntries);
        restoreAfterScreenshot();
        return canvas.toDataURL("image/png");
      });
    }).catch(() => {
      restoreDrawnSvgs(svgEntries);
      restoreAfterScreenshot();
      return null;
    });
  }

  // ─── Side-by-Side Compositing ────────────────────────────────────
  function composeSideBySide(origCanvas, changedCanvas) {
    const PAD = 40;
    const LABEL_H = 56;
    const BORDER = 3;
    const GAP = 48;

    const imgW1 = origCanvas.width;
    const imgH1 = origCanvas.height;
    const imgW2 = changedCanvas.width;
    const imgH2 = changedCanvas.height;
    const maxH = Math.max(imgH1, imgH2);

    const totalW = PAD + BORDER + imgW1 + BORDER + GAP + BORDER + imgW2 + BORDER + PAD;
    const totalH = PAD + LABEL_H + BORDER + maxH + BORDER + PAD;

    const combo = document.createElement("canvas");
    combo.width = totalW;
    combo.height = totalH;
    const ctx = combo.getContext("2d");

    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, totalW, totalH);

    // Label: ORIGINAL
    const origLabelX = PAD + BORDER + imgW1 / 2;
    const changedLabelX = PAD + BORDER + imgW1 + BORDER + GAP + BORDER + imgW2 / 2;
    const labelY = PAD + LABEL_H - 14;

    ctx.font = "bold 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#64748b";
    ctx.fillText("ORIGINAL", origLabelX, labelY);
    ctx.fillStyle = "#dc2626";
    ctx.fillText("CHANGED", changedLabelX, labelY);

    // Border + image: ORIGINAL
    const imgY = PAD + LABEL_H;
    const origX = PAD;
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = BORDER;
    ctx.setLineDash([]);
    ctx.strokeRect(origX + BORDER / 2, imgY + BORDER / 2, imgW1 + BORDER, imgH1 + BORDER);
    ctx.drawImage(origCanvas, origX + BORDER, imgY + BORDER);

    // Border + image: CHANGED
    const changedX = PAD + BORDER + imgW1 + BORDER + GAP;
    ctx.strokeStyle = "#dc2626";
    ctx.strokeRect(changedX + BORDER / 2, imgY + BORDER / 2, imgW2 + BORDER, imgH2 + BORDER);
    ctx.drawImage(changedCanvas, changedX + BORDER, imgY + BORDER);

    // Divider line
    const dividerX = PAD + BORDER + imgW1 + BORDER + GAP / 2;
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.moveTo(dividerX, PAD + 10);
    ctx.lineTo(dividerX, totalH - PAD + 10);
    ctx.stroke();

    return combo.toDataURL("image/png");
  }

  // ─── Viewport Side-by-Side helpers ─────────────────────────────────
  let _revertState = null;

  function snapshotElement(el) {
    return {
      el,
      cssText: el.style.cssText,
      html: el.innerHTML,
      classes: el.getAttribute("class") || "",
      display: el.style.display,
    };
  }

  function revertToOriginal() {
    exitTextEditing();
    clearSelection();
    hideToolbar();
    if (state.hoveredEl) {
      state.hoveredEl.classList.remove("sd-hover-highlight");
    }
    document.querySelectorAll(".sd-hover-highlight, .sd-selected, .sd-text-editing, .sd-text-edited").forEach((el) => {
      el.classList.remove("sd-hover-highlight", "sd-selected", "sd-text-editing", "sd-text-edited");
    });

    // Snapshot every element that will be modified
    const pastedSnapshots = state.pastedItems
      .filter((el) => el.isConnected)
      .map((el) => snapshotElement(el));

    // Collect non-pasted page elements that were edited
    const pastedSet = new Set(state.pastedItems);
    const editedSnapshots = [];
    const snappedEls = new Set();
    state.undoStack.forEach((action) => {
      if (action.type === "textEdit" && action.el.isConnected && !pastedSet.has(action.el)) {
        if (!snappedEls.has(action.el)) { snappedEls.add(action.el); editedSnapshots.push(snapshotElement(action.el)); }
      }
      if ((action.type === "move" || action.type === "resize") && action.styles) {
        action.styles.forEach((s) => {
          if (!pastedSet.has(s.el) && !snappedEls.has(s.el)) { snappedEls.add(s.el); editedSnapshots.push(snapshotElement(s.el)); }
        });
      }
      if (action.type === "rotate" && action.el.isConnected && !pastedSet.has(action.el)) {
        if (!snappedEls.has(action.el)) { snappedEls.add(action.el); editedSnapshots.push(snapshotElement(action.el)); }
      }
      if (action.type === "delete" && !action.isPasted && action.el.isConnected && !pastedSet.has(action.el)) {
        if (!snappedEls.has(action.el)) { snappedEls.add(action.el); editedSnapshots.push(snapshotElement(action.el)); }
      }
    });

    // Hide pasted items
    pastedSnapshots.forEach((snap) => { snap.el.style.display = "none"; });

    // Revert non-pasted edits
    state.undoStack.forEach((action) => {
      if (action.type === "textEdit" && action.el.isConnected && !pastedSet.has(action.el)) {
        action.el.innerHTML = action.oldValue;
        action.el.classList.remove("sd-text-edited");
      }
      if (action.type === "move" || action.type === "resize") {
        action.styles.forEach((s) => {
          if (!pastedSet.has(s.el)) s.el.style[s.prop] = s.oldValue;
        });
        const el = action.styles[0]?.el;
        if (el && !pastedSet.has(el)) el.classList.remove("sd-text-edited");
      }
      if (action.type === "rotate" && !pastedSet.has(action.el)) {
        action.el.style.transform = action.oldTransform;
        action.el.classList.remove("sd-text-edited");
      }
      if (action.type === "delete" && !action.isPasted && action.el.style.display === "none") {
        action.el.style.display = action.oldDisplay || "";
      }
    });

    document.body.classList.add("sd-capturing");
    _revertState = { pastedSnapshots, editedSnapshots };
  }

  function restoreEdits() {
    document.body.classList.remove("sd-capturing");
    if (!_revertState) return;

    try {
      // Restore pasted items from snapshots
      _revertState.pastedSnapshots.forEach((snap) => {
        snap.el.style.cssText = snap.cssText;
        snap.el.setAttribute("class", snap.classes);
      });

      // Restore edited page elements from snapshots
      _revertState.editedSnapshots.forEach((snap) => {
        snap.el.style.cssText = snap.cssText;
        snap.el.innerHTML = snap.html;
        snap.el.setAttribute("class", snap.classes);
      });
    } catch (err) {
      console.error("[WebScreenDraft] restoreEdits error:", err);
    }

    _revertState = null;
  }

  function composeSideBySideFromUrls(originalUrl, changedUrl) {
    return new Promise((resolve) => {
      const imgOrig = new Image();
      const imgChanged = new Image();
      let loaded = 0;
      const onLoad = () => {
        loaded++;
        if (loaded < 2) return;
        const c1 = document.createElement("canvas");
        c1.width = imgOrig.width;
        c1.height = imgOrig.height;
        c1.getContext("2d").drawImage(imgOrig, 0, 0);
        const c2 = document.createElement("canvas");
        c2.width = imgChanged.width;
        c2.height = imgChanged.height;
        c2.getContext("2d").drawImage(imgChanged, 0, 0);
        resolve(composeSideBySide(c1, c2));
      };
      imgOrig.onload = onLoad;
      imgChanged.onload = onLoad;
      imgOrig.src = originalUrl;
      imgChanged.src = changedUrl;
    });
  }

  // ─── Side-by-Side Screenshot (Full Page) ───────────────────────────
  function takeSideBySideScreenshot(showHighlights) {
    exitTextEditing();
    clearSelection();
    hideToolbar();

    if (typeof html2canvas === "undefined") return Promise.resolve(null);

    // 1. Capture the CHANGED version — always hide highlights for side-by-side
    document.body.classList.add("sd-capturing");
    state.pastedItems.forEach((el) => {
      if (el.isConnected) {
        el.dataset.sdBorder = el.style.border;
        el.style.border = "none";
      }
    });
    document.querySelectorAll(".sd-text-edited").forEach((el) => {
      el.classList.remove("sd-text-edited");
      el.classList.add("sd-text-edited-hidden");
    });

    let scrollW, scrollH;
    if (isBlankCanvas()) {
      const bounds = getContentBounds();
      scrollW = bounds.width;
      scrollH = bounds.height;
    } else {
      scrollW = document.documentElement.scrollWidth;
      scrollH = document.documentElement.scrollHeight;
    }
    const opts = {
      useCORS: true,
      allowTaint: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: scrollW,
      windowHeight: scrollH,
      width: scrollW,
      height: scrollH,
    };

    let changedCanvas;
    let svgEntries;
    return rasterizeDrawnSvgs().then((entries) => {
      svgEntries = entries;
      return html2canvas(document.body, opts);
    }).then((canvas) => {
      changedCanvas = canvas;
      restoreDrawnSvgs(svgEntries);
      restoreAfterScreenshot();

      if (isBlankCanvas()) {
        const origCanvas = document.createElement("canvas");
        origCanvas.width = changedCanvas.width;
        origCanvas.height = changedCanvas.height;
        const ctx = origCanvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, origCanvas.width, origCanvas.height);
        return composeSideBySide(origCanvas, changedCanvas);
      }

      // 2. Snapshot all modified elements, then revert to original
      const pastedSnapshots = state.pastedItems
        .filter((el) => el.isConnected)
        .map((el) => snapshotElement(el));
      const pastedSet = new Set(state.pastedItems);
      const editedSnapshots = [];
      const snappedEls = new Set();
      state.undoStack.forEach((action) => {
        if (action.type === "textEdit" && action.el.isConnected && !pastedSet.has(action.el)) {
          if (!snappedEls.has(action.el)) { snappedEls.add(action.el); editedSnapshots.push(snapshotElement(action.el)); }
        }
        if ((action.type === "move" || action.type === "resize") && action.styles) {
          action.styles.forEach((s) => {
            if (!pastedSet.has(s.el) && !snappedEls.has(s.el)) { snappedEls.add(s.el); editedSnapshots.push(snapshotElement(s.el)); }
          });
        }
        if (action.type === "rotate" && action.el.isConnected && !pastedSet.has(action.el)) {
          if (!snappedEls.has(action.el)) { snappedEls.add(action.el); editedSnapshots.push(snapshotElement(action.el)); }
        }
        if (action.type === "delete" && !action.isPasted && action.el.isConnected && !pastedSet.has(action.el)) {
          if (!snappedEls.has(action.el)) { snappedEls.add(action.el); editedSnapshots.push(snapshotElement(action.el)); }
        }
      });

      // Remove all edit indicators before capturing original
      if (state.hoveredEl) {
        state.hoveredEl.classList.remove("sd-hover-highlight");
      }
      document.querySelectorAll(".sd-hover-highlight, .sd-selected, .sd-text-editing").forEach((el) => {
        el.classList.remove("sd-hover-highlight", "sd-selected", "sd-text-editing");
      });

      // Hide pasted items and revert non-pasted edits
      pastedSnapshots.forEach((snap) => { snap.el.style.display = "none"; });
      state.undoStack.forEach((action) => {
        if (action.type === "textEdit" && action.el.isConnected && !pastedSet.has(action.el)) {
          action.el.innerHTML = action.oldValue;
          action.el.classList.remove("sd-text-edited");
        }
        if (action.type === "move" || action.type === "resize") {
          action.styles.forEach((s) => {
            if (!pastedSet.has(s.el)) s.el.style[s.prop] = s.oldValue;
          });
          const el = action.styles[0]?.el;
          if (el && !pastedSet.has(el)) el.classList.remove("sd-text-edited");
        }
        if (action.type === "rotate" && !pastedSet.has(action.el)) {
          action.el.style.transform = action.oldTransform;
          action.el.classList.remove("sd-text-edited");
        }
        if (action.type === "delete" && !action.isPasted && action.el.style.display === "none") {
          action.el.style.display = action.oldDisplay || "";
        }
      });

      document.body.classList.add("sd-capturing");
      return html2canvas(document.body, opts).then((origCanvas) => {
        document.body.classList.remove("sd-capturing");

        // 3. Restore all edits from snapshots
        pastedSnapshots.forEach((snap) => {
          snap.el.style.cssText = snap.cssText;
          snap.el.setAttribute("class", snap.classes);
        });
        editedSnapshots.forEach((snap) => {
          snap.el.style.cssText = snap.cssText;
          snap.el.innerHTML = snap.html;
          snap.el.setAttribute("class", snap.classes);
        });

        return composeSideBySide(origCanvas, changedCanvas);
      });
    }).catch(() => {
      restoreDrawnSvgs(svgEntries || []);
      restoreAfterScreenshot();
      return null;
    });
  }

  // ─── Editor Toolbar ─────────────────────────────────────────────────
  let editorBar = null;
  let svgOverlay = null;
  let toolbarWrapper = null;
  let subToolbar = null;

  const STROKE_COLORS = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#6741d9", "#ffffff"];
  const BG_COLORS = ["transparent", "#ffffff", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99", "#d0bfff"];
  const STROKE_WIDTHS = [
    { value: 1, label: "Thin" },
    { value: 2, label: "Normal" },
    { value: 4, label: "Bold" },
  ];
  const STROKE_STYLES_OPT = [
    { value: "solid", label: "Solid" },
    { value: "dashed", label: "Dashed" },
    { value: "dotted", label: "Dotted" },
  ];
  const FONT_SIZES = [
    { value: 16, label: "S" },
    { value: 20, label: "M" },
    { value: 28, label: "L" },
    { value: 36, label: "XL" },
  ];
  const TOOL_PROPS = {
    select: [],
    rect: ["strokeColor", "backgroundColor", "strokeWidth", "strokeStyle"],
    circle: ["strokeColor", "backgroundColor", "strokeWidth", "strokeStyle"],
    arrow: ["strokeColor", "strokeWidth", "strokeStyle"],
    line: ["strokeColor", "strokeWidth", "strokeStyle"],
    draw: ["strokeColor", "strokeWidth"],
    text: ["strokeColor", "fontSize"],
    eraser: [],
  };

  const TOOLS = [
    { id: "select", label: "Selection", key: "1", icon: '<path d="M4 2L4 14L8 10H13L4 2Z" fill="currentColor"/>', group: 0 },
    { id: "rect", label: "Rectangle", key: "2", icon: '<rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>', group: 1 },
    { id: "circle", label: "Ellipse", key: "3", icon: '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" fill="none"/>', group: 1 },
    { id: "arrow", label: "Arrow", key: "4", icon: '<line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="1.5"/><polyline points="7,3 13,3 13,9" stroke="currentColor" stroke-width="1.5" fill="none"/>', group: 2 },
    { id: "line", label: "Line", key: "5", icon: '<line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="2"/>', group: 2 },
    { id: "draw", label: "Draw", key: "6", icon: '<path d="M12.1 1.9L14.1 3.9L5 13H3V11L12.1 1.9Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/><path d="M3 13L2 14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>', group: 3 },
    { id: "text", label: "Text", key: "7", icon: '<text x="8" y="12" text-anchor="middle" font-size="12" font-weight="bold" font-family="sans-serif" fill="currentColor">T</text>', group: 3 },
    { id: "eraser", label: "Eraser", key: "8", icon: '<path d="M3 13L9 3L14 7L8 13H3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/><line x1="8" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="6.5" y1="8" x2="11.5" y2="5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>', group: 4 },
  ];

  function applyStrokeProps(svgEl, includeBackground) {
    svgEl.setAttribute("stroke", state.strokeColor);
    svgEl.setAttribute("stroke-width", String(state.strokeWidth));
    if (state.strokeStyle === "dashed") svgEl.setAttribute("stroke-dasharray", "12,8");
    else if (state.strokeStyle === "dotted") svgEl.setAttribute("stroke-dasharray", "2,8");
    if (includeBackground) svgEl.setAttribute("fill", state.backgroundColor);
  }

  function createEditorBar() {
    if (editorBar) return;

    toolbarWrapper = document.createElement("div");
    toolbarWrapper.className = "sd-toolbar-wrapper";

    editorBar = document.createElement("div");
    editorBar.className = "sd-editor-bar";

    const grip = document.createElement("div");
    grip.className = "sd-toolbar-grip";
    grip.innerHTML = '<svg width="8" height="14" viewBox="0 0 8 14" fill="none">'
      + '<circle cx="2" cy="2" r="1.2" fill="#9ca3af"/>'
      + '<circle cx="6" cy="2" r="1.2" fill="#9ca3af"/>'
      + '<circle cx="2" cy="7" r="1.2" fill="#9ca3af"/>'
      + '<circle cx="6" cy="7" r="1.2" fill="#9ca3af"/>'
      + '<circle cx="2" cy="12" r="1.2" fill="#9ca3af"/>'
      + '<circle cx="6" cy="12" r="1.2" fill="#9ca3af"/>'
      + '</svg>';
    grip.addEventListener("mousedown", onEditorBarDragStart);
    editorBar.appendChild(grip);

    let lastGroup = -1;
    TOOLS.forEach((tool) => {
      if (tool.group !== lastGroup && lastGroup !== -1) {
        const divider = document.createElement("div");
        divider.className = "sd-toolbar-divider";
        editorBar.appendChild(divider);
      }
      lastGroup = tool.group;

      const btn = document.createElement("button");
      btn.className = "sd-tool-btn" + (tool.id === state.activeTool ? " active" : "");
      btn.dataset.tool = tool.id;
      btn.title = tool.label + (tool.key ? " (" + tool.key + ")" : "");
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none">' + tool.icon + '</svg>'
        + (tool.key ? '<span class="sd-tool-key">' + tool.key + '</span>' : '');
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        setActiveTool(tool.id);
      });
      editorBar.appendChild(btn);
    });

    const sep = document.createElement("div");
    sep.className = "sd-toolbar-divider";
    editorBar.appendChild(sep);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "sd-tool-btn sd-tool-btn-toggle";
    toggleBtn.title = "Toggle edit highlights";
    toggleBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none">'
      + '<path d="M8 2C5 2 2.7 4.7 1 8c1.7 3.3 4 6 7 6s5.3-2.7 7-6c-1.7-3.3-4-6-7-6z" stroke="currentColor" stroke-width="1.3" fill="none"/>'
      + '<circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.3" fill="none"/>'
      + '</svg>';
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.body.classList.toggle("sd-highlights-hidden");
      toggleBtn.classList.toggle("sd-toggle-off");
    });
    editorBar.appendChild(toggleBtn);

    subToolbar = document.createElement("div");
    subToolbar.className = "sd-subtoolbar";

    toolbarWrapper.appendChild(editorBar);
    toolbarWrapper.appendChild(subToolbar);
    document.body.appendChild(toolbarWrapper);

    updateSubToolbar();
  }

  function updateSubToolbar() {
    if (!subToolbar) return;
    const props = TOOL_PROPS[state.activeTool] || [];
    subToolbar.innerHTML = "";

    if (props.length === 0) {
      subToolbar.style.cssText = "display: none !important;";
      return;
    }
    subToolbar.style.cssText = "";

    props.forEach((prop, i) => {
      if (i > 0) {
        const divider = document.createElement("div");
        divider.className = "sd-prop-divider";
        subToolbar.appendChild(divider);
      }

      const section = document.createElement("div");
      section.className = "sd-prop-section";

      switch (prop) {
        case "strokeColor": {
          const label = document.createElement("span");
          label.className = "sd-prop-label";
          label.textContent = "Stroke";
          section.appendChild(label);
          STROKE_COLORS.forEach((color) => {
            const btn = document.createElement("button");
            btn.className = "sd-color-btn" + (state.strokeColor === color ? " active" : "");
            btn.style.cssText = "background: " + color + " !important;"
              + (color === "#ffffff" ? " border-color: #ced4da !important;" : "");
            btn.title = color;
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              state.strokeColor = color;
              updateSubToolbar();
            });
            section.appendChild(btn);
          });
          break;
        }
        case "backgroundColor": {
          const label = document.createElement("span");
          label.className = "sd-prop-label";
          label.textContent = "Fill";
          section.appendChild(label);
          BG_COLORS.forEach((color) => {
            const btn = document.createElement("button");
            const isTransparent = color === "transparent";
            btn.className = "sd-color-btn" + (isTransparent ? " transparent-swatch" : "") + (state.backgroundColor === color ? " active" : "");
            if (!isTransparent) {
              const border = color === "#ffffff" ? "border-color: #ced4da !important;" : "";
              btn.style.cssText = "background: " + color + " !important;" + border;
            }
            btn.title = isTransparent ? "No fill" : color;
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              state.backgroundColor = color;
              updateSubToolbar();
            });
            section.appendChild(btn);
          });
          break;
        }
        case "strokeWidth": {
          const label = document.createElement("span");
          label.className = "sd-prop-label";
          label.textContent = "Width";
          section.appendChild(label);
          STROKE_WIDTHS.forEach((opt) => {
            const btn = document.createElement("button");
            btn.className = "sd-width-btn" + (state.strokeWidth === opt.value ? " active" : "");
            btn.title = opt.label;
            btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20"><line x1="4" y1="10" x2="16" y2="10" stroke="#374151" stroke-width="' + opt.value + '" stroke-linecap="round"/></svg>';
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              state.strokeWidth = opt.value;
              updateSubToolbar();
            });
            section.appendChild(btn);
          });
          break;
        }
        case "strokeStyle": {
          const label = document.createElement("span");
          label.className = "sd-prop-label";
          label.textContent = "Style";
          section.appendChild(label);
          STROKE_STYLES_OPT.forEach((opt) => {
            const btn = document.createElement("button");
            btn.className = "sd-style-btn" + (state.strokeStyle === opt.value ? " active" : "");
            btn.title = opt.label;
            let dashAttr = "";
            if (opt.value === "dashed") dashAttr = ' stroke-dasharray="6,4"';
            else if (opt.value === "dotted") dashAttr = ' stroke-dasharray="2,4"';
            btn.innerHTML = '<svg width="28" height="20" viewBox="0 0 28 20"><line x1="4" y1="10" x2="24" y2="10" stroke="#374151" stroke-width="2" stroke-linecap="round"' + dashAttr + '/></svg>';
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              state.strokeStyle = opt.value;
              updateSubToolbar();
            });
            section.appendChild(btn);
          });
          break;
        }
        case "fontSize": {
          const label = document.createElement("span");
          label.className = "sd-prop-label";
          label.textContent = "Size";
          section.appendChild(label);
          FONT_SIZES.forEach((opt) => {
            const btn = document.createElement("button");
            btn.className = "sd-size-btn" + (state.fontSize === opt.value ? " active" : "");
            btn.textContent = opt.label;
            btn.title = opt.value + "px";
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              state.fontSize = opt.value;
              updateSubToolbar();
            });
            section.appendChild(btn);
          });
          break;
        }
      }
      subToolbar.appendChild(section);
    });
  }

  function readElementProps(el) {
    const svg = el.querySelector("svg");
    const shape = svg && (svg.querySelector("rect, ellipse, circle, line, polyline, path"));
    if (!shape && !el.classList.contains("sd-pasted")) return {};
    const result = {};
    if (shape) {
      result.stroke = shape.getAttribute("stroke") || "#1e1e1e";
      result.strokeWidth = parseFloat(shape.getAttribute("stroke-width")) || 2;
      const da = shape.getAttribute("stroke-dasharray") || "";
      if (da.startsWith("12")) result.strokeStyle = "dashed";
      else if (da.startsWith("2")) result.strokeStyle = "dotted";
      else result.strokeStyle = "solid";
      const fill = shape.getAttribute("fill");
      result.fill = (fill && fill !== "none") ? fill : "transparent";
    } else {
      const cs = window.getComputedStyle(el);
      result.stroke = cs.color || "#1e1e1e";
      result.fontSize = parseInt(cs.fontSize) || 20;
    }
    return result;
  }

  function applyPropToElement(el, propName, value) {
    const svg = el.querySelector("svg");
    const shapes = svg ? svg.querySelectorAll("rect, ellipse, circle, line, polyline, path") : [];
    shapes.forEach((s) => {
      switch (propName) {
        case "strokeColor":
          s.setAttribute("stroke", value);
          break;
        case "strokeWidth":
          s.setAttribute("stroke-width", String(value));
          break;
        case "strokeStyle":
          if (value === "dashed") s.setAttribute("stroke-dasharray", "12,8");
          else if (value === "dotted") s.setAttribute("stroke-dasharray", "2,8");
          else s.removeAttribute("stroke-dasharray");
          break;
        case "backgroundColor":
            if (s.tagName === "rect" || s.tagName === "ellipse" || s.tagName === "circle") {
            s.setAttribute("fill", value === "transparent" ? "none" : value);
          }
          break;
      }
    });
    if (propName === "strokeColor" && shapes.length === 0) {
      el.style.color = value;
    }
    if (propName === "fontSize" && shapes.length === 0) {
      el.style.fontSize = value + "px";
    }
  }

  function showSubToolbarForType(elType, el) {
    if (!subToolbar) return;
    const props = TOOL_PROPS[elType] || [];
    subToolbar.innerHTML = "";

    if (props.length === 0) {
      subToolbar.style.cssText = "display: none !important;";
      return;
    }
    subToolbar.style.cssText = "";

    const current = readElementProps(el);

    props.forEach((prop, i) => {
      if (i > 0) {
        const divider = document.createElement("div");
        divider.className = "sd-prop-divider";
        subToolbar.appendChild(divider);
      }

      const section = document.createElement("div");
      section.className = "sd-prop-section";

      switch (prop) {
        case "strokeColor": {
          const label = document.createElement("span");
          label.className = "sd-prop-label";
          label.textContent = "Stroke";
          section.appendChild(label);
          STROKE_COLORS.forEach((color) => {
            const btn = document.createElement("button");
            btn.className = "sd-color-btn" + (current.stroke === color ? " active" : "");
            btn.style.cssText = "background: " + color + " !important;"
              + (color === "#ffffff" ? " border-color: #ced4da !important;" : "");
            btn.title = color;
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              applyPropToElement(el, "strokeColor", color);
              state.strokeColor = color;
              showSubToolbarForType(elType, el);
            });
            section.appendChild(btn);
          });
          break;
        }
        case "backgroundColor": {
          const label = document.createElement("span");
          label.className = "sd-prop-label";
          label.textContent = "Fill";
          section.appendChild(label);
          BG_COLORS.forEach((color) => {
            const btn = document.createElement("button");
            const isTransparent = color === "transparent";
            btn.className = "sd-color-btn" + (isTransparent ? " transparent-swatch" : "") + (current.fill === color ? " active" : "");
            if (!isTransparent) {
              const border = color === "#ffffff" ? "border-color: #ced4da !important;" : "";
              btn.style.cssText = "background: " + color + " !important;" + border;
            }
            btn.title = isTransparent ? "No fill" : color;
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              applyPropToElement(el, "backgroundColor", color);
              state.backgroundColor = color;
              showSubToolbarForType(elType, el);
            });
            section.appendChild(btn);
          });
          break;
        }
        case "strokeWidth": {
          const label = document.createElement("span");
          label.className = "sd-prop-label";
          label.textContent = "Width";
          section.appendChild(label);
          STROKE_WIDTHS.forEach((opt) => {
            const btn = document.createElement("button");
            btn.className = "sd-width-btn" + (current.strokeWidth === opt.value ? " active" : "");
            btn.title = opt.label;
            btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20"><line x1="4" y1="10" x2="16" y2="10" stroke="#374151" stroke-width="' + opt.value + '" stroke-linecap="round"/></svg>';
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              applyPropToElement(el, "strokeWidth", opt.value);
              state.strokeWidth = opt.value;
              showSubToolbarForType(elType, el);
            });
            section.appendChild(btn);
          });
          break;
        }
        case "strokeStyle": {
          const label = document.createElement("span");
          label.className = "sd-prop-label";
          label.textContent = "Style";
          section.appendChild(label);
          STROKE_STYLES_OPT.forEach((opt) => {
            const btn = document.createElement("button");
            btn.className = "sd-style-btn" + (current.strokeStyle === opt.value ? " active" : "");
            btn.title = opt.label;
            let dashAttr = "";
            if (opt.value === "dashed") dashAttr = ' stroke-dasharray="6,4"';
            else if (opt.value === "dotted") dashAttr = ' stroke-dasharray="2,4"';
            btn.innerHTML = '<svg width="28" height="20" viewBox="0 0 28 20"><line x1="4" y1="10" x2="24" y2="10" stroke="#374151" stroke-width="2" stroke-linecap="round"' + dashAttr + '/></svg>';
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              applyPropToElement(el, "strokeStyle", opt.value);
              state.strokeStyle = opt.value;
              showSubToolbarForType(elType, el);
            });
            section.appendChild(btn);
          });
          break;
        }
        case "fontSize": {
          const label = document.createElement("span");
          label.className = "sd-prop-label";
          label.textContent = "Size";
          section.appendChild(label);
          const curSize = current.fontSize || state.fontSize;
          FONT_SIZES.forEach((opt) => {
            const btn = document.createElement("button");
            btn.className = "sd-size-btn" + (curSize === opt.value ? " active" : "");
            btn.textContent = opt.label;
            btn.title = opt.value + "px";
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              applyPropToElement(el, "fontSize", opt.value);
              state.fontSize = opt.value;
              showSubToolbarForType(elType, el);
            });
            section.appendChild(btn);
          });
          break;
        }
      }
      subToolbar.appendChild(section);
    });

  }


  // ─── Editor Bar Dragging ──────────────────────────────────────────
  let editorBarDrag = null;

  function onEditorBarDragStart(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!toolbarWrapper) return;

    const rect = toolbarWrapper.getBoundingClientRect();
    toolbarWrapper.style.setProperty("left", rect.left + "px", "important");
    toolbarWrapper.style.setProperty("top", rect.top + "px", "important");
    toolbarWrapper.style.setProperty("transform", "none", "important");

    editorBarDrag = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
    };

    document.addEventListener("mousemove", onEditorBarDragMove, true);
    document.addEventListener("mouseup", onEditorBarDragEnd, true);
  }

  function onEditorBarDragMove(e) {
    if (!editorBarDrag || !toolbarWrapper) return;
    e.preventDefault();
    const dx = e.clientX - editorBarDrag.startX;
    const dy = e.clientY - editorBarDrag.startY;
    toolbarWrapper.style.setProperty("left", (editorBarDrag.origLeft + dx) + "px", "important");
    toolbarWrapper.style.setProperty("top", (editorBarDrag.origTop + dy) + "px", "important");
  }

  function onEditorBarDragEnd() {
    editorBarDrag = null;
    document.removeEventListener("mousemove", onEditorBarDragMove, true);
    document.removeEventListener("mouseup", onEditorBarDragEnd, true);
  }

  function removeEditorBar() {
    if (toolbarWrapper) { toolbarWrapper.remove(); toolbarWrapper = null; editorBar = null; subToolbar = null; }
    removeSvgOverlay();
  }

  function setActiveTool(toolId) {
    state.activeTool = toolId;
    if (editorBar) {
      editorBar.querySelectorAll(".sd-tool-btn").forEach((b) => {
        if (b.dataset.tool) {
          b.classList.toggle("active", b.dataset.tool === toolId);
        }
      });
    }

    document.body.classList.toggle("sd-eraser-active", toolId === "eraser");

    if (toolId === "eraser") {
      removeSvgOverlay();
      createEraserCursor();
      document.addEventListener("mousemove", moveEraserCursor, true);
      document.addEventListener("mousedown", onEraserMouseDown, true);
    } else {
      removeEraserCursor();
      document.removeEventListener("mousemove", moveEraserCursor, true);
      document.removeEventListener("mousedown", onEraserMouseDown, true);
    }

    if (toolId === "select") {
      removeSvgOverlay();
    } else if (toolId !== "eraser") {
      clearSelection();
      ensureSvgOverlay();
      if (svgOverlay && toolId !== "draw") {
        svgOverlay.style.zIndex = "2147483639";
      }
    }

    updateSubToolbar();
  }

  // ─── SVG Drawing Overlay ──────────────────────────────────────────
  function ensureSvgOverlay() {
    if (svgOverlay) return;
    svgOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgOverlay.setAttribute("class", "sd-svg-overlay");
    Object.assign(svgOverlay.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: document.documentElement.scrollWidth + "px",
      height: document.documentElement.scrollHeight + "px",
      zIndex: "2147483639",
      pointerEvents: "auto",
      cursor: "crosshair",
    });
    svgOverlay.addEventListener("mousedown", onDrawStart);
    document.body.appendChild(svgOverlay);
  }

  function removeSvgOverlay() {
    if (svgOverlay) { svgOverlay.remove(); svgOverlay = null; }
  }

  function onDrawStart(e) {
    if (state.activeTool === "select") return;
    e.preventDefault();
    e.stopPropagation();

    const x = e.clientX + window.scrollX;
    const y = e.clientY + window.scrollY;

    if (state.activeTool === "text") {
      placeTextBox(x, y);
      return;
    }

    state.drawingData = { startX: x, startY: y, el: null };

    if (state.activeTool === "draw") {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M" + x + "," + y);
      path.setAttribute("stroke", state.strokeColor);
      path.setAttribute("stroke-width", String(state.strokeWidth));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("vector-effect", "non-scaling-stroke");
      svgOverlay.appendChild(path);
      state.drawingData.el = path;
      state.drawingData.pathD = "M" + x + "," + y;
    }

    document.addEventListener("mousemove", onDrawMove, true);
    document.addEventListener("mouseup", onDrawEnd, true);
  }

  function onDrawMove(e) {
    if (!state.drawingData) return;
    e.preventDefault();

    const x = e.clientX + window.scrollX;
    const y = e.clientY + window.scrollY;
    const d = state.drawingData;
    const dx = x - d.startX;
    const dy = y - d.startY;

    if (state.activeTool === "draw") {
      d.pathD += " L" + x + "," + y;
      d.el.setAttribute("d", d.pathD);
      return;
    }

    if (d.el) d.el.remove();

    if (state.activeTool === "rect") {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", Math.min(d.startX, x));
      rect.setAttribute("y", Math.min(d.startY, y));
      rect.setAttribute("width", Math.abs(dx));
      rect.setAttribute("height", Math.abs(dy));
      rect.setAttribute("rx", "2");
      rect.setAttribute("vector-effect", "non-scaling-stroke");
      applyStrokeProps(rect, true);
      svgOverlay.appendChild(rect);
      d.el = rect;
    } else if (state.activeTool === "circle") {
      const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
      ellipse.setAttribute("cx", d.startX + dx / 2);
      ellipse.setAttribute("cy", d.startY + dy / 2);
      ellipse.setAttribute("rx", Math.abs(dx / 2));
      ellipse.setAttribute("ry", Math.abs(dy / 2));
      ellipse.setAttribute("vector-effect", "non-scaling-stroke");
      applyStrokeProps(ellipse, true);
      svgOverlay.appendChild(ellipse);
      d.el = ellipse;
    } else if (state.activeTool === "line") {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", d.startX);
      line.setAttribute("y1", d.startY);
      line.setAttribute("x2", x);
      line.setAttribute("y2", y);
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      applyStrokeProps(line, false);
      svgOverlay.appendChild(line);
      d.el = line;
    } else if (state.activeTool === "arrow") {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", d.startX);
      line.setAttribute("y1", d.startY);
      line.setAttribute("x2", x);
      line.setAttribute("y2", y);
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      applyStrokeProps(line, false);
      g.appendChild(line);

      const angle = Math.atan2(y - d.startY, x - d.startX);
      const headLen = 14;
      const a1x = x - headLen * Math.cos(angle - Math.PI / 6);
      const a1y = y - headLen * Math.sin(angle - Math.PI / 6);
      const a2x = x - headLen * Math.cos(angle + Math.PI / 6);
      const a2y = y - headLen * Math.sin(angle + Math.PI / 6);
      const head = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      head.setAttribute("points", a1x + "," + a1y + " " + x + "," + y + " " + a2x + "," + a2y);
      head.setAttribute("fill", "none");
      head.setAttribute("stroke-linecap", "round");
      head.setAttribute("stroke-linejoin", "round");
      head.setAttribute("vector-effect", "non-scaling-stroke");
      applyStrokeProps(head, false);
      g.appendChild(head);

      svgOverlay.appendChild(g);
      d.el = g;
    }
  }

  function onDrawEnd(e) {
    document.removeEventListener("mousemove", onDrawMove, true);
    document.removeEventListener("mouseup", onDrawEnd, true);
    if (!state.drawingData || !state.drawingData.el) {
      state.drawingData = null;
      return;
    }

    const svgEl = state.drawingData.el;
    const keepTool = state.activeTool === "draw";
    state.drawingData = null;

    finishDrawnElement(svgEl, keepTool);
  }

  function finishDrawnElement(svgEl, keepTool) {
    const bbox = svgEl.getBBox();
    if (bbox.width < 3 && bbox.height < 3) {
      svgEl.remove();
      return;
    }

    const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const pad = 4;
    const w = bbox.width + pad * 2;
    const h = bbox.height + pad * 2;
    wrapper.setAttribute("viewBox", (bbox.x - pad) + " " + (bbox.y - pad) + " " + w + " " + h);
    wrapper.setAttribute("preserveAspectRatio", "none");
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.style.overflow = "visible";
    wrapper.style.display = "block";

    svgEl.remove();
    wrapper.appendChild(svgEl);

    const container = document.createElement("div");
    container.className = "sd-pasted sd-drawn" + (keepTool ? "" : " sd-text-edited");
    Object.assign(container.style, {
      position: "absolute",
      left: (bbox.x - pad) + "px",
      top: (bbox.y - pad) + "px",
      width: w + "px",
      height: h + "px",
      zIndex: "2147483640",
      cursor: "move",
      border: "none",
      userSelect: "none",
      lineHeight: "0",
    });
    container.appendChild(wrapper);
    document.body.appendChild(container);
    state.pastedItems.push(container);
    pushUndo({ type: "paste", el: container });

    if (keepTool) {
      if (svgOverlay) {
        svgOverlay.style.zIndex = "2147483645";
      }
    } else {
      setActiveTool("select");
      selectElement(container);
      showToolbar("Shape created — drag to move");
      setTimeout(hideToolbar, 1500);
    }
  }

  function placeTextBox(x, y) {
    const el = document.createElement("div");
    el.className = "sd-pasted sd-drawn sd-text-edited";
    el.setAttribute("contenteditable", "true");
    el.textContent = "Text";
    Object.assign(el.style, {
      position: "absolute",
      left: x + "px",
      top: y + "px",
      zIndex: "2147483640",
      background: "transparent",
      border: "1px dashed #4f46e5",
      padding: "4px 8px",
      fontSize: state.fontSize + "px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontWeight: "normal",
      color: state.strokeColor,
      cursor: "move",
      minWidth: "200px",
      minHeight: "40px",
      maxWidth: "500px",
      userSelect: "none",
      whiteSpace: "pre-wrap",
      wordWrap: "break-word",
      overflowWrap: "break-word",
    });
    document.body.appendChild(el);
    state.pastedItems.push(el);
    pushUndo({ type: "paste", el });

    setActiveTool("select");
    selectElement(el);

    // Immediately enter text editing mode
    el.style.userSelect = "text";
    el.style.cursor = "text";
    el.classList.add("sd-text-editing");
    state.textEditing = el;
    state.textEditInfo = { originalText: el.innerHTML, isPasted: true };
    el.textContent = "";
    el.focus();
    document.addEventListener("keydown", onTextEditKeydown, true);
    el.addEventListener("input", onTextInput);
  }

  // ─── Keyboard Shortcuts ────────────────────────────────────────────
  function onKeyDown(e) {
    if (!state.editActive) return;

    // Ctrl+Shift+Z redo
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
      if (state.textEditing) return;
      e.preventDefault();
      e.stopPropagation();
      redoLast();
      return;
    }

    // Ctrl+Z undo
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      if (state.textEditing) return;
      e.preventDefault();
      e.stopPropagation();
      undoLast();
      return;
    }

    // Ctrl+C copy element to internal clipboard
    if ((e.ctrlKey || e.metaKey) && e.key === "c" && !e.shiftKey) {
      if (state.textEditing) return;
      if (state.selectedEl) {
        e.preventDefault();
        e.stopPropagation();
        copyToClipboard();
      }
      return;
    }

    // Ctrl+V paste element from internal clipboard (fall through to native paste otherwise)
    if ((e.ctrlKey || e.metaKey) && e.key === "v" && !e.shiftKey) {
      if (state.textEditing) return;
      if (state.clipboardEl) {
        e.preventDefault();
        e.stopPropagation();
        pasteFromClipboard();
        return;
      }
      // No internal clipboard — let the native paste event fire so onPaste handles it
    }

    // Delete / Backspace to delete selected element
    if (e.key === "Delete" || e.key === "Backspace") {
      if (state.textEditing) return;
      if (state.selectedEl) {
        e.preventDefault();
        e.stopPropagation();
        deleteSelectedElement();
      }
      return;
    }

    // Escape to deselect or return to selection tool
    if (e.key === "Escape" && !state.textEditing) {
      if (state.activeTool !== "select") {
        e.preventDefault();
        setActiveTool("select");
        return;
      }
      if (state.selectedEl) {
        e.preventDefault();
        clearSelection();
        return;
      }
    }

    // Number keys 1-8 to switch tools (like Excalidraw)
    if (!state.textEditing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tool = TOOLS.find((t) => t.key === e.key);
      if (tool) {
        e.preventDefault();
        setActiveTool(tool.id);
        return;
      }
    }
  }

  // ─── Event Binding ──────────────────────────────────────────────────
  function enableEditListeners() {
    document.addEventListener("mouseover", onMouseOverElement, true);
    document.addEventListener("mouseout", onMouseOutElement, true);
    document.addEventListener("click", onClickElement, true);
    document.addEventListener("dblclick", onDblClick, true);
    document.addEventListener("mousedown", onDragStart, false);
    document.addEventListener("mousemove", onDragMove, false);
    document.addEventListener("mouseup", onDragEnd, false);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("click", onClickOutsideTextEdit, false);
    document.addEventListener("keydown", onKeyDown, true);
    createEditorBar();
  }

  function disableEditListeners() {
    document.removeEventListener("mouseover", onMouseOverElement, true);
    document.removeEventListener("mouseout", onMouseOutElement, true);
    document.removeEventListener("click", onClickElement, true);
    document.removeEventListener("dblclick", onDblClick, true);
    document.removeEventListener("mousedown", onDragStart, false);
    document.removeEventListener("mousemove", onDragMove, false);
    document.removeEventListener("mouseup", onDragEnd, false);
    document.removeEventListener("paste", onPaste, true);
    document.removeEventListener("click", onClickOutsideTextEdit, false);
    document.removeEventListener("keydown", onKeyDown, true);
    if (state.hoveredEl) {
      state.hoveredEl.classList.remove("sd-hover-highlight");
      state.hoveredEl = null;
    }
    exitTextEditing();
    clearSelection();
    removeEditorBar();
    removeEraserCursor();
    document.removeEventListener("mousemove", moveEraserCursor, true);
    document.removeEventListener("mousedown", onEraserMouseDown, true);
    document.body.classList.remove("sd-eraser-active");
    state.activeTool = "select";
  }

  // ─── Click on pasted items to select + drag ─────────────────────────
  document.addEventListener("mousedown", (e) => {
    if (!state.editActive) return;
    if (state.activeTool === "eraser") return;
    const pasted = e.target.closest?.(".sd-pasted");
    if (!pasted) return;
    if (state.activeTool !== "select") return;
    if (state.textEditing === pasted) return;
    e.preventDefault();
    e.stopPropagation();

    selectElement(pasted);
    const savedStyles = [
      { el: pasted, prop: "left", oldValue: pasted.style.left },
      { el: pasted, prop: "top", oldValue: pasted.style.top },
    ];
    state.dragging = true;
    state.dragData = {
      el: pasted,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: parseFloat(pasted.style.left) || 0,
      origTop: parseFloat(pasted.style.top) || 0,
      mode: "absolute",
      savedStyles,
    };
    pasted.classList.add("sd-dragging");
  }, true);


  // ─── Message Handling ───────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PING") { sendResponse("PONG"); return; }
    switch (msg.type) {
      case "TOGGLE_EDIT":
        state.editActive = msg.active;
        if (state.editActive) {
          enableEditListeners();
          createToolbar();
          showToolbar("Edit mode ON — click to select, double-click text to edit");
          setTimeout(hideToolbar, 2500);
        } else {
          disableEditListeners();
          hideToolbar();
        }
        sendResponse({ ok: true });
        break;

      case "TOGGLE_EDIT_SHORTCUT":
        state.editActive = !state.editActive;
        if (state.editActive) {
          enableEditListeners();
          createToolbar();
          showToolbar("Edit mode ON");
          setTimeout(hideToolbar, 2000);
        } else {
          disableEditListeners();
          hideToolbar();
        }
        sendResponse({ ok: true });
        break;

      case "GET_STATE":
        sendResponse({
          editActive: state.editActive,
        });
        break;

      case "HAS_CHANGES":
        sendResponse({
          hasChanges: state.undoStack.length > 0 || state.pastedItems.some((el) => el.isConnected),
        });
        break;

      case "PREPARE_SCREENSHOT":
        prepareScreenshot(msg.showHighlights);
        sendResponse({ ok: true });
        break;

      case "SCREENSHOT_DONE":
        restoreAfterScreenshot();
        sendResponse({ ok: true });
        break;

      case "FULL_PAGE_SCREENSHOT":
        takeFullPageScreenshot(msg.showHighlights).then((dataUrl) => {
          sendResponse({ dataUrl });
        });
        return true;

      case "SIDE_BY_SIDE_SCREENSHOT":
        takeSideBySideScreenshot(msg.showHighlights).then((dataUrl) => {
          sendResponse({ dataUrl });
        });
        return true;

      case "REVERT_TO_ORIGINAL":
        revertToOriginal();
        sendResponse({ ok: true });
        break;

      case "RESTORE_EDITS":
        restoreEdits();
        sendResponse({ ok: true });
        break;

      case "COMPOSE_SIDE_BY_SIDE":
        composeSideBySideFromUrls(msg.originalUrl, msg.changedUrl).then((dataUrl) => {
          sendResponse({ dataUrl });
        });
        return true;

      case "RESET_ALL":
        resetAll();
        sendResponse({ ok: true });
        break;

      default:
        return false;
    }
    return true;
  });

  // Store cleanup function for future reloads
  window.__sdCleanup = () => {
    state.editActive = false;
    disableEditListeners();
    removeSvgOverlay();
    if (_statusToast) { _statusToast.remove(); _statusToast = null; }
    document.querySelectorAll(".sd-toolbar-wrapper, .sd-svg-overlay").forEach((el) => el.remove());
  };

  if (location.pathname.endsWith("blank.html")) {
    state.editActive = true;
    enableEditListeners();
  }
})();
