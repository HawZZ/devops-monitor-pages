const fmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const tokenFmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const usdFmt = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdPreciseFmt = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 });
let defaultApiBase = normalizeBase((window.MONITOR_CONFIG && window.MONITOR_CONFIG.defaultApiBase) || '');
const apiBaseKey = 'devops-monitor-api-base';
const apiBaseManualKey = 'devops-monitor-api-base-manual';
const tokenKey = 'devops-monitor-token';
let refreshTimer = null;

function normalizeBase(value) {
  return (value || '').trim().replace(/\/+$/, '');
}

function apiBase() {
  if (localStorage.getItem(apiBaseManualKey) === '1') {
    return normalizeBase(localStorage.getItem(apiBaseKey) || defaultApiBase);
  }
  return defaultApiBase;
}

function apiUrl(path) {
  return `${apiBase()}${path}`;
}

async function fetchApi(path, options = {}, retryDefault = true) {
  const token = sessionStorage.getItem(tokenKey);
  const headers = {
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(apiUrl(path), {
      ...options,
      credentials: 'include',
      headers
    });
  } catch (error) {
    const storedBase = normalizeBase(localStorage.getItem(apiBaseKey) || '');
    if (retryDefault && localStorage.getItem(apiBaseManualKey) === '1' && storedBase && defaultApiBase && storedBase !== defaultApiBase) {
      localStorage.removeItem(apiBaseManualKey);
      localStorage.removeItem(apiBaseKey);
      return fetchApi(path, options, false);
    }
    throw error;
  }
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function bytes(n) {
  if (!Number.isFinite(n)) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${fmt2.format(value)} ${units[index]}`;
}

function rate(n) {
  return `${bytes(n)}/s`;
}

function pct(n) {
  return `${fmt.format(n)}%`;
}

function usd(n) {
  return Number.isFinite(n) ? usdFmt.format(n) : '--';
}

function usdPrecise(n) {
  return Number.isFinite(n) ? usdPreciseFmt.format(n) : '--';
}

function tokens(n) {
  if (!Number.isFinite(n)) return '--';
  if (Math.abs(n) >= 1_000_000) return `${fmt2.format(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1_000) return `${fmt2.format(n / 1_000)}K`;
  return tokenFmt.format(n);
}

function barClass(value) {
  return value >= 90 ? 'red' : value >= 75 ? 'amber' : value >= 55 ? 'violet' : 'green';
}

function duration(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor(sec % 86400 / 3600);
  const m = Math.floor(sec % 3600 / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分钟`;
  return `${m} 分钟`;
}

function badge(el, className, text) {
  el.className = `badge ${className}`;
  el.textContent = text;
}

function resourceRow(name, value, foot, percent) {
  return `<div class="row">
    <div class="row-name">${name}</div>
    <div class="bar ${barClass(percent)}"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>
    <div class="row-value">${value}<br><span class="mini">${foot}</span></div>
  </div>`;
}

function renderTable(headers, rows) {
  if (!rows.length) return '<div class="empty">暂无数据</div>';
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function showLogin(message = '') {
  document.getElementById('loginPanel').classList.remove('hidden');
  document.getElementById('appPanel').classList.add('hidden');
  setText('loginMessage', message);
}

function showApp() {
  document.getElementById('loginPanel').classList.add('hidden');
  document.getElementById('appPanel').classList.remove('hidden');
}

function setView(view) {
  const active = ['ops', 'budget', 'tokens'].includes(view) ? view : 'ops';
  document.getElementById('viewOps').classList.toggle('active', active === 'ops');
  document.getElementById('viewBudget').classList.toggle('active', active === 'budget');
  document.getElementById('viewTokens').classList.toggle('active', active === 'tokens');
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === active));
  if (location.hash !== `#${active}`) history.replaceState(null, '', `${location.pathname}${location.search}#${active}`);
}

async function apiFetch(path, options = {}) {
  const response = await fetchApi(path, options);
  if (response.status === 401) {
    showLogin('请登录后访问监控数据。');
    throw new Error('unauthorized');
  }
  return response;
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = new URLSearchParams({
    username: form.get('username'),
    password: form.get('password')
  });
  setText('loginMessage', '正在登录...');
  let response;
  try {
    response = await fetchApi('/monitor/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
  } catch (error) {
    showLogin(`无法连接后端：${error.message}`);
    setText('updated', '连接失败');
    return;
  }
  if (!response.ok) {
    const message = response.status === 429 ? '失败次数过多，请稍后再试。' : '账号或密码不正确。';
    showLogin(message);
    return;
  }
  const data = await response.json();
  if (data.token) sessionStorage.setItem(tokenKey, data.token);
  showApp();
  await load();
}

async function logout() {
  sessionStorage.removeItem(tokenKey);
  try {
    await apiFetch('/monitor/api/logout', { method: 'POST' });
  } catch (_) {
    // Already logged out or unavailable.
  }
  showLogin('已退出。');
}

function renderBudget(budget, traffic) {
  const summary = budget.summary;
  const instance = budget.instance;
  const pricing = budget.pricing;
  setText('budgetToday', usd(summary.today_usd));
  setText('budgetMtd', usd(summary.month_to_date_usd));
  setText('budgetMtdFoot', `${budget.period.month_running_hours} 小时`);
  setText('budgetProjected', usd(summary.projected_month_usd));
  setText('budgetRunRate', usd(summary.normalized_30d_usd));
  setText('budgetUsage', summary.monthly_budget_usd ? pct(summary.normalized_30d_budget_usage_percent) : '--');
  setText('budgetRemaining', summary.monthly_budget_usd ? `${usd(summary.normalized_30d_budget_remaining_usd)} 剩余 / ${usd(summary.monthly_budget_usd)} 预算` : '未设置月预算');
  setText('freeTraffic', `${fmt2.format(traffic.free_remaining_gb)} GB`);
  const allowanceBasis = pricing.data_transfer_allowance_basis || traffic.allowance_basis || '出站流量';
  const allowanceUsed = allowanceBasis === '总流量' ? traffic.total_gb : traffic.sent_gb;
  setText('freeTrafficFoot', `本月${allowanceBasis} ${fmt2.format(allowanceUsed)} / ${fmt2.format(traffic.free_gb)} GB`);
  badge(
    document.getElementById('budgetBadge'),
    !summary.monthly_budget_usd ? 'info' : summary.normalized_30d_budget_usage_percent >= 100 ? 'bad' : summary.normalized_30d_budget_usage_percent >= 80 ? 'warn' : 'ok',
    summary.monthly_budget_usd ? `${usd(summary.monthly_budget_usd)} 月预算` : '未设预算'
  );
  setText('pricingSource', pricing.source);

  const costRows = budget.rows.map(row =>
    `<tr><td>${row.item}<br><span class="mini">${row.note}</span></td><td>${row.basis}<br><span class="mini">${row.usage}</span></td><td>${usd(row.month_to_date_usd)}</td><td>${usd(row.projected_month_usd)}</td><td>${usd(row.normalized_30d_usd)}</td></tr>`
  );
  document.getElementById('budgetTable').innerHTML = renderTable(['项目', '计费依据', '本月累计', '月底预测', '30天预测'], costRows);

  const isLightsail = (pricing.billing_model || '').includes('Lightsail');
  const facts = [
    ['计费模式', pricing.billing_model || '--'],
    ['实例 ID', instance.instance_id],
    ['实例规格', instance.instance_type],
    ['区域 / 可用区', `${instance.region} / ${instance.availability_zone}`],
    ['内网 IP', instance.private_ip],
    ['公网 IP', instance.public_ip || '--'],
    ['启动时间', instance.launched_at ? new Date(instance.launched_at).toLocaleString('zh-CN') : '--'],
    ['已运行', `${instance.running_hours} 小时`]
  ];
  if (isLightsail) {
    facts.push(
      ['Lightsail 套餐', pricing.lightsail_bundle_name || '--'],
      ['套餐月费', `${usd(pricing.lightsail_bundle_monthly_usd)} / 月`],
      ['套餐含量', `${fmt2.format(pricing.lightsail_included_disk_gb)} GB SSD / ${fmt2.format(pricing.lightsail_included_transfer_gb)} GB 流量`],
      ['超额流量单价', `${usd(pricing.data_transfer_gb_usd)} / GB`]
    );
  } else {
    facts.push(
      ['计算单价', `${usd(pricing.instance_hourly_usd)} / 小时`],
      ['存储单价', `${usd(pricing.storage_gb_month_usd)} / GB-月`],
      ['公网 IPv4 单价', `${usd(pricing.public_ipv4_hourly_usd)} / 小时`],
      ['流量规则', `${pricing.data_transfer_free_gb} GB 免费后 ${usd(pricing.data_transfer_gb_usd)} / GB`]
    );
  }
  facts.push(
    ['本月累计流量', `${fmt2.format(traffic.total_gb)} GB`],
    ['本月出站流量', `${fmt2.format(traffic.sent_gb)} GB`],
    ['计费出站流量', `${fmt2.format(traffic.billable_sent_gb)} GB`],
    ['统计网卡', traffic.interfaces.length ? traffic.interfaces.join(', ') : '--']
  );
  document.getElementById('instanceFacts').innerHTML = facts.map(([name, value]) =>
    `<div class="fact-row"><div class="fact-name">${name}</div><div class="fact-value">${value || '--'}</div></div>`
  ).join('');
}

function renderTokenBilling(tokenBilling = {}) {
  const summary = tokenBilling.summary || {};
  const today = tokenBilling.today || {};
  const rows = tokenBilling.rows || [];
  const configs = tokenBilling.configs || [];
  const pricing = tokenBilling.pricing || {};
  const sources = tokenBilling.sources || [];
  const balances = tokenBilling.balances || {};

  setText('tokenTodayTokens', tokens(summary.today_tokens ?? today.total_tokens));
  setText('tokenTodayCost', usdPrecise(summary.today_cost_usd ?? today.cost_usd));
  setText('tokenMonthTokens', tokens(summary.month_tokens ?? summary.total_tokens));
  setText('tokenMonthCost', usdPrecise(summary.month_cost_usd ?? summary.cost_usd));
  setText('tokenUnpriced', tokens(summary.month_unpriced_tokens ?? summary.unpriced_tokens));
  setText('tokenPricingVersion', pricing.version || '--');
  setText('tokenTodayFoot', `${tokenFmt.format(summary.today_entries || today.entries || 0)} 条记录`);
  setText('tokenMonthFoot', `${tokenFmt.format(summary.month_entries || summary.entries || 0)} 条记录`);

  const accountRows = summarizeTokenAccounts(rows, balances);
  badge(
    document.getElementById('tokenAccountBadge'),
    accountRows.length ? 'ok' : 'warn',
    `${accountRows.length} 个账号`
  );
  const accountTableRows = accountRows.map(item =>
    `<tr><td>${esc(item.account)}<br><span class="mini">${esc(item.apps.join(', ') || '--')}</span></td><td>${balanceText(item.balance)}</td><td>${tokens(item.today_tokens)}<br><span class="mini">${usdPrecise(item.today_cost_usd)}</span></td><td>${tokens(item.month_tokens)}<br><span class="mini">${usdPrecise(item.month_cost_usd)}</span></td><td>${esc(item.providers.join(', ') || '--')}</td></tr>`
  );
  document.getElementById('tokenAccountTable').innerHTML = renderTable(['账号/Profile', '余额', '今日', '本月', 'Provider'], accountTableRows);

  badge(
    document.getElementById('tokenRowsBadge'),
    rows.length ? 'ok' : 'warn',
    `${rows.length} 个分组`
  );
  const usageRows = rows.map(row => {
    const month = row.month || {};
    const day = row.today || {};
    const priceClass = row.pricing_status === 'priced' ? 'ok' : 'warn';
    const latest = row.latest_at ? new Date(row.latest_at).toLocaleString('zh-CN') : '--';
    return `<tr><td>${esc(row.app)}<br><span class="mini">${esc(row.source || '--')} · ${esc(latest)}</span></td><td>${esc(row.account || row.provider || '--')}</td><td>${esc(row.model)}<br><span class="mini">${esc(row.provider || '--')} / ${esc(row.pricing_provider || '--')}</span></td><td>${tokens(day.total_tokens || 0)}<br><span class="mini">${usdPrecise(day.cost_usd)}</span></td><td>${tokens(month.total_tokens || 0)}<br><span class="mini">${usdPrecise(month.cost_usd)}</span></td><td><span class="badge ${priceClass}">${esc(row.pricing_key || '--')}</span><br><span class="mini">${esc(row.pricing_note || '--')}</span></td></tr>`;
  });
  document.getElementById('tokenUsageTable').innerHTML = renderTable(['应用', '账号/Profile', '模型', '今日', '本月', '计价'], usageRows);

  const okConfigs = configs.filter(item => item.status === 'ok').length;
  badge(document.getElementById('tokenConfigBadge'), okConfigs ? 'ok' : 'warn', `${okConfigs}/${configs.length || 0} 已发现`);
  const configRows = configs.map(item =>
    `<tr><td>${esc(item.app)}<br><span class="mini">${esc(item.status)}</span></td><td>${esc(item.account || '--')}<br><span class="mini">${esc(item.provider || '--')}</span></td><td>${balanceText(item.balance)}</td><td>${esc(item.model || '--')}</td><td>${esc(item.config_path || '--')}<br><span class="mini">${esc(item.usage_path || '--')}</span></td></tr>`
  );
  document.getElementById('tokenConfigTable').innerHTML = renderTable(['应用', '账号/Profile', '余额', '模型', '路径'], configRows);

  const priceRows = (pricing.models || [])
    .filter(item => ['gpt-5.5', 'gpt-5.4', 'gpt-5', 'gpt-5-codex', 'claude-sonnet-4.5', 'claude-haiku-4.5'].includes(item.model) || rows.some(row => row.pricing_key === item.model))
    .map(item =>
      `<tr><td>${esc(item.model)}<br><span class="mini">${esc(item.provider)}</span></td><td>${priceCell(item.input_usd_per_mtok)}</td><td>${priceCell(item.cached_input_usd_per_mtok)}</td><td>${priceCell(item.output_usd_per_mtok)}</td></tr>`
    );
  document.getElementById('tokenPricingTable').innerHTML = renderTable(['模型', 'Input', 'Cached', 'Output'], priceRows);
  badge(document.getElementById('tokenPricingBadge'), 'info', pricing.unit || 'USD / 1M tokens');

  const sourceText = sources.map(source => `${source.name}: ${source.entries || 0} 条`).join(' / ') || '--';
  badge(document.getElementById('tokenSourceBadge'), 'info', sourceText);
  const notes = [
    ...(tokenBilling.notes || []),
    ...(pricing.sources || []).map(source => `${source.provider}：${source.url}`)
  ];
  document.getElementById('tokenNotes').innerHTML = notes.map(note =>
    `<div class="rec info"><strong>${esc(note.split('：')[0])}</strong><span>${esc(note.includes('：') ? note.slice(note.indexOf('：') + 1) : note)}</span></div>`
  ).join('');
}

function summarizeTokenAccounts(rows, balances = {}) {
  const summaries = new Map();
  for (const row of rows) {
    const account = row.account || row.provider || 'unknown';
    if (!summaries.has(account)) {
      summaries.set(account, {
        account,
        apps: new Set(),
        providers: new Set(),
        today_tokens: 0,
        today_cost_usd: 0,
        month_tokens: 0,
        month_cost_usd: 0,
        balance: balances[account] || {}
      });
    }
    const item = summaries.get(account);
    if (!item.balance && balances[account]) item.balance = balances[account];
    if (row.app) item.apps.add(row.app);
    if (row.provider) item.providers.add(row.provider);
    if (row.pricing_provider) item.providers.add(row.pricing_provider);
    const today = row.today || {};
    const month = row.month || {};
    item.today_tokens += Number(today.total_tokens || 0);
    item.today_cost_usd += Number(today.cost_usd || 0);
    item.month_tokens += Number(month.total_tokens || 0);
    item.month_cost_usd += Number(month.cost_usd || 0);
  }
  return [...summaries.values()]
    .map(item => ({
      ...item,
      apps: [...item.apps].sort(),
      providers: [...item.providers].sort()
    }))
    .sort((a, b) => (b.month_cost_usd - a.month_cost_usd) || (b.month_tokens - a.month_tokens));
}

function balanceText(balance = {}) {
  if (!balance || balance.remaining === undefined || balance.remaining === null || balance.remaining === '') return '';
  const numeric = Number(balance.remaining);
  const unit = balance.unit || 'USD';
  const value = Number.isFinite(numeric) ? fmt2.format(numeric) : String(balance.remaining);
  const status = balance.is_valid === false ? '不可用' : '可用';
  return `${unit === 'USD' ? '$' : ''}${esc(value)} ${esc(unit === 'USD' ? '' : unit)}<br><span class="mini">${status}</span>`;
}

function priceCell(value) {
  return Number.isFinite(value) ? `$${fmt2.format(value)}` : '--';
}

function render(data) {
  showApp();
  setText('hostname', `${data.hostname} · ${apiBase()}`);
  setText('updated', new Date(data.generated_at * 1000).toLocaleString('zh-CN'));
  setText('uptime', `运行 ${duration(data.uptime_seconds)}`);

  setText('cpuValue', pct(data.cpu.percent));
  setText('cpuFoot', `${data.cpu.logical_count} vCPU · load ${data.cpu.load.one}`);
  setText('memValue', pct(data.memory.percent));
  setText('memFoot', `${bytes(data.memory.used)} / ${bytes(data.memory.total)}`);
  setText('diskValue', pct(data.storage.max_percent));
  setText('diskFoot', `${data.storage.partitions.length} 个挂载点`);
  setText('netValue', `${fmt2.format(data.network.total.total_mbps)} Mbps`);
  setText('netFoot', `${rate(data.network.total.rx_rate_bps)} 下行 · ${rate(data.network.total.tx_rate_bps)} 上行`);
  setText('monthlyTrafficValue', `${fmt2.format(data.network.monthly.total_gb)} GB`);
  setText('monthlyTrafficFoot', `出站 ${fmt2.format(data.network.monthly.sent_gb)} GB · 免费剩余 ${fmt2.format(data.network.monthly.free_remaining_gb)} GB`);
  setText('safeValue', fmt.format(data.connections.safe_count));
  setText('riskValue', fmt.format(data.connections.risk_count));
  setText('bandwidthBase', `${data.settings.bandwidth_mbps} Mbps 基准`);
  setText('trafficPlan', `${fmt2.format(data.network.monthly.free_remaining_gb)} GB 免费剩余`);

  const rows = [
    resourceRow('CPU 使用率', pct(data.cpu.percent), `1分钟负载比 ${data.cpu.load.ratio_one}`, data.cpu.percent),
    resourceRow('内存使用率', pct(data.memory.percent), `${bytes(data.memory.available)} 可用`, data.memory.percent),
    resourceRow('Swap 使用率', pct(data.memory.swap_percent), `${bytes(data.memory.swap_used)} / ${bytes(data.memory.swap_total)}`, data.memory.swap_percent),
    resourceRow('带宽占用率', pct(data.network.total.bandwidth_utilization_percent), `${fmt2.format(data.network.total.projected_monthly_gb)} GB/月估算`, data.network.total.bandwidth_utilization_percent),
    resourceRow('免费流量额度', pct(data.network.monthly.free_usage_percent), `本月出站 ${fmt2.format(data.network.monthly.sent_gb)} / ${fmt2.format(data.network.monthly.free_gb)} GB`, data.network.monthly.free_usage_percent)
  ];
  for (const part of data.storage.partitions) rows.push(resourceRow(part.mountpoint, pct(part.percent), `${bytes(part.free)} 可用 · ${part.fstype}`, part.percent));
  document.getElementById('resourceRows').innerHTML = rows.join('');

  document.getElementById('recommendations').innerHTML = data.recommendations.map(rec =>
    `<div class="rec ${rec.level}"><strong>${rec.title}</strong><span>${rec.detail}</span></div>`
  ).join('');

  const svcOk = data.services.summary.systemd_ok + data.services.summary.ports_ok;
  const svcTotal = data.services.summary.systemd_total + data.services.summary.ports_total;
  badge(document.getElementById('svcSummary'), svcOk === svcTotal ? 'ok' : 'bad', `${svcOk}/${svcTotal} 正常`);
  const svcRows = [
    ...data.services.systemd.map(s => `<tr><td>${s.name}</td><td><span class="badge ${s.ok ? 'ok' : 'bad'}">${s.active}</span></td><td>${s.enabled}</td></tr>`),
    ...data.services.ports.map(p => `<tr><td>${p.name}</td><td><span class="badge ${p.ok ? 'ok' : 'bad'}">${p.ok ? 'open' : 'down'}</span></td><td>${p.host}:${p.port} ${p.latency_ms ? p.latency_ms + 'ms' : ''}</td></tr>`)
  ];
  document.getElementById('services').innerHTML = renderTable(['项目', '状态', '详情'], svcRows);

  const netRows = data.network.interfaces.slice(0, 8).map(n =>
    `<tr><td>${n.name}</td><td>${rate(n.rx_rate_bps)} / ${rate(n.tx_rate_bps)}</td><td>${bytes(n.bytes_recv)} / ${bytes(n.bytes_sent)}</td></tr>`
  );
  document.getElementById('network').innerHTML = renderTable(['接口', '收/发速率', '累计收/发'], netRows);

  badge(document.getElementById('connSummary'), data.connections.risk_count ? 'warn' : 'ok', `${data.connections.safe_count} 安全 / ${data.connections.risk_count} 风险`);
  const listenerRows = data.connections.listeners.slice(0, 6).map(l =>
    `<tr><td>${l.address}</td><td><span class="badge ${l.risk ? 'bad' : 'info'}">${l.reason}</span></td><td>${l.process || '--'}</td></tr>`
  );
  const riskyRows = data.connections.risky.slice(0, 6).map(c =>
    `<tr><td>${c.remote}</td><td><span class="badge warn">${c.status}</span></td><td>${c.local} · ${c.reasons.join('、')}</td></tr>`
  );
  document.getElementById('connections').innerHTML = renderTable(['地址', '状态', '进程/原因'], [...listenerRows, ...riskyRows]);
  renderBudget(data.budget, data.network.monthly);
  renderTokenBilling(data.token_billing);
}

async function load() {
  try {
    const response = await apiFetch('/monitor/api/metrics');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    if (error.message !== 'unauthorized') {
      showLogin(`无法连接后端：${error.message}`);
      setText('updated', '连接失败');
    }
  }
}

function openSettings() {
  document.getElementById('apiBase').value = apiBase();
  document.getElementById('settingsDialog').showModal();
}

function saveSettings() {
  const raw = document.getElementById('apiBase').value.trim().replace(/\/+$/, '');
  if (!raw) return;
  localStorage.setItem(apiBaseKey, raw);
  localStorage.setItem(apiBaseManualKey, '1');
  document.getElementById('settingsDialog').close();
  showLogin('后端地址已更新，请重新登录。');
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch(`config.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const config = await response.json();
    if (config.defaultApiBase) defaultApiBase = normalizeBase(config.defaultApiBase);
  } catch (_) {
    // config.js remains the fallback.
  }
}

async function init() {
  await loadRuntimeConfig();
  const hashView = (location.hash || '').replace('#', '');
  setView(['ops', 'budget', 'tokens'].includes(hashView) ? hashView : 'ops');
  await load();
  refreshTimer = setInterval(load, 5000);
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.getElementById('loginForm').addEventListener('submit', login);
document.getElementById('logoutButton').addEventListener('click', logout);
document.getElementById('settingsButton').addEventListener('click', openSettings);
document.getElementById('saveSettings').addEventListener('click', saveSettings);
init();
