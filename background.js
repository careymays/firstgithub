import { resolveCapture } from './shared.js';

const YT_PAGES = [
  '*://*.youtube.com/watch*',
  '*://*.youtube.com/shorts/*',
  '*://*.youtube.com/live/*',
  '*://youtu.be/*',
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    // One item for images and links so a YouTube thumbnail (an image inside a
    // video link) shows a single "Save thumbnail to Vault" entry, not a submenu.
    chrome.contextMenus.create({
      id: 'vault-save',
      title: 'Save thumbnail to Vault',
      contexts: ['image', 'link'],
    });
    chrome.contextMenus.create({
      id: 'vault-save-page',
      title: 'Save thumbnail to Vault',
      contexts: ['page'],
      documentUrlPatterns: YT_PAGES,
    });
  });
});

// Clicking the toolbar icon opens the side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // sidePanel.open() must run synchronously inside the click handler to keep
  // the user gesture, so open first and hand the capture over via storage.
  if (tab && tab.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
  const capture = resolveCapture({
    srcUrl: info.srcUrl,
    linkUrl: info.linkUrl,
    pageUrl: info.pageUrl || (tab && tab.url),
  });
  chrome.storage.session.set({
    pendingCapture: {
      ...capture,
      pageTitle: (tab && tab.title) || '',
      windowId: tab ? tab.windowId : null,
      at: Date.now(),
      nonce: crypto.randomUUID(),
    },
  });
});
