package remotecontrol

// dashboardHTML is the whole remote page: no build step, no external assets. The layout
// follows the desktop app so it reads at a glance - conversation list on the left, the
// selected conversation and its context in the middle, the composer pinned to the bottom,
// and a control sheet for model, policy and the audit trail.
const dashboardHTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>MilkSU 远端视图</title>
<style>
  :root { color-scheme: dark light; --bg:#0f1115; --panel:#161922; --card:#1d2129; --line:#2a2f3a; --fg:#e8ebf0; --dim:#96a0b0; --ok:#34d399; --warn:#fbbf24; --bad:#f87171; --me:#2b4a7d; }
  @media (prefers-color-scheme: light) { :root { --bg:#f4f5f7; --panel:#fff; --card:#fff; --line:#e2e5ea; --fg:#14161c; --dim:#5c6472; --me:#dce7fb; } }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Helvetica Neue",sans-serif; }
  button { background:var(--card); color:var(--fg); border:1px solid var(--line); border-radius:9px; padding:7px 11px; font-size:14px; }
  button.primary { border-color:var(--ok); color:var(--ok); }
  button.danger { border-color:var(--bad); color:var(--bad); }
  button.ghost { border-color:transparent; background:transparent; color:var(--dim); }
  button:disabled { opacity:.4; }
  input, select { background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:9px; padding:9px 10px; font-size:15px; width:100%; }
  .hidden { display:none !important; }

  /* login */
  #login { max-width:380px; margin:9vh auto; padding:18px; background:var(--panel); border:1px solid var(--line); border-radius:14px; }
  #login h1 { font-size:17px; margin:0 0 6px; }
  #login input { text-align:center; letter-spacing:.14em; font-size:19px; margin-top:8px; }
  #login button { width:100%; margin-top:10px; padding:11px; }
  .err { color:var(--bad); min-height:19px; font-size:13px; }

  /* app shell */
  #app { display:grid; grid-template-rows:auto auto 1fr auto; height:100%; }
  @media (min-width:900px) { #app { grid-template-columns:264px 1fr; grid-template-rows:auto auto 1fr auto; }
    #drawer { grid-row:1 / span 4; } #topbar { grid-column:2; } #banner { grid-column:2; } #chat { grid-column:2; } #composer { grid-column:2; } }

  #drawer { background:var(--panel); border-right:1px solid var(--line); overflow:auto; padding:10px; }
  @media (max-width:899px) {
    #drawer { position:fixed; inset:0 auto 0 0; width:82%; max-width:320px; z-index:40; transform:translateX(-102%); transition:transform .18s ease; }
    #drawer.open { transform:none; box-shadow:0 0 0 100vmax rgba(0,0,0,.45); }
  }
  #drawer h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:4px 0 8px; }
  .conv-item { display:block; width:100%; text-align:left; background:transparent; border:1px solid transparent; border-radius:10px; padding:8px 9px; margin-bottom:4px; color:var(--fg); }
  .conv-item.active { background:var(--card); border-color:var(--line); }
  .conv-item .t { font-size:14px; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .conv-item .m { font-size:11px; color:var(--dim); }

  #topbar { display:flex; align-items:center; gap:8px; padding:9px 12px; border-bottom:1px solid var(--line); background:var(--panel); position:sticky; top:0; z-index:20; }
  #topbar h1 { font-size:15px; margin:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pill { border:1px solid var(--line); border-radius:999px; padding:2px 9px; font-size:12px; color:var(--dim); white-space:nowrap; }

  #banner { padding:0 12px; }
  #banner .inner { margin:10px 0 0; border:1px solid var(--warn); color:var(--warn); border-radius:10px; padding:9px 11px; font-size:13px; }

  #chat { overflow:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
  .status { display:flex; flex-wrap:wrap; gap:6px; }
  .msg { max-width:86%; border-radius:13px; padding:9px 12px; white-space:pre-wrap; word-break:break-word; background:var(--card); border:1px solid var(--line); }
  .msg.me { align-self:flex-end; background:var(--me); }
  .msg .who { display:block; font-size:11px; color:var(--dim); margin-bottom:3px; }
  .msg.tool { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:var(--dim); max-width:100%; }
  .approval { border:1px solid var(--warn); border-radius:12px; padding:10px; background:var(--card); }
  .approval h3 { font-size:14px; margin:0 0 4px; }
  .approval .row { display:flex; gap:8px; margin-top:8px; }

  #composer { display:flex; gap:8px; align-items:flex-end; padding:10px 12px calc(10px + env(safe-area-inset-bottom)); border-top:1px solid var(--line); background:var(--panel); }
  #composer textarea { flex:1; resize:none; min-height:44px; max-height:140px; border-radius:11px; padding:11px; background:var(--bg); color:var(--fg); border:1px solid var(--line); font:inherit; }
  #composer button { padding:11px 14px; }

  #sheet { position:fixed; inset:auto 0 0 0; max-height:82vh; overflow:auto; background:var(--panel); border-top:1px solid var(--line); border-radius:16px 16px 0 0; padding:14px; z-index:50; }
  @media (min-width:900px) { #sheet { inset:12vh auto 12vh 50%; transform:translateX(-50%); width:min(560px,92vw); border:1px solid var(--line); border-radius:16px; } }
  #sheet h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:14px 0 8px; }
  #sheet .grid { display:grid; gap:8px; }
  #sheet .row { display:flex; gap:8px; align-items:center; }
  #auditList { font-size:12px; color:var(--dim); display:grid; gap:4px; }
  #scrim { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:45; }
</style>
</head>
<body>
<div id="login">
  <h1>MilkSU 远端视图</h1>
  <p style="color:var(--dim);font-size:13px;margin:0">在主机「设置 → 网络 / 远端控制」里点「生成绑定码」，把显示的 10 位绑定码填到这里。绑定码 5 分钟内有效、只能使用一次。</p>
  <input id="code" autocapitalize="characters" autocomplete="off" placeholder="绑定码">
  <div class="err" id="loginError"></div>
  <button class="primary" id="pairButton">配对并连接</button>
  <div id="passwordBlock" class="hidden" style="margin-top:14px">
    <p style="color:var(--dim);font-size:13px;margin:0 0 6px">本机浏览器可直接用访问口令登录（仅「仅本机」模式可用）。</p>
    <input id="password" type="password" autocomplete="current-password" placeholder="访问口令" style="letter-spacing:normal;font-size:15px">
    <button id="loginButton">用口令登录</button>
  </div>
</div>

<div id="app" class="hidden">
  <aside id="drawer">
    <h2>对话</h2>
    <button class="primary" id="newConversation" style="width:100%;margin-bottom:10px">＋ 新建对话</button>
    <div id="conversationList"></div>
  </aside>
  <div id="scrim" class="hidden"></div>

  <header id="topbar">
    <button class="ghost" id="menuButton" aria-label="对话列表">☰</button>
    <h1 id="chatTitle">—</h1>
    <span class="pill" id="capability"></span>
    <button id="panelButton">控制</button>
  </header>

  <div id="banner"></div>

  <main id="chat">
    <div id="approvals"></div>
    <div class="status" id="status"></div>
    <div id="messages"></div>
  </main>

  <form id="composer">
    <textarea id="prompt" rows="1" placeholder="输入消息…"></textarea>
    <button class="primary" id="sendButton" type="submit">发送</button>
  </form>
</div>

<section id="sheet" class="hidden">
  <div class="row" style="justify-content:space-between">
    <strong>控制面板</strong>
    <button class="ghost" id="closePanel">关闭</button>
  </div>
  <h2>当前上下文</h2>
  <div class="status" id="contextPills"></div>
  <h2>模型</h2>
  <div class="row"><select id="modelSelect"></select><button id="applyModel">切换</button></div>
  <h2>本对话的审批策略</h2>
  <div class="row"><select id="policySelect"></select><button id="applyPolicy">应用</button></div>
  <h2>新建对话</h2>
  <div class="row"><input id="newTitle" placeholder="标题（可留空）"><button id="createConversation">新建</button></div>
  <h2>本设备的操作记录</h2>
  <div id="auditList">—</div>
  <div class="err" id="actionError" style="margin-top:10px"></div>
  <p style="color:var(--dim);font-size:12px" id="deviceLine"></p>
  <button class="danger" id="logout" style="width:100%;margin-top:10px">注销本设备</button>
</section>

<script>
const $ = id => document.getElementById(id)
const escapeHtml = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

let state = null            // /api/state snapshot
let conversations = []
let selectedId = ''
let messages = []
let canControl = false

function showLogin(message) {
  $('app').classList.add('hidden')
  $('login').classList.remove('hidden')
  $('loginError').textContent = message || ''
}

function showApp() {
  $('login').classList.add('hidden')
  $('app').classList.remove('hidden')
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MilkSU-Remote': '1' },
    body: JSON.stringify(body || {}),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(text.trim() || ('HTTP ' + response.status))
  return text ? JSON.parse(text) : {}
}

async function pair() {
  try {
    await postJson('/api/pair', { code: $('code').value.trim(), client_id: clientId() })
    await refreshAll()
  } catch (reason) { showLogin('配对失败：' + reason.message) }
}

// clientId keeps this browser recognisable across visits, so enrolling again (for example
// after the browser dropped its cookie) updates the existing device instead of adding a
// duplicate row on the host.
function clientId() {
  try {
    let id = localStorage.getItem('milksu_remote_client')
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
      localStorage.setItem('milksu_remote_client', id)
    }
    return id
  } catch (reason) {
    return ''
  }
}

async function login() {
  try {
    await postJson('/api/login', { password: $('password').value })
    await refreshAll()
  } catch (reason) { showLogin('登录失败：' + reason.message) }
}

async function logout() {
  await postJson('/api/logout', {})
  showLogin('本设备已注销，如仍需要访问请在主机上重新生成绑定码。')
}

async function act(url, body, label) {
  $('actionError').textContent = ''
  try {
    await postJson(url, body)
    await refreshAll()
  } catch (reason) {
    $('actionError').textContent = label + '失败：' + reason.message
  }
}

function renderDrawer() {
  $('conversationList').innerHTML = conversations.map(conversation => {
    const last = (conversation.messages || [])[(conversation.messages || []).length - 1]
    const preview = last ? String(last.text || '').slice(0, 46) : ''
    return '<button class="conv-item' + (conversation.id === selectedId ? ' active' : '') + '" data-conversation="' + escapeHtml(conversation.id) + '">' +
      '<span class="t">' + escapeHtml(conversation.title || conversation.id) + (conversation.running ? ' ●' : '') + '</span>' +
      '<span class="m">' + escapeHtml(conversation.updated_at || '') + (preview ? ' · ' + escapeHtml(preview) : '') + '</span></button>'
  }).join('')
}

function renderTopbar() {
  const current = conversations.find(item => item.id === selectedId)
  $('chatTitle').textContent = current ? (current.title || current.id) : '未选择对话'
  const capability = state && state.device && state.device.capability === 'control' ? '可操作' : '只读'
  $('capability').textContent = capability
  $('capability').style.color = canControl ? 'var(--ok)' : 'var(--warn)'
}

function renderBanner() {
  const device = (state && state.device) || {}
  const banner = $('banner')
  if (canControl) { banner.innerHTML = ''; return }
  const text = device.state === 'expired'
    ? '本次授权已到期：仍可查看，但发送与操作已停用。请在主机上续期或重新生成绑定码。'
    : device.state === 'network-changed'
      ? '本设备所在网络未获核验：请在主机「设置 → 网络 / 远端控制」里核验此网络。'
      : '本设备是只读权限：可以查看，但不能发送消息或批准操作。请在主机上把这台设备升级为「可操作」。'
  banner.innerHTML = '<div class="inner">' + escapeHtml(text) + '</div>'
}

function renderStatus() {
  const context = (state && state.context) || {}
  const current = conversations.find(item => item.id === selectedId)
  const pills = [
    (context.active_provider || '—') + ' / ' + (context.active_model || '—'),
    current && current.running ? '最近有活动' : '空闲',
    '待审核 ' + ((state && state.approvals || []).length),
  ]
  $('status').innerHTML = pills.map(text => '<span class="pill">' + escapeHtml(text) + '</span>').join('') +
    ((current && (current.background_tasks || []).length
      ? current.background_tasks.map(task => '<span class="pill">' + escapeHtml(task.label || task.id) + ' · ' + escapeHtml(task.status) + '</span>').join('')
      : ''))
}

function renderApprovals() {
  const approvals = (state && state.approvals) || []
  if (!approvals.length) { $('approvals').innerHTML = ''; return }
  $('approvals').innerHTML = approvals.map(item =>
    '<div class="approval"><h3>' + escapeHtml(item.tool_name || '工具调用') + '</h3>' +
    '<div style="color:var(--dim);font-size:12px">' + escapeHtml(item.conversation_id || '') + ' · ' + escapeHtml(item.requested_at || '') + '</div>' +
    (item.input ? '<div class="msg tool" style="margin-top:6px">' + escapeHtml(item.input) + '</div>' : '') +
    '<div class="row">' +
      '<button class="primary" data-approve="' + escapeHtml(item.request_id) + '" data-conversation="' + escapeHtml(item.conversation_id) + '"' + (canControl ? '' : ' disabled') + '>批准</button>' +
      '<button class="danger" data-deny="' + escapeHtml(item.request_id) + '" data-conversation="' + escapeHtml(item.conversation_id) + '"' + (canControl ? '' : ' disabled') + '>拒绝</button>' +
    '</div></div>').join('')
}

function renderMessages(currentMessages) {
  messages = currentMessages || []
  if (!messages.length) {
    $('messages').innerHTML = '<p style="color:var(--dim)">这个对话还没有消息。</p>'
    return
  }
  $('messages').innerHTML = messages.map(message => {
    const role = String(message.role || '')
    const mine = role === '你'
    const tool = role === '工具'
    return '<div class="msg' + (mine ? ' me' : '') + (tool ? ' tool' : '') + '">' +
      '<span class="who">' + escapeHtml(role) + ' · ' + escapeHtml(message.at || '') + '</span>' +
      escapeHtml(message.text || '') + '</div>'
  }).join('')
}

function renderContextPills() {
  const context = (state && state.context) || {}
  const items = [
    ['模型', (context.active_provider || '—') + ' / ' + (context.active_model || '—')],
    ['最近有活动的对话', String(context.running_turns || 0)],
    ['待审核', String(context.pending_approvals || 0)],
    ['后台任务', String(context.background_tasks || 0)],
  ]
  $('contextPills').innerHTML = items.map(([label, value]) =>
    '<span class="pill">' + escapeHtml(label) + '：' + escapeHtml(value) + '</span>').join('')
  const device = (state && state.device) || {}
  $('deviceLine').textContent = '设备 ' + (device.id || '') + ' · ' + (device.ip || '') +
    ' · 到期 ' + (device.expires_at || '—') +
    ((device.networks || []).length ? ' · 已核验网络 ' + device.networks.join('、') : '')
}

function renderModels() {
  const models = (state && state.models) || []
  const select = $('modelSelect')
  const previous = select.value
  select.innerHTML = models.map(option =>
    '<option value="' + escapeHtml(option.provider + '|' + option.model) + '"' + (option.active ? ' selected' : '') + '>' +
    escapeHtml(option.label) + (option.active ? '（当前）' : '') + '</option>').join('')
  if (previous) select.value = previous
}

function renderPolicies() {
  const policies = (state && state.policies) || []
  const current = conversations.find(item => item.id === selectedId)
  const select = $('policySelect')
  select.innerHTML = policies.map(option =>
    '<option value="' + escapeHtml(option.id) + '">' + escapeHtml(option.label) + '</option>').join('')
  if (current && current.approval_policy) select.value = current.approval_policy
}

function renderAudit(entries) {
  if (!entries || !entries.length) { $('auditList').textContent = '本设备还没有操作记录。'; return }
  $('auditList').innerHTML = entries.slice(-10).reverse().map(entry =>
    '<div>' + (entry.ok ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--bad)">✕</span>') + ' ' +
    escapeHtml(entry.at) + ' · ' + escapeHtml(entry.action) +
    (entry.detail ? ' · ' + escapeHtml(entry.detail) : '') +
    (entry.error ? ' · <span style="color:var(--bad)">' + escapeHtml(entry.error) + '</span>' : '') + '</div>').join('')
}

function applyDevice() {
  const device = (state && state.device) || {}
  canControl = Boolean(device.can_control)
  $('prompt').disabled = !canControl
  $('sendButton').disabled = !canControl
  $('prompt').placeholder = canControl ? '输入消息…' : '只读设备不能发送消息'
  $('newConversation').disabled = !canControl
}

async function loadConversation(id) {
  if (!id) return
  selectedId = id
  renderDrawer()
  renderTopbar()
  renderPolicies()
  try {
    const response = await fetch('/api/conversation?id=' + encodeURIComponent(id))
    if (response.ok) {
      const conversation = await response.json()
      renderMessages(conversation.messages || [])
    } else {
      renderMessages([])
    }
  } catch (_) { renderMessages([]) }
}

async function refreshAll() {
  const response = await fetch('/api/state')
  if (response.status === 401) {
    const reason = response.headers.get('x-milkus-remote-reason')
    const body = await response.text().catch(() => '')
    showLogin(reason === 'network-unverified'
      ? '本设备当前所在网络未获主机核验：请在主机「设置 → 网络 / 远端控制」里点「核验此网络」，或重新生成绑定码。'
      : (body.trim() || '访问已失效，请在主机上重新生成绑定码。'))
    return
  }
  if (!response.ok) return
  state = await response.json()
  showApp()
  applyDevice()
  conversations = state.conversations || []
  if (!selectedId || !conversations.some(item => item.id === selectedId)) {
    selectedId = conversations.length ? conversations[0].id : ''
  }
  renderDrawer()
  renderTopbar()
  renderBanner()
  renderStatus()
  renderApprovals()
  renderContextPills()
  renderModels()
  renderPolicies()
  await loadConversation(selectedId)
  void refreshAudit()
}

async function refreshAudit() {
  try {
    const response = await fetch('/api/audit')
    if (response.ok) renderAudit(await response.json())
  } catch (_) { /* optional */ }
}

// --- 交互 ---
$('pairButton').addEventListener('click', () => { void pair() })
$('code').addEventListener('keydown', event => { if (event.key === 'Enter') void pair() })
$('loginButton').addEventListener('click', () => { void login() })
$('logout').addEventListener('click', () => { void logout() })
$('menuButton').addEventListener('click', () => {
  $('drawer').classList.toggle('open')
  $('scrim').classList.toggle('hidden', !$('drawer').classList.contains('open'))
})
$('scrim').addEventListener('click', () => {
  $('drawer').classList.remove('open')
  $('scrim').classList.add('hidden')
})
$('conversationList').addEventListener('click', event => {
  const target = event.target.closest('[data-conversation]')
  if (!target) return
  void loadConversation(target.getAttribute('data-conversation'))
  $('drawer').classList.remove('open')
  $('scrim').classList.add('hidden')
})
$('panelButton').addEventListener('click', () => {
  $('sheet').classList.remove('hidden')
  renderContextPills()
  void refreshAudit()
})
$('closePanel').addEventListener('click', () => $('sheet').classList.add('hidden'))
$('applyModel').addEventListener('click', () => {
  const [provider, model] = String($('modelSelect').value).split('|')
  void act('/api/action/model', { provider, model }, '切换模型')
})
$('applyPolicy').addEventListener('click', () => {
  void act('/api/action/policy', { conversation_id: selectedId, policy: $('policySelect').value }, '应用策略')
})
$('createConversation').addEventListener('click', async () => {
  $('actionError').textContent = ''
  try {
    await postJson('/api/action/conversation', { title: $('newTitle').value })
    $('newTitle').value = ''
    await refreshAll()
  } catch (reason) { $('actionError').textContent = '新建对话失败：' + reason.message }
})
$('newConversation').addEventListener('click', () => {
  $('sheet').classList.remove('hidden')
  $('newTitle').focus()
})
$('approvals').addEventListener('click', event => {
  const target = event.target
  if (!(target instanceof HTMLButtonElement)) return
  const approve = target.getAttribute('data-approve')
  const deny = target.getAttribute('data-deny')
  if (!approve && !deny) return
  void act('/api/action/approve', {
    conversation_id: target.getAttribute('data-conversation'),
    request_id: approve || deny,
    approved: Boolean(approve),
  }, approve ? '批准' : '拒绝')
})
$('composer').addEventListener('submit', async event => {
  event.preventDefault()
  const prompt = $('prompt').value.trim()
  if (!prompt || !selectedId || !canControl) return
  $('actionError').textContent = ''
  $('sendButton').disabled = true
  try {
    await postJson('/api/action/send', { conversation_id: selectedId, prompt })
    $('prompt').value = ''
    $('prompt').style.height = 'auto'
    await refreshAll()
  } catch (reason) {
    $('actionError').textContent = '发送失败：' + reason.message
    $('sheet').classList.remove('hidden')
  } finally {
    $('sendButton').disabled = !canControl
  }
})
const autoGrow = () => { const el = $('prompt'); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px' }
$('prompt').addEventListener('input', autoGrow)
$('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('composer').requestSubmit() }
})

void fetch('/api/mode').then(r => r.ok ? r.json() : null)
  .then(mode => { if (mode && mode.local_only) $('passwordBlock').classList.remove('hidden') })
  .catch(() => {})
void refreshAll()
setInterval(() => { if (!$('app').classList.contains('hidden')) void refreshAll() }, 5000)
</script>
</body>
</html>
`
