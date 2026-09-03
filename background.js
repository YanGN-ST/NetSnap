// NetSnap background service worker
// 用 Chrome DevTools Protocol (chrome.debugger) 捕获网络请求，组装 HAR + 提取 Cookie
import { HarBuilder } from './har-builder.js';

const state = { tabId: null, builder: null, recording: false };

// 录制中断点恢复：MV3 service worker 空闲约 30s 即被杀，内存里的 builder 会全部丢失。
// 录制期间定期把 builder 快照写入 storage.session（SW 重启后仍在，浏览器关闭即清），
// 重启时恢复，避免「录了半天 → SW 休眠 → stop 只能拿到空 HAR」。
const SNAPSHOT_KEY = 'recordingSnapshot';
const FLUSH_INTERVAL_MS = 10000;
let lastFlushAt = 0;

async function flushSnapshot(force = false) {
  if (!state.recording || !state.builder) return;
  const now = Date.now();
  if (!force && now - lastFlushAt < FLUSH_INTERVAL_MS) return;
  lastFlushAt = now;
  try {
    await chrome.storage.session.set({
      [SNAPSHOT_KEY]: { tabId: state.tabId, snapshot: state.builder.snapshot() },
    });
  } catch (e) {
    // 超配额等失败只损失断点恢复能力，不打断录制
    console.warn('[NetSnap] 快照写入失败:', e?.message || e);
  }
}

async function clearSnapshot() {
  try { await chrome.storage.session.remove(SNAPSHOT_KEY); } catch { /* ignore */ }
}

// worker 启动时：优先从 session 快照恢复录制中状态（SW 被杀后重启）；
// 无快照时清理僵尸状态（storage 里 recording 仍为 true 但内存 state 为空、
// 且无快照可恢复——重置 recording 避免 UI 假显示「录制中」且无法停止）
(async () => {
  try {
    const s = await chrome.storage.local.get('recording');
    if (s.recording && !state.recording) {
      const { [SNAPSHOT_KEY]: saved } = await chrome.storage.session.get(SNAPSHOT_KEY);
      if (saved?.tabId != null && saved.snapshot) {
        state.tabId = saved.tabId;
        state.builder = HarBuilder.restore(saved.snapshot);
        state.recording = true;
        // debugger attach 可能已随旧 SW 失效，重新 attach（若仍 attached 会报 Already attached，忽略）
        chrome.debugger.attach({ tabId: state.tabId }, '1.3', () => void chrome.runtime.lastError);
        chrome.debugger.sendCommand({ tabId: state.tabId }, 'Network.enable', () => void chrome.runtime.lastError);
        return;
      }
      await chrome.storage.local.set({ recording: false, tabId: null });
    }
  } catch { /* ignore */ }
})();

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

  const attachResult = await new Promise((resolve) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      chrome.debugger.sendCommand({ tabId }, 'Network.enable', () => resolve({ ok: true }));
    });
  });
  if (!attachResult.ok) {
    state.tabId = null;
    state.builder = null;
    state.recording = false;
    return { ok: false, error: attachResult.error };
  }

  await chrome.storage.local.set({ recording: true, tabId, requestCount: 0, cookies: [], tokens: [] });
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
  } else if (method === 'Network.loadingFailed') {
    state.builder.onLoadingFailed(params);
  } else if (method === 'Network.loadingFinished') {
    const requestId = params.requestId;
    chrome.debugger.sendCommand(
      { tabId: state.tabId },
      'Network.getResponseBody',
      { requestId },
      (result) => {
        if (chrome.runtime.lastError) return; // 超大响应体会拒绝返回 body
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
    try {
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
    } catch (e) {
      // 任何 handler 抛异常都必须兜底响应，否则 popup 的 await 永久挂起、UI 卡死
      console.error('[NetSnap] message handler error:', msg?.type, e);
      try { sendResponse({ ok: false, error: '处理请求失败：' + (e?.message || e) }); } catch { /* channel 已关闭 */ }
    }
  })();
  return true; // 异步响应
});
