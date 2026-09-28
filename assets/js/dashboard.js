// Dashboard de leads e do formulário
import { DB } from '@shared/db.js';
import { dateRange, datePicker, dateBtn, S, $, $$, esc, FAT, stageOf, profileOf, isHot, isInactive, isDue, brl, pct, num, formName, sourceLabel, fail } from './util.js?v=2609281242';

const D = { period: '30', from: '', to: '', form: '' };
const QTYPES = ['short_text', 'long_text', 'email', 'phone', 'number', 'url', 'date', 'choice', 'multi', 'dropdown', 'yes_no', 'rating', 'scale', 'consent'];

const since = () => dateRange(D)[0];
const until = () => dateRange(D)[1] || new Date();
const inPeriod = (iso) => { const [a, b] = dateRange(D); const d = new Date(iso); return (!a || d >= a) && (!b || d <= b); };

export async function renderDashboard(el) {
  const from = since();
  const leads = S.leads.filter((l) => inPeriod(l.created_at) && (!D.form || l.form_id === D.form));
  const formIds = [...new Set([...Object.keys(S.forms), ...S.leads.map((l) => l.form_id)])];

  const won = leads.filter((l) => stageOf(l)?.kind === 'won');
  const lost = leads.filter((l) => stageOf(l)?.kind === 'lost');
  const receita = won.reduce((a, l) => a + Number(l.valor || 0), 0);

  el.innerHTML = `
    <div class="topline"><h1>Dashboard</h1><div class="grow"></div>
      ${dateBtn(D)}
      <select class="inp" data-form style="width:auto"><option value="">Todos os formulários</option>${formIds.map((id) => `<option value="${id}" ${D.form === id ? 'selected' : ''}>${esc(S.forms[id]?.name || (id === 'manual' ? 'Cadastro manual' : id))}</option>`).join('')}</select>
    </div>
    <div class="dash-grid">
      ${tile('Leads', num(leads.length), `${num(leads.filter((l) => l.source === 'pago').length)} de anúncios pagos`, true)}
      ${tile('Taxa do formulário', '<span data-formrate>…</span>', '<span data-formrate-sub>visitas que viraram lead</span>')}
      ${tile('Leads quentes', num(leads.filter(isHot).length), 'faturam R$50 mil+ por mês')}
      ${tile('Convertidos', num(won.length), receita ? brl(receita) + '/mês em contratos' : `${pct(won.length, leads.length)} dos leads`)}
      ${tile('Em aberto', num(leads.length - won.length - lost.length), `${num(leads.filter(isInactive).length)} sem atividade há 7+ dias`)}
      ${tile('Lembretes vencidos', num(S.leads.filter(isDue).length), 'em todos os leads')}

      <section class="panel chart-card span-8"><h3>Leads por ${bucketDays(leads) > 1 ? 'semana' : 'dia'}</h3><p class="sub">Quantos leads entraram no período</p>
        <div class="legend"><span><i style="background:var(--viz-1)"></i>Quentes (R$50 mil+)</span><span><i style="background:var(--viz-neutral)"></i>Demais</span></div>
        <div class="chart" data-chart="days"></div></section>
      <section class="panel chart-card span-4"><h3>Pipeline</h3><p class="sub">Leads do período em cada estágio</p><div data-chart="funnel"></div></section>

      <section class="panel chart-card span-6"><h3>Abandono do formulário</h3><p class="sub" data-drop-sub>Carregando eventos…</p><div data-chart="drop"></div></section>
      <section class="panel chart-card span-6"><h3>Faturamento dos leads</h3><p class="sub">Distribuição por faixa informada no formulário</p><div data-chart="fat"></div></section>

      <section class="panel chart-card span-6"><h3>Campanhas</h3><p class="sub">Por utm_campaign</p><div data-chart="camp"></div></section>
      <section class="panel chart-card span-6"><h3>Equipe</h3><p class="sub">Leads atribuídos e convertidos por pessoa</p><div data-chart="team"></div></section>

      <section class="panel chart-card span-6"><h3>Fonte</h3><p class="sub">Pago tem fbclid ou utm_medium de mídia paga</p><div data-chart="source"></div></section>
      <section class="panel chart-card span-6"><h3>Formulários</h3><p class="sub">Leads por formulário de origem</p><div data-chart="forms"></div></section>
    </div>`;

  el.querySelector('[data-date]').addEventListener('click', (e) => datePicker(e.currentTarget, D, (st) => { Object.assign(D, st); renderDashboard(el); }));
  el.querySelector('[data-form]').addEventListener('change', (e) => { D.form = e.target.value; renderDashboard(el); });

  columnChart($('[data-chart="days"]', el), dayBuckets(leads, from));
  const openStages = S.stages.filter((s) => s.kind === 'open');
  hbars($('[data-chart="funnel"]', el), S.stages.map((s) => {
    const n = leads.filter((l) => l.stage_id === s.id).length;
    const i = openStages.indexOf(s);
    // estágios em andamento: rampa de âmbar (avança = mais intenso); ganho: branco; perdido: cinza
    const color = s.kind === 'won' ? 'var(--viz-cream)' : s.kind === 'lost' ? 'var(--viz-gray)' : rampAt(i, openStages.length);
    return { name: s.name, value: n, note: pct(n, leads.length), color };
  }));
  hbars($('[data-chart="fat"]', el), [...FAT, null].map((f, i) => {
    const n = leads.filter((l) => (l.faturamento || null) === f).length;
    return { name: f || 'Não informado', value: n, note: pct(n, leads.length), color: f ? `var(--ramp-${i + 1})` : 'var(--viz-gray)' };
  }).filter((r) => r.value || r.name !== 'Não informado'));
  const SRC_COLOR = { pago: 'var(--viz-1)', organico: 'var(--viz-cream)', manual: 'var(--viz-gray)', api: 'var(--ramp-2)' };
  hbars($('[data-chart="source"]', el), ['pago', 'organico', 'manual', 'api'].map((s) => { const n = leads.filter((l) => l.source === s).length; return { name: sourceLabel(s), value: n, note: pct(n, leads.length), color: SRC_COLOR[s] }; }).filter((r) => r.value));
  hbars($('[data-chart="forms"]', el), formIds.map((id) => { const n = leads.filter((l) => l.form_id === id).length; return { name: S.forms[id]?.name || (id === 'manual' ? 'Cadastro manual' : id), value: n, note: pct(n, leads.length) }; }).filter((r) => r.value).sort((a, b) => b.value - a.value));
  groupTable($('[data-chart="camp"]', el), leads, (l) => l.utm_campaign || 'Sem campanha', 'Campanha');
  groupTable($('[data-chart="team"]', el), leads, (l) => profileOf(l.assigned_to)?.nome || 'Não atribuído', 'Pessoa');

  // eventos do formulário (abandono) — carregados à parte
  try {
    const events = await DB.listEvents(from ? from.toISOString() : null);
    if (!el.isConnected) return;
    dropOff(el, events.filter((e) => inPeriod(e.created_at)), leads, from);
  } catch (e) { fail(e); }
}

