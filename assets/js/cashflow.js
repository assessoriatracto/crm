// Financeiro > Fluxo de caixa: resultado mês a mês (DRE simples) e previsão dos próximos 3 meses
import { DB } from '@shared/db.js';
import { esc, brl, fail } from './util.js?v=2610020954';
import { contracts, received, result } from './dashboard.js?v=2610020954';

const CF = { months: 6 };
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const MONTH = (d) => d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '').replace(' de ', '/');
const pctTxt = (v) => (v == null || !Number.isFinite(v) ? '—' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
const short = (v) => (Math.abs(v) >= 1000 ? 'R$' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : 'R$' + Math.round(v));

export async function renderCashflow(host) {
  host.innerHTML = '<div class="loading">Carregando…</div>';
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - CF.months + 1, 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  let entries = [], ins = [], settings = null, recur = [];
  try {
    await DB.runRecurring();
    [entries, ins, settings, recur] = await Promise.all([
      DB.listFinance('2000-01-01', iso(lastOfMonth)), DB.listInsights(iso(new Date(first.getFullYear(), first.getMonth() - 3, 1)), iso(now)).catch(() => []),
      DB.getTracking().catch(() => null), DB.listRecurring().catch(() => [])
    ]);
  } catch (e) { fail(e); }
  if (!host.isConnected) return;
  const list = contracts(entries, settings?.contract_months || 12);

  // meses fechados e o atual (pelo que já foi lançado)
  const months = [];
  for (let k = 0; k < CF.months; k++) {
    const a = new Date(first.getFullYear(), first.getMonth() + k, 1);
    const b = new Date(a.getFullYear(), a.getMonth() + 1, 0, 23, 59, 59);
    months.push({ a, b, label: MONTH(a), current: k === CF.months - 1, ...result(ins, entries, list, a, b, 'caixa') });
  }
  // previsão: contratos ativos + despesas fixas cadastradas + média dos últimos 3 meses fechados em anúncios e variáveis
  const closed = months.filter((m) => !m.current).slice(-3);
  const avg = (k) => (closed.length ? closed.reduce((s, m) => s + m[k], 0) / closed.length : 0);
  const adsAvg = avg('ads'); const varAvg = avg('variable');
  for (let k = 1; k <= 3; k++) {
    const a = new Date(now.getFullYear(), now.getMonth() + k, 1);
    const b = new Date(a.getFullYear(), a.getMonth() + 1, 0, 23, 59, 59);
    // mensalidades que vencem no mês (contratos ativos; mensal renova até cancelar)
    const recurring = list.filter((c) => !c.upfront).reduce((s, c) => s + received(c, a, b), 0);
    const fixed = recur.filter((r) => r.active && r.start_date <= iso(b) && (!r.end_date || r.end_date >= iso(a))).reduce((s, r) => s + Number(r.amount), 0);
    const costs = adsAvg + fixed + varAvg;
    months.push({ a, b, label: MONTH(a), forecast: true, revenue: recurring, recurring, once: 0, other: 0, ads: adsAvg, fixed, variable: varAvg, costs, profit: recurring - costs, margin: recurring ? (recurring - costs) / recurring : null });
  }
  let acc = 0; months.forEach((m) => { acc += m.profit; m.acc = acc; });

  const cur = months.find((m) => m.current);
  const next = months.find((m) => m.forecast);
  const avgProfit = closed.length ? closed.reduce((s, m) => s + m.profit, 0) / closed.length : null;
  const realized = months.filter((m) => !m.forecast).reduce((s, m) => s + m.profit, 0);

  const ROWS = [
    ['Entradas', 'revenue', 'head'],
    ['Mensalidades (marketing)', 'recurring'], ['Pagamentos integrais (marketplace e únicos)', 'once'], ['Outras receitas', 'other'],
    ['Saídas', 'costs', 'head neg'],
    ['Anúncios (Meta)', 'ads'], ['Despesas fixas', 'fixed'], ['Despesas variáveis', 'variable'],
    ['Resultado', 'profit', 'total'], ['Margem', 'margin', 'pct'], ['Acumulado', 'acc', 'acc']
  ];
  const cell = (m, k, cls = '') => {
    const v = m[k];
    if (cls.includes('pct')) return pctTxt(v);
    const strong = /total|acc/.test(cls);
    if (!v && !strong) return '<span class="muted">—</span>';
    return `<span class="${strong && v < 0 ? 'cf-neg' : strong && v > 0 ? 'cf-pos' : ''}">${brl(v)}</span>`;
  };

  host.innerHTML = `
    <div class="kx-grid kx-4">
      <section class="panel kx accent"><span class="kx-l">Resultado de ${esc(cur.label)}</span><div class="kx-vr"><span class="kx-v ${cur.profit < 0 ? 'cf-neg' : cur.profit > 0 ? 'cf-pos' : ''}">${brl(cur.profit)}</span></div><div class="kx-s">mês em andamento · margem ${pctTxt(cur.margin)}</div></section>
      <section class="panel kx"><span class="kx-l">Média mensal</span><div class="kx-vr"><span class="kx-v ${avgProfit < 0 ? 'cf-neg' : avgProfit > 0 ? 'cf-pos' : ''}">${avgProfit == null ? '—' : brl(avgProfit)}</span></div><div class="kx-s">resultado dos últimos ${closed.length || 3} meses fechados</div></section>
      <section class="panel kx"><span class="kx-l">Previsão de ${esc(next.label)}</span><div class="kx-vr"><span class="kx-v ${next.profit < 0 ? 'cf-neg' : next.profit > 0 ? 'cf-pos' : ''}">${brl(next.profit)}</span></div><div class="kx-s">entram ${brl(next.revenue)} · saem ${brl(next.costs)}</div></section>
      <section class="panel kx"><span class="kx-l">Acumulado</span><div class="kx-vr"><span class="kx-v ${realized < 0 ? 'cf-neg' : realized > 0 ? 'cf-pos' : ''}">${brl(realized)}</span></div><div class="kx-s">soma dos ${CF.months} meses mostrados</div></section>
    </div>

    <section class="panel chart-card" style="margin-top:12px">
      <div class="cf-head"><div><h3>Entradas × saídas por mês</h3><p class="sub">Barras claras são previsão</p></div>
        <div class="seg">${[[6, '6 meses'], [12, '12 meses']].map(([n, t]) => `<button class="b b-sm ${CF.months === n ? 'on' : ''}" data-cfm="${n}">${t}</button>`).join('')}</div></div>
      <div class="legend"><span><i style="background:var(--viz-1)"></i>Entradas</span><span><i style="background:var(--viz-neutral)"></i>Saídas</span></div>
      <div class="chart" data-cf-chart></div>
    </section>

    <section class="panel cf-card">
      <div class="cf-head"><div><h3>Demonstrativo mensal</h3><p class="sub">O que entrou no mês: mensalidades de marketing na data de cada mês, marketplace e pagamentos únicos inteiros na data da venda, e outras receitas. Menos anúncios e despesas</p></div></div>
      <div class="table-wrap cf-wrap"><table class="int-table cf-table">
        <thead><tr><th></th>${months.map((m) => `<th class="num ${m.forecast ? 'cf-fc' : ''} ${m.current ? 'cf-cur' : ''}">${esc(m.label)}${m.forecast ? '<small>previsão</small>' : m.current ? '<small>em andamento</small>' : ''}</th>`).join('')}</tr></thead>
        <tbody>${ROWS.map(([n, k, cls = '']) => `<tr class="cf-${cls.split(' ')[0] || 'row'}"><th scope="row">${n}</th>${months.map((m) => `<td class="num ${m.forecast ? 'cf-fc' : ''} ${m.current ? 'cf-cur' : ''}">${cell(m, k, cls)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="adt-note">A previsão usa as mensalidades dos contratos ativos de marketing (mensais renovam até o cancelamento), as despesas fixas cadastradas e a média dos últimos 3 meses de anúncios e despesas variáveis.</p>
    </section>`;

  host.querySelectorAll('[data-cfm]').forEach((b) => b.addEventListener('click', () => { CF.months = Number(b.dataset.cfm); renderCashflow(host); }));
  chart(host.querySelector('[data-cf-chart]'), months);
}

// colunas agrupadas: entradas (âmbar) × saídas (cinza), mesmo eixo em R$; previsão mais clara
function chart(host, data) {
  const W = Math.max(320, host.clientWidth); const H = 240; const padL = 58; const padB = 24; const padT = 10;
  const maxV = Math.max(1, ...data.map((x) => Math.max(x.revenue, x.costs)));
  const p = Math.pow(10, Math.floor(Math.log10(maxV))); const max = [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= maxV);
  const iw = W - padL; const ih = H - padB - padT; const bw = iw / data.length; const gap = 2;
  const barW = Math.max(4, Math.min(26, (bw - 10) / 2));
  const y = (v) => padT + ih - (v / max) * ih;
  const bar = (x, v, cls, i) => { if (!v) return ''; const top = y(v); const h = padT + ih - top; const rr = Math.min(4, barW / 2, h); return `<path class="bar ${cls}" data-i="${i}" d="M${x},${padT + ih} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + barW - rr} Q${x + barW},${top} ${x + barW},${top + rr} V${padT + ih} Z"/>`; };
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Entradas e saídas por mês">
    ${[0, max / 2, max].map((t) => `<line class="gl" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${short(t)}</text>`).join('')}
    ${data.map((x, i) => { const cx = padL + i * bw + bw / 2; const fc = x.forecast ? ' fc' : ''; return bar(cx - barW - gap / 2, x.revenue, 'hot' + fc, i) + bar(cx + gap / 2, x.costs, 'rest' + fc, i); }).join('')}
    ${data.map((x, i) => `<text class="ax" x="${padL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${x.label}</text>`).join('')}
    ${data.map((x, i) => `<rect class="hit" data-i="${i}" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${ih}"/>`).join('')}
  </svg><div class="ctip" hidden></div>`;
  const tip = host.querySelector('.ctip'); const svg = host.querySelector('svg');
  svg.addEventListener('mousemove', (e) => {
    const h = e.target.closest('.hit'); if (!h) return;
    const i = +h.dataset.i; const x = data[i];
    host.querySelectorAll('.bar').forEach((b) => b.classList.toggle('dim', +b.dataset.i !== i));
    tip.innerHTML = `<div class="muted">${x.label}${x.forecast ? ' · previsão' : x.current ? ' · em andamento' : ''}</div>Entradas <b>${brl(x.revenue)}</b><br>Saídas <b>${brl(x.costs)}</b><br><span class="muted">Resultado ${brl(x.profit)}</span>`;
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / W;
    tip.style.left = Math.min(Math.max((padL + i * bw + bw / 2) * scale, 80), host.clientWidth - 80) + 'px';
    tip.style.top = y(Math.max(x.revenue, x.costs)) * scale + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; host.querySelectorAll('.bar').forEach((b) => b.classList.remove('dim')); });
}
