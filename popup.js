// HarSnap popup 交互：多选导出（HAR / Cookie / Token）+ 请求范围 + 请求清单
const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);

let currentState = { recording: false, requestCount: 0, cookies: [], tokens: [], requests: [] };

/* ---------------- 渲染 ---------------- */

async function refresh() {
  currentState = await send({ type: 'status' });
  const { recording, requestCount, cookies, tokens, requests } = currentState;

  $('#dot').classList.toggle('recording', recording);
  $('#statusText').textContent = recording ? `录制中… ${requestCount} 个请求` : '就绪';
  $('#reqCount').textContent = requestCount;
  $('#cookieCount').textContent = cookies.length;
  $('#tokenCount').textContent = tokens.length;

  $('#startBtn').hidden = recording;
  $('#stopBtn').hidden = !recording;

  const hasResult = !recording && (cookies.length > 0 || tokens.length > 0 || requests.length > 0);
  $('#result').hidden = !hasResult;
  if (!hasResult) return;

  renderRequests(requests);
  renderCredential('#cookieSection', '#cookieList', cookies, (c) => `${c.name}=${c.value}`, c => c.name, c => c.value);
  renderCredential('#tokenSection', '#tokenList', tokens, (t) => t.full, t => t.scheme, t => t.value);
}

function renderRequests(requests) {
  $('#reqSection').hidden = !requests.length;
  $('#reqList').innerHTML = requests.map((r) => `
    <li>
      <input type="checkbox" class="req-check" data-i="${r.i}" ${r.i === requests.length - 1 ? 'checked' : ''}>
      <span class="req-method ${(r.method || '').toLowerCase()}">${escapeHtml(r.method)}</span>
      <span class="req-url" title="${escapeHtml(r.url)}">${escapeHtml(shortUrl(r.url))}</span>
      <span class="req-status ${r.status >= 400 ? 'err' : ''}">${r.status}</span>
    </li>
  `).join('');
}

function renderCredential(sectionSel, listSel, items, toFull, toName, toValue) {
  const section = $(sectionSel);
  const list = $(listSel);
  section.hidden = !items.length;
  list.innerHTML = items.map((it) => `
    <li>
      <span class="cname">${escapeHtml(toName(it))}</span>
      <span class="cval" title="${escapeHtml(toFull(it))}">${escapeHtml(toValue(it))}</span>
      <button class="copy" data-text="${escapeAttr(toFull(it))}" title="复制">⧉</button>
    </li>
  `).join('');
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || '');
  } catch {
    return url;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/* ---------------- 事件 ---------------- */

$('#startBtn').addEventListener('click', async () => {
  const r = await send({ type: 'start' });
  if (r.ok) window.close();
  else alert('开始录制失败：' + (r.error || ''));
});

$('#stopBtn').addEventListener('click', async () => {
  const r = await send({ type: 'stop' });
  if (r.ok) await refresh();
  else alert('停止失败：' + (r.error || ''));
});

// 下载所选：根据勾选类型逐个下载
$('#downloadBtn').addEventListener('click', async () => {
  const wantHar = $('#chkHar').checked;
  const wantCookie = $('#chkCookie').checked;
  const wantToken = $('#chkToken').checked;
  if (!wantHar && !wantCookie && !wantToken) {
    alert('请至少勾选一项导出内容');
    return;
  }
  const scope = document.querySelector('input[name="scope"]:checked').value;
  const indices = scope === 'selected'
    ? [...document.querySelectorAll('.req-check:checked')].map((cb) => Number(cb.dataset.i))
    : undefined;
  if (scope === 'selected' && (!indices || !indices.length)) {
    alert('请至少勾选一个请求');
    return;
  }

  if (wantHar) {
    const r = await send({ type: 'downloadHar', indices });
    if (!r.ok) alert(r.error || 'HAR 下载失败');
  }
  if (wantCookie) {
    const r = await send({ type: 'downloadCookies' });
    if (!r.ok) alert(r.error || 'Cookie 下载失败');
  }
  if (wantToken) {
    const r = await send({ type: 'downloadTokens' });
    if (!r.ok) alert(r.error || 'Token 下载失败');
  }
});

$('#summaryBtn').addEventListener('click', async () => {
  const r = await send({ type: 'downloadSummary', format: 'markdown' });
  if (!r.ok) alert(r.error || '清单下载失败');
});

// 复制全部（事件委托，data-copy="cookies" / "tokens"）
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (btn) {
    const key = btn.dataset.copy;
    const arr = key === 'cookies' ? currentState.cookies : currentState.tokens;
    const text = arr.map((x) => (key === 'cookies' ? `${x.name}=${x.value}` : x.full)).join('\n');
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      btn.textContent = '已复制 ✓';
      setTimeout(() => { btn.textContent = '复制全部'; }, 1500);
    }
  }
  // 单个 cookie/token 复制
  const copyBtn = e.target.closest('.copy');
  if (copyBtn && !copyBtn.closest('[data-copy]')) {
    const ok = await copyText(copyBtn.dataset.text);
    if (ok) {
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = '⧉'; }, 1200);
    }
  }
});

refresh();
