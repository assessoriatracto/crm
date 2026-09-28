// Dashboard: visão executiva e enxuta da saúde do negócio.
// O detalhe (campanhas, lançamentos, gráficos por dia) fica no Financeiro e na Central de leads.
import { DB } from '@shared/db.js';
import { dateRange, datePicker, dateBtn, S, $, $$, esc, ICON, brl, num, isDue, isInactive, fail } from './util.js?v=2609282004';

const D = { period: '30', from: '', to: '' };
const DAY = 86400000;
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const SALE_CATS = ['Venda (contrato)', 'Contrato'];

// ---------- contratos (clientes): vendas do CRM + vendas lançadas no Financeiro ----------
function contracts(entries, months) {
  const out = [];
  S.leads.filter((l) => l.won_at && Number(l.valor) > 0).forEach((l) => out.push({
    id: l.id, name: l.nome, start: new Date(l.won_at), monthly: Number(l.valor), months,
    canceled: l.canceled_at ? new Date(l.canceled_at + 'T12:00') : null, lead: l.id
  }));
  entries.filter((e) => e.kind === 'receita' && SALE_CATS.includes(e.category)).forEach((e) => out.push({
    id: e.id, name: e.description || 'Venda lançada', start: new Date(e.date + 'T12:00'),
    monthly: Number(e.monthly_amount || (e.months ? e.amount / e.months : e.amount)), months: Number(e.months || months),
    canceled: e.canceled_at ? new Date(e.canceled_at + 'T12:00') : null
  }));
  out.forEach((c) => { c.end = new Date(c.start.getTime() + c.months * 30.44 * DAY); });
  return out;
}
const activeAt = (c, t) => c.start <= t && c.end > t && (!c.canceled || c.canceled > t);

function metrics(ins, leads, a, b, contractsList, useMeta) {
  const inR = (d) => d >= a && d <= b;
  const insR = ins.filter((x) => { const d = new Date(x.date + 'T12:00'); return inR(d); });
  const spend = insR.reduce((s, x) => s + Number(x.spend), 0);
  const metaLeads = insR.reduce((s, x) => s + Number(x.meta_leads || 0), 0);
  const crmLeads = leads.filter((l) => inR(new Date(l.created_at))).length;
  const nLeads = useMeta ? metaLeads : crmLeads; // mesma fonte nos dois períodos (comparação justa)
  const news = contractsList.filter((c) => inR(c.start));
  const newValue = news.reduce((s, c) => s + c.monthly * c.months, 0);
  const activeStart = contractsList.filter((c) => activeAt(c, a));
  const canceled = contractsList.filter((c) => c.canceled && inR(c.canceled));
  const activeEnd = contractsList.filter((c) => activeAt(c, b));
  const mrr = activeEnd.reduce((s, c) => s + c.monthly, 0);
  return {
    spend, nLeads, crmLeads, hasAds: insR.length > 0,
    cpl: nLeads ? spend / nLeads : null,
    newClients: news.length, newMrr: news.reduce((s, c) => s + c.monthly, 0), newValue,
    cac: news.length && spend ? spend / news.length : null,
    roas: spend ? newValue / spend : null,
    conv: nLeads ? news.length / nLeads : null,
    active: activeEnd.length, mrr, ticket: activeEnd.length ? mrr / activeEnd.length : null,
    churnN: canceled.length, churn: activeStart.length ? canceled.length / activeStart.length : null,
    churnMrr: canceled.reduce((s, c) => s + c.monthly, 0)
  };
}

