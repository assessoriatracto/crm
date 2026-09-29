// Dashboard: visão executiva e enxuta da saúde do negócio.
// O detalhe (campanhas, lançamentos, gráficos por dia) fica no Financeiro e na Central de leads.
import { DB } from '@shared/db.js';
import { PERIOD, dateRange, datePicker, dateBtn, S, $, $$, esc, ICON, brl, num, isDue, isInactive, fail, fmtDays } from './util.js?v=2609291415';

const D = PERIOD;
const DAY = 86400000;
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const SALE_CATS = ['Venda (contrato)', 'Contrato'];

// ---------- contratos (clientes): vendas do CRM + vendas lançadas no Financeiro ----------
// contratos (clientes): vendas do CRM + vendas lançadas no Financeiro. Usado também na aba Clientes do Financeiro.
export function contracts(entries, months) {
  const out = [];
  const org = (x) => ({ utm_campaign: x?.utm_campaign || null, utm_term: x?.utm_term || null, utm_content: x?.utm_content || null, utm_id: x?.utm_id || null });
  S.leads.filter((l) => l.won_at && Number(l.valor) > 0).forEach((l) => out.push({
    id: l.id, kind: 'lead', lead: l, name: l.nome, start: new Date(l.won_at), monthly: Number(l.valor), months: l.plan === 'unico' ? 1 : Number(l.contract_months || months), plan: l.plan || null, service: l.service || null,
    canceled: l.canceled_at ? new Date(l.canceled_at + 'T12:00') : null, reason: l.cancel_reason || '', origin: org(l), sent: true
  }));
  entries.filter((e) => e.kind === 'receita' && SALE_CATS.includes(e.category)).forEach((e) => {
    const l = e.lead_id ? S.leads.find((x) => x.id === e.lead_id) : null;
    const o = org(e); const lo = org(l);
    out.push({
      id: e.id, kind: 'entry', entry: e, lead: l, name: e.description || l?.nome || 'Venda lançada', start: new Date(e.date + 'T12:00'),
      monthly: e.plan === 'unico' ? Number(e.amount) : Number(e.monthly_amount || (e.months ? e.amount / e.months : e.amount)), months: e.plan === 'unico' ? 1 : Number(e.months || months), plan: e.plan || null, service: e.service || null,
      canceled: e.canceled_at ? new Date(e.canceled_at + 'T12:00') : null, reason: e.cancel_reason || '',
      origin: o.utm_campaign || o.utm_id ? o : lo, sent: !!e.meta_sent_at
    });
  });
  // mensal renova até cancelar; pagamento único não entra na receita recorrente
  out.forEach((c) => {
    c.oneTime = c.plan === 'unico';
    c.end = c.oneTime ? new Date(c.start) : c.plan === 'mensal' ? new Date(c.start.getTime() + 1200 * 30.44 * DAY) : new Date(c.start.getTime() + c.months * 30.44 * DAY);
  });
  return out;
}
// a venda veio de anúncio? (tem campanha, ou o contato chegou por tráfego pago)
// venda de anúncio: tudo que não foi marcado como indicação/orgânico (a captação da Tracto é por anúncio)
export const isOrganic = (c) => (c.kind === 'entry' ? c.entry?.source === 'organico' : c.lead?.source === 'organico' || c.lead?.source === 'manual');
export const hasOrigin = (c) => !!(c.origin?.utm_campaign || c.origin?.utm_id);
export const fromAds = (c) => !isOrganic(c);
export const activeAt = (c, t) => !c.oneTime && c.start <= t && c.end > t && (!c.canceled || c.canceled > t);

