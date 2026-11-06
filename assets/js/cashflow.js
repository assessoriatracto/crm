// Financeiro > Fluxo de caixa: o que entra e sai em cada mês, agenda de recebimentos pelo vencimento de cada cliente
// e previsão dos próximos 3 meses
import { DB } from '@shared/db.js';
import { esc, brl, fail, renderTicket } from './util.js?v=2611060733';
import { contracts, payments, result } from './dashboard.js?v=2611060733';
import { gradBars } from './board.js?v=2611060733';
import { contractTags } from './contract.js?v=2611060733';

const CF = { months: 6, all: false };
const DAYMS = 86400000;
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const MONTH = (d) => d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '').replace(' de ', '/');
const MONTH_LONG = (d) => d.toLocaleDateString('pt-BR', { month: 'long' });
const pctTxt = (v) => (v == null || !Number.isFinite(v) ? '—' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
const short = (v) => (Math.abs(v) >= 1000 ? 'R$' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : 'R$' + Math.round(v));
const tone = (v) => (v < 0 ? 'cf-neg' : v > 0 ? 'cf-pos' : '');
const sum = (arr) => arr.reduce((s, p) => s + p.amount, 0);
const ICON = {
  cal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
};

// texto da parcela: "1º semestre", "Mensalidade 2 de 6", "4ª mensalidade" (mensal sem fim) ou "Pagamento integral"
const parcela = (c, p) => {
  if (c.upfront) return 'Pagamento integral';
  const unit = c.plan === 'semestral' ? 'semestre' : c.plan === 'anual' ? 'ano' : null;
  if (unit) return `${p.n}º ${unit}${p.of > 1 ? ` de ${p.of}` : ''}`;
  return p.of ? `Mensalidade ${p.n} de ${p.of}` : `${p.n}ª mensalidade`;
};

export async function renderCashflow(host) {
  const stale = renderTicket(host);
  host.innerHTML = '<div class="loading">Carregando…</div>';
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const first = new Date(now.getFullYear(), now.getMonth() - CF.months + 1, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  let entries = [], ins = [], settings = null, recur = [];
  try {
    await DB.runRecurring();
    [entries, ins, settings, recur] = await Promise.all([
      DB.listFinance('2000-01-01', iso(lastOfMonth)), DB.listInsights(iso(new Date(first.getFullYear(), first.getMonth() - 3, 1)), iso(now)).catch(() => []),
      DB.getTracking().catch(() => null), DB.listRecurring().catch(() => [])
    ]);
  } catch (e) { fail(e); }
  if (stale()) return;
  const list = contracts(entries, settings?.contract_months || 12);
  const pays = (a, b) => list.flatMap((c) => payments(c, a, b).map((p) => ({ ...p, c })));

  // meses fechados e o atual: pelo que foi lançado e pelo vencimento de cada contrato
  const months = [];
  for (let k = 0; k < CF.months; k++) {
    const a = new Date(first.getFullYear(), first.getMonth() + k, 1);
    const b = new Date(a.getFullYear(), a.getMonth() + 1, 0, 23, 59, 59);
    months.push({ a, b, label: MONTH(a), current: k === CF.months - 1, ...result(ins, entries, list, a, b, 'caixa') });
  }
  // previsão: parcelas que vencem no mês + despesas fixas cadastradas + média dos 3 últimos meses fechados em anúncios e variáveis
  const closed = months.filter((m) => !m.current).slice(-3);
  const avg = (k) => (closed.length ? closed.reduce((s, m) => s + m[k], 0) / closed.length : 0);
  const adsAvg = avg('ads'); const varAvg = avg('variable');
  const fixedIn = (a, b) => recur.filter((r) => r.active && r.start_date <= iso(b) && (!r.end_date || r.end_date >= iso(a))).reduce((s, r) => s + Number(r.amount), 0);
  for (let k = 1; k <= 3; k++) {
    const a = new Date(now.getFullYear(), now.getMonth() + k, 1);
    const b = new Date(a.getFullYear(), a.getMonth() + 1, 0, 23, 59, 59);
    const ps = pays(a, b);
    const recurring = sum(ps.filter((p) => !p.c.upfront)); const once = sum(ps.filter((p) => p.c.upfront));
    const revenue = recurring + once; const fixed = fixedIn(a, b); const costs = adsAvg + fixed + varAvg;
    months.push({ a, b, label: MONTH(a), forecast: true, revenue, recurring, once, other: 0, ads: adsAvg, fixed, variable: varAvg, costs, profit: revenue - costs, margin: revenue ? (revenue - costs) / revenue : null });
  }
  let acc = 0; months.forEach((m) => { acc += m.profit; m.acc = acc; });

  const cur = months.find((m) => m.current);
  const next = months.find((m) => m.forecast);
  // mês atual: o que já venceu até hoje e o que ainda vence até o fim do mês
  const otherToDate = entries.filter((e) => e.kind === 'receita' && !['Venda (contrato)', 'Contrato'].includes(e.category) && e.date >= iso(monthStart) && e.date <= iso(now)).reduce((s, e) => s + Number(e.amount), 0);
  const gotPays = pays(monthStart, todayEnd);
  const got = sum(gotPays) + otherToDate;
  const restPays = pays(new Date(todayEnd.getTime() + 1000), lastOfMonth);
  const rest = sum(restPays);

  // agenda: próximos 45 dias
  const horizon = new Date(todayEnd.getTime() + 45 * DAYMS);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcoming = pays(todayStart, horizon).sort((x, y) => x.date - y.date || y.amount - x.amount);
  const upTotal = sum(upcoming);
  const shown = CF.all ? upcoming : upcoming.slice(0, 8);

  const ROWS = [
    ['Entradas', 'revenue', 'head'],
    ['Contratos de marketing', 'recurring'], ['Marketplace e pagamentos únicos', 'once'], ['Outras receitas', 'other'],
    ['Saídas', 'costs', 'head neg'],
    ['Anúncios (Meta)', 'ads'], ['Despesas fixas', 'fixed'], ['Despesas variáveis', 'variable'],
    ['Resultado', 'profit', 'total'], ['Margem', 'margin', 'pct'], ['Acumulado', 'acc', 'acc']
  ];
  const cell = (m, k, cls = '') => {
    const v = m[k];
    if (cls.includes('pct')) return `<span class="${tone(v)}">${pctTxt(v)}</span>`;
    const strong = /total|acc/.test(cls);
    if (!v && !strong) return '<span class="muted">—</span>';
    return `<span class="${strong ? tone(v) : ''}">${brl(v)}</span>`;
  };
  const dayTxt = (d) => {
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - todayStart) / DAYMS);
    return diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  };

  host.innerHTML = `
    <div class="kx-grid kx-4">
      <section class="panel kx accent"><span class="kx-l">Recebido em ${esc(MONTH_LONG(now))}</span><div class="kx-vr"><span class="kx-v">${brl(got)}</span></div><div class="kx-s">${gotPays.length} ${gotPays.length === 1 ? 'pagamento vencido' : 'pagamentos vencidos'} até hoje</div></section>
      <section class="panel kx"><span class="kx-l">A receber até ${esc(lastOfMonth.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))}</span><div class="kx-vr"><span class="kx-v">${brl(rest)}</span></div><div class="kx-s">${restPays.length ? `${restPays.length} ${restPays.length === 1 ? 'vencimento' : 'vencimentos'} no resto do mês` : 'nenhum vencimento no resto do mês'}</div></section>
      <section class="panel kx"><span class="kx-l">Resultado de ${esc(MONTH_LONG(now))}</span><div class="kx-vr"><span class="kx-v ${tone(cur.profit)}">${brl(cur.profit)}</span></div><div class="kx-s">entram ${brl(cur.revenue)} · saem ${brl(cur.costs)}</div></section>
      <section class="panel kx"><span class="kx-l">Previsão de ${esc(MONTH_LONG(next.a))}</span><div class="kx-vr"><span class="kx-v ${tone(next.profit)}">${brl(next.profit)}</span></div><div class="kx-s">entram ${brl(next.revenue)} · saem ${brl(next.costs)}</div></section>
    </div>

    <div class="cf-grid">
      <section class="panel chart-card">
        <div class="cf-head"><div><h3>Entradas e saídas por mês</h3><p class="sub">Barras claras são previsão</p></div>
          <div class="seg">${[[6, '6 meses'], [12, '12 meses']].map(([n, t]) => `<button class="b b-sm ${CF.months === n ? 'on' : ''}" data-cfm="${n}">${t}</button>`).join('')}</div></div>
        <div class="legend"><span><i style="background:var(--viz-1)"></i>Entradas</span><span><i style="background:var(--viz-neutral)"></i>Saídas</span></div>
        <div class="chart" data-cf-chart></div>
      </section>

      <section class="panel cf-up">
        <div class="cf-head"><div><h3>Próximos recebimentos</h3><p class="sub">Vencimentos dos próximos 45 dias</p></div><span class="cf-up-total">${brl(upTotal)}</span></div>
        ${upcoming.length ? `<ul class="cf-list">${shown.map((p) => `
          <li class="${p.date <= todayEnd ? 'today' : ''}">
            <div class="cf-date"><b>${p.date.getDate()}</b><span>${esc(p.date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''))}</span></div>
            <div class="cf-who"><div class="cf-name">${esc(p.c.name)}</div><div class="cf-meta">${esc(dayTxt(p.date))} · ${esc(parcela(p.c, p))} ${contractTags(p.c.service, null)}</div></div>
            <div class="cf-amt">${brl(p.amount)}</div>
          </li>`).join('')}</ul>
          ${upcoming.length > 8 ? `<button class="b b-sm b-ghost cf-more" data-cf-all>${CF.all ? 'Mostrar menos' : `Ver todos (${upcoming.length})`}</button>` : ''}`
        : `<div class="cf-empty">${ICON.cal}<div>Nenhum vencimento nos próximos 45 dias.<br><span class="muted">Ao lançar uma venda, informe o 1º pagamento e o dia do vencimento.</span></div></div>`}
      </section>
    </div>

    <section class="panel cf-card">
      <div class="cf-head"><div><h3>Demonstrativo mensal</h3><p class="sub">Entradas pelo vencimento de cada cliente, menos anúncios e despesas do mês</p></div></div>
      <div class="table-wrap cf-wrap"><table class="int-table cf-table">
        <thead><tr><th></th>${months.map((m) => `<th class="num ${m.forecast ? 'cf-fc' : ''} ${m.current ? 'cf-cur' : ''}">${esc(m.label)}${m.forecast ? '<small>previsão</small>' : m.current ? '<small>em andamento</small>' : ''}</th>`).join('')}</tr></thead>
        <tbody>${ROWS.map(([n, k, cls = '']) => `<tr class="cf-r-${cls.split(' ')[0] || 'row'}"><th scope="row">${n}</th>${months.map((m) => `<td class="num ${m.forecast ? 'cf-fc' : ''} ${m.current ? 'cf-cur' : ''}">${cell(m, k, cls)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="adt-note">Marketing entra mês a mês no dia do vencimento (mensais renovam até o cancelamento). Marketplace e pagamento único entram inteiros na data do 1º pagamento. A previsão soma as parcelas que vencem no mês, as despesas fixas cadastradas e a média dos últimos 3 meses de anúncios e despesas variáveis.</p>
    </section>`;

  host.querySelectorAll('[data-cfm]').forEach((b) => b.addEventListener('click', () => { CF.months = Number(b.dataset.cfm); renderCashflow(host); }));
  host.querySelector('[data-cf-all]')?.addEventListener('click', () => { CF.all = !CF.all; renderCashflow(host); });
  gradBars(host.querySelector('[data-cf-chart]'), {
    data: months, height: 250, aria: 'por mês', fmt: short, label: (x) => x.label, faded: (x) => !!x.forecast,
    series: [{ key: 'revenue', label: 'Entradas', cls: 'hot' }, { key: 'costs', label: 'Saídas', cls: 'rest' }],
    tip: (x) => `<div class="muted">${esc(x.label)}${x.forecast ? ' · previsão' : x.current ? ' · em andamento' : ''}</div>Entradas <b>${brl(x.revenue)}</b><br>Saídas <b>${brl(x.costs)}</b><br><span class="${tone(x.profit)}">Resultado ${brl(x.profit)}</span>`
  });
}
