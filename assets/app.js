const fmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const usdFmt = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const defaultApiBase = normalizeBase((window.MONITOR_CONFIG && window.MONITOR_CONFIG.defaultApiBase) || '');
const apiBaseKey = 'devops-monitor-api-base';
let refreshTimer = null;

function normalizeBase(value) {
  return (value || '').trim().replace(/\/+$/, '');
}

function apiBase() {
  return normalizeBase(localStorage.getItem(apiBaseKey) || defaultApiBase);
}

function apiUrl(path) {
  return `${apiBase()}${path}`;
}

async function fetchApi(path, options = {}, retryDefault = true) {
  try {
    return await fetch(apiUrl(path), {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.headers || {})
      }
    });
  } catch (error) {
    const storedBase = normalizeBase(localStorage.getItem(apiBaseKey) || '');
    if (retryDefault && storedBase && defaultApiBase && storedBase !== defaultApiBase) {
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
  return `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
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
  const active = view === 'budget' ? 'budget' : 'ops';
  document.getElementById('viewOps').classList.toggle('active', active === 'ops');
  document.getElementById('viewBudget').classList.toggle('active', active === 'budget');
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
  showApp();
  await load();
}

async function logout() {
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
  setText('budgetUsage', summary.monthly_budget_usd ? pct(summary.budget_usage_percent) : '--');
  setText('budgetRemaining', summary.monthly_budget_usd ? `${usd(summary.budget_remaining_usd)} 剩余 / ${usd(summary.monthly_budget_usd)} 预算` : '未设置月预算');
  setText('freeTraffic', `${fmt2.format(traffic.free_remaining_gb)} GB`);
  setText('freeTrafficFoot', `本月出站 ${fmt2.format(traffic.sent_gb)} / ${fmt2.format(traffic.free_gb)} GB`);
  badge(
    document.getElementById('budgetBadge'),
    !summary.monthly_budget_usd ? 'info' : summary.budget_usage_percent >= 100 ? 'bad' : summary.budget_usage_percent >= 80 ? 'warn' : 'ok',
    summary.monthly_budget_usd ? `${usd(summary.monthly_budget_usd)} 月预算` : '未设预算'
  );
  setText('pricingSource', pricing.source);

  const costRows = budget.rows.map(row =>
    `<tr><td>${row.item}<br><span class="mini">${row.note}</span></td><td>${row.basis}<br><span class="mini">${row.usage}</span></td><td>${usd(row.month_to_date_usd)}</td><td>${usd(row.projected_month_usd)}</td></tr>`
  );
  document.getElementById('budgetTable').innerHTML = renderTable(['项目', '计费依据', '本月累计', '月底预测'], costRows);

  const facts = [
    ['实例 ID', instance.instance_id],
    ['实例规格', instance.instance_type],
    ['区域 / 可用区', `${instance.region} / ${instance.availability_zone}`],
    ['内网 IP', instance.private_ip],
    ['启动时间', instance.launched_at ? new Date(instance.launched_at).toLocaleString('zh-CN') : '--'],
    ['已运行', `${instance.running_hours} 小时`],
    ['计算单价', `${usd(pricing.instance_hourly_usd)} / 小时`],
    ['存储单价', `${usd(pricing.storage_gb_month_usd)} / GB-月`],
    ['流量规则', `${pricing.data_transfer_free_gb} GB 免费后 ${usd(pricing.data_transfer_gb_usd)} / GB`],
    ['本月累计流量', `${fmt2.format(traffic.total_gb)} GB`],
    ['本月出站流量', `${fmt2.format(traffic.sent_gb)} GB`],
    ['计费出站流量', `${fmt2.format(traffic.billable_sent_gb)} GB`],
    ['统计网卡', traffic.interfaces.length ? traffic.interfaces.join(', ') : '--']
  ];
  document.getElementById('instanceFacts').innerHTML = facts.map(([name, value]) =>
    `<div class="fact-row"><div class="fact-name">${name}</div><div class="fact-value">${value || '--'}</div></div>`
  ).join('');
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
  document.getElementById('settingsDialog').close();
  showLogin('后端地址已更新，请重新登录。');
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.getElementById('loginForm').addEventListener('submit', login);
document.getElementById('logoutButton').addEventListener('click', logout);
document.getElementById('settingsButton').addEventListener('click', openSettings);
document.getElementById('saveSettings').addEventListener('click', saveSettings);
setView(location.hash === '#budget' ? 'budget' : 'ops');
load();
refreshTimer = setInterval(load, 5000);
