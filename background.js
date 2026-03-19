const injectedTabs = new Set();

async function ensureContentScripts(tabId) {
  if (injectedTabs.has(tabId)) return;
  try {
    const results = await chrome.tabs.sendMessage(tabId, { type: "PING" }).catch(() => null);
    if (results === "PONG") {
      injectedTabs.add(tabId);
      return;
    }
  } catch {}
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/html2canvas.min.js", "content.js"] });
  injectedTabs.add(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => injectedTabs.delete(tabId));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "INJECT_CONTENT_SCRIPTS") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) { sendResponse({ error: "No active tab" }); return; }
      try {
        await ensureContentScripts(tabs[0].id);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });
    return true;
  }

  if (message.type === "TAKE_SCREENSHOT") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ error: "No active tab" });
        return;
      }
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
          return;
        }
        const filename = "web-screen-draft-" + Date.now() + ".png";
        chrome.downloads.download(
          { url: dataUrl, filename: filename, saveAs: true },
          (downloadId) => {
            chrome.tabs.sendMessage(tabs[0].id, { type: "SCREENSHOT_DONE" });
            sendResponse({ success: true, downloadId });
          }
        );
      });
    });
    return true;
  }

  if (message.type === "CAPTURE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ error: "No active tab" });
        return;
      }
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ dataUrl });
      });
    });
    return true;
  }

  if (message.type === "DOWNLOAD_DATA_URL") {
    const filename = message.filename || ("web-screen-draft-" + Date.now() + ".png");
    chrome.downloads.download(
      { url: message.dataUrl, filename: filename, saveAs: true },
      (downloadId) => {
        sendResponse({ success: true, downloadId });
      }
    );
    return true;
  }
});

chrome.commands?.onCommand?.addListener((command) => {
  if (command === "toggle-edit") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        await ensureContentScripts(tabs[0].id);
        chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_EDIT_SHORTCUT" });
      }
    });
  }
});
