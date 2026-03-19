chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_EDIT_SHORTCUT" });
      }
    });
  }
});
