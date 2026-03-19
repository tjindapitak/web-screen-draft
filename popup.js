(function () {
  const toggleBtn = document.getElementById("toggleEdit");
  const statusBadge = document.getElementById("statusBadge");
  const ssViewport = document.getElementById("screenshotViewport");
  const ssFullPage = document.getElementById("screenshotFullPage");
  const ssSideBySide = document.getElementById("screenshotSideBySide");
  const ssSbsViewport = document.getElementById("screenshotSbsViewport");
  const resetBtn = document.getElementById("resetChanges");
  const showHighlightsCheckbox = document.getElementById("showHighlights");

  let editActive = false;

  function sendToContent(message) {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return resolve(null);
        chrome.tabs.sendMessage(tabs[0].id, message, resolve);
      });
    });
  }

  function sendToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  function setButtonLoading(btn, loading) {
    btn.disabled = loading;
    if (loading) {
      btn.dataset.origText = btn.textContent;
      btn.textContent = "Capturing...";
    } else {
      btn.textContent = btn.dataset.origText || "";
    }
  }

  function updateUI() {
    if (editActive) {
      toggleBtn.textContent = "";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("fill", "none");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M4 4L12 12M12 4L4 12");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
      toggleBtn.appendChild(svg);
      toggleBtn.appendChild(document.createTextNode(" Disable Edit Mode"));
      toggleBtn.classList.add("active");
      statusBadge.textContent = "ON";
      statusBadge.classList.add("active");
    } else {
      toggleBtn.textContent = "";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("fill", "none");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M11.5 1.5L14.5 4.5L5 14H2V11L11.5 1.5Z");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
      toggleBtn.appendChild(svg);
      toggleBtn.appendChild(document.createTextNode(" Enable Edit Mode"));
      toggleBtn.classList.remove("active");
      statusBadge.textContent = "OFF";
      statusBadge.classList.remove("active");
    }
  }

  toggleBtn.addEventListener("click", async () => {
    editActive = !editActive;
    updateUI();
    await sendToContent({ type: "TOGGLE_EDIT", active: editActive });
  });

  // Viewport screenshot (captureVisibleTab)
  ssViewport.addEventListener("click", async () => {
    setButtonLoading(ssViewport, true);
    await sendToContent({ type: "PREPARE_SCREENSHOT", showHighlights: showHighlightsCheckbox.checked });
    await new Promise((r) => setTimeout(r, 150));
    await sendToBackground({ type: "TAKE_SCREENSHOT" });
    setButtonLoading(ssViewport, false);
  });

  // Full page screenshot (html2canvas)
  ssFullPage.addEventListener("click", async () => {
    setButtonLoading(ssFullPage, true);
    const result = await sendToContent({ type: "FULL_PAGE_SCREENSHOT", showHighlights: showHighlightsCheckbox.checked });
    if (result && result.dataUrl) {
      await sendToBackground({
        type: "DOWNLOAD_DATA_URL",
        dataUrl: result.dataUrl,
        filename: "web-screen-draft-fullpage-" + Date.now() + ".png",
      });
    }
    setButtonLoading(ssFullPage, false);
  });

  // Side-by-side screenshot — full page (original vs changed)
  ssSideBySide.addEventListener("click", async () => {
    setButtonLoading(ssSideBySide, true);
    const result = await sendToContent({ type: "SIDE_BY_SIDE_SCREENSHOT", showHighlights: showHighlightsCheckbox.checked });
    if (result && result.dataUrl) {
      await sendToBackground({
        type: "DOWNLOAD_DATA_URL",
        dataUrl: result.dataUrl,
        filename: "web-screen-draft-compare-" + Date.now() + ".png",
      });
    }
    setButtonLoading(ssSideBySide, false);
  });

  // Side-by-side screenshot — viewport (original vs changed)
  ssSbsViewport.addEventListener("click", async () => {
    setButtonLoading(ssSbsViewport, true);

    // 1. Prepare changed state and capture viewport
    await sendToContent({ type: "PREPARE_SCREENSHOT", showHighlights: showHighlightsCheckbox.checked });
    await new Promise((r) => setTimeout(r, 150));
    const changedResult = await sendToBackground({ type: "CAPTURE_TAB" });
    await sendToContent({ type: "SCREENSHOT_DONE" });

    // 2. Revert to original and capture viewport
    await sendToContent({ type: "REVERT_TO_ORIGINAL" });
    await new Promise((r) => setTimeout(r, 150));
    const originalResult = await sendToBackground({ type: "CAPTURE_TAB" });
    await sendToContent({ type: "RESTORE_EDITS" });

    // 3. Compose side-by-side in content script
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

    setButtonLoading(ssSbsViewport, false);
  });

  resetBtn.addEventListener("click", async () => {
    await sendToContent({ type: "RESET_ALL" });
    editActive = false;
    updateUI();
  });

  sendToContent({ type: "GET_STATE" }).then((state) => {
    if (state) {
      editActive = state.editActive;
    }
    updateUI();
  });
})();
