// Financeiro (estilo UTMify): gasto da Meta Ads × leads e vendas do CRM × receitas e despesas lançadas
import { DB } from '@shared/db.js';
import { renderClients } from './clients.js?v=2609290906';
import { PERIOD, BRAND, popover, dateRange, datePicker, dateBtn, S, $, $$, esc, ICON, brl, num, pct, fullDate, ago, toast, fail, modal, confirmBox } from './util.js?v=2609290906';

const F = { period: '30', from: '', to: '', level: 'campaign', revenue: 'mensal', sort: 'spend', tab: 'geral' };
const GRAPH = 'v21.0';
const CATS = { despesa: ['Ferramentas', 'Equipe', 'Comissões', 'Impostos', 'Tráfego (outras plataformas)', 'Outros'], receita: ['Venda (contrato)', 'Setup', 'Consultoria', 'Outros'] };
const SALE_CATS = ['Venda (contrato)', 'Contrato'];
const isSaleEntry = (e) => e.kind === 'receita' && SALE_CATS.includes(e.category);
// venda manual: na visão "1ª mensalidade" conta a mensalidade; na visão contrato, o total arrecadado
const entrySale = (e) => (F.revenue === 'mensal' && e.monthly_amount ? Number(e.monthly_amount) : Number(e.amount));
const entryRev = (e) => (isSaleEntry(e) ? entrySale(e) : Number(e.amount));
// ações que a Meta devolve nos insights (o que pode contar como lead)
const ACTION_NAMES = {
  lead: 'Leads (total da Meta)',
  'offsite_conversion.fb_pixel_lead': 'Lead no site (pixel)',
  'onsite_conversion.lead_grouped': 'Formulário instantâneo da Meta',
  'onsite_conversion.lead': 'Formulário instantâneo (envio)',
  'offsite_conversion.fb_pixel_complete_registration': 'Cadastro concluído (pixel)',
  complete_registration: 'Cadastro concluído',
  'offsite_conversion.fb_pixel_submit_application': 'Inscrição enviada (pixel)',
  submit_application: 'Inscrição enviada',
  'offsite_conversion.fb_pixel_contact': 'Contato (pixel)',
  contact: 'Contato',
  'offsite_conversion.fb_pixel_schedule': 'Agendamento (pixel)',
  'offsite_conversion.fb_pixel_custom': 'Eventos personalizados do pixel',
  'onsite_conversion.messaging_conversation_started_7d': 'Conversas iniciadas no WhatsApp/Direct',
  'onsite_conversion.messaging_first_reply': 'Primeira resposta em conversa'
};
// só ações com cara de lead aparecem pra escolher (cliques, curtidas e visualizações ficam de fora)
const LEADISH = /lead|registration|application|contact|schedule|custom|messaging_conversation_started|messaging_first_reply/;
const actionName = (t) => ACTION_NAMES[t] || (t.startsWith('offsite_conversion.custom.') ? 'Conversão personalizada ' + t.split('.').pop() : t.replace(/^(offsite|onsite)_conversion\./, '').replace(/_/g, ' '));
let LEAD_TYPES = null; // null = automático
const rowLeads = (x) => {
  if (!LEAD_TYPES?.length || !Array.isArray(x.actions)) return Number(x.meta_leads || 0);
  return x.actions.reduce((a, it) => a + (LEAD_TYPES.includes(it.action_type) ? Number(it.value || 0) : 0), 0);
};
const parseMoney = (v) => Number(String(v || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
const UTM_TEMPLATE = 'utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&utm_id={{campaign.id}}';
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// intervalo do filtro em datas ISO (Todo o período = desde 2020)
function range() {
  const [a, b] = dateRange(F);
  return [a ? iso(a) : '2020-01-01', iso(b || new Date())];
}
const inRange = (dateIso, [a, b]) => { const d = iso(new Date(dateIso)); return d >= a && d <= b; };

const TABS = [['geral', 'Visão geral'], ['clientes', 'Clientes'], ['contas', 'Contas de anúncio']];
const tabBar = () => `<nav class="ptabs" role="tablist">${TABS.map(([k, n]) => `<button role="tab" class="ptab ${F.tab === k ? 'on' : ''}" aria-selected="${F.tab === k}" data-tab="${k}">${n}</button>`).join('')}</nav>`;
function bindTabs(el) {
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    if (F.tab === b.dataset.tab) return;
    F.tab = b.dataset.tab; renderFinance(el, true);
  }));
}

