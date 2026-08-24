// HarSnap popup 交互
const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);

/* ---------------- 状态渲染 ---------------- */

async function refresh() {
  const s = await send({ type: 'status' });
  const recording = !!s.recording;
  const reqCount = s.requestCount || 0;
  const cookies = s.cookies || [];

  $('#dot').classList.toggle('recording', recording);
  $('#statusText').textContent = recording ? `录制中… ${reqCount} 个请求` : '就绪';
  $('#reqCount').textContent = reqCount;
  $('#cookieCount').textContent = cookies.length;

  $('#startBtn').hidden = recording;
  $('#stopBtn').hidden = !recording;

  // 有结果时展示 cookie 和导出
  const hasResult = cookies.length > 0;
  $('#cookies').hidden = !hasResult;
  $('#exports').hidden = !hasResult;

  if (hasResult) renderCookies(cookies);
}

function renderCookies(cookies) {
  $('#cookieList').innerHTML = cookies.map((c) => `
    <li>
      <span class="cname">${escapeHtml(c.name)}</span>
      <span class="cval" title="${escapeHtml(c.value)}">${escapeHtml(c.value)}</span>
      <button class="copy" data-cookie="${escapeAttr(`${c.name}=${c.value}`)}" title="复制">⧉</button>
    </li>
  `).join('');
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
    // 剪贴板 API 不可用时，用降级方案
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
  if (r.ok) {
    // 关闭 popup，让用户去操作网页
    window.close();
  } else {
    alert('开始录制失败：' + (r.error || ''));
  }
});

$('#stopBtn').addEventListener('click', async () => {
  const r = await send({ type: 'stop' });
  if (r.ok) {
    await refresh();
  } else {
    alert('停止失败：' + (r.error || ''));
  }
});

$('#downloadHar').addEventListener('click', async () => {
  const r = await send({ type: 'downloadHar' });
  if (!r.ok) alert(r.error || '下载失败');
});

$('#downloadCookies').addEventListener('click', async () => {
  const r = await send({ type: 'downloadCookies' });
  if (!r.ok) alert(r.error || '下载失败');
});

$('#copyAll').addEventListener('click', async () => {
  const s = await send({ type: 'status' });
  const text = (s.cookies || []).map((c) => `${c.name}=${c.value}`).join('\n');
  if (!text) return;
  const ok = await copyText(text);
  if (ok) $('#copyAll').textContent = '已复制 ✓';
  setTimeout(() => { $('#copyAll').textContent = '复制全部'; }, 1500);
});

// 单个 cookie 复制（事件委托）
$('#cookieList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  const ok = await copyText(btn.dataset.cookie);
  if (ok) {
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '⧉'; }, 1200);
  }
});

refresh();