// posição i de n numa rampa de 5 tons de âmbar (ordinal: mais avançado = mais intenso)
function rampAt(i, n) {
  const k = n <= 1 ? 4 : Math.round((i / (n - 1)) * 4);
  return `var(--ramp-${Math.max(1, Math.min(5, k + 1))})`;
}

function tile(label, value, sub, accent) {
  return `<section class="panel tile ${accent ? 'accent' : ''}"><div class="t-label">${label}</div><div class="t-value">${value}</div><div class="t-sub">${sub}</div></section>`;
}

// ---------- abandono ----------
function dropOff(el, events, leads, from) {
  const fid = D.form && S.forms[D.form] ? D.form : 'trafego';
  const form = S.forms[fid];
  const ev = events.filter((e) => e.form_id === fid);
  const sessions = (pred) => new Set(ev.filter(pred).map((e) => e.session_id)).size;
  const views = sessions((e) => e.event === 'view');
  const starts = sessions((e) => e.event === 'start');
  const submits = S.leads.filter((l) => l.form_id === fid && inPeriod(l.created_at)).length;
  const qs = form.fields.filter((f) => QTYPES.includes(f.type));
  const strip = (h) => String(h).replace(/<[^>]+>/g, '').replace(/\{\{(\w+)(:\w+)?\}\}/g, '…');
  const rows = [
    { name: 'Visitaram', value: views },
    { name: 'Começaram', value: starts },
    ...qs.map((q, i) => ({ name: `${i + 1}. ${strip(q.title)}`, value: sessions((e) => e.event === 'step' && e.step_id === q.id), soft: !!q.showIf })),
    { name: 'Enviaram', value: submits }
  ].map((r, i, arr) => ({ ...r, note: i ? pct(r.value, arr[0].value) : '100%', color: i === 0 ? 'var(--viz-cream)' : rampAt(i - 1, arr.length - 1) }));

  const rate = views ? pct(submits, views) : '—';
  $('[data-formrate]', el).textContent = rate;
  $('[data-formrate-sub]', el).textContent = views ? `${num(submits)} de ${num(views)} visitas (${form.name.replace('Assessoria Tracto - ', '')})` : 'sem visitas registradas ainda';
  $('[data-drop-sub]', el).textContent = `${form.name}: sessões que chegaram em cada etapa (% das visitas)`;
  hbars($('[data-chart="drop"]', el), rows, { max: views || 1 });
}

// ---------- barras horizontais ----------
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