export async function renderFinance(el, swap = false) {
  // mesmo período do Dashboard
  F.period = PERIOD.period; F.from = PERIOD.from; F.to = PERIOD.to;
  try { const t = sessionStorage.getItem('tracto_fin_tab'); if (t) { F.tab = t; sessionStorage.removeItem('tracto_fin_tab'); } } catch (e) {}
  if (F.tab === 'contas') return renderAccounts(el, swap);
  if (F.tab === 'clientes') {
    el.innerHTML = `<div class="topline"><h1>Financeiro</h1><div class="grow"></div>${dateBtn(F)}</div>${tabBar()}<div class="tab-body ${swap ? 'swap-in' : ''}" data-clients></div>`;
    bindTabs(el);
    el.querySelector('[data-date]').addEventListener('click', (e) => datePicker(e.currentTarget, F, (st) => { Object.assign(F, st); Object.assign(PERIOD, st); renderFinance(el); }));
    return renderClients(el.querySelector('[data-clients]'), F, () => renderFinance(el));
  }
  el.innerHTML = '<div class="loading">Carregando…</div>';
  const r = range();
  let ins = [], entries = [], accounts = [], settings = null;
  try {
    await DB.processAds();
    [ins, entries, accounts, settings, OBJS] = await Promise.all([DB.listInsights(r[0], r[1]), DB.listFinance(r[0], r[1]), DB.listAdAccounts().catch(() => []), DB.getTracking().catch(() => null), DB.listMetaObjects().then((l) => new Map(l.map((o) => [o.id, o]))).catch(() => new Map())]);
    // primeira vez: busca status e orçamento na Meta em segundo plano
    if (!OBJS.size && accounts.some((a) => a.enabled) && !renderFinance._objSync) { renderFinance._objSync = true; syncObjects().then((n) => { if (n && el.isConnected && F.tab === 'geral') renderFinance(el); }); }
  } catch (e) { fail(e); }
  if (!el.isConnected) return;
  const months = settings?.contract_months || 12;
  const isAdmin = S.me?.role === 'admin';
  LEAD_TYPES = Array.isArray(settings?.meta_lead_actions) && settings.meta_lead_actions.length ? settings.meta_lead_actions : null;

  // ---------- números ----------
  const leads = S.leads.filter((l) => inRange(l.created_at, r));
  const paidLeads = leads.filter((l) => l.source === 'pago');
  const sales = S.leads.filter((l) => l.won_at && inRange(l.won_at, r));
  const saleValue = (l) => Number(l.valor || 0) * (F.revenue === 'contrato' ? months : 1);
  const manualSales = entries.filter(isSaleEntry);
  const tblSales = [...sales, ...manualSales.map((e) => {
    const l = e.lead_id ? S.leads.find((x) => x.id === e.lead_id) : null;
    const own = e.utm_campaign || e.utm_id;
    return { utm_campaign: own ? e.utm_campaign : l?.utm_campaign, utm_term: own ? e.utm_term : l?.utm_term, utm_content: own ? e.utm_content : l?.utm_content, utm_id: own ? e.utm_id : l?.utm_id, __entry: e };
  })];
  const junkId = S.stages.find((x) => x.name === 'Descarte')?.id;
  const leadsOk = leads.filter((l) => l.stage_id !== junkId);
  const linked = new Set(entries.filter((e) => e.lead_id).map((e) => e.lead_id));
  const cohortWon = leadsOk.filter((l) => l.won_at || linked.has(l.id)).length;
  const tblValue = (x) => (x.__entry ? entrySale(x.__entry) : saleValue(x));
  // vendas que vieram de anúncio (campanha na venda/contato, ou contato de tráfego pago)
  // venda de anúncio: tudo que não foi marcado como indicação/orgânico
  const isAds = (x) => (x.__entry ? x.__entry.source !== 'organico' : !['organico', 'manual'].includes(x.source));
  const adsSales = tblSales.filter(isAds);
  const revAds = adsSales.reduce((a2, x) => a2 + tblValue(x), 0);
  const nSales = sales.length + manualSales.length;
  const revSales = sales.reduce((a, l) => a + saleValue(l), 0) + manualSales.reduce((a, e) => a + entrySale(e), 0);
  const revManual = entries.filter((e) => e.kind === 'receita' && !isSaleEntry(e)).reduce((a, e) => a + Number(e.amount), 0);
  const expManual = entries.filter((e) => e.kind === 'despesa').reduce((a, e) => a + Number(e.amount), 0);
  const spend = ins.reduce((a, x) => a + Number(x.spend), 0);
  const imp = ins.reduce((a, x) => a + Number(x.impressions), 0);
  const clicks = ins.reduce((a, x) => a + Number(x.clicks), 0);
  const linkClicks = ins.reduce((a, x) => a + Number(x.link_clicks || 0), 0);
  const metaLeads = ins.reduce((a, x) => a + rowLeads(x), 0);
  const hasMeta = ins.length > 0;
  const leadsN = hasMeta ? metaLeads : leads.length; // leads pela própria Meta quando há campanhas
  const faturamento = revSales + revManual;
  const despesas = spend + expManual;
  const lucro = faturamento - despesas;
  const ratio = (a, b) => (b ? a / b : null);
  const money = (v) => (v == null ? '—' : brl(v));
  const x2 = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + 'x');

  const tiles = [
    ['Faturamento', brl(faturamento), `${num(nSales)} venda${nSales === 1 ? '' : 's'}${revManual ? ' + ' + brl(revManual) + ' em outras receitas' : ''}`, 'accent'],
    ['Gastos com anúncios', brl(spend), accounts.length || ins.length ? `${num(imp)} impressões` : 'conecte na aba Contas de anúncio'],
    ['Lucro', brl(lucro), `margem ${faturamento ? pct(lucro, faturamento) : '—'}`, lucro < 0 ? 'neg' : 'pos'],
    ['ROAS', x2(ratio(revAds, spend)), adsSales.length ? `${num(adsSales.length)} venda${adsSales.length === 1 ? '' : 's'} de anúncio ÷ gasto` : 'só vendas que vieram de anúncio'],
    ['ROI', ratio(lucro, despesas) == null ? '—' : pct(lucro, despesas), `despesas totais ${brl(despesas)}`],
    ['Ticket médio', money(ratio(revSales, nSales)), F.revenue === 'contrato' ? 'valor total do contrato' : 'por mensalidade'],
    ['CAC', money(ratio(spend, adsSales.length)), adsSales.length ? `com todas as despesas: ${money(ratio(despesas, nSales))}` : 'nenhuma venda de anúncio no período'],
    ['Leads', num(leadsN), hasMeta ? `pela Meta · ${num(leads.length)} no CRM` : `${num(paidLeads.length)} de anúncios`],
    ['CPL', money(ratio(spend, hasMeta ? metaLeads : (paidLeads.length || leads.length))), hasMeta ? 'gasto ÷ leads da Meta' : 'gasto ÷ leads de anúncio'],
    ['Conversão', leadsN ? pct(nSales, leadsN) : '—', leadsN ? `${num(nSales)} cliente${nSales === 1 ? '' : 's'} de ${num(leadsN)} leads` : 'nenhum lead no período'],
    ['CTR', imp ? pct(linkClicks || clicks, imp) : '—', `CPC ${money(ratio(spend, linkClicks || clicks))}${linkClicks ? ' · cliques no link' : ''}`],
    ['CPM', money(imp ? (spend / imp) * 1000 : null), `${num(linkClicks || clicks)} cliques${linkClicks ? ' no link' : ''}`]
  ];

  el.innerHTML = `
    <div class="topline"><h1>Financeiro</h1><div class="grow"></div>
      ${dateBtn(F)}
    </div>
    ${tabBar()}
    <div class="tab-body">
    <div class="fin-actions">
      <div class="seg"><button class="b b-sm ${F.revenue === 'mensal' ? 'on' : ''}" data-rev="mensal">Receita: 1ª mensalidade</button><button class="b b-sm ${F.revenue === 'contrato' ? 'on' : ''}" data-rev="contrato">Receita: contrato</button></div>
      <div class="grow"></div>
      ${accounts.length ? `<button class="b b-refresh" data-sync>${ICON.refresh}Sincronizar Meta Ads</button>` : ''}
      <button class="b b-primary" data-entry>+ Lançamento</button>
    </div>
    <div class="fin-tiles">${tiles.map(([l, v, sub, cls]) => `<section class="panel ftile ${cls || ''}"><div class="t-label">${l}</div><div class="t-value">${v}</div><div class="t-sub">${esc(sub)}</div></section>`).join('')}</div>

    <section class="panel chart-card" style="margin-top:12px"><h3>Faturamento × gastos por dia</h3><p class="sub">Vendas fechadas (pela data da venda) e lançamentos, contra gasto em anúncios e despesas</p>
      <div class="legend"><span><i style="background:var(--viz-1)"></i>Faturamento</span><span><i style="background:var(--viz-neutral)"></i>Gastos</span></div>
      <div class="chart" data-chart></div></section>

    <section class="panel adt-card">
      <div class="adt-head">
        <nav class="adt-tabs" role="tablist">${[['campaign', 'Campanhas'], ['adset', 'Conjuntos de anúncios'], ['ad', 'Anúncios']].map(([k, n]) => `<button role="tab" aria-selected="${F.level === k}" class="adt-tab ${F.level === k ? 'on' : ''}" data-level="${k}">${LVL_IC[k]}<span>${n}</span></button>`).join('')}</nav>
        <div class="adt-tools"><label class="adt-search">${ICON.search}<input type="search" data-adt-q placeholder="Buscar por nome" value="${esc(F.q || '')}"></label>
          <button class="b b-ic adt-colbtn" data-cols data-pop-anchor><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg><span>Colunas</span></button></div>
      </div>
      <div class="adt-wrap" data-table></div>
      <p class="adt-note">Resultados, gasto e cliques vêm da Meta (mesma atribuição do Gerenciador). Vendas e faturamento vêm do CRM, ligados pelas UTMs dos anúncios.</p>
      <details class="docs"><summary>Parâmetros de URL pra colar nos anúncios</summary>
        <p class="help">No Gerenciador de Anúncios, em cada anúncio: Rastreamento &gt; Parâmetros de URL. É assim que o CRM liga cada lead e venda à campanha, conjunto e anúncio que trouxe.</p>
        <div class="code"><div class="code-h"><span>Parâmetros de URL</span><button class="b b-sm b-ghost" data-copy-utm>Copiar</button></div><pre>${esc(UTM_TEMPLATE)}</pre></div></details>
    </section>

    <div class="int-grid" style="margin-top:12px">
      <section class="panel int-card">
        <div class="int-h"><div><h3>Lançamentos</h3><p class="help">Vendas feitas por fora do CRM, outras receitas e despesas: ferramentas, equipe, impostos…</p></div></div>
        ${entries.length ? `<div class="table-wrap"><table class="int-table"><thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th><th></th></tr></thead><tbody>
          ${entries.map((e) => `<tr data-id="${e.id}" class="row-click" title="Clique para editar"><td class="nowrap">${new Date(e.date + 'T12:00').toLocaleDateString('pt-BR')}</td><td><span class="pill ${e.kind === 'receita' ? 'good' : 'bad'}">${e.kind === 'receita' ? 'Receita' : 'Despesa'}</span></td><td>${esc(e.category)}</td><td>${esc(e.description || '')}${e.months ? `<br><small class="muted">${e.months} × ${brl(e.monthly_amount || 0)}</small>` : ''}</td><td class="num">${brl(e.amount)}</td><td style="text-align:right"><span class="row-acts"><button class="b b-sm b-ghost" data-eedit aria-label="Editar">${ICON.edit}</button><button class="b b-sm b-ghost" data-edel aria-label="Excluir">${ICON.x}</button></span></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted empty-line">Nenhum lançamento no período.</p>'}
      </section>
      <section class="panel int-card">
        <div class="int-h"><div><h3>Contas de anúncio</h3><p class="help">${accounts.length ? `${accounts.filter((a) => a.enabled).length} ativa${accounts.filter((a) => a.enabled).length === 1 ? '' : 's'} · gasto atualizado a cada 3 horas` : 'Conecte o perfil do Facebook pra puxar o gasto das campanhas.'}</p></div><button class="b b-sm" data-go-acc>Gerenciar</button></div>
        ${accounts.length ? '' : '<p class="muted empty-line">Nenhuma conta conectada.</p>'}
        ${accounts.slice(0, 4).map((a) => `<div class="srow">${META_ICON}<div class="grow"><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${accStatus(a)}</div></div>${a.enabled ? '<span class="pill good">Ativa</span>' : '<span class="pill">Pausada</span>'}</div>`).join('')}
      </section>
    </div>
    </div>`;

  // tabela por nível
  renderTable(el.querySelector('[data-table]'), ins, leads, tblSales, tblValue);
  el.querySelector('[data-cols]').addEventListener('click', (e) => colsPicker(e.currentTarget));
  let qT; el.querySelector('[data-adt-q]').addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => { F.q = e.target.value; renderTable(el.querySelector('[data-table]'), ins, leads, tblSales, tblValue); }, 150); });
  dailyChart(el.querySelector('[data-chart]'), r, ins, sales, entries, saleValue);

  const reload = () => renderFinance(el);
  bindTabs(el);
  if (swap) el.querySelector('.tab-body').classList.add('swap-in');
  el.querySelector('[data-go-acc]').addEventListener('click', () => { F.tab = 'contas'; renderFinance(el, true); });
  el.querySelector('[data-date]').addEventListener('click', (e) => datePicker(e.currentTarget, F, (st) => { Object.assign(F, st); Object.assign(PERIOD, st); reload(); }));
  el.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', () => { F.revenue = b.dataset.rev; reload(); }));
  el.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => {
    if (F.level === b.dataset.level) return;
    F.level = b.dataset.level;
    el.querySelectorAll('[data-level]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    const host = el.querySelector('[data-table]');
    renderTable(host, ins, leads, tblSales, tblValue);
    host.classList.remove('swap-in'); void host.offsetWidth; host.classList.add('swap-in');
  }));
  el.querySelector('[data-copy-utm]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(UTM_TEMPLATE); toast('Parâmetros copiados'); } catch (e) { toast('Não consegui copiar', true); } });
  el.querySelector('[data-entry]').addEventListener('click', () => entryModal(reload));
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-edel]')) return;
    const entry = entries.find((x) => x.id === tr.dataset.id); if (entry) entryModal(reload, entry);
  }));
  el.querySelectorAll('tr[data-id] [data-edel]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Excluir este lançamento?', 'Excluir'))) return;
    try { await DB.deleteFinance(b.closest('tr').dataset.id); reload(); } catch (e) { fail(e); }
  }));
  el.querySelector('[data-sync]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.classList.add('is-spinning');
    try {
      await DB.syncAds(null, 30); await DB.metaObjectsSync().catch(() => 0);
      for (const wait of [3000, 4000, 6000]) { await new Promise((ok) => setTimeout(ok, wait)); await DB.processAds(); await DB.metaObjectsProcess().catch(() => 0); }
      toast('Meta Ads atualizado'); reload();
    } catch (err) { fail(err); btn.disabled = false; btn.classList.remove('is-spinning'); }
  });
}