function metrics(ins, leads, a, b, contractsList, useMeta) {
  const inR = (d) => d >= a && d <= b;
  const insR = ins.filter((x) => { const d = new Date(x.date + 'T12:00'); return inR(d); });
  const spend = insR.reduce((s, x) => s + Number(x.spend), 0);
  const metaLeads = insR.reduce((s, x) => s + Number(x.meta_leads || 0), 0);
  const junkId = S.stages.find((x) => x.name === 'Descarte')?.id;
  const cohort = leads.filter((l) => l.stage_id !== junkId && inR(new Date(l.created_at)));
  const crmLeads = cohort.length;
  // conversão por coorte: dos leads que chegaram no período, quantos já viraram cliente (pelo pipeline ou venda ligada ao contato)
  const clientLeadIds = new Set(contractsList.filter((c) => c.lead).map((c) => c.lead.id));
  const cohortWon = cohort.filter((l) => l.won_at || clientLeadIds.has(l.id)).length;
  const nLeads = useMeta ? metaLeads : crmLeads; // mesma fonte nos dois períodos (comparação justa)
  const news = contractsList.filter((c) => inR(c.start));
  const newValue = news.reduce((s, c) => s + c.monthly * c.months, 0);
  // CAC e ROAS só com vendas que vieram de anúncio (venda por indicação/fora do tráfego não entra)
  const adsNews = news.filter(fromAds);
  const adsValue = adsNews.reduce((s, c) => s + c.monthly * c.months, 0);
  const activeStart = contractsList.filter((c) => activeAt(c, a));
  const canceled = contractsList.filter((c) => c.canceled && inR(c.canceled));
  const activeEnd = contractsList.filter((c) => activeAt(c, b));
  const mrr = activeEnd.reduce((s, c) => s + c.monthly, 0);
  // tempo até a venda: do dia em que virou lead até a venda (só vendas ligadas a um lead)
  const ttc = news.filter((c) => c.lead).map((c) => Math.max(0, (c.start - new Date(c.lead.created_at)) / DAY)).sort((x, y) => x - y);
  const ttcAvg = ttc.length ? ttc.reduce((s, d) => s + d, 0) / ttc.length : null;
  const ttcMed = ttc.length ? (ttc.length % 2 ? ttc[(ttc.length - 1) / 2] : (ttc[ttc.length / 2 - 1] + ttc[ttc.length / 2]) / 2) : null;
  return {
    spend, nLeads, crmLeads, hasAds: insR.length > 0,
    cpl: nLeads ? spend / nLeads : null,
    newClients: news.length, newMrr: news.reduce((s, c) => s + c.monthly, 0), newValue,
    adsClients: adsNews.length, adsValue, cohortWon,
    cac: adsNews.length && spend ? spend / adsNews.length : null,
    roas: spend ? adsValue / spend : null,
    // conversão: clientes do período ÷ leads do período (mesma base do card Leads)
    conv: nLeads ? news.length / nLeads : null,
    noOrigin: adsNews.filter((c) => !hasOrigin(c)).length,
    active: activeEnd.length, mrr, ticket: activeEnd.length ? mrr / activeEnd.length : null,
    churnN: canceled.length, churn: activeStart.length ? canceled.length / activeStart.length : null,
    churnMrr: canceled.reduce((s, c) => s + c.monthly, 0),
    ttcAvg, ttcMed, ttcN: ttc.length, ttcMin: ttc.length ? ttc[0] : null
  };
}

