// HarSnap background service worker
// 用 Chrome DevTools Protocol (chrome.debugger) 捕获网络请求，组装 HAR + 提取 Cookie
import { HarBuilder } from './har-builder.js';

const state = { tabId: null, builder: null, recording: false };

/* ---------------- 录制生命周期 ---------------- */

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function start() {
  const tabId = await getActiveTabId();
  if (tabId == null) return { ok: false, error: '找不到当前标签页' };

  state.tabId = tabId;
  state.builder = new HarBuilder();
  state.recording = true;

  await new Promise((resolve) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      chrome.debugger.sendCommand({ tabId }, 'Network.enable', () => resolve());
    });
  });
  await chrome.storage.local.set({ recording: true, tabId, requestCount: 0, cookies: [] });
  return { ok: true, tabId };
}

async function stop() {
  if (!state.tabId) return { ok: false, error: '未在录制' };
  const tabId = state.tabId;
  const builder = state.builder;

  await new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });

  const har = builder ? builder.build() : { log: { version: '1.2', entries: [] } };
  const cookies = builder ? builder.getCookies() : [];
  const requestCount = builder ? builder.requestCount : 0;

  state.recording = false;
  state.builder = null;
  state.tabId = null;

  await chrome.storage.local.set({ recording: false, har, cookies, requestCount, tabId: null });
  return { ok: true, requestCount, cookieCount: cookies.length };
}

/* ---------------- CDP 事件 ---------------- */

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== state.tabId || !state.builder) return;

  if (method === 'Network.requestWillBeSent') {
    state.builder.onRequestWillBeSent(params);
  } else if (method === 'Network.responseReceived') {
    state.builder.onResponseReceived(params);
  } else if (method === 'Network.loadingFinished') {
    const requestId = params.requestId;
    chrome.debugger.sendCommand(
      { tabId: state.tabId },
      'Network.getResponseBody',
      { requestId },
      (result) => {
        // 超大响应体会返回 error，忽略即可（headers/status 仍在）
        if (result?.body != null) {
          state.builder?.setResponseBody(requestId, result.body, result.base64Encoded);
        }
      }
    );
  }
});

// 黄色横幅被关闭 / 用户手动 detach 时，自动收尾
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === state.tabId) {
    state.recording = false;
    state.builder = null;
    state.tabId = null;
    chrome.storage.local.set({ recording: false, tabId: null });
  }
});

/* ---------------- 下载 ---------------- */

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function downloadHar() {
  const { har } = await chrome.storage.local.get('har');
  if (!har) return { ok: false, error: '暂无录制结果，请先录制' };
  const json = JSON.stringify(har, null, 2);
  const dataUrl = 'data:application/json;base64,' + toBase64(json);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.downloads.download({
    url: dataUrl,
    filename: `harsnap-${stamp}.har`,
    saveAs: true,
  });
  return { ok: true };
}

async function downloadCookies() {
  const { cookies } = await chrome.storage.local.get('cookies');
  if (!cookies?.length) return { ok: false, error: '未捕获到 cookie' };
  const text = cookies.map((c) => `${c.name}=${c.value}`).join('\n');
  const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.downloads.download({
    url: dataUrl,
    filename: `harsnap-cookies-${stamp}.txt`,
    saveAs: true,
  });
  return { ok: true };
}

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'start':
        sendResponse(await start());
        break;
      case 'stop':
        sendResponse(await stop());
        break;
      case 'status': {
        const s = await chrome.storage.local.get(['recording', 'requestCount', 'cookies']);
        const recording = state.recording || !!s.recording;
        const requestCount = state.builder ? state.builder.requestCount : (s.requestCount || 0);
        const cookies = state.builder ? state.builder.getCookies() : (s.cookies || []);
        sendResponse({ recording, requestCount, cookies });
        break;
      }
      case 'downloadHar':
        sendResponse(await downloadHar());
        break;
      case 'downloadCookies':
        sendResponse(await downloadCookies());
        break;
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // 异步响应
});