// ================= Contas de anúncio: login do Facebook + contas ativas =================
const META_ICON = `<span class="plat plat-meta">${BRAND.meta}</span>`;
const FB_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg>';
const daysLeft = (d) => (d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null);
function accStatus(a) {
  if (a.last_error) return `<span style="color:var(--fg-red)">${esc(a.last_error)}</span>`;
  const left = daysLeft(a.token_expires_at);
  const sync = a.last_sync_at ? 'sincronizado ' + (ago(a.last_sync_at) === 'agora' ? 'agora' : 'há ' + ago(a.last_sync_at)) : 'aguardando 1ª sincronização';
  if (left != null && left <= 0) return '<span style="color:var(--fg-red)">acesso expirou · reconecte o Facebook</span>';
  if (left != null && left <= 10) return `${sync} · <span style="color:var(--amber-ink)">acesso expira em ${left} dia${left === 1 ? '' : 's'}</span>`;
  return sync;
}

let sdk = null;
function loadFbSdk(appId) {
  if (sdk && sdk.appId === appId) return sdk.p;
  const p = new Promise((ok, bad) => {
    const init = () => { window.FB.init({ appId, version: GRAPH, cookie: false, xfbml: false }); ok(window.FB); };
    if (window.FB) return init();
    window.fbAsyncInit = init;
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/pt_BR/sdk.js'; s.async = true; s.crossOrigin = 'anonymous';
    s.onerror = () => { sdk = null; bad(new Error('Não consegui carregar o login do Facebook. Desative bloqueadores de anúncio nesta página e tente de novo.')); };
    document.head.appendChild(s);
    setTimeout(() => bad(new Error('O Facebook demorou pra responder. Tente de novo.')), 20000);
  });
  sdk = { appId, p };
  return p;
}
const fbApi = (FB, path, params = {}) => new Promise((ok, bad) => FB.api(path, 'GET', params, (r) => (!r || r.error ? bad(new Error(r?.error?.message || 'erro no Facebook')) : ok(r))));
async function fbAccounts(FB) {
  const out = []; let after = null;
  do {
    const r = await fbApi(FB, '/me/adaccounts', { fields: 'name,account_id,currency,account_status,business{name}', limit: 100, ...(after ? { after } : {}) });
    out.push(...(r.data || []));
    after = r.paging?.next ? r.paging.cursors?.after : null;
  } while (after && out.length < 500);
  return out;
}
const ACC_STATUS = { 1: 'Ativa', 2: 'Desativada', 3: 'Pagamento pendente', 7: 'Em análise', 8: 'Pagamento pendente', 9: 'Em período de carência', 100: 'Encerrando', 101: 'Encerrada' };

async function renderAccounts(el, swap) {
  el.innerHTML = '<div class="loading">Carregando…</div>';
  const isAdmin = S.me?.role === 'admin';
  let accounts = [], ins30 = [], settings = null, mls = null;
  const today = iso(new Date()); const since = iso(new Date(Date.now() - 29 * 86400000));
  try { [accounts, ins30, settings] = await Promise.all([DB.listAdAccounts(), DB.listInsights(since, today).catch(() => []), DB.getTracking().catch(() => null), DB.metaLeadsStatus().catch(() => null)]).then((r) => { mls = r[3]; return r.slice(0, 3); }); } catch (e) { fail(e); }
  if (!el.isConnected) return;
  const appId = window.TRACTO_CONFIG?.metaAppId || '';
  const hasApp = /^\d{8,20}$/.test(appId);
  const profiles = [...new Set(accounts.filter((a) => a.fb_user_name).map((a) => a.fb_user_name))];
  const soonest = accounts.filter((a) => a.connected_via === 'facebook' && a.token_expires_at).map((a) => daysLeft(a.token_expires_at)).sort((a, b) => a - b)[0];

  el.innerHTML = `
    <div class="topline"><h1>Financeiro</h1><div class="grow"></div></div>
    ${tabBar()}
    <div class="tab-body">
    <section class="panel int-card fb-card">
      <div class="fb-hero">
        <span class="fb-badge">${FB_ICON}</span>
        <div class="grow">
          <h3>${profiles.length ? 'Perfil do Facebook <em>conectado</em>' : 'Conecte o perfil do <em>Facebook</em>'}</h3>
          <p class="help">${profiles.length
            ? `${esc(profiles.join(', '))} · ${soonest == null ? '' : soonest > 0 ? `acesso válido por mais ${soonest} dia${soonest === 1 ? '' : 's'}` : 'acesso expirado'}`
            : 'Entre com o Facebook, escolha as contas de anúncio e o CRM passa a puxar gasto, impressões, cliques e leads de cada campanha, conjunto e anúncio.'}</p>
        </div>
        ${isAdmin ? `<button class="b b-fb" data-fb ${hasApp ? '' : 'disabled'}>${FB_ICON}${!hasApp ? 'Disponível em breve' : profiles.length ? 'Reconectar ou adicionar contas' : 'Continuar com o Facebook'}</button>` : ''}
      </div>
      ${isAdmin ? `<details class="docs" style="margin-top:12px"><summary>Permissões do Facebook que o CRM usa</summary>
        <ul class="how" style="margin-top:8px">
          <li><b>ads_read</b>: gastos, resultados e métricas das campanhas.</li>
          <li><b>ads_management</b>: pausar, ativar, renomear e mudar orçamento de campanhas, conjuntos e anúncios pelo Financeiro.</li>
          <li><b>leads_retrieval</b>, <b>pages_show_list</b>, <b>pages_read_engagement</b>, <b>pages_manage_ads</b>: trazer os leads dos formulários da Meta.</li>
          <li><b>business_management</b>: ver as contas do portfólio da Tracto.</li>
        </ul>
        <p class="help">Pra adicionar uma permissão: developers.facebook.com › CRM Tracto › Login do Facebook para Empresas › Configurações › edite a configuração e marque a permissão. Depois clique em Reconectar aqui em cima.</p></details>` : ''}
      ${isAdmin && soonest != null && soonest <= 10 ? `<p class="fb-note warn">O Facebook libera o acesso por 60 dias. Clique em Reconectar pra renovar sem perder o histórico.</p>` : ''}
    </section>

    <section class="panel int-card" style="margin-top:12px">
      <div class="int-h"><div><h3>Contas de anúncio</h3><p class="help">Gasto sincronizado a cada 3 horas, por anúncio e por dia. Só as contas ativas entram no financeiro.</p></div>
        ${accounts.length ? `<button class="b b-refresh" data-sync>${ICON.refresh}Sincronizar agora</button>` : ''}</div>
      ${accounts.length ? accounts.map((a) => `<div class="srow" data-id="${a.id}">${META_ICON}
          <div class="grow"><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${esc(a.account_id)}${a.currency ? ' · ' + esc(a.currency) : ''}${a.connected_via === 'facebook' ? ' · via Facebook' : ' · token manual'} · ${accStatus(a)}</div></div>
          ${isAdmin ? `<button class="switch ${a.enabled ? 'on' : ''}" data-acc-toggle aria-label="${a.enabled ? 'Pausar' : 'Ativar'} conta"></button>${a.connected_via === 'facebook' ? '' : '<button class="b b-sm" data-acc-edit>Editar</button>'}<button class="b b-sm b-danger" data-acc-del aria-label="Desconectar">×</button>` : (a.enabled ? '<span class="pill good">Ativa</span>' : '<span class="pill">Pausada</span>')}</div>`).join('')
        : `<div class="empty-mini"><p class="muted">${isAdmin ? 'Nenhuma conta ativa ainda. Conecte o Facebook acima e escolha as contas.' : 'Peça pra um admin conectar o Facebook.'}</p></div>`}
    </section>
    ${metaLeadsCard(mls, accounts.length > 0)}
    ${leadActionsCard(ins30, settings, isAdmin || S.me?.role === 'gestor')}
    </div>`;

  const reload = () => renderAccounts(el);
  bindLeadActions(el, reload);
  bindMetaLeads(el, reload);
  bindTabs(el);
  if (swap) el.querySelector('.tab-body').classList.add('swap-in');

  el.querySelector('[data-fb]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.classList.add('is-busy');
    const done = () => { btn.disabled = false; btn.classList.remove('is-busy'); };
    try {
      const FB = await loadFbSdk(appId);
      // app do tipo Empresa usa a configuração do Login para Empresas; sem ela, pede as permissões direto
      const cfgId = window.TRACTO_CONFIG?.metaLoginConfigId;
      const opts = cfgId ? { config_id: cfgId, return_scopes: true } : { scope: 'ads_read,ads_management,business_management,leads_retrieval,pages_show_list,pages_read_engagement,pages_manage_ads', return_scopes: true, auth_type: 'rerequest' };
      const auth = await new Promise((ok) => FB.login((r) => ok(r.authResponse), opts));
      if (!auth) { done(); return toast('Login cancelado', true); }
      if (auth.grantedScopes && !String(auth.grantedScopes).includes('ads_read')) { done(); return toast('Autorize a permissão de ler anúncios (ads_read) pra continuar', true); }
      const [me, list] = await Promise.all([fbApi(FB, '/me', { fields: 'name' }), fbAccounts(FB)]);
      if (!list.length) { done(); return toast('Esse perfil não tem acesso a nenhuma conta de anúncio', true); }
      const conn = await DB.metaConnect(auth.accessToken, auth.userID, me.name);
      let st = null;
      for (const wait of [800, 1200, 1500, 2000, 3000, 4000]) {
        await new Promise((ok) => setTimeout(ok, wait));
        st = await DB.metaConnectStatus(conn);
        if (st.status !== 'pending') break;
      }
      done();
      if (st?.status !== 'ok') return toast('O Facebook não confirmou a conexão. Tente de novo em instantes.', true);
      pickAccounts(conn, me.name, list, accounts, reload);
    } catch (err) { done(); fail(err); }
  });

  el.querySelector('[data-sync]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.classList.add('is-spinning');
    try {
      await DB.syncAds(null, 30);
      for (const wait of [3000, 4000, 6000]) { await new Promise((ok) => setTimeout(ok, wait)); await DB.processAds(); }
      toast('Gasto da Meta atualizado'); reload();
    } catch (err) { fail(err); btn.disabled = false; btn.classList.remove('is-spinning'); }
  });
  el.querySelectorAll('.srow[data-id]').forEach((row) => {
    const a = accounts.find((x) => x.id === row.dataset.id); if (!a) return;
    row.querySelector('[data-acc-toggle]')?.addEventListener('click', async () => { try { await DB.saveAdAccount({ id: a.id, enabled: !a.enabled }); toast(a.enabled ? 'Conta pausada' : 'Conta ativada'); reload(); } catch (e) { fail(e); } });
    row.querySelector('[data-acc-edit]')?.addEventListener('click', () => accountModal(a, reload));
    row.querySelector('[data-acc-del]')?.addEventListener('click', async () => {
      if (!(await confirmBox(`Desconectar a conta "${a.name}"? O histórico de gasto dela também sai do financeiro.`, 'Desconectar'))) return;
      try { await DB.deleteAdAccount(a.id); reload(); } catch (e) { fail(e); }
    });
  });
}

