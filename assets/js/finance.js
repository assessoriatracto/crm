// Financeiro (estilo UTMify): gasto da Meta Ads × leads e vendas do CRM × receitas e despesas lançadas
import { DB } from '@shared/db.js';
import { renderClients } from './clients.js?v=2609291926';
import { renderExpenses } from './expenses.js?v=2609291926';
import { renderCashflow } from './cashflow.js?v=2609291926';
import { contracts, received, result, fromAds } from './dashboard.js?v=2609291926';
import { contractTags } from './contract.js?v=2609291926';
import { entryModal } from './entry.js?v=2609291926';
import { PERIOD, BRAND, popover, dateRange, datePicker, dateBtn, S, $, $$, esc, ICON, brl, num, pct, fullDate, ago, toast, fail, modal, confirmBox } from './util.js?v=2609291926';

const F = { period: '30', from: '', to: '', level: 'campaign', revenue: 'mensal', sort: 'spend', tab: 'geral' };
const GRAPH = 'v21.0';
const SALE_CATS = ['Venda (contrato)', 'Contrato'];
const isSaleEntry = (e) => e.kind === 'receita' && SALE_CATS.includes(e.category);
// venda manual: na visão "1ª mensalidade" conta a mensalidade; na visão contrato, o total arrecadado
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