// resultado do período: receita pelo que cada contrato rende nos dias do período (mensalidade proporcional),
// pagamentos únicos e outras receitas, menos anúncios e despesas lançadas (fixas e variáveis)
export function result(ins, entries, list, a, b) {
  const inR = (d) => d >= a && d <= b;
  const dIso = (x) => new Date(x + 'T12:00');
  let recurring = 0;
  list.filter((c) => !c.oneTime).forEach((c) => {
    const s0 = Math.max(c.start, a); const s1 = Math.min(c.end, c.canceled || Infinity, b);
    if (s1 > s0) recurring += c.monthly * ((s1 - s0) / (30.44 * DAY));
  });
  const once = list.filter((c) => c.oneTime && inR(c.start)).reduce((s, c) => s + c.monthly, 0);
  const other = entries.filter((e) => e.kind === 'receita' && !SALE_CATS.includes(e.category) && inR(dIso(e.date))).reduce((s, e) => s + Number(e.amount), 0);
  const exp = entries.filter((e) => e.kind === 'despesa' && inR(dIso(e.date)));
  const fixed = exp.filter((e) => e.expense_type === 'fixa' || e.recurring_id).reduce((s, e) => s + Number(e.amount), 0);
  const variable = exp.reduce((s, e) => s + Number(e.amount), 0) - fixed;
  const ads = ins.filter((x) => inR(dIso(x.date))).reduce((s, x) => s + Number(x.spend), 0);
  const revenue = recurring + once + other; const costs = ads + fixed + variable;
  return { revenue, recurring, once, other, ads, fixed, variable, costs, profit: revenue - costs, margin: revenue ? (revenue - costs) / revenue : null };
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

  let ins = [], entries = [], settings = null, partials = [], recur = [];
  try {
    if (canMoney) await DB.runRecurring?.();
    [ins, entries, settings, partials, recur] = await Promise.all([
      canMoney ? DB.listInsights(iso(pa), iso(b)).catch(() => []) : [],
      canMoney ? DB.listFinance('2000-01-01', iso(new Date())).catch(() => []) : [],
      canMoney ? DB.getTracking().catch(() => null) : null,
      DB.listPartials().catch(() => []),
      canMoney && DB.listRecurring ? DB.listRecurring().catch(() => []) : []
    ]);
  } catch (e) { fail(e); }
  if (!el.isConnected) return;

  const months = settings?.contract_months || 12;
  // MRR e clientes ativos são a carteira no fim do período (hoje, ou o último dia escolhido)
  const endLabel = rb && iso(rb) < iso(new Date()) ? 'em ' + rb.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : 'hoje';
  const list = contracts(entries, months);
  const useMeta = ins.length > 0;
  const cur = metrics(ins, S.leads, a, b, list, useMeta);
  const prev = metrics(ins, S.leads, pa, pb, list, useMeta);
  const res = result(ins, entries, list, a, b);
  const resPrev = result(ins, entries, list, pa, pb);
  const today = new Date();
  const fixedMonthly = recur.filter((r) => r.active && (!r.end_date || new Date(r.end_date + 'T12:00') >= today)).reduce((s, r) => s + Number(r.amount), 0);
  const need = fixedMonthly && cur.ticket ? Math.ceil(fixedMonthly / cur.ticket) : null;
  const cacFull = cur.newClients && res.costs ? res.costs / cur.newClients : null;
  const ltv = cur.ticket && list.length ? cur.ticket * (list.reduce((s, c) => s + c.months, 0) / list.length) : null;

  // funil do período
  const leadsR = S.leads.filter((l) => { const d = new Date(l.created_at); return d >= a && d <= b; });
  const open = S.stages.filter((s) => s.kind === 'open').sort((x, y) => x.position - y.position);
  const qualIdx = Math.max(0, open.findIndex((s) => /qualific/i.test(s.name)));
  const meetIdx = open.findIndex((s) => /reuni|agend/i.test(s.name));
  const posOf = (l) => { const s = S.stages.find((x) => x.id === l.stage_id); return s ? (s.kind === 'won' ? 999 : s.kind === 'lost' ? -1 : open.indexOf(s)) : 0; };
  const junkId = S.stages.find((x) => x.name === 'Descarte')?.id;
  const leadsOk = leadsR.filter((l) => l.stage_id !== junkId);
  const raw = [
    ['Leads', canMoney ? cur.nLeads : leadsOk.length],
    ['Em atendimento', leadsOk.filter((l) => posOf(l) >= 1 || l.won_at).length],
    ['Qualificados', leadsOk.filter((l) => posOf(l) >= Math.max(qualIdx, 1) || l.won_at).length],
    ...(meetIdx > 0 ? [['Reunião agendada', leadsOk.filter((l) => posOf(l) >= meetIdx || l.won_at).length]] : []),
    ['Viraram clientes', canMoney ? cur.newClients : cur.cohortWon]
  ];
  // cada etapa inclui quem já passou dela (quem comprou também foi atendido, qualificado…)
  const funnel = raw.map(([n, v]) => [n, v]);
  for (let k = funnel.length - 2; k >= 1; k--) funnel[k][1] = Math.max(funnel[k][1], funnel[k + 1][1]);
  funnel[0][1] = Math.max(funnel[0][1], funnel[1]?.[1] || 0);

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
    <h2 class="dash-h">Receita recorrente <span>carteira ${endLabel} · entradas e saídas no período</span></h2>
    <div class="kx-grid kx-4">
      ${kpi(`Receita mensal (MRR) ${endLabel}`, brl(cur.mrr), `${cur.newMrr ? '+' + brl(cur.newMrr) + ' em contratos fechados no período' : 'nenhum contrato fechado no período'}${cur.churnMrr ? ` · −${brl(cur.churnMrr)} cancelados` : ''}`, delta(cur.mrr, prev.mrr), 'accent')}
      ${kpi(`Clientes ativos ${endLabel}`, num(cur.active), `${cur.newClients ? '+' + num(cur.newClients) + ' novo' + (cur.newClients === 1 ? '' : 's') + ' no período' : 'nenhum cliente novo no período'}${cur.churnN ? ` · −${num(cur.churnN)} cancelado${cur.churnN === 1 ? '' : 's'}` : ''}`, delta(cur.active, prev.active))}
      ${kpi('Ticket médio', money(cur.ticket), ltv ? `LTV estimado ${brl(ltv)}` : 'por cliente, ao mês', delta(cur.ticket, prev.ticket))}
      ${kpi('Churn', pctTxt(cur.churn), cur.churnN ? `${num(cur.churnN)} cancelamento${cur.churnN === 1 ? '' : 's'} no período` : 'nenhum cancelamento no período', delta(cur.churn, prev.churn, 'down', true))}
    </div>
    <h2 class="dash-h">Resultado <span>no período · receita dos contratos menos anúncios e despesas</span></h2>
    <div class="kx-grid kx-4">
      ${kpi('Lucro líquido', brl(res.profit), `margem ${pctTxt(res.margin)} · receita ${brl(res.revenue)}`, delta(res.profit, resPrev.profit), res.profit < 0 ? 'neg' : '')}
      ${kpi('Custos do período', brl(res.costs), res.costs ? `anúncios ${brl(res.ads)} · fixas ${brl(res.fixed)} · variáveis ${brl(res.variable)}` : 'nenhum custo no período', delta(res.costs, resPrev.costs, 'down'))}
      ${kpi('Custo fixo mensal', brl(fixedMonthly), fixedMonthly ? `${num(recur.filter((r) => r.active).length)} despesa${recur.filter((r) => r.active).length === 1 ? '' : 's'} fixa${recur.filter((r) => r.active).length === 1 ? '' : 's'} ativa${recur.filter((r) => r.active).length === 1 ? '' : 's'}` : 'cadastre em Financeiro › Despesas')}
      ${kpi('Ponto de equilíbrio', need == null ? '—' : `${num(need)} cliente${need === 1 ? '' : 's'}`, need == null ? (fixedMonthly ? 'sem ticket médio ainda' : 'precisa das despesas fixas') : `pra cobrir os custos fixos · você tem ${num(cur.active)} ativo${cur.active === 1 ? '' : 's'}`, '', need != null ? (cur.active >= need ? 'ok' : 'warn') : '')}
    </div>
    <h2 class="dash-h">Aquisição <span>no período</span></h2>
    <div class="kx-grid kx-4">
      ${kpi('Investimento', brl(cur.spend), cur.hasAds ? 'Meta Ads' : 'sem campanhas no período', delta(cur.spend, prev.spend, null))}
      ${kpi('Leads', num(cur.nLeads), cur.hasAds ? `resultados da Meta · ${num(cur.crmLeads)} no CRM` : 'no CRM', delta(cur.nLeads, prev.nLeads))}
      ${kpi('Custo por lead', money(cur.cpl), 'investimento ÷ leads', delta(cur.cpl, prev.cpl, 'down'))}
      ${kpi('Novos clientes', num(cur.newClients), cur.newClients ? `${brl(cur.newValue)} em contratos${cur.newClients - cur.adsClients ? ` · ${num(cur.newClients - cur.adsClients)} indicação/orgânico` : ''}` : 'nenhum contrato fechado no período', delta(cur.newClients, prev.newClients))}
      ${kpi('Taxa de conversão', pctTxt(cur.conv), cur.nLeads ? `${num(cur.newClients)} cliente${cur.newClients === 1 ? '' : 's'} de ${num(cur.nLeads)} leads no período` : 'nenhum lead no período', delta(cur.conv, prev.conv, 'up', true))}
      ${kpi('Tempo até a venda', cur.ttcAvg == null ? '—' : fmtDays(cur.ttcAvg), cur.ttcAvg == null ? (cur.newClients ? 'ligue o contato do cliente em Financeiro › Clientes' : 'média de lead a venda') : `média · mediana ${fmtDays(cur.ttcMed)} · ${num(cur.ttcN)} venda${cur.ttcN === 1 ? '' : 's'}`, delta(cur.ttcAvg, prev.ttcAvg, 'down'))}
      ${kpi('CAC', money(cur.cac), cur.cac == null ? (cur.spend ? 'nenhum cliente de anúncio no período' : 'sem investimento no período') : `${ltv ? `LTV:CAC ${(ltv / cur.cac).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x · ` : ''}investimento ÷ ${num(cur.adsClients)} cliente${cur.adsClients === 1 ? '' : 's'}${cacFull ? ` · com todos os custos ${brl(cacFull)}` : ''}`, delta(cur.cac, prev.cac, 'down'))}
      ${kpi('ROAS', cur.roas == null ? '—' : cur.roas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'x', cur.adsClients ? `${brl(cur.adsValue)} em contratos ÷ investimento${cur.noOrigin ? ` · ${num(cur.noOrigin)} sem campanha definida` : ''}` : 'contratos fechados ÷ investimento', delta(cur.roas, prev.roas))}
    </div>` : ''}
    <div class="dash-row ${canMoney ? '' : 'two'}">
      <section class="panel dcard">
        <div class="dcard-h"><h3>Funil do período</h3><a class="link" href="/leads">Central de leads</a></div>
        <div class="fz" style="--n:${funnel.length}">
          <div class="fz-shape">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs><linearGradient id="fzGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="fz-s1"/><stop offset="1" class="fz-s2"/></linearGradient></defs>
              <clipPath id="fzClip"><path d="M2.5 0 H97.5 Q100 0 98.9 2.3 L53.2 95.5 Q50 101.5 46.8 95.5 L1.1 2.3 Q0 0 2.5 0 Z"/></clipPath>
              <g clip-path="url(#fzClip)">${funnel.map((_, k) => `<rect x="0" y="${(k / funnel.length) * 100}" width="100" height="${100 / funnel.length + 0.4}" class="fz-b fz-b${Math.min(k, 5)}" style="--t:${funnel.length > 1 ? k / (funnel.length - 1) : 0}"/>`).join('')}</g>
              ${funnel.slice(1).map((_, k) => `<line x1="0" x2="100" y1="${((k + 1) / funnel.length) * 100}" y2="${((k + 1) / funnel.length) * 100}" class="fz-gap" vector-effect="non-scaling-stroke"/>`).join('')}
            </svg>
            ${funnel.map(([, v], k) => `<b class="fz-num" style="top:${((k + 0.46) / funnel.length) * 100}%">${num(v)}</b>`).join('')}
          </div>
          <div class="fz-labels">${funnel.map(([n, v], k) => `<div class="fz-l"><span>${n}</span><small>${k ? `${pctTxt(funnel[0][1] ? v / funnel[0][1] : null)} dos leads` : '100% · base do funil'}</small></div>`).join('')}</div>
        </div>
      </section>
      <section class="panel dcard">
        <div class="dcard-h"><h3>Precisa de atenção</h3></div>
        <div class="att">${attention.map(([n, v, href, hint]) => `<a class="att-row ${v ? 'hot' : ''}" href="${href}"><span class="att-n">${num(v)}</span><span class="att-t"><b>${n}</b><small>${v ? hint : 'Tudo em dia'}</small></span>${ICON.caret}</a>`).join('')}</div>
      </section>
      ${canMoney ? `<section class="panel dcard">
        <div class="dcard-h"><h3>Contratos a vencer</h3><span class="muted">próximos 45 dias</span></div>
        ${soon.length ? `<div class="soon">${soon.map((c) => `<div class="soon-row"><span class="soon-d">${fmtDate(c.end)}</span><span class="soon-t"><b title="${esc(c.name)}">${esc(c.name)}</b><small>${brl(c.monthly)}/mês</small></span></div>`).join('')}</div>`
          : '<p class="muted empty-line">Nenhum contrato vence nos próximos 45 dias.</p>'}
        <p class="help" style="margin:10px 0 0">Cancelamentos e origem das vendas ficam em <a class="link" href="/financeiro" data-go-clients>Financeiro › Clientes</a>.</p>
      </section>` : ''}
    </div>`;
  el.querySelector('[data-date]').addEventListener('click', (e) => datePicker(e.currentTarget, D, (st) => { Object.assign(D, st); renderDashboard(el); }));
  el.querySelector('[data-go-clients]')?.addEventListener('click', () => { try { sessionStorage.setItem('tracto_fin_tab', 'clientes'); } catch (e) {} });
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
