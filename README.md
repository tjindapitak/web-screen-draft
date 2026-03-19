# Web Screen Draft

A Chrome extension for editing, rearranging, and screenshotting any webpage. Built for legal, product, compliance teams, or anyone who needs to modify page content visually and capture the result.

## Features

- **Select elements or text** — click any element to select it, or switch to text mode to select specific words/phrases
- **Drag & move** — reposition any selected element or text anywhere on the page
- **Paste anything** — paste text or images from your clipboard directly onto the page
- **Resize images** — 8-handle resize with proportional scaling (corners) and free scaling (edges, or hold Shift on corners)
- **Screenshot** — capture the visible viewport as a PNG and download it

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select this project folder
5. The Web Screen Draft icon appears in your extensions toolbar

## Usage

1. Click the extension icon to open the popup
2. Click **Enable Edit Mode** to activate editing on the current page
3. **Element mode** (default): hover to highlight elements, click to select, drag to move
4. **Text mode**: click and drag to select a text range — it becomes a movable overlay
5. **Paste**: use Ctrl/Cmd+V to paste text or images from your clipboard onto the page
6. **Resize**: select an image — drag corner handles to resize proportionally, edge handles for free resize
7. **Double-click** a pasted text block to edit its content inline
8. Click **Take Screenshot** to capture and download the current viewport
9. Click **Reset All Changes** to undo everything and restore the original page

## File Structure

```
manifest.json       — Extension manifest (Manifest V3)
popup.html/css/js   — Popup UI
background.js       — Service worker (screenshot capture, message routing)
content.js          — Content script (all editing features)
content.css         — Content script styles
lib/html2canvas.min.js — html2canvas library (bundled)
icons/              — Extension icons
```

## Permissions

- `activeTab` — access the current tab for content script injection and screenshots
- `downloads` — save screenshots to disk
- `clipboardRead` — read clipboard content for pasting

## Notes

- Screenshots capture the visible viewport only. Scroll to the desired area before capturing.
- The extension hides its own UI elements (selection borders, resize handles) during screenshot capture for a clean result.
- Pasted items and moved elements persist until you click Reset or reload the page.