const TAB_IC = (d) => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TABS = [
  ['geral', 'Visão geral', TAB_IC('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>')],
  ['clientes', 'Clientes', TAB_IC('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.9-3.4 3.4-5.5 6.5-5.5s5.6 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.5 3.5 5.2"/>')],
  ['despesas', 'Despesas', TAB_IC('<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>')],
  ['fluxo', 'Fluxo de caixa', TAB_IC('<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>')],
  ['contas', 'Contas de anúncio', `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"/></svg>`],
];
const tabBar = () => `<nav class="ptabs" role="tablist">${TABS.map(([k, n, ic]) => `<button role="tab" class="ptab ${F.tab === k ? 'on' : ''}" aria-selected="${F.tab === k}" data-tab="${k}">${ic}<span>${n}</span></button>`).join('')}</nav>`;
function bindTabs(el) {
  // no celular, deixa a aba escolhida à vista na barra de abas
  const bar = el.querySelector('.ptabs'); const on = bar?.querySelector('.ptab.on');
  if (bar && on && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2);
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
  if (F.tab === 'despesas' || F.tab === 'fluxo') {
    const exp = F.tab === 'despesas';
    el.innerHTML = `<div class="topline"><h1>Financeiro</h1><div class="grow"></div>${exp ? dateBtn(F) : ''}</div>${tabBar()}<div class="tab-body ${swap ? 'swap-in' : ''}" data-sub></div>`;
    bindTabs(el);
    el.querySelector('[data-date]')?.addEventListener('click', (e) => datePicker(e.currentTarget, F, (st) => { Object.assign(F, st); Object.assign(PERIOD, st); renderFinance(el); }));
    const host = el.querySelector('[data-sub]');
    return exp ? renderExpenses(host, F, { range, entryModal }) : renderCashflow(host);
  }
  if (F.tab === 'clientes') {
    el.innerHTML = `<div class="topline"><h1>Financeiro</h1><div class="grow"></div>${dateBtn(F)}</div>${tabBar()}<div class="tab-body ${swap ? 'swap-in' : ''}" data-clients></div>`;
    bindTabs(el);
    el.querySelector('[data-date]').addEventListener('click', (e) => datePicker(e.currentTarget, F, (st) => { Object.assign(F, st); Object.assign(PERIOD, st); renderFinance(el); }));
    return renderClients(el.querySelector('[data-clients]'), F, () => renderFinance(el));
  }
  el.innerHTML = '<div class="loading">Carregando…</div>';
  const r = range();
  let ins = [], entries = [], settings = null, recur = [];
  try {
    await Promise.all([DB.processAds(), DB.runRecurring?.()]);
    [ins, entries, settings, recur] = await Promise.all([DB.listInsights(r[0], r[1]), DB.listFinance('2000-01-01', iso(new Date(Date.now() + 400 * 86400000))), DB.getTracking().catch(() => null), DB.listRecurring?.().catch(() => []) || []]);
  } catch (e) { fail(e); }
  if (!el.isConnected) return;
  const months = settings?.contract_months || 12;

  // ---------- números ----------
  // vendas: um cadastro só (lançamento de venda, sincronizado com a Central de leads); contratos de antes do período também pagam mensalidade nele
  const all = entries; entries = all.filter((e) => inRange(e.date + 'T12:00', r));
  const list = contracts(all, months);
  const [ra, rb] = [new Date(r[0] + 'T00:00'), new Date(r[1] + 'T23:59:59')];
  const res = result(ins, all, list, ra, rb);
  const salesR = list.filter((c) => c.start >= ra && c.start <= rb);
  const nSales = salesR.length;
  const salesValue = salesR.reduce((a, c) => a + c.value, 0);
  const adsSales = salesR.filter(fromAds);
  const revAds = adsSales.reduce((a, c) => a + c.value, 0);
  const isFixed = (e) => !!(e.recurring_id || e.expense_type === 'fixa');
  const exp = entries.filter((e) => e.kind === 'despesa');
  const { ads: spend, fixed, variable, other: revOther } = res;
  const faturamento = res.revenue; const custos = res.costs; const lucro = res.profit;
  const fixedMonthly = recur.filter((x) => x.active && (!x.end_date || x.end_date >= iso(new Date()))).reduce((a, x) => a + Number(x.amount), 0);
  const ratio = (a, b) => (b ? a / b : null);
  const money = (v) => (v == null ? '—' : brl(v));
  const x2 = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + 'x');
  const pctOf = (v, t) => (t ? Math.round((v / t) * 100) : 0);

  // receita por serviço e custos por categoria
  const svcRows = [['marketing', 'Marketing'], ['marketplace', 'Marketplace'], [null, 'Sem serviço definido']].map(([k, n]) => {
    const cs = list.filter((c) => (c.service || null) === k).map((c) => received(c, ra, rb)).filter((v) => v > 0);
    return { key: k, name: n, n: cs.length, value: cs.reduce((a, v) => a + v, 0) };
  }).filter((x) => x.n);
  const catMap = new Map(); if (spend) catMap.set('Anúncios (Meta)', spend);
  exp.forEach((e) => catMap.set(e.category, (catMap.get(e.category) || 0) + Number(e.amount)));
  const cats = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const bars = (rows, total, cls = () => '') => rows.map(([n, v, sub]) => `<div class="ex-bar"><span class="n" title="${esc(n)}">${esc(n)}</span><span class="track"><span class="fill ${cls(n)}" style="--w:${pctOf(v, rows[0][1] || 1)}%"></span></span><span class="v">${brl(v)}<small>${sub ?? pctOf(v, total) + '%'}</small></span></div>`).join('');
  // lançamentos (vendas da Central de leads já estão aqui) + lead ganho que ainda não virou lançamento
  const pipeRows = salesR.filter((c) => c.kind === 'lead').map((c) => ({ id: c.lead.id, pipeline: true, kind: 'receita', category: 'Venda (contrato)', description: c.name, service: c.service, plan: c.plan,
    date: iso(c.start), months: c.months, monthly_amount: c.monthly, amount: c.value }));
  const allRows = [...entries, ...pipeRows].sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));
  const shown = F.allEntries ? allRows : allRows.slice(0, 8);

  el.innerHTML = `
    <div class="topline"><h1>Financeiro</h1><div class="grow"></div>${dateBtn(F)}</div>
    ${tabBar()}
    <div class="tab-body">
    <div class="kx-grid kx-4">
      <section class="panel kx accent"><span class="kx-l">Faturamento</span><div class="kx-vr"><span class="kx-v">${brl(faturamento)}</span></div><div class="kx-s">o que entrou no período${nSales ? ` · ${num(nSales)} venda${nSales === 1 ? '' : 's'} fechada${nSales === 1 ? '' : 's'} (${brl(salesValue)} em contratos)` : ''}</div></section>
      <section class="panel kx"><span class="kx-l">Custos</span><div class="kx-vr"><span class="kx-v">${brl(custos)}</span></div><div class="kx-s">${custos ? `anúncios ${brl(spend)} · fixas ${brl(fixed)} · variáveis ${brl(variable)}` : 'nenhum custo no período'}</div></section>
      <section class="panel kx ${lucro < 0 ? 'neg' : 'ok'}"><span class="kx-l">Lucro líquido</span><div class="kx-vr"><span class="kx-v">${brl(lucro)}</span></div><div class="kx-s">margem ${faturamento ? pct(lucro, faturamento) : '—'}</div></section>
      <section class="panel kx"><span class="kx-l">ROAS</span><div class="kx-vr"><span class="kx-v">${x2(ratio(revAds, spend))}</span></div><div class="kx-s">${spend ? `${brl(revAds)} em contratos de anúncio ÷ investimento` : 'sem investimento no período'}</div></section>
    </div>
    <div class="fin-mini">
      <div><span>Ticket médio</span><b>${money(ratio(salesValue, nSales))}</b><small>por contrato fechado</small></div>
      <div><span>CAC</span><b>${money(ratio(spend, adsSales.length))}</b><small>${nSales && custos ? `com todos os custos ${brl(custos / nSales)}` : 'investimento ÷ clientes de anúncio'}</small></div>
      <div><span>ROI</span><b>${ratio(lucro, custos) == null ? '—' : pct(lucro, custos)}</b><small>lucro ÷ custos</small></div>
      <div><span>Custo fixo mensal</span><b>${brl(fixedMonthly)}</b><small><a class="link" href="#" data-go="despesas">ver despesas</a></small></div>
    </div>

    <section class="panel chart-card" style="margin-top:12px"><h3>Faturamento × custos por dia</h3><p class="sub">O que entrou em cada dia (mensalidades, marketplace e receitas), contra anúncios e despesas</p>
      <div class="legend"><span><i style="background:var(--viz-1)"></i>Faturamento</span><span><i style="background:var(--viz-neutral)"></i>Custos</span></div>
      <div class="chart" data-chart></div></section>

    <div class="fin-split">
      <section class="panel ex-card">
        <div class="ex-h"><div><h3>Faturamento por serviço</h3><p class="help">O que entrou no período (marketplace inteiro na venda)</p></div><a class="link" href="#" data-go="clientes">ver clientes</a></div>
        ${svcRows.length ? `<div class="ex-bars">${bars(svcRows.map((x) => [x.name, x.value, `${x.n} cliente${x.n === 1 ? '' : 's'}`]), svcRows.reduce((a, x) => a + x.value, 0), (n) => (n === 'Marketplace' ? 'mkp' : n.startsWith('Sem') ? 'ads' : ''))}</div>` : '<p class="muted empty-line">Nenhuma venda no período.</p>'}
      </section>
      <section class="panel ex-card">
        <div class="ex-h"><div><h3>Para onde foi o dinheiro</h3><p class="help">Custos do período por categoria</p></div><a class="link" href="#" data-go="despesas">ver despesas</a></div>
        ${cats.length ? `<div class="ex-bars">${bars(cats.map(([n, v]) => [n, v]), custos, (n) => (n === 'Anúncios (Meta)' ? 'ads' : ''))}</div>` : '<p class="muted empty-line">Nenhum custo no período.</p>'}
      </section>
    </div>

    <section class="panel ex-card" style="margin-top:12px">
      <div class="ex-h"><div><h3>Lançamentos</h3><p class="help">Vendas (da Central de leads e lançadas aqui), outras receitas e despesas do período</p></div><button class="b b-primary b-sm" data-entry>+ Novo lançamento</button></div>
      ${allRows.length ? `<div class="table-wrap"><table class="int-table"><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th></th></tr></thead><tbody>
        ${shown.map((e) => e.pipeline ? `<tr data-lead="${e.id}" class="row-click" title="Abrir o lead na Central de leads"><td class="nowrap">${new Date(e.date + 'T12:00').toLocaleDateString('pt-BR')}</td><td><span class="pill good">Receita</span></td><td>${esc(e.description || '')}<div class="ctr-tags"><span class="pill pipe">Central de leads</span>${contractTags(e.service, e.plan)}</div></td><td>Venda (pipeline)</td><td class="num">${brl(e.amount)}</td><td style="text-align:right"><span class="row-acts"><button class="b b-sm b-ghost" aria-label="Editar">${ICON.edit}</button><button class="b b-sm b-ghost" data-ldel aria-label="Excluir">${ICON.x}</button></span></td></tr>` : `<tr data-id="${e.id}" class="row-click" title="Clique para editar"><td class="nowrap">${new Date(e.date + 'T12:00').toLocaleDateString('pt-BR')}</td><td><span class="pill ${e.kind === 'receita' ? 'good' : 'bad'}">${e.kind === 'receita' ? 'Receita' : isFixed(e) ? 'Despesa fixa' : 'Despesa'}</span></td><td>${esc(e.description || '')}${isSaleEntry(e) ? `<div class="ctr-tags">${e.lead_id ? '<span class="pill pipe">Central de leads</span>' : ''}${contractTags(e.service, e.plan)}${(!e.plan || e.plan === 'mensal') && e.months ? `<small class="muted">${e.months} × ${brl(e.monthly_amount || 0)}</small>` : ''}</div>` : ''}</td><td>${esc(e.category)}</td><td class="num">${brl(e.amount)}</td><td style="text-align:right"><span class="row-acts"><button class="b b-sm b-ghost" data-eedit aria-label="Editar">${ICON.edit}</button><button class="b b-sm b-ghost" data-edel aria-label="Excluir">${ICON.x}</button></span></td></tr>`).join('')}
      </tbody></table></div>${allRows.length > 8 ? `<button class="b b-sm b-ghost fin-more" data-more-entries>${F.allEntries ? 'Mostrar menos' : `Mostrar todos (${allRows.length})`}</button>` : ''}` : '<p class="muted empty-line">Nenhum lançamento no período.</p>'}
    </section>
    </div>`;

  dailyChart(el.querySelector('[data-chart]'), r, ins, list, all);

  const reload = () => renderFinance(el);
  bindTabs(el);
  if (swap) el.querySelector('.tab-body').classList.add('swap-in');
  el.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); F.tab = a.dataset.go; renderFinance(el, true); }));
  el.querySelector('[data-more-entries]')?.addEventListener('click', () => { F.allEntries = !F.allEntries; reload(); });
  el.querySelector('[data-date]').addEventListener('click', (e) => datePicker(e.currentTarget, F, (st) => { Object.assign(F, st); Object.assign(PERIOD, st); reload(); }));
  el.querySelector('[data-entry]').addEventListener('click', () => entryModal(reload));
  // venda do pipeline: abre o lead (valor, contrato e data da venda ficam na ficha dele)
  el.querySelectorAll('tr[data-lead] [data-ldel]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const l = S.leads.find((x) => x.id === b.closest('tr').dataset.lead);
    if (!(await confirmBox(`Excluir a venda de ${l?.nome || 'este cliente'}? Ela também sai da Central de leads (o contato continua lá).`, 'Excluir'))) return;
    try { await DB.updateLeads([l.id], { valor: null, contract_value: null }); Object.assign(l, { valor: null, contract_value: null }); toast('Venda excluída'); reload(); } catch (err) { fail(err); }
  }));
  el.querySelectorAll('tr[data-lead]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-ldel]')) return;
    history.pushState(null, '', '/leads'); window.dispatchEvent(new Event('tracto:nav'));
    setTimeout(() => window.dispatchEvent(new CustomEvent('tracto:open-lead', { detail: tr.dataset.lead })), 150);
  }));
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-edel]')) return;
    const entry = entries.find((x) => x.id === tr.dataset.id); if (entry) entryModal(reload, entry);
  }));
  el.querySelectorAll('tr[data-id] [data-edel]').forEach((b) => b.addEventListener('click', async () => {
    const entry = entries.find((x) => x.id === b.closest('tr').dataset.id);
    const lead = entry?.lead_id ? S.leads.find((x) => x.id === entry.lead_id) : null;
    const msg = entry?.recurring_id ? 'Excluir o lançamento deste mês? A despesa fixa continua nos próximos meses.'
      : lead ? `Excluir a venda de ${lead.nome}? Ela também sai da Central de leads (o contato continua lá).` : `Excluir ${entry?.description ? `"${entry.description}"` : 'este lançamento'}?`;
    if (!(await confirmBox(msg, 'Excluir'))) return;
    try { await DB.deleteFinance(entry.id); toast('Lançamento excluído'); if (lead) window.dispatchEvent(new Event('tracto:reload-leads')); reload(); } catch (e) { fail(e); }
  }));
}

