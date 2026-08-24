// 把 Chrome DevTools Protocol 的网络事件组装成 HAR 1.2 格式
// 参考 HAR 1.2 spec: https://w3c.github.io/web-performance/specs/HAR/Overview.html

export class HarBuilder {
  constructor() {
    this.entries = new Map(); // requestId -> entry
    this.cookies = new Map(); // "name" -> { name, value, domain }
    this.requestCount = 0;
  }

  onRequestWillBeSent(params) {
    const { requestId, request, timestamp } = params;
    const headers = toHeaderArray(request.headers || {});
    const host = safeHost(request.url);
    // 从请求 Cookie 头收集 cookie（去重）
    for (const h of headers) {
      if (h.name.toLowerCase() !== 'cookie') continue;
      for (const part of String(h.value).split(';')) {
        const idx = part.indexOf('=');
        if (idx <= 0) continue;
        const name = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (name && !this.cookies.has(name)) {
          this.cookies.set(name, { name, value, domain: host });
        }
      }
    }
    const entry = {
      startedDateTime: new Date((timestamp || Date.now() / 1000) * 1000).toISOString(),
      time: 0,
      request: {
        method: request.method,
        url: request.url,
        httpVersion: 'HTTP/1.1',
        headers,
        queryString: parseQuery(request.url),
        cookies: [],
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: 0,
        statusText: '',
        httpVersion: '',
        headers: [],
        cookies: [],
        content: { size: 0, mimeType: 'x-unknown', text: '' },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: {},
    };
    if (request.postData) {
      entry.request.postData = {
        mimeType: request.postData.mimeType || 'text/plain',
        text: request.postData.text || '',
      };
    }
    this.entries.set(requestId, entry);
    this.requestCount++;
  }

  onResponseReceived(params) {
    const entry = this.entries.get(params.requestId);
    if (!entry) return;
    const resp = params.response;
    entry.response.status = resp.status;
    entry.response.statusText = resp.statusText || '';
    entry.response.httpVersion = resp.protocol || '';
    entry.response.headers = toHeaderArray(resp.headers || {});
    entry.response.content.mimeType = resp.mimeType || 'x-unknown';
    // 收集 Set-Cookie
    for (const [name, value] of Object.entries(resp.headers || {})) {
      if (name.toLowerCase() === 'set-cookie') {
        const parsed = parseSetCookie(value);
        if (parsed && !this.cookies.has(parsed.name)) {
          this.cookies.set(parsed.name, { ...parsed, domain: safeHost(entry.request.url) });
        }
      }
    }
  }

  setResponseBody(requestId, body, base64Encoded = false) {
    const entry = this.entries.get(requestId);
    if (!entry) return;
    entry.response.content.text = body || '';
    entry.response.content.size = body ? body.length : 0;
    if (base64Encoded) entry.response.content.encoding = 'base64';
  }

  build() {
    return {
      log: {
        version: '1.2',
        creator: { name: 'HarSnap', version: '1.0.0' },
        pages: [],
        entries: [...this.entries.values()],
      },
    };
  }

  getCookies() {
    return [...this.cookies.values()];
  }
}

function toHeaderArray(obj) {
  return Object.entries(obj).map(([name, value]) => ({ name, value: String(value) }));
}

function parseQuery(url) {
  try {
    const u = new URL(url);
    return [...u.searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function parseSetCookie(setCookieStr) {
  const first = String(setCookieStr).split(';')[0];
  const idx = first.indexOf('=');
  if (idx <= 0) return null;
  return { name: first.slice(0, idx).trim(), value: first.slice(idx + 1).trim() };
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

