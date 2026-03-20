(function () {
  const toggleBtn = document.getElementById("toggleEdit");
  const statusLabel = document.getElementById("statusLabel");
  const captureViewport = document.getElementById("captureViewport");
  const captureFullPage = document.getElementById("captureFullPage");
  const resetBtn = document.getElementById("resetChanges");
  const blankCanvasBtn = document.getElementById("blankCanvas");
  const showHighlightsCheckbox = document.getElementById("showHighlights");
  const modeToggle = document.getElementById("modeToggle");

  let editActive = false;
  let captureMode = "changes";
  let activeTabIsExtension = false;

  modeToggle.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      modeToggle.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      captureMode = btn.dataset.mode;
    });
  });

  async function ensureInjected() {
    await sendToBackground({ type: "INJECT_CONTENT_SCRIPTS" });
  }

  function sendToContent(message) {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return resolve(null);
        if (tabs[0].url?.startsWith("chrome-extension://")) {
          chrome.runtime.sendMessage(message, resolve);
        } else {
          chrome.tabs.sendMessage(tabs[0].id, message, resolve);
        }
      });
    });
  }

  function sendToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.classList.toggle("loading", loading);
    const label = btn.querySelector("span");
    if (loading) {
      btn.dataset.origLabel = label ? label.textContent : "";
      if (label) label.textContent = "Capturing\u2026";
    } else {
      if (label) label.textContent = btn.dataset.origLabel || "";
    }
  }

  function showNoChanges(btn) {
    const label = btn.querySelector("span");
    const orig = label ? label.textContent : "";
    if (label) label.textContent = "No changes";
    btn.disabled = true;
    setTimeout(() => {
      if (label) label.textContent = orig;
      btn.disabled = false;
    }, 1500);
  }

  function updateUI() {
    toggleBtn.classList.toggle("active", editActive);
    statusLabel.textContent = editActive ? "Active" : "Off";
  }

  toggleBtn.addEventListener("click", async () => {
    await ensureInjected();
    editActive = !editActive;
    updateUI();
    await sendToContent({ type: "TOGGLE_EDIT", active: editActive });
    if (editActive) window.close();
  });

  // Viewport: changes-only screenshot
  async function viewportChanges() {
    const check = await sendToContent({ type: "HAS_CHANGES" });
    if (!check || !check.hasChanges) {
      showNoChanges(captureViewport);
      return;
    }
    setLoading(captureViewport, true);
    await sendToContent({ type: "PREPARE_SCREENSHOT", showHighlights: showHighlightsCheckbox.checked });
    await new Promise((r) => setTimeout(r, 150));
    await sendToBackground({ type: "TAKE_SCREENSHOT" });
    await sendToContent({ type: "SCREENSHOT_DONE" });
    setLoading(captureViewport, false);
  }

  // Viewport: side-by-side
  async function viewportSideBySide() {
    const check = await sendToContent({ type: "HAS_CHANGES" });
    if (!check || !check.hasChanges) {
      showNoChanges(captureViewport);
      return;
    }
    setLoading(captureViewport, true);

    try {
      await sendToContent({ type: "PREPARE_SCREENSHOT", showHighlights: showHighlightsCheckbox.checked });
      await new Promise((r) => setTimeout(r, 150));
      const changedResult = await sendToBackground({ type: "CAPTURE_TAB" });
      await sendToContent({ type: "SCREENSHOT_DONE" });

      await sendToContent({ type: "REVERT_TO_ORIGINAL" });
      await new Promise((r) => setTimeout(r, 150));
      const originalResult = await sendToBackground({ type: "CAPTURE_TAB" });
      await sendToContent({ type: "RESTORE_EDITS" });

      if (changedResult?.dataUrl && originalResult?.dataUrl) {
        const composed = await sendToContent({
          type: "COMPOSE_SIDE_BY_SIDE",
          originalUrl: originalResult.dataUrl,
          changedUrl: changedResult.dataUrl,
        });
        if (composed?.dataUrl) {
          await sendToBackground({
            type: "DOWNLOAD_DATA_URL",
            dataUrl: composed.dataUrl,
            filename: "web-screen-draft-viewport-compare-" + Date.now() + ".png",
          });
        }
      }
    } catch (err) {
      console.error("[WebScreenDraft] viewportSideBySide error:", err);
    }

    setLoading(captureViewport, false);
  }

  // Full page: changes-only screenshot
  async function fullPageChanges() {
    const check = await sendToContent({ type: "HAS_CHANGES" });
    if (!check || !check.hasChanges) {
      showNoChanges(captureFullPage);
      return;
    }
    setLoading(captureFullPage, true);
    const result = await sendToContent({ type: "FULL_PAGE_SCREENSHOT", showHighlights: showHighlightsCheckbox.checked });
    if (result && result.dataUrl) {
      await sendToBackground({
        type: "DOWNLOAD_DATA_URL",
        dataUrl: result.dataUrl,
        filename: "web-screen-draft-fullpage-" + Date.now() + ".png",
      });
    }
    setLoading(captureFullPage, false);
  }

  // Full page: side-by-side
  async function fullPageSideBySide() {
    const check = await sendToContent({ type: "HAS_CHANGES" });
    if (!check || !check.hasChanges) {
      showNoChanges(captureFullPage);
      return;
    }
    setLoading(captureFullPage, true);
    const result = await sendToContent({ type: "SIDE_BY_SIDE_SCREENSHOT", showHighlights: showHighlightsCheckbox.checked });
    if (result && result.dataUrl) {
      await sendToBackground({
        type: "DOWNLOAD_DATA_URL",
        dataUrl: result.dataUrl,
        filename: "web-screen-draft-compare-" + Date.now() + ".png",
      });
    }
    setLoading(captureFullPage, false);
  }

  captureViewport.addEventListener("click", async () => {
    await ensureInjected();
    if (captureMode === "sidebyside") await viewportSideBySide();
    else await viewportChanges();
  });

  captureFullPage.addEventListener("click", async () => {
    await ensureInjected();
    if (captureMode === "sidebyside") await fullPageSideBySide();
    else await fullPageChanges();
  });

  blankCanvasBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("blank.html") });
    window.close();
  });

  resetBtn.addEventListener("click", async () => {
    await ensureInjected();
    await sendToContent({ type: "RESET_ALL" });
    editActive = false;
    updateUI();
  });

  ensureInjected().then(() => {
    sendToContent({ type: "GET_STATE" }).then((state) => {
      if (state) {
        editActive = state.editActive;
      }
      updateUI();
    });
  }).catch(() => {
    updateUI();
  });
})();