// variação contra o período anterior (good: 'up' = subir é bom, 'down' = cair é bom, null = neutro)
const ARROW = {
  up: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>'
};
function delta(cur, prev, good = 'up', pp = false) {
  if (cur == null || prev == null) return '';
  const diff = pp ? (cur - prev) * 100 : prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
  if (diff == null || !Number.isFinite(diff)) return ''; // sem base de comparação
  if (Math.abs(diff) < 0.5) return '<span class="dl">estável</span>';
  const upDir = diff > 0;
  const cls = good == null ? '' : (upDir === (good === 'up') ? 'good' : 'bad');
  return `<span class="dl ${cls}" title="Comparado ao período anterior">${upDir ? ARROW.up : ARROW.down}${Math.abs(diff).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${pp ? ' p.p.' : '%'}</span>`;
}
const pctTxt = (v) => (v == null ? '—' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
const money = (v) => (v == null ? '—' : brl(v));
const kpi = (label, value, sub, dl = '', cls = '') => `<section class="panel kx ${cls}"><span class="kx-l" title="${label}">${label}</span><div class="kx-vr"><span class="kx-v">${value}</span>${dl}</div><div class="kx-s">${sub}</div></section>`;

export async function renderDashboard(el) {
  const canMoney = ['admin', 'gestor'].includes(S.me?.role);
  const [ra, rb] = dateRange(D);
  const b = rb || new Date();
  const a = ra || new Date(Math.min(...S.leads.map((l) => new Date(l.created_at).getTime()), b.getTime() - 30 * DAY));
  const len = b - a;
  const pa = new Date(a.getTime() - len); const pb = new Date(a.getTime() - 1);

  el.innerHTML = `<div class="topline"><h1>Dashboard</h1><div class="grow"></div>${dateBtn(D)}</div><div class="loading">Carregando…</div>`;
  el.querySelector('[data-date]').addEventListener('click', (e) => datePicker(e.currentTarget, D, (st) => { Object.assign(D, st); renderDashboard(el); }));

  let ins = [], entries = [], settings = null, partials = [];
  try {
    [ins, entries, settings, partials] = await Promise.all([
      canMoney ? DB.listInsights(iso(pa), iso(b)).catch(() => []) : [],
      canMoney ? DB.listFinance('2000-01-01', iso(new Date())).catch(() => []) : [],
      canMoney ? DB.getTracking().catch(() => null) : null,
      DB.listPartials().catch(() => [])
    ]);
  } catch (e) { fail(e); }
  if (!el.isConnected) return;

  const months = settings?.contract_months || 12;
  const list = contracts(entries, months);
  const useMeta = ins.length > 0;
  const cur = metrics(ins, S.leads, a, b, list, useMeta);
  const prev = metrics(ins, S.leads, pa, pb, list, useMeta);
  const ltv = cur.ticket && list.length ? cur.ticket * (list.reduce((s, c) => s + c.months, 0) / list.length) : null;

  // funil do período
  const leadsR = S.leads.filter((l) => { const d = new Date(l.created_at); return d >= a && d <= b; });
  const open = S.stages.filter((s) => s.kind === 'open').sort((x, y) => x.position - y.position);
  const qualIdx = Math.max(0, open.findIndex((s) => /qualific/i.test(s.name)));
  const meetIdx = open.findIndex((s) => /reuni|agend/i.test(s.name));
  const posOf = (l) => { const s = S.stages.find((x) => x.id === l.stage_id); return s ? (s.kind === 'won' ? 999 : s.kind === 'lost' ? -1 : open.indexOf(s)) : 0; };
  const funnel = [
    ['Leads', leadsR.length],
    ['Em atendimento', leadsR.filter((l) => posOf(l) >= 1 || l.won_at).length],
    ['Qualificados', leadsR.filter((l) => posOf(l) >= Math.max(qualIdx, 1) || l.won_at).length],
    ...(meetIdx > 0 ? [['Reunião agendada', leadsR.filter((l) => posOf(l) >= meetIdx || l.won_at).length]] : []),
    ['Vendas', leadsR.filter((l) => l.won_at).length]
  ];

  // precisa de atenção (agora)
  const openLeads = S.leads.filter((l) => { const k = S.stages.find((s) => s.id === l.stage_id)?.kind; return k !== 'won' && k !== 'lost'; });
  const attention = [
    ['Lembretes vencidos', S.leads.filter(isDue).length, '/leads', 'Retorne hoje'],
    ['Leads sem responsável', openLeads.filter((l) => !l.assigned_to).length, '/leads', 'Distribua pra equipe'],
    ['Sem contato há 7+ dias', openLeads.filter(isInactive).length, '/leads', 'Risco de esfriar'],
    ['Formulários incompletos', partials.filter((p) => ['em_andamento', 'abandonado'].includes(p.status) && (p.whatsapp || p.email)).length, '/recuperacao', 'Com contato pra recuperar']
  ];
  const soon = canMoney ? list.filter((c) => activeAt(c, new Date()) && c.end - Date.now() < 45 * DAY).sort((x, y) => x.end - y.end).slice(0, 6) : [];

  const fmtDate = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  el.innerHTML = `
    <div class="topline"><h1>Dashboard</h1><div class="grow"></div>${dateBtn(D)}</div>
    ${canMoney ? `
    <h2 class="dash-h">Receita recorrente <span>hoje</span></h2>
    <div class="kx-grid kx-4">
      ${kpi('Receita mensal (MRR)', brl(cur.mrr), `${cur.newMrr ? '+' + brl(cur.newMrr) + ' em novos contratos' : 'sem contratos novos'}${cur.churnMrr ? ` · −${brl(cur.churnMrr)} cancelados` : ''}`, delta(cur.mrr, prev.mrr), 'accent')}
      ${kpi('Clientes ativos', num(cur.active), `${cur.newClients ? '+' + num(cur.newClients) + ' novo' + (cur.newClients === 1 ? '' : 's') : 'nenhum cliente novo'}${cur.churnN ? ` · −${num(cur.churnN)} cancelado${cur.churnN === 1 ? '' : 's'}` : ''}`, delta(cur.active, prev.active))}
      ${kpi('Ticket médio', money(cur.ticket), ltv ? `LTV estimado ${brl(ltv)}` : 'por cliente, ao mês', delta(cur.ticket, prev.ticket))}
      ${kpi('Churn', pctTxt(cur.churn), cur.churnN ? `${num(cur.churnN)} cancelamento${cur.churnN === 1 ? '' : 's'} no período` : 'nenhum cancelamento no período', delta(cur.churn, prev.churn, 'down', true))}
    </div>
    <h2 class="dash-h">Aquisição <span>no período</span></h2>
    <div class="kx-grid kx-6">
      ${kpi('Investimento', brl(cur.spend), cur.hasAds ? 'Meta Ads' : 'sem campanhas no período', delta(cur.spend, prev.spend, null))}
      ${kpi('Leads', num(cur.nLeads), cur.hasAds ? `resultados da Meta · ${num(cur.crmLeads)} no CRM` : 'no CRM', delta(cur.nLeads, prev.nLeads))}
      ${kpi('Custo por lead', money(cur.cpl), 'investimento ÷ leads', delta(cur.cpl, prev.cpl, 'down'))}
      ${kpi('Novos clientes', num(cur.newClients), `conversão ${pctTxt(cur.conv)} dos leads`, delta(cur.newClients, prev.newClients))}
      ${kpi('CAC', money(cur.cac), ltv && cur.cac ? `LTV:CAC ${(ltv / cur.cac).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x` : 'investimento ÷ novos clientes', delta(cur.cac, prev.cac, 'down'))}
      ${kpi('ROAS', cur.roas == null ? '—' : cur.roas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'x', `${brl(cur.newValue)} em contratos fechados`, delta(cur.roas, prev.roas))}
    </div>` : ''}
    <div class="dash-row ${canMoney ? '' : 'two'}">
      <section class="panel dcard">
        <div class="dcard-h"><h3>Funil do período</h3><a class="link" href="/leads">Central de leads</a></div>
        <div class="fnl">${funnel.map(([n, v], i) => {
          const base = funnel[0][1] || 1; const prevStep = i ? funnel[i - 1][1] : null;
          return `<div class="fnl-row"><div class="fnl-l"><span>${n}</span><b>${num(v)}</b></div>
            <div class="fnl-bar"><span style="width:${Math.max(v ? 3 : 0, (v / base) * 100)}%"></span></div>
            <small>${i ? `${pctTxt(prevStep ? v / prevStep : null)} da etapa anterior` : 'entraram no período'}</small></div>`;
        }).join('')}</div>
      </section>
      <section class="panel dcard">
        <div class="dcard-h"><h3>Precisa de atenção</h3></div>
        <div class="att">${attention.map(([n, v, href, hint]) => `<a class="att-row ${v ? 'hot' : ''}" href="${href}"><span class="att-n">${num(v)}</span><span class="att-t"><b>${n}</b><small>${v ? hint : 'Tudo em dia'}</small></span>${ICON.caret}</a>`).join('')}</div>
      </section>
      ${canMoney ? `<section class="panel dcard">
        <div class="dcard-h"><h3>Contratos a vencer</h3><span class="muted">próximos 45 dias</span></div>
        ${soon.length ? `<div class="soon">${soon.map((c) => `<div class="soon-row"><span class="soon-d">${fmtDate(c.end)}</span><span class="soon-t"><b title="${esc(c.name)}">${esc(c.name)}</b><small>${brl(c.monthly)}/mês</small></span></div>`).join('')}</div>`
          : '<p class="muted empty-line">Nenhum contrato vence nos próximos 45 dias.</p>'}
        <p class="help" style="margin:10px 0 0">Registre cancelamentos no lead (Contrato cancelado em) ou no lançamento da venda, pra o churn ficar certo.</p>
      </section>` : ''}
    </div>`;
  el.querySelector('[data-date]').addEventListener('click', (e) => datePicker(e.currentTarget, D, (st) => { Object.assign(D, st); renderDashboard(el); }));
}

// barras horizontais (usadas também em Integrações)
export function hbars(host, rows, { max } = {}) {
  if (!rows.length || rows.every((r) => !r.value)) { host.innerHTML = '<p class="muted">Sem dados no período.</p>'; return; }
  const m = max || Math.max(...rows.map((r) => r.value), 1);
  host.innerHTML = `<div class="hbars">${rows.map((r) => `
    <div class="hb" title="${esc(r.name)}: ${num(r.value)}${r.note ? ' (' + r.note + ')' : ''}">
      <span class="n">${esc(r.name)}</span>
      <span class="track"><span class="fill ${r.soft ? 'soft' : ''}" style="width:0;${r.color ? `background:${r.color}` : ''}"></span></span>
      <span class="v">${num(r.value)}${r.note ? `<small>${r.note}</small>` : ''}</span>
    </div>`).join('')}</div>`;
  requestAnimationFrame(() => $$('.fill', host).forEach((f, i) => { f.style.width = (rows[i].value / m) * 100 + '%'; }));
}