// ================= Campanhas (topo de Contas de anúncio): métricas por nível + gerenciar na Meta =================
async function renderCampaigns(host) {
  host.innerHTML = '<section class="panel adt-card"><div class="loading">Carregando campanhas…</div></section>';
  const r = range();
  let ins = [], entries = [], settings = null, accounts = [];
  try {
    await DB.processAds();
    [ins, entries, settings, accounts, OBJS] = await Promise.all([DB.listInsights(r[0], r[1]), DB.listFinance('2000-01-01', iso(new Date(Date.now() + 400 * 86400000))), DB.getTracking().catch(() => null), DB.listAdAccounts().catch(() => []), DB.listMetaObjects().then((l) => new Map(l.map((o) => [o.id, o]))).catch(() => new Map())]);
  } catch (e) { fail(e); }
  if (!host.isConnected) return;
  if (!accounts.length) { host.innerHTML = ''; return; }
  LEAD_TYPES = Array.isArray(settings?.meta_lead_actions) && settings.meta_lead_actions.length ? settings.meta_lead_actions : null;
  const months = settings?.contract_months || 12;
  const leads = S.leads.filter((l) => inRange(l.created_at, r));
  // vendas do período com a campanha de origem; valor = contrato fechado (mesma conta do ROAS do Dashboard)
  const [ra, rb] = [new Date(r[0] + 'T00:00'), new Date(r[1] + 'T23:59:59')];
  const tblSales = contracts(entries, months).filter((c) => c.start >= ra && c.start <= rb).map((c) => ({ ...c.origin, __v: c.value }));
  const tblValue = (x) => x.__v;

  host.innerHTML = `
    <section class="panel adt-card">
      <div class="adt-top"><div><h3>Campanhas</h3><p class="help">Resultados, gasto, vendas e faturamento de cada campanha, conjunto e anúncio no período.${canManage() ? ' Pause, ative, renomeie e mude o orçamento direto aqui.' : ''}</p></div>
        <button class="b b-refresh" data-sync>${ICON.refresh}Sincronizar</button></div>
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
`;
  renderTable(host.querySelector('[data-table]'), ins, leads, tblSales, tblValue);
  host.querySelector('[data-cols]').addEventListener('click', (e) => colsPicker(e.currentTarget));
  let qT; host.querySelector('[data-adt-q]').addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => { F.q = e.target.value; renderTable(host.querySelector('[data-table]'), ins, leads, tblSales, tblValue); }, 150); });
  host.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => {
    if (F.level === b.dataset.level) return;
    F.level = b.dataset.level;
    host.querySelectorAll('[data-level]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    const tbl = host.querySelector('[data-table]');
    renderTable(tbl, ins, leads, tblSales, tblValue);
    tbl.classList.remove('swap-in'); void tbl.offsetWidth; tbl.classList.add('swap-in');
  }));
  host.querySelector('[data-copy-utm]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(UTM_TEMPLATE); toast('Parâmetros copiados'); } catch (e) { toast('Não consegui copiar', true); } });
  host.querySelector('[data-sync]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.classList.add('is-spinning');
    try {
      await DB.syncAds(null, 30); await DB.metaObjectsSync().catch(() => 0);
      for (const wait of [3000, 4000, 6000]) { await new Promise((ok) => setTimeout(ok, wait)); await DB.processAds(); await DB.metaObjectsProcess().catch(() => 0); }
      toast('Meta Ads atualizado'); renderCampaigns(host);
    } catch (err) { fail(err); btn.disabled = false; btn.classList.remove('is-spinning'); }
  });
  // primeira vez: busca status e orçamento na Meta em segundo plano
  if (!OBJS.size && accounts.some((a) => a.enabled) && !renderCampaigns._objSync) { renderCampaigns._objSync = true; syncObjects().then((n) => { if (n && host.isConnected) renderCampaigns(host); }); }
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
    <div class="topline"><h1>Financeiro</h1><div class="grow"></div>${accounts.length ? dateBtn(F) : ''}</div>
    ${tabBar()}
    <div class="tab-body">
    <div data-camps></div>
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
  // campanhas no topo, com o mesmo período do Dashboard
  renderCampaigns(el.querySelector('[data-camps]'));
  el.querySelector('[data-date]')?.addEventListener('click', (e) => datePicker(e.currentTarget, F, (st) => { Object.assign(F, st); Object.assign(PERIOD, st); renderFinance(el); }));

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
      case 'roas': return !r.rev || v == null || !Number.isFinite(v) ? dash : `<span class="roas ${v >= 1 ? 'good' : 'bad'}">${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</span>`;
      case 'lpv': case 'msgs': case 'crm': return v ? num(v) : dash;
      case 'delivery': { const o = OBJS.get(r.id); if (!o) return dash; const [t, c] = DELIVERY[o.effective_status] || [o.effective_status || o.status || '—', '']; return `<span class="pill ${c}">${esc(t)}</span>`; }
      case 'budget': {
        const o = OBJS.get(r.id); if (!o || o.level === 'ad') return dash;
        const txt = o.daily_budget ? `${money2(o.daily_budget / 100)}<small>por dia</small>` : o.lifetime_budget ? `${money2(o.lifetime_budget / 100)}<small>total</small>` : `<span class="adt-dash">—</span><small>${o.level === 'campaign' ? 'no conjunto' : 'na campanha'}</small>`;
        return canManage() && (o.daily_budget || o.lifetime_budget) ? `<button class="adt-edit" data-budget="${esc(o.id)}" title="Alterar orçamento" aria-label="Alterar orçamento"><span class="adt-pen">${ICON.edit}</span><span>${txt}</span></button>` : txt;
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
function dailyChart(host, r, ins, list, entries) {
  const days = [];
  for (let d = new Date(r[0] + 'T12:00'); iso(d) <= r[1]; d = new Date(d.getTime() + 86400000)) days.push(iso(d));
  const data = days.map((d) => {
    const a = new Date(d + 'T00:00'); const b = new Date(d + 'T23:59:59');
    return {
      d,
      rev: list.reduce((s2, c) => s2 + received(c, a, b), 0) + entries.filter((e) => e.kind === 'receita' && !SALE_CATS.includes(e.category) && e.date === d).reduce((s2, e) => s2 + Number(e.amount), 0),
      exp: ins.filter((x) => x.date === d).reduce((s2, x) => s2 + Number(x.spend), 0) + entries.filter((e) => e.kind === 'despesa' && e.date === d).reduce((s2, e) => s2 + Number(e.amount), 0)
    };
  });
  const W = Math.max(320, host.clientWidth); const H = 240; const padL = 58; const padB = 24; const padT = 10;
  const maxV = Math.max(1, ...data.map((x) => Math.max(x.rev, x.exp)));
  const p = Math.pow(10, Math.floor(Math.log10(maxV))); const max = [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= maxV);
  const iw = W - padL; const ih = H - padB - padT; const bw = iw / data.length; const gap = 2;
  const barW = Math.max(1, Math.min(14, (bw - 6) / 2));
  const y = (v) => padT + ih - (v / max) * ih;
  const bar = (x, v, cls, i) => { if (!v) return ''; const top = y(v); const h = padT + ih - top; const rr = Math.min(3, barW / 2, h); return `<path class="bar ${cls}" data-i="${i}" d="M${x},${padT + ih} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + barW - rr} Q${x + barW},${top} ${x + barW},${top + rr} V${padT + ih} Z"/>`; };
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 64)));
  const short = (v) => v >= 1000 ? 'R$' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : 'R$' + Math.round(v);
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Faturamento e custos por dia">
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
    tip.innerHTML = `<div class="muted">${new Date(x.d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</div>Faturamento <b>${brl(x.rev)}</b><br>Custos <b>${brl(x.exp)}</b><br><span class="muted">Resultado ${brl(x.rev - x.exp)}</span>`;
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / W;
    tip.style.left = Math.min(Math.max((padL + i * bw + bw / 2) * scale, 80), host.clientWidth - 80) + 'px';
    tip.style.top = y(Math.max(x.rev, x.exp)) * scale + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; host.querySelectorAll('.bar').forEach((b) => b.classList.remove('dim')); });
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