// ---------- tabela agrupada ----------
function groupTable(host, leads, keyFn, colName) {
  const g = new Map();
  leads.forEach((l) => {
    const k = keyFn(l);
    const r = g.get(k) || { name: k, n: 0, hot: 0, won: 0, rev: 0 };
    r.n++; if (isHot(l)) r.hot++;
    if (stageOf(l)?.kind === 'won') { r.won++; r.rev += Number(l.valor || 0); }
    g.set(k, r);
  });
  const rows = [...g.values()].sort((a, b) => b.n - a.n).slice(0, 10);
  if (!rows.length) { host.innerHTML = '<p class="muted">Sem dados no período.</p>'; return; }
  const max = rows[0].n;
  host.innerHTML = `<div class="table-wrap"><table class="dash-table"><thead><tr><th>${colName}</th><th class="num">Leads</th><th></th><th class="num">Quentes</th><th class="num">Convertidos</th><th class="num">Conversão</th><th class="num">Receita/mês</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${num(r.n)}</td><td style="width:22%"><div class="minibar"><i style="width:${(r.n / max) * 100}%"></i></div></td><td class="num">${num(r.hot)}</td><td class="num">${num(r.won)}</td><td class="num">${pct(r.won, r.n)}</td><td class="num">${r.rev ? brl(r.rev) : '—'}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// ---------- colunas por dia/semana ----------
function bucketDays(leads) {
  const from = since() || (leads.length ? new Date(Math.min(...leads.map((l) => +new Date(l.created_at)))) : new Date());
  return (until() - from) / 86400000 > 120 ? 7 : 1;
}
function dayBuckets(leads, from) {
  const step = bucketDays(leads);
  const start = new Date(from || (leads.length ? Math.min(...leads.map((l) => +new Date(l.created_at))) : Date.now()));
  start.setHours(0, 0, 0, 0);
  const end = new Date(until()); end.setHours(0, 0, 0, 0);
  const out = [];
  for (let d = new Date(start); d <= end; d = new Date(+d + step * 86400000)) out.push({ date: new Date(d), value: 0, hot: 0 });
  if (!out.length) out.push({ date: end, value: 0, hot: 0 });
  leads.forEach((l) => {
    const i = Math.min(out.length - 1, Math.floor((new Date(l.created_at) - start) / (step * 86400000)));
    if (i >= 0) { out[i].value++; if (isHot(l)) out[i].hot++; }
  });
  out.step = step;
  return out;
}
function niceMax(v) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}
function columnChart(host, data) {
  const W = Math.max(320, host.clientWidth);
  const H = 230; const padL = 30; const padB = 24; const padT = 18;
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const iw = W - padL; const ih = H - padB - padT;
  const bw = iw / data.length;
  const gap = Math.min(2, bw * 0.2);
  const barW = Math.max(1, Math.min(28, bw - gap));
  const y = (v) => padT + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 64)));

  // coluna empilhada: base = demais (neutro), topo = quentes (âmbar); só o topo da pilha é arredondado
  const seg = (x, yTop, yBot, round) => {
    const h = yBot - yTop; if (h <= 0) return '';
    const r = round ? Math.min(4, barW / 2, h) : 0;
    return r ? `M${x},${yBot} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yBot} Z`
             : `M${x},${yBot} V${yTop} H${x + barW} V${yBot} Z`;
  };
  const GAP = 2;
  const showTotals = bw >= 16;
  const bars = data.map((d, i) => {
    if (!d.value) return '';
    const x = padL + i * bw + (bw - barW) / 2;
    const base = padT + ih;
    const rest = d.value - d.hot;
    const yRest = y(rest); const yTop = y(d.value);
    let out = '';
    if (rest) out += `<path class="bar rest" data-i="${i}" d="${seg(x, yRest, base, !d.hot)}"/>`;
    if (d.hot) out += `<path class="bar hot" data-i="${i}" d="${seg(x, yTop, rest ? yRest - GAP : base, true)}"/>`;
    if (showTotals) out += `<text class="tot" x="${x + barW / 2}" y="${yTop - 5}" text-anchor="middle">${d.value}</text>`;
    return out;
  }).join('');
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Leads por período">
    ${ticks.map((t) => `<line class="gl" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${num(t)}</text>`).join('')}
    ${bars}
    ${data.map((d, i) => (i % every === 0 ? `<text class="ax" x="${padL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${fmt(d.date)}</text>` : '')).join('')}
    ${data.map((d, i) => `<rect class="hit" data-i="${i}" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${ih}"/>`).join('')}
  </svg><div class="ctip" hidden></div>`;

  const tip = host.querySelector('.ctip');
  const svg = host.querySelector('svg');
  svg.addEventListener('mousemove', (e) => {
    const h = e.target.closest('.hit'); if (!h) return;
    const i = +h.dataset.i; const d = data[i];
    host.querySelectorAll('.bar').forEach((b) => b.classList.toggle('dim', +b.dataset.i !== i));
    const label = data.step > 1 ? `Semana de ${fmt(d.date)}` : d.date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    tip.innerHTML = `<div class="muted">${label}</div><b>${num(d.value)}</b> lead${d.value === 1 ? '' : 's'}${d.hot ? ` · ${d.hot} quente${d.hot > 1 ? 's' : ''}` : ''}`;
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / W;
    tip.style.left = Math.min(Math.max((padL + i * bw + bw / 2) * scale, 70), host.clientWidth - 70) + 'px';
    tip.style.top = y(Math.max(d.value, 0)) * scale + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; host.querySelectorAll('.bar').forEach((b) => b.classList.remove('dim')); });
}
