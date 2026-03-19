# Privacy Policy — Web Screen Draft

**Last updated:** March 19, 2026

## Overview

Web Screen Draft is a Chrome extension that lets you edit, move, paste, and screenshot any webpage. It is designed for legal, product, and compliance teams. The extension operates entirely on your local device and does not collect, store, or transmit any personal data.

## Data Collection

**We do not collect any data.** Specifically:

- No personal information is collected.
- No browsing history is recorded.
- No analytics or telemetry data is gathered.
- No cookies are set by the extension.
- No user accounts or sign-ins are required.

## Permissions

The extension requests the following Chrome permissions, each used solely for its core functionality:

| Permission | Why it's needed |
|---|---|
| `activeTab` | Access the current tab to enable on-page editing and capture screenshots. |
| `downloads` | Save screenshots to your local Downloads folder. |
| `clipboardRead` | Read clipboard content when you paste text or images onto the page in edit mode. |

## Data Storage

- The extension does **not** use `chrome.storage`, `localStorage`, or any other persistent storage mechanism.
- All edits exist only in the current tab's DOM and are lost when the page is reloaded or reset.
- Clipboard content is read only at the moment of pasting and is not retained.

## Network Requests

The extension makes **no network requests**. All processing — editing, drawing, and screenshot capture — happens locally on your device. No data is sent to any server, third party, or external service.

## Third-Party Libraries

The extension bundles [html2canvas](https://html2canvas.hertzen.com/) for full-page screenshot capture. This library runs entirely within the page context on your device and does not transmit data externally.

## Changes to This Policy

If this privacy policy is updated, the changes will be posted to this page with a revised "Last updated" date.

## Contact

If you have questions about this privacy policy, please open an issue at:
https://github.com/tjindapitak/web-screen-draft/issues

---

**Author:** Thanapon Jindapitak
**Source:** https://github.com/tjindapitak/web-screen-draft
