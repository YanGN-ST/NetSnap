// NetSnap background service worker
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
  const tokens = builder ? builder.getTokens() : [];
  const requestCount = builder ? builder.requestCount : 0;

  state.recording = false;
  state.builder = null;
  state.tabId = null;

  await chrome.storage.local.set({ recording: false, har, cookies, tokens, requestCount, tabId: null });
  return { ok: true, requestCount, cookieCount: cookies.length, tokenCount: tokens.length };
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

async function downloadHar(indices) {
  const { har } = await chrome.storage.local.get('har');
  if (!har) return { ok: false, error: '暂无录制结果，请先录制' };
  let out = har;
  if (Array.isArray(indices) && indices.length) {
    out = {
      log: {
        ...har.log,
        entries: indices.map((i) => har.log.entries[i]).filter(Boolean),
      },
    };
  }
  const json = JSON.stringify(out, null, 2);
  const dataUrl = 'data:application/json;base64,' + toBase64(json);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.downloads.download({
    url: dataUrl,
    filename: `netsnap-${stamp}.har`,
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
    filename: `netsnap-cookies-${stamp}.txt`,
    saveAs: true,
  });
  return { ok: true };
}

async function downloadTokens() {
  const { tokens } = await chrome.storage.local.get('tokens');
  if (!tokens?.length) return { ok: false, error: '未捕获到 token' };
  const text = tokens.map((t) => t.full).join('\n');
  const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.downloads.download({
    url: dataUrl,
    filename: `netsnap-tokens-${stamp}.txt`,
    saveAs: true,
  });
  return { ok: true };
}

async function downloadSummary(format = 'csv') {
  const { har } = await chrome.storage.local.get('har');
  if (!har) return { ok: false, error: '暂无录制结果，请先录制' };
  const rows = har.log.entries.map((e, i) => ({
    i: i + 1,
    method: e.request.method,
    url: e.request.url,
    status: e.response.status || 0,
  }));
  let text;
  let ext;
  if (format === 'markdown') {
    ext = 'md';
    text = '| # | 方法 | URL | 状态 |\n|---|---|---|---|\n'
      + rows.map((r) => `| ${r.i} | ${r.method} | ${r.url} | ${r.status} |`).join('\n');
  } else {
    ext = 'csv';
    text = '#,method,url,status\n'
      + rows.map((r) => `${r.i},"${r.method}","${r.url.replace(/"/g, '""')}",${r.status}`).join('\n');
  }
  const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.downloads.download({
    url: dataUrl,
    filename: `netsnap-summary-${stamp}.${ext}`,
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
        const s = await chrome.storage.local.get(['recording', 'requestCount', 'cookies', 'tokens', 'har']);
        const recording = state.recording || !!s.recording;
        const requestCount = state.builder ? state.builder.requestCount : (s.requestCount || 0);
        const cookies = state.builder ? state.builder.getCookies() : (s.cookies || []);
        const tokens = state.builder ? state.builder.getTokens() : (s.tokens || []);
        // 请求列表（供「仅勾选」导出），停止后从 storage 的 har 取
        let requests = [];
        if (!recording && s.har?.log?.entries) {
          requests = s.har.log.entries.map((e, i) => ({
            i, method: e.request.method, url: e.request.url, status: e.response.status || 0,
          }));
        }
        sendResponse({ recording, requestCount, cookies, tokens, requests });
        break;
      }
      case 'downloadHar':
        sendResponse(await downloadHar(msg.indices));
        break;
      case 'downloadCookies':
        sendResponse(await downloadCookies());
        break;
      case 'downloadTokens':
        sendResponse(await downloadTokens());
        break;
      case 'downloadSummary':
        sendResponse(await downloadSummary(msg.format));
        break;
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // 异步响应
});