// escolhe quais contas do perfil ficam ativas no CRM
// leads dos formulários de cadastro da Meta (puxados a cada 15 minutos)
const PERM_ERR = /(leads_retrieval|pages_|permission|permiss|#10\b|#200\b|#190\b|OAuth)/i;
function metaLeadsCard(st, connected) {
  if (!st) return '';
  const forms = Array.isArray(st.forms) ? st.forms : [];
  const needPerm = st.last_error && PERM_ERR.test(st.last_error);
  const when = st.last_run ? (ago(st.last_run) === 'agora' ? 'agora' : 'há ' + ago(st.last_run)) : 'ainda não buscou';
  return `<section class="panel int-card" style="margin-top:12px" data-meta-leads>
    <div class="int-h"><div><h3>Leads dos formulários da Meta</h3><p class="help">O CRM puxa sozinho todos os leads dos formulários de cadastro das suas páginas (histórico completo e os novos a cada 15 minutos), com campanha, conjunto e anúncio de cada um.</p></div>
      ${connected ? `<button class="b b-refresh" data-ml-sync>${ICON.refresh}Buscar agora</button>` : ''}</div>
    <div class="ml-stats">
      <div><span>Leads trazidos da Meta</span><b>${num(st.total_leads || 0)}</b></div>
      <div><span>Páginas</span><b>${num(st.pages || 0)}</b></div>
      <div><span>Formulários</span><b>${num(forms.length)}</b></div>
      <div><span>Última busca</span><b class="ml-when">${esc(when)}</b></div>
    </div>
    ${needPerm ? `<div class="ml-alert"><b>Falta liberar a leitura de leads no Facebook</b>
      <ol class="steps"><li>Em developers.facebook.com &gt; CRM Tracto &gt; Login do Facebook para Empresas &gt; Configurações, edite a configuração "Leitura de anúncios" e adicione as permissões <b>leads_retrieval</b>, <b>pages_show_list</b>, <b>pages_read_engagement</b> e <b>pages_manage_ads</b>.</li>
      <li>Volte aqui e clique em <b>Reconectar ou adicionar contas</b> (lá em cima), autorizando as páginas da Tracto.</li>
      <li>Clique em <b>Buscar agora</b>.</li></ol></div>` : ''}
    ${forms.length ? `<div class="table-wrap"><table class="int-table"><thead><tr><th>Formulário</th><th>Status</th><th class="num">Leads na Meta</th><th>Atualizado</th></tr></thead><tbody>
      ${forms.map((f) => `<tr><td><b>${esc(f.name || '')}</b></td><td>${f.status === 'ACTIVE' ? '<span class="pill good">Ativo</span>' : `<span class="pill">${f.status === 'ARCHIVED' ? 'Arquivado' : 'Inativo'}</span>`}</td><td class="num">${num(f.leads || 0)}</td><td class="nowrap muted">${f.synced_at ? (ago(f.synced_at) === 'agora' ? 'agora' : 'há ' + ago(f.synced_at)) : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="muted empty-line">${connected ? (needPerm ? 'Assim que a permissão for liberada, os formulários aparecem aqui.' : 'Clique em Buscar agora pra trazer os formulários e os leads.') : 'Conecte o Facebook acima pra trazer os leads.'}</p>`}
  </section>`;
}
function bindMetaLeads(el, reload) {
  el.querySelector('[data-ml-sync]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.classList.add('is-spinning');
    try {
      await DB.metaLeadsSync();
      let got = 0;
      // páginas → formulários → leads (cada etapa espera a resposta da Meta)
      for (const wait of [2500, 3000, 3500, 4000, 5000, 6000]) { await new Promise((ok) => setTimeout(ok, wait)); got += Number(await DB.metaLeadsProcess()) || 0; }
      toast(got ? `${num(got)} lead${got === 1 ? '' : 's'} novo${got === 1 ? '' : 's'} da Meta` : 'Busca concluída. Leads grandes continuam chegando nos próximos minutos.');
      window.dispatchEvent(new Event('tracto:reload-leads'));
      reload();
    } catch (err) { btn.disabled = false; btn.classList.remove('is-spinning'); fail(err); }
  });
}

// escolher quais ações da Meta contam como lead (igual à coluna "Resultados" do Gerenciador)
function leadActionsCard(ins, settings, canEdit) {
  const tot = new Map();
  ins.forEach((x) => (Array.isArray(x.actions) ? x.actions : []).forEach((a) => {
    if (LEADISH.test(a.action_type)) tot.set(a.action_type, (tot.get(a.action_type) || 0) + Number(a.value || 0));
  }));
  const chosen = Array.isArray(settings?.meta_lead_actions) ? settings.meta_lead_actions : [];
  const list = [...tot.entries()].sort((a, b) => b[1] - a[1]);
  const autoN = ins.reduce((a, x) => a + Number(x.meta_leads || 0), 0);
  return `<section class="panel int-card" style="margin-top:12px" data-lead-actions>
    <div class="int-h"><div><h3>O que conta como lead</h3><p class="help">No automático, o CRM usa a coluna "Resultados" de cada campanha, igual ao Gerenciador de Anúncios. Só ligue ações abaixo se quiser contar de outro jeito. Números dos últimos 30 dias, somando as contas ativas.</p></div></div>
    ${list.length ? `<div class="acc-pick">${list.map(([t, n]) => `<label class="acc-opt ${chosen.includes(t) ? 'on' : ''}" data-t="${esc(t)}">
        <span class="grow acc-info"><b>${esc(actionName(t))}</b><small class="muted">${esc(t)}</small></span>
        <span class="la-n">${num(n)}</span>
        <input type="checkbox" class="ios-switch" role="switch" aria-label="Contar ${esc(actionName(t))}" ${chosen.includes(t) ? 'checked' : ''} ${canEdit ? '' : 'disabled'}></label>`).join('')}</div>
      <div class="la-foot"><span class="muted" data-la-sum></span><div class="grow"></div>${canEdit ? '<button class="b" data-la-auto>Usar automático</button><button class="b b-primary" data-la-save>Salvar</button>' : ''}</div>`
      : `<p class="muted empty-line">${ins.length ? 'As campanhas ainda não trouxeram detalhes das ações. Clique em Sincronizar agora e aguarde alguns segundos.' : 'Sem dados de campanha nos últimos 30 dias.'}</p>`}
    <input type="hidden" data-la-auto-n value="${autoN}">
  </section>`;
}
function bindLeadActions(el, reload) {
  const card = el.querySelector('[data-lead-actions]'); if (!card || !card.querySelector('.acc-pick')) return;
  const sum = () => {
    const on = [...card.querySelectorAll('.acc-opt')].filter((l) => l.querySelector('input').checked);
    card.querySelectorAll('.acc-opt').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    const n = on.reduce((a, l) => a + Number(l.querySelector('.la-n').textContent.replace(/\D/g, '')), 0);
    card.querySelector('[data-la-sum]').textContent = on.length ? `${num(n)} leads com a seleção` : `Automático: ${num(Number(card.querySelector('[data-la-auto-n]').value))} leads`;
  };
  card.querySelector('.acc-pick').addEventListener('change', sum); sum();
  const save = async (types, btn) => {
    btn.disabled = true;
    try { await DB.saveTracking({ meta_lead_actions: types.length ? types : null }); toast('Contagem de leads atualizada'); reload(); } catch (e) { btn.disabled = false; fail(e); }
  };
  card.querySelector('[data-la-save]')?.addEventListener('click', (e) => save([...card.querySelectorAll('.acc-opt')].filter((l) => l.querySelector('input').checked).map((l) => l.dataset.t), e.currentTarget));
  card.querySelector('[data-la-auto]')?.addEventListener('click', (e) => save([], e.currentTarget));
}

// escolher colunas da tabela de campanhas (fica salvo neste navegador)
function colsPicker(anchor) {
  const on = new Set(visibleCols().map((c) => c[0]));
  const groups = [...new Set(ALL_COLS.map((c) => c[0]))];
  popover(anchor, `<div class="colp"><div class="ph">Colunas da tabela</div>
    ${groups.map((g) => `<div class="colp-g">${g}</div>${ALL_COLS.filter((c) => c[0] === g).map(([, k, n, , tip]) => `<button type="button" class="pi colp-i" data-k="${k}"><span class="cbx ${on.has(k) ? 'on' : ''}">${ICON.check}</span><span class="colp-t"><span>${n}</span>${tip ? `<small>${esc(tip)}</small>` : ''}</span></button>`).join('')}`).join('')}
    <hr><div class="pfoot"><button class="b b-sm b-ghost" data-reset>Restaurar padrão</button></div></div>`, (p) => {
    const save = () => {
      try { localStorage.setItem(COLS_KEY, JSON.stringify([...on])); } catch (e) {}
      if (lastTable && lastTable[0].isConnected) renderTable(...lastTable);
    };
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (b) {
        const k = b.dataset.k;
        if (on.has(k)) { if (on.size <= 1) return toast('Deixe pelo menos uma coluna', true); on.delete(k); } else on.add(k);
        b.querySelector('.cbx').classList.toggle('on', on.has(k));
        save();
      }
      if (e.target.closest('[data-reset]')) {
        on.clear(); DEFAULT_COLS.forEach((k) => on.add(k));
        p.querySelectorAll('[data-k]').forEach((x) => x.querySelector('.cbx').classList.toggle('on', on.has(x.dataset.k)));
        try { localStorage.removeItem(COLS_KEY); } catch (e2) {}
        if (lastTable && lastTable[0].isConnected) renderTable(...lastTable);
      }
    });
  }, { closable: true, cls: 'pop-cols' });
}

function pickAccounts(conn, fbName, list, current, done) {
  const cur = new Map(current.map((a) => [a.account_id, a]));
  const rows = list.map((a) => ({ id: a.id, name: a.name, currency: a.currency, status: a.account_status, biz: a.business?.name }))
    .sort((a, b) => (cur.get(b.id)?.enabled ? 1 : 0) - (cur.get(a.id)?.enabled ? 1 : 0) || (a.status === 1 ? 0 : 1) - (b.status === 1 ? 0 : 1) || a.name.localeCompare(b.name));
  // começa ligado só o que já é acompanhado: evita misturar contas de clientes no financeiro da Tracto
  const on = new Set(rows.filter((r) => cur.get(r.id)?.enabled).map((r) => r.id));
  modal(`<h3>Contas de anúncio</h3>
    <p class="help" style="margin-top:-4px">Conectado como <b>${esc(fbName)}</b>. Ligue as contas que o financeiro deve acompanhar.</p>
    <div class="acc-pick-h"><span class="muted" data-count></span><div class="grow"></div><button type="button" class="b b-sm b-ghost" data-all>Selecionar todas</button><button type="button" class="b b-sm b-ghost" data-none>Desmarcar todas</button></div>
    <div class="acc-pick">${rows.map((a) => `<label class="acc-opt ${on.has(a.id) ? 'on' : ''}" data-id="${esc(a.id)}">
      <span class="grow acc-info"><b>${esc(a.name)}</b><small class="muted">${esc(a.id)}${a.biz ? ' · ' + esc(a.biz) : ''} · ${esc(a.currency || '')}</small></span>
      ${a.status === 1 ? '' : `<span class="pill wait">${ACC_STATUS[a.status] || 'Status ' + a.status}</span>`}
      <input type="checkbox" class="ios-switch" role="switch" aria-label="Acompanhar ${esc(a.name)}" ${on.has(a.id) ? 'checked' : ''}></label>`).join('')}</div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar</button></div>`, (c, close) => {
    const sync = () => {
      c.querySelectorAll('.acc-opt').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
      const n = c.querySelectorAll('.acc-opt input:checked').length;
      c.querySelector('[data-count]').textContent = `${n} de ${rows.length} ligada${n === 1 ? '' : 's'}`;
    };
    c.querySelector('.acc-pick').addEventListener('change', sync);
    c.querySelector('[data-all]').addEventListener('click', () => { c.querySelectorAll('.acc-opt input').forEach((i) => { i.checked = true; }); sync(); });
    c.querySelector('[data-none]').addEventListener('click', () => { c.querySelectorAll('.acc-opt input').forEach((i) => { i.checked = false; }); sync(); });
    sync();
    c.querySelector('[data-ok]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ids = new Set([...c.querySelectorAll('.acc-opt')].filter((l) => l.querySelector('input').checked).map((l) => l.dataset.id));
      const pick = rows.filter((r) => ids.has(r.id)).map((r) => ({ id: r.id, name: r.name, currency: r.currency }));
      const off = current.filter((a) => a.enabled && rows.some((r) => r.id === a.account_id) && !ids.has(a.account_id));
      if (!pick.length && !off.length) return toast('Ligue pelo menos uma conta', true);
      btn.disabled = true;
      try {
        await Promise.all(off.map((a) => DB.saveAdAccount({ id: a.id, enabled: false })));
        const n = pick.length ? await DB.metaActivate(conn, pick) : 0;
        close();
        toast(n ? `${n} conta${n === 1 ? '' : 's'} ligada${n === 1 ? '' : 's'}. Buscando os últimos 30 dias…` : 'Contas atualizadas');
        if (n) for (const wait of [3000, 4000, 6000]) { await new Promise((ok) => setTimeout(ok, wait)); await DB.processAds(); }
        done();
      } catch (err) { btn.disabled = false; fail(err); }
    });
  });
}

// ---------- tabela de campanhas / conjuntos / anúncios (estilo Gerenciador de Anúncios + UTMify) ----------
const money2 = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RESULT_NAMES = {
  'actions:onsite_conversion.lead_grouped': 'Leads no formulário',
  'actions:lead': 'Leads',
  'actions:offsite_conversion.fb_pixel_lead': 'Leads no site',
  'actions:onsite_conversion.messaging_conversation_started_7d': 'Conversas iniciadas',
  'actions:link_click': 'Cliques no link',
  'actions:landing_page_view': 'Visualizações da página',
  total_profile_visits: 'Visitas ao perfil',
  reach: 'Alcance',
  impressions: 'Impressões'
};
const resultName = (ind) => {
  if (!ind) return '';
  if (RESULT_NAMES[ind]) return RESULT_NAMES[ind];
  const m = ind.match(/fb_pixel_custom\.(.+)$/) || ind.match(/custom\.(\d+)$/);
  if (m) return m[1];
  return ind.replace(/^(actions|conversions):/, '').replace(/^(offsite|onsite)_conversion\./, '').replace(/_/g, ' ');
};
const LVL_IC = {campaign: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.5.7l1.3 1.6h6.6A2.5 2.5 0 0 1 21 9.8v7.7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>', adset: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>', ad: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/></svg>'};
const LEVELS = [['campaign', 'Campanhas', 'campanha'], ['adset', 'Conjuntos de anúncios', 'conjunto'], ['ad', 'Anúncios', 'anúncio']];
// colunas disponíveis (grupo, chave, nome, visível por padrão, explicação)
const ALL_COLS = [
  ['Desempenho', 'delivery', 'Veiculação', true, 'Status real da veiculação na Meta'],
  ['Desempenho', 'budget', 'Orçamento', true, 'Orçamento diário ou total (clique pra alterar)'],
  ['Desempenho', 'results', 'Resultados', true, 'Coluna Resultados do Gerenciador de Anúncios'],
  ['Desempenho', 'cpr', 'Custo por resultado', true],
  ['Desempenho', 'spend', 'Valor usado', true],
  ['Desempenho', 'imp', 'Impressões', true],
  ['Desempenho', 'cpm', 'CPM', true, 'Custo por mil impressões'],
  ['Cliques', 'link', 'Cliques no link', true],
  ['Cliques', 'ctr', 'CTR', true, 'Cliques no link ÷ impressões'],
  ['Cliques', 'cpc', 'CPC', true, 'Custo por clique no link'],
  ['Cliques', 'lpv', 'Visualizações da página', false, 'Quem clicou e a página carregou'],
  ['Cliques', 'connect', 'Connect rate', false, 'Visualizações da página ÷ cliques no link'],
  ['Cliques', 'cplpv', 'Custo por visualização', false, 'Valor usado ÷ visualizações da página'],
  ['Conversas', 'msgs', 'Conversas iniciadas', false, 'WhatsApp e Direct'],
  ['Conversas', 'cpmsg', 'Custo por conversa', false],
  ['Leads e vendas', 'crm', 'Leads no CRM', false, 'Leads que chegaram ao CRM com a UTM dessa linha'],
  ['Leads e vendas', 'conv', 'Taxa de conversão', false, 'Vendas ÷ leads'],
  ['Leads e vendas', 'sales', 'Vendas', true],
  ['Leads e vendas', 'cpa', 'Custo por venda', false, 'Valor usado ÷ vendas (CAC da campanha)'],
  ['Leads e vendas', 'rev', 'Faturamento', true],
  ['Leads e vendas', 'ticket', 'Ticket médio', false, 'Faturamento ÷ vendas'],
  ['Leads e vendas', 'roas', 'ROAS', true, 'Faturamento ÷ valor usado'],
  ['Leads e vendas', 'profit', 'Lucro', true, 'Faturamento − valor usado']
];
const COLS_KEY = 'tracto_adt_cols';
const DEFAULT_COLS = ALL_COLS.filter((c) => c[3]).map((c) => c[1]);
function visibleCols() {
  let keys = null;
  try { keys = JSON.parse(localStorage.getItem(COLS_KEY)); } catch (e) {}
  if (!Array.isArray(keys) || !keys.length) keys = DEFAULT_COLS;
  return ALL_COLS.filter((c) => keys.includes(c[1])).map((c) => [c[1], c[2], c[4]]);
}
let lastTable = null; // últimos argumentos da tabela (pra redesenhar ao trocar colunas)
let OBJS = new Map();  // campanhas, conjuntos e anúncios da Meta (status e orçamento)
const canManage = () => ['admin', 'gestor'].includes(S.me?.role);
const DELIVERY = {
  ACTIVE: ['Ativa', 'good'], PAUSED: ['Pausada', ''], CAMPAIGN_PAUSED: ['Campanha pausada', ''], ADSET_PAUSED: ['Conjunto pausado', ''],
  IN_PROCESS: ['Em processamento', 'wait'], WITH_ISSUES: ['Com problemas', 'bad'], PENDING_REVIEW: ['Em análise', 'wait'], DISAPPROVED: ['Reprovado', 'bad'],
  PREAPPROVED: ['Pré-aprovado', 'wait'], PENDING_BILLING_INFO: ['Pagamento pendente', 'bad'], ARCHIVED: ['Arquivada', ''], DELETED: ['Excluída', '']
};
const LEVEL_NAME = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Anúncio' };
async function syncObjects() {
  try {
    await DB.metaObjectsSync();
    let n = 0;
    for (const wait of [2500, 3500, 5000]) { await new Promise((ok) => setTimeout(ok, wait)); n += Number(await DB.metaObjectsProcess()) || 0; }
    return n;
  } catch (e) { return 0; }
}
// manda a alteração e espera a Meta confirmar
async function applyChange(o, patch, okMsg) {
  const before = { ...o };
  Object.assign(o, patch.status ? { status: patch.status, effective_status: patch.status } : {}, patch.name ? { name: patch.name } : {});
  if (lastTable && lastTable[0].isConnected) renderTable(...lastTable);
  try {
    const job = await DB.metaObjectUpdate(o.id, patch);
    for (let i = 0; i < 10; i++) {
      await new Promise((ok) => setTimeout(ok, i ? 1500 : 900));
      await DB.metaObjectsProcess().catch(() => 0);
      const st = await DB.metaObjectJob(job);
      if (st?.done) {
        if (!st.ok) throw new Error(st.error || 'a Meta recusou a alteração');
        if (patch.daily_budget) { o.daily_budget = patch.daily_budget * 100; o.lifetime_budget = null; }
        if (patch.lifetime_budget) { o.lifetime_budget = patch.lifetime_budget * 100; o.daily_budget = null; }
        toast(okMsg);
        if (lastTable && lastTable[0].isConnected) renderTable(...lastTable);
        return true;
      }
    }
    toast('Alteração enviada. A Meta ainda está processando.');
    return true;
  } catch (e) {
    Object.assign(o, before);
    if (lastTable && lastTable[0].isConnected) renderTable(...lastTable);
    const perm = /permission|permiss|ads_management|#200|#10\b|OAuthException/i.test(e.message);
    toast(perm ? 'Falta a permissão ads_management. Veja Financeiro › Contas de anúncio.' : 'A Meta recusou: ' + e.message, true);
    return false;
  }
}
function budgetModal(o) {
  const cur = o.daily_budget ? ['daily', o.daily_budget / 100] : o.lifetime_budget ? ['lifetime', o.lifetime_budget / 100] : ['daily', ''];
  modal(`<h3>Orçamento</h3>
    <p class="help" style="margin-top:-4px">${LEVEL_NAME[o.level]}: <b>${esc(o.name || '')}</b></p>
    <div class="row"><div class="seg"><button type="button" class="b ${cur[0] === 'daily' ? 'on' : ''}" data-bt="daily">Diário</button><button type="button" class="b ${cur[0] === 'lifetime' ? 'on' : ''}" data-bt="lifetime">Total</button></div></div>
    <div class="row"><label class="lbl">Valor (R$)</label><input class="inp" data-bv inputmode="decimal" value="${cur[1] ? Number(cur[1]).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}" placeholder="0,00"></div>
    <p class="help">A Meta aplica o novo orçamento na hora. Mudanças grandes (mais de 20%) podem colocar a campanha de volta em aprendizado.</p>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar orçamento</button></div>`, (m, close) => {
    let type = cur[0];
    m.querySelectorAll('[data-bt]').forEach((b) => b.addEventListener('click', () => { type = b.dataset.bt; m.querySelectorAll('[data-bt]').forEach((x) => x.classList.toggle('on', x === b)); }));
    m.querySelector('[data-ok]').addEventListener('click', async () => {
      const v = parseMoney(m.querySelector('[data-bv]').value);
      if (!(v >= 1)) return toast('Informe um valor a partir de R$ 1', true);
      close();
      applyChange(o, type === 'daily' ? { daily_budget: v } : { lifetime_budget: v }, 'Orçamento atualizado na Meta');
    });
  });
}
function renameModal(o) {
  modal(`<h3>Renomear ${LEVEL_NAME[o.level].toLowerCase()}</h3>
    <div class="row"><label class="lbl">Nome</label><input class="inp" data-nm maxlength="400" value="${esc(o.name || '')}"></div>
    <p class="help">Se os anúncios usam o nome da campanha nas UTMs, os leads novos passam a chegar com o nome novo.</p>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar nome</button></div>`, (m, close) => {
    m.querySelector('[data-ok]').addEventListener('click', () => {
      const n = m.querySelector('[data-nm]').value.trim();
      if (!n) return toast('Informe o nome', true);
      if (n === o.name) return close();
      close(); applyChange(o, { name: n }, 'Nome atualizado na Meta');
    });
  });
}

function renderTable(host, ins, leads, sales, saleValue) {
  lastTable = [host, ins, leads, sales, saleValue];
  const COLS = visibleCols();
  const key = { campaign: ['campaign_id', 'campaign_name'], adset: ['adset_id', 'adset_name'], ad: ['ad_id', 'ad_name'] }[F.level];
  const utm = { campaign: 'utm_campaign', adset: 'utm_term', ad: 'utm_content' }[F.level];
  const lastDay = ins.reduce((a, x) => (x.date > a ? x.date : a), '');
  const rows = new Map();
  ins.forEach((x) => {
    const k = x[key[0]] || x[key[1]];
    const r = rows.get(k) || { id: x[key[0]], name: x[key[1]] || '(sem nome)', campaign: x.campaign_name, adset: x.adset_name, spend: 0, imp: 0, clicks: 0, link: 0, lpv: 0, msgs: 0, crm: 0, results: 0, leads: 0, ind: {}, last: '' };
    r.spend += Number(x.spend); r.imp += Number(x.impressions); r.clicks += Number(x.clicks); r.link += Number(x.link_clicks || 0);
    r.lpv += Number(x.landing_views || 0); r.msgs += Number(x.messages || 0);
    r.leads += rowLeads(x);
    // "Resultados" = o que a Meta mostra na coluna de mesmo nome; sem ela, os leads
    const res = x.results != null ? Number(x.results) : rowLeads(x);
    r.results += res;
    const ind = x.result_indicator || (res ? 'actions:lead' : '');
    if (ind) r.ind[ind] = (r.ind[ind] || 0) + res + 0.0001;
    if (Number(x.spend) > 0 && x.date > r.last) r.last = x.date;
    rows.set(k, r);
  });
  // vendas do CRM ligadas pela UTM (ou pelo id da campanha em utm_id)
  const match = (l) => [...rows.values()].find((r) => (F.level === 'campaign' && l.utm_id && l.utm_id === r.id) || (l[utm] && l[utm] === r.name));
  rows.forEach((r) => Object.assign(r, { sales: 0, rev: 0, indicator: Object.entries(r.ind).sort((a, b) => b[1] - a[1])[0]?.[0] || '' }));
  const unmatched = { name: 'Sem anúncio identificado', sub: 'Orgânico, indicação ou link sem UTM', spend: 0, imp: 0, clicks: 0, link: 0, lpv: 0, msgs: 0, crm: 0, results: 0, leads: 0, sales: 0, rev: 0, none: true };
  leads.forEach((l) => { const r = match(l); if (r) r.crm++; else { unmatched.leads++; unmatched.crm++; } });
  sales.forEach((l) => { const r = match(l) || unmatched; r.sales++; r.rev += saleValue(l); });
  unmatched.results = unmatched.leads;

  const val = (r, k) => ({
    results: r.results, cpr: r.results ? r.spend / r.results : null, spend: r.spend, imp: r.imp, cpm: r.imp ? (r.spend / r.imp) * 1000 : null,
    link: r.link || r.clicks, ctr: r.imp ? (r.link || r.clicks) / r.imp : null, cpc: (r.link || r.clicks) ? r.spend / (r.link || r.clicks) : null,
    sales: r.sales, rev: r.rev, roas: r.spend ? r.rev / r.spend : null, profit: r.rev - r.spend,
    lpv: r.lpv, connect: (r.link || r.clicks) && r.lpv ? r.lpv / (r.link || r.clicks) : null, cplpv: r.lpv ? r.spend / r.lpv : null,
    msgs: r.msgs, cpmsg: r.msgs ? r.spend / r.msgs : null, crm: r.crm,
    conv: (r.leads || r.crm) ? r.sales / (r.leads || r.crm) : null, cpa: r.sales && r.spend ? r.spend / r.sales : null, ticket: r.sales ? r.rev / r.sales : null
  })[k];
  const q = (F.q || '').trim().toLowerCase();
  let list = [...rows.values()].filter((r) => !q || `${r.name} ${r.campaign || ''} ${r.adset || ''}`.toLowerCase().includes(q));
  const sk = F.sort || 'spend'; const dir = F.sortDir || -1;
  list.sort((a, b) => ((val(a, sk) ?? -Infinity) - (val(b, sk) ?? -Infinity)) * dir || b.spend - a.spend);
  if (!q && (unmatched.leads || unmatched.sales)) list.push(unmatched);
  const levelName = LEVELS.find(([k]) => k === F.level);
  if (!list.length) { host.innerHTML = `<div class="adt-empty">${q ? 'Nada encontrado com essa busca.' : 'Sem gasto nem leads no período.'}</div>`; return; }

  const tot = list.filter((r) => !r.none).reduce((a, r) => { ['spend', 'imp', 'clicks', 'link', 'lpv', 'msgs', 'results', 'leads'].forEach((k) => { a[k] += r[k]; }); return a; }, { spend: 0, imp: 0, clicks: 0, link: 0, lpv: 0, msgs: 0, results: 0, leads: 0 });
  tot.crm = list.reduce((a, r) => a + (r.crm || 0), 0);
  list.forEach((r) => { tot.sales = (tot.sales || 0) + r.sales; tot.rev = (tot.rev || 0) + r.rev; });
  const inds = new Set(list.filter((r) => !r.none && r.indicator).map((r) => r.indicator));
  tot.indicator = inds.size === 1 ? [...inds][0] : '';
  const mixed = inds.size > 1;

  const dash = '<span class="adt-dash">—</span>';
  const cell = (r, k, isTot) => {
    const v = val(r, k);
    if ((r.none || isTot) && ['delivery', 'budget'].includes(k)) return isTot ? '' : dash;
    if (r.none && ['cpr', 'spend', 'imp', 'cpm', 'link', 'ctr', 'cpc', 'roas', 'profit', 'lpv', 'connect', 'cplpv', 'msgs', 'cpmsg', 'cpa'].includes(k)) return dash;
    const pctv = (x) => (x == null ? dash : (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
    switch (k) {
      case 'results': {
        if (isTot && mixed) return `<b>${num(r.leads)}</b><small>leads</small>`;
        const label = r.none ? 'leads no CRM' : resultName(r.indicator);
        return v ? `<b>${num(v)}</b>${label ? `<small>${esc(label)}</small>` : ''}` : dash;
      }
      case 'cpr': return isTot && mixed ? (r.leads ? `${money2(r.spend / r.leads)}<small>por lead</small>` : dash) : v == null ? dash : `${money2(v)}<small>por resultado</small>`;
      case 'spend': return money2(v);
      case 'imp': return v ? num(v) : dash;
      case 'cpm': case 'cpc': return v == null ? dash : money2(v);
      case 'link': return v ? num(v) : dash;
      case 'ctr': return v == null ? dash : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
      case 'sales': return v ? `<b>${num(v)}</b>` : dash;
      case 'rev': return v ? money2(v) : dash;
      case 'roas': return !r.rev ? dash : `<span class="roas ${v >= 1 ? 'good' : 'bad'}">${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</span>`;
      case 'lpv': case 'msgs': case 'crm': return v ? num(v) : dash;
      case 'delivery': { const o = OBJS.get(r.id); if (!o) return dash; const [t, c] = DELIVERY[o.effective_status] || [o.effective_status || o.status || '—', '']; return `<span class="pill ${c}">${esc(t)}</span>`; }
      case 'budget': {
        const o = OBJS.get(r.id); if (!o || o.level === 'ad') return dash;
        const txt = o.daily_budget ? `${money2(o.daily_budget / 100)}<small>por dia</small>` : o.lifetime_budget ? `${money2(o.lifetime_budget / 100)}<small>total</small>` : `<span class="adt-dash">—</span><small>${o.level === 'campaign' ? 'no conjunto' : 'na campanha'}</small>`;
        return canManage() && (o.daily_budget || o.lifetime_budget) ? `<button class="adt-edit" data-budget="${esc(o.id)}" title="Alterar orçamento">${txt}</button>` : txt;
      }
      case 'connect': return v == null ? dash : `<span class="roas ${v >= 0.7 ? 'good' : v < 0.5 ? 'bad' : ''}">${pctv(v)}</span>`;
      case 'conv': return pctv(v);
      case 'cplpv': case 'cpmsg': case 'cpa': case 'ticket': return v == null ? dash : money2(v);
      case 'profit': return !r.rev && !r.sales ? `<span class="neg">${money2(v)}</span>` : `<span class="${v < 0 ? 'neg' : 'pos'}">${money2(v)}</span>`;
    }
    return '';
  };
  const status = (r) => {
    if (r.none) return '<span class="adt-dot off" title="Fora dos anúncios"></span>';
    const o = OBJS.get(r.id);
    if (o && canManage() && ['ACTIVE', 'PAUSED'].includes(o.status)) return `<input type="checkbox" class="ios-switch adt-sw" data-toggle="${esc(o.id)}" ${o.status === 'ACTIVE' ? 'checked' : ''} aria-label="${o.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}" title="${o.status === 'ACTIVE' ? 'Ativo: clique pra pausar' : 'Pausado: clique pra ativar'}">`;
    const on = r.last && lastDay && r.last >= lastDay;
    return `<span class="adt-dot ${on ? 'on' : 'off'}" title="${on ? 'Com gasto no último dia do período' : 'Sem gasto no último dia do período'}"></span>`;
  };
  const sub = (r) => r.none ? r.sub : F.level === 'campaign' ? '' : F.level === 'adset' ? r.campaign : `${r.campaign || ''}${r.adset ? ' › ' + r.adset : ''}`;
  const sortIc = (k) => (sk === k ? `<span class="adt-sort">${dir > 0 ? ICON.up : ICON.down}</span>` : '');
  host.innerHTML = `<table class="adt">
    <thead><tr><th class="adt-name" data-sort="name">${levelName[1].replace(' de anúncios', '')}</th>${COLS.map(([k, n, tip]) => `<th class="num ${sk === k ? 'on' : ''}" data-sort="${k}" ${tip ? `title="${esc(tip)}"` : ''}>${n}${sortIc(k)}</th>`).join('')}</tr></thead>
    <tbody>${list.map((r) => `<tr class="${r.none ? 'adt-none' : ''}">
      <td class="adt-name"><div class="adt-n">${status(r)}<div class="adt-t"><b title="${esc(OBJS.get(r.id)?.name || r.name)}">${esc(OBJS.get(r.id)?.name || r.name)}</b>${!r.none && OBJS.get(r.id) && canManage() ? `<button class="adt-rn" data-rename="${esc(r.id)}" aria-label="Renomear" title="Renomear">${ICON.edit}</button>` : ''}${sub(r) ? `<small title="${esc(sub(r))}">${esc(sub(r))}</small>` : ''}</div></div></td>
      ${COLS.map(([k]) => `<td class="num">${cell(r, k)}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><td class="adt-name"><div class="adt-t"><b>Resultados de ${num(list.filter((r) => !r.none).length)} ${levelName[2]}${list.filter((r) => !r.none).length === 1 ? '' : 's'}</b><small>Soma do período</small></div></td>
      ${COLS.map(([k]) => `<td class="num">${cell({ ...tot, none: false }, k, true)}</td>`).join('')}</tr></tfoot>
  </table>`;
  host.querySelectorAll('[data-toggle]').forEach((sw) => sw.addEventListener('change', () => {
    const o = OBJS.get(sw.dataset.toggle); if (!o) return;
    const on = sw.checked;
    applyChange(o, { status: on ? 'ACTIVE' : 'PAUSED' }, `${LEVEL_NAME[o.level]} ${on ? 'ativad' : 'pausad'}${o.level === 'ad' ? 'o' : 'a'} na Meta`);
  }));
  host.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const o = OBJS.get(b.dataset.rename); if (o) renameModal(o); }));
  host.querySelectorAll('[data-budget]').forEach((b) => b.addEventListener('click', () => { const o = OBJS.get(b.dataset.budget); if (o) budgetModal(o); }));
  host.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort; if (k === 'name') return;
    F.sortDir = F.sort === k ? -(F.sortDir || -1) : -1; F.sort = k;
    renderTable(host, ins, leads, sales, saleValue);
  }));
}

// colunas agrupadas: faturamento (âmbar) × gastos (cinza), mesmo eixo em R$
function dailyChart(host, r, ins, sales, entries, saleValue) {
  const days = [];
  for (let d = new Date(r[0] + 'T12:00'); iso(d) <= r[1]; d = new Date(d.getTime() + 86400000)) days.push(iso(d));
  const data = days.map((d) => ({
    d,
    rev: sales.filter((l) => iso(new Date(l.won_at)) === d).reduce((a, l) => a + saleValue(l), 0) + entries.filter((e) => e.kind === 'receita' && e.date === d).reduce((a, e) => a + entryRev(e), 0),
    exp: ins.filter((x) => x.date === d).reduce((a, x) => a + Number(x.spend), 0) + entries.filter((e) => e.kind === 'despesa' && e.date === d).reduce((a, e) => a + Number(e.amount), 0)
  }));
  const W = Math.max(320, host.clientWidth); const H = 240; const padL = 58; const padB = 24; const padT = 10;
  const maxV = Math.max(1, ...data.map((x) => Math.max(x.rev, x.exp)));
  const p = Math.pow(10, Math.floor(Math.log10(maxV))); const max = [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= maxV);
  const iw = W - padL; const ih = H - padB - padT; const bw = iw / data.length; const gap = 2;
  const barW = Math.max(1, Math.min(14, (bw - 6) / 2));
  const y = (v) => padT + ih - (v / max) * ih;
  const bar = (x, v, cls, i) => { if (!v) return ''; const top = y(v); const h = padT + ih - top; const rr = Math.min(3, barW / 2, h); return `<path class="bar ${cls}" data-i="${i}" d="M${x},${padT + ih} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + barW - rr} Q${x + barW},${top} ${x + barW},${top + rr} V${padT + ih} Z"/>`; };
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 64)));
  const short = (v) => v >= 1000 ? 'R$' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : 'R$' + Math.round(v);
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Faturamento e gastos por dia">
    ${[0, max / 2, max].map((t) => `<line class="gl" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${short(t)}</text>`).join('')}
    ${data.map((x, i) => { const cx = padL + i * bw + bw / 2; return bar(cx - barW - gap / 2, x.rev, 'hot', i) + bar(cx + gap / 2, x.exp, 'rest', i); }).join('')}
    ${data.map((x, i) => (i % every === 0 ? `<text class="ax" x="${padL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${x.d.slice(8, 10)}/${x.d.slice(5, 7)}</text>` : '')).join('')}
    ${data.map((x, i) => `<rect class="hit" data-i="${i}" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${ih}"/>`).join('')}
  </svg><div class="ctip" hidden></div>`;
  const tip = host.querySelector('.ctip'); const svg = host.querySelector('svg');
  svg.addEventListener('mousemove', (e) => {
    const h = e.target.closest('.hit'); if (!h) return;
    const i = +h.dataset.i; const x = data[i];
    host.querySelectorAll('.bar').forEach((b) => b.classList.toggle('dim', +b.dataset.i !== i));
    tip.innerHTML = `<div class="muted">${new Date(x.d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</div>Faturamento <b>${brl(x.rev)}</b><br>Gastos <b>${brl(x.exp)}</b><br><span class="muted">Resultado ${brl(x.rev - x.exp)}</span>`;
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / W;
    tip.style.left = Math.min(Math.max((padL + i * bw + bw / 2) * scale, 80), host.clientWidth - 80) + 'px';
    tip.style.top = y(Math.max(x.rev, x.exp)) * scale + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; host.querySelectorAll('.bar').forEach((b) => b.classList.remove('dim')); });
}

function entryModal(done, entry = null) {
  let kind = entry?.kind || 'receita';
  let totalTouched = !!(entry && entry.months && entry.monthly_amount && Math.abs(entry.months * entry.monthly_amount - entry.amount) > 0.009);
  const cats = () => CATS[kind].map((c) => `<option>${c}</option>`).join('');
  const fmt0 = (n) => (Number(n) > 0 ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  modal(`<h3>${entry ? (SALE_CATS.includes(entry.category) ? 'Editar venda' : 'Editar lançamento') : 'Novo lançamento'}</h3>
    <div class="row"><div class="seg"><button type="button" class="b ${kind === 'receita' ? 'on' : ''}" data-k="receita">Receita</button><button type="button" class="b ${kind === 'despesa' ? 'on' : ''}" data-k="despesa">Despesa</button></div></div>
    <div class="grid2"><div class="row"><label class="lbl">Categoria</label><select class="inp" data-cat>${cats()}</select></div>
      <div class="row"><label class="lbl" data-date-l>Contrato fechado em</label><input class="inp" type="date" data-date value="${entry?.date || ''}" max="${iso(new Date())}"></div></div>
    <div data-sale>
      <div class="grid3">
        <div class="row"><label class="lbl">Meses de contrato</label><input class="inp" data-months inputmode="numeric" value="${entry?.months || 12}"></div>
        <div class="row"><label class="lbl">Valor mensal (R$)</label><input class="inp" data-monthly inputmode="decimal" placeholder="0,00" value="${fmt0(entry?.monthly_amount)}"></div>
        <div class="row"><label class="lbl">Valor total (R$)</label><input class="inp" data-total inputmode="decimal" placeholder="0,00" value="${entry && SALE_CATS.includes(entry.category) ? fmt0(entry.amount) : ''}"></div>
      </div>
      <p class="help" style="margin-top:-4px">O total é calculado sozinho (mensal × meses). Se o valor arrecadado for outro, é só editar.</p>
      <div class="row"><label class="lbl">Contrato cancelado em <span class="muted" style="text-transform:none;letter-spacing:0">(opcional, entra no churn)</span></label><input class="inp" type="date" data-canceled value="${entry?.canceled_at || ''}"></div>
    </div>
    <div class="row" data-simple hidden><label class="lbl">Valor (R$)</label><input class="inp" data-amount inputmode="decimal" placeholder="0,00" value="${entry && !SALE_CATS.includes(entry.category) ? fmt0(entry.amount) : ''}"></div>
    <div class="row"><label class="lbl" data-desc-l>Cliente</label><input class="inp" data-desc maxlength="200" placeholder="Ex: Ferragista Silva" value="${esc(entry?.description || '')}"></div>
    <div class="modal-foot">${entry ? '<button class="b b-danger" data-del style="margin-right:auto">Excluir</button>' : ''}<button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar</button></div>`, (c, close) => {
    const $c = (sel) => c.querySelector(sel);
    if (entry) {
      const opt = [...$c('[data-cat]').options].find((o) => o.value === entry.category || (SALE_CATS.includes(entry.category) && SALE_CATS.includes(o.value)));
      if (opt) $c('[data-cat]').value = opt.value; else $c('[data-cat]').insertAdjacentHTML('afterbegin', `<option selected>${esc(entry.category)}</option>`);
      $c('[data-del]').addEventListener('click', async () => {
        if (!(await confirmBox('Excluir este lançamento?', 'Excluir'))) return;
        try { await DB.deleteFinance(entry.id); close(); toast('Lançamento excluído'); done(); } catch (err) { fail(err); }
      });
    }
    const fmt = (n) => (n > 0 ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
    const isSale = () => kind === 'receita' && SALE_CATS.includes($c('[data-cat]').value);
    const layout = () => {
      const sale = isSale();
      $c('[data-sale]').hidden = !sale; $c('[data-simple]').hidden = sale;
      $c('[data-desc-l]').textContent = sale ? 'Cliente' : 'Descrição';
      $c('[data-date-l]').textContent = sale ? 'Contrato fechado em' : 'Data';
      $c('[data-desc]').placeholder = sale ? 'Ex: Ferragista Silva' : kind === 'despesa' ? 'Ex: Assinatura de ferramenta' : 'Ex: Setup da loja';
    };
    const recalc = () => {
      if (totalTouched) return;
      const m = Math.round(parseMoney($c('[data-months]').value)); const v = parseMoney($c('[data-monthly]').value);
      $c('[data-total]').value = m > 0 && v > 0 ? fmt(m * v) : '';
    };
    c.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
      kind = b.dataset.k; c.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b));
      $c('[data-cat]').innerHTML = cats(); layout();
    }));
    $c('[data-cat]').addEventListener('change', layout);
    $c('[data-months]').addEventListener('input', recalc);
    $c('[data-monthly]').addEventListener('input', recalc);
    $c('[data-total]').addEventListener('input', (e) => { totalTouched = e.target.value.trim() !== ''; if (!totalTouched) recalc(); });
    ['[data-monthly]', '[data-total]', '[data-amount]'].forEach((sel) => $c(sel).addEventListener('blur', (e) => { const v = parseMoney(e.target.value); if (v > 0) e.target.value = fmt(v); }));
    layout();
    $c('[data-ok]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const base = { ...(entry ? { id: entry.id } : {}), kind, date: $c('[data-date]').value, category: $c('[data-cat]').value, description: $c('[data-desc]').value.trim() || null, ...(entry ? {} : { created_by: S.me?.id?.startsWith('demo') ? null : S.me?.id }) };
      let row;
      if (!base.date) return toast(isSale() ? 'Informe quando o contrato foi fechado' : 'Informe a data', true);
      if (isSale()) {
        const months = Math.round(parseMoney($c('[data-months]').value)); const monthly = parseMoney($c('[data-monthly]').value); const total = parseMoney($c('[data-total]').value);
        if (!(months >= 1 && months <= 120)) return toast('Meses de contrato entre 1 e 120', true);
        if (!(monthly > 0)) return toast('Informe o valor mensal', true);
        if (!(total > 0)) return toast('Informe o valor total', true);
        row = { ...base, amount: total, months, monthly_amount: monthly, canceled_at: $c('[data-canceled]').value || null };
      } else {
        const amount = parseMoney($c('[data-amount]').value);
        if (!(amount > 0)) return toast('Informe um valor', true);
        row = { ...base, amount, months: null, monthly_amount: null };
      }
      btn.disabled = true;
      try { await DB.saveFinance(row); close(); toast(entry ? 'Lançamento atualizado' : isSale() ? 'Venda lançada' : 'Lançamento salvo'); done(); } catch (err) { btn.disabled = false; fail(err); }
    });
  });
}

function accountModal(a, done) {
  modal(`<h3>${a ? 'Editar conta' : 'Conectar conta da Meta Ads'}</h3>
    <div class="row"><label class="lbl">Nome</label><input class="inp" data-name value="${esc(a?.name || '')}" placeholder="Ex: Tracto · BM principal"></div>
    <div class="row"><label class="lbl">ID da conta de anúncio</label><input class="inp" data-acc value="${esc(a?.account_id || '')}" placeholder="act_123456789" ${a ? 'readonly' : ''}>
      <p class="help">Gerenciador de Anúncios: o número ao lado do nome da conta. Coloque "act_" na frente.</p></div>
    <div class="row"><label class="lbl">Token de acesso (ads_read)</label><textarea class="inp" data-token rows="3" autocomplete="off" spellcheck="false" placeholder="${a?.access_token ? '•••••••• salvo · cole outro pra trocar' : 'EAA…'}"></textarea>
      <p class="help">Recomendado: Configurações do Negócio &gt; Usuários do sistema &gt; crie um usuário do sistema, dê acesso à conta de anúncio e gere um token com a permissão <b>ads_read</b> (não expira). O token fica guardado no banco e só admins acessam.</p></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>${a ? 'Salvar' : 'Conectar e sincronizar'}</button></div>`, (c, close) => {
    c.querySelector('[data-ok]').addEventListener('click', async () => {
      const name = c.querySelector('[data-name]').value.trim();
      let acc = c.querySelector('[data-acc]').value.trim().replace(/\s/g, '');
      if (/^\d+$/.test(acc)) acc = 'act_' + acc;
      const token = c.querySelector('[data-token]').value.trim();
      if (!name) return toast('Dê um nome pra conta', true);
      if (!/^act_\d{5,25}$/.test(acc)) return toast('O ID da conta é act_ seguido de números', true);
      if (!a && !token) return toast('Cole o token de acesso', true);
      try {
        const row = await DB.saveAdAccount({ ...(a ? { id: a.id } : {}), name, account_id: acc, ...(token ? { access_token: token } : {}) });
        close(); toast('Conta salva. Buscando os últimos 30 dias…');
        await DB.syncAds(row.id, 30);
        for (const wait of [3000, 4000, 6000]) { await new Promise((ok) => setTimeout(ok, wait)); await DB.processAds(); }
        done();
      } catch (e) { fail(e); }
    });
  });
}
