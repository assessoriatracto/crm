// Financeiro (estilo UTMify): gasto da Meta Ads × leads e vendas do CRM × receitas e despesas lançadas
import { DB } from '@shared/db.js';
import { S, $, $$, esc, ICON, brl, num, pct, fullDate, ago, toast, fail, modal, confirmBox } from './util.js?v=5e3e4be';

const F = { period: '30', from: '', to: '', level: 'campaign', revenue: 'mensal', sort: 'spend' };
const PERIODS = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['mespassado', 'Mês passado'], ['custom', 'Personalizado']];
const CATS = { despesa: ['Ferramentas', 'Equipe', 'Comissões', 'Impostos', 'Tráfego (outras plataformas)', 'Outros'], receita: ['Contrato', 'Setup', 'Consultoria', 'Outros'] };
const UTM_TEMPLATE = 'utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&utm_id={{campaign.id}}';
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function range() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const day = 86400000;
  switch (F.period) {
    case 'hoje': return [iso(t), iso(t)];
    case 'ontem': return [iso(new Date(t - day)), iso(new Date(t - day))];
    case '7': return [iso(new Date(t - 6 * day)), iso(t)];
    case 'mes': return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
    case 'mespassado': return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))];
    case 'custom': return [F.from || iso(new Date(t - 29 * day)), F.to || iso(t)];
    default: return [iso(new Date(t - 29 * day)), iso(t)];
  }
}
const inRange = (dateIso, [a, b]) => { const d = iso(new Date(dateIso)); return d >= a && d <= b; };

export async function renderFinance(el) {
  el.innerHTML = '<div class="loading">Carregando…</div>';
  const r = range();
  let ins = [], entries = [], accounts = [], settings = null;
  try {
    await DB.processAds();
    [ins, entries, accounts, settings] = await Promise.all([DB.listInsights(r[0], r[1]), DB.listFinance(r[0], r[1]), DB.listAdAccounts().catch(() => []), DB.getTracking().catch(() => null)]);
  } catch (e) { fail(e); }
  if (!el.isConnected) return;
  const months = settings?.contract_months || 12;
  const isAdmin = S.me?.role === 'admin';

  // ---------- números ----------
  const leads = S.leads.filter((l) => inRange(l.created_at, r));
  const paidLeads = leads.filter((l) => l.source === 'pago');
  const sales = S.leads.filter((l) => l.won_at && inRange(l.won_at, r));
  const saleValue = (l) => Number(l.valor || 0) * (F.revenue === 'contrato' ? months : 1);
  const revSales = sales.reduce((a, l) => a + saleValue(l), 0);
  const revManual = entries.filter((e) => e.kind === 'receita').reduce((a, e) => a + Number(e.amount), 0);
  const expManual = entries.filter((e) => e.kind === 'despesa').reduce((a, e) => a + Number(e.amount), 0);
  const spend = ins.reduce((a, x) => a + Number(x.spend), 0);
  const imp = ins.reduce((a, x) => a + Number(x.impressions), 0);
  const clicks = ins.reduce((a, x) => a + Number(x.clicks), 0);
  const faturamento = revSales + revManual;
  const despesas = spend + expManual;
  const lucro = faturamento - despesas;
  const ratio = (a, b) => (b ? a / b : null);
  const money = (v) => (v == null ? '—' : brl(v));
  const x2 = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + 'x');

  const tiles = [
    ['Faturamento', brl(faturamento), `${num(sales.length)} venda${sales.length === 1 ? '' : 's'}${revManual ? ' + ' + brl(revManual) + ' lançados' : ''}`, 'accent'],
    ['Gastos com anúncios', brl(spend), accounts.length || ins.length ? `${num(imp)} impressões` : 'conecte a Meta Ads abaixo'],
    ['Lucro', brl(lucro), `margem ${faturamento ? pct(lucro, faturamento) : '—'}`, lucro < 0 ? 'neg' : 'pos'],
    ['ROAS', x2(ratio(revSales, spend)), 'receita de vendas ÷ gasto'],
    ['ROI', ratio(lucro, despesas) == null ? '—' : pct(lucro, despesas), `despesas totais ${brl(despesas)}`],
    ['Ticket médio', money(ratio(revSales, sales.length)), F.revenue === 'contrato' ? `contrato × ${months} meses` : 'por mensalidade'],
    ['CAC', money(ratio(spend, sales.length)), `com todas as despesas: ${money(ratio(despesas, sales.length))}`],
    ['Leads', num(leads.length), `${num(paidLeads.length)} de anúncios`],
    ['CPL', money(ratio(spend, paidLeads.length || leads.length)), 'gasto ÷ leads de anúncio'],
    ['Conversão', pct(sales.length, leads.length), 'leads → vendas'],
    ['CTR', imp ? pct(clicks, imp) : '—', `CPC ${money(ratio(spend, clicks))}`],
    ['CPM', money(imp ? (spend / imp) * 1000 : null), `${num(clicks)} cliques`]
  ];

  el.innerHTML = `
    <div class="topline"><h1>Financeiro</h1><div class="grow"></div>
      <div class="seg">${PERIODS.map(([k, n]) => `<button class="b ${F.period === k ? 'on' : ''}" data-period="${k}">${n}</button>`).join('')}</div>
    </div>
    ${F.period === 'custom' ? `<div class="custom-range panel"><label>De <input type="date" class="inp" data-from value="${r[0]}"></label><label>Até <input type="date" class="inp" data-to value="${r[1]}"></label><button class="b b-primary b-sm" data-apply>Aplicar</button></div>` : ''}
    <div class="fin-actions">
      <div class="seg"><button class="b b-sm ${F.revenue === 'mensal' ? 'on' : ''}" data-rev="mensal">Receita: 1ª mensalidade</button><button class="b b-sm ${F.revenue === 'contrato' ? 'on' : ''}" data-rev="contrato">Receita: contrato (× ${months} meses)</button></div>
      <div class="grow"></div>
      ${accounts.length ? `<button class="b" data-sync>↻ Sincronizar Meta Ads</button>` : ''}
      <button class="b b-primary" data-entry>+ Lançamento</button>
    </div>
    <div class="fin-tiles">${tiles.map(([l, v, sub, cls]) => `<section class="panel ftile ${cls || ''}"><div class="t-label">${l}</div><div class="t-value">${v}</div><div class="t-sub">${esc(sub)}</div></section>`).join('')}</div>

    <section class="panel chart-card" style="margin-top:12px"><h3>Faturamento × gastos por dia</h3><p class="sub">Vendas fechadas (pela data da venda) e lançamentos, contra gasto em anúncios e despesas</p>
      <div class="legend"><span><i style="background:var(--viz-1)"></i>Faturamento</span><span><i style="background:var(--viz-neutral)"></i>Gastos</span></div>
      <div class="chart" data-chart></div></section>

    <section class="panel int-card" style="margin-top:12px">
      <div class="int-h"><div><h3>Desempenho por ${F.level === 'campaign' ? 'campanha' : F.level === 'adset' ? 'conjunto' : 'anúncio'}</h3><p class="help">Cruza o gasto da Meta com os leads e as vendas do CRM pelas UTMs dos anúncios.</p></div>
        <div class="seg">${[['campaign', 'Campanhas'], ['adset', 'Conjuntos'], ['ad', 'Anúncios']].map(([k, n]) => `<button class="b b-sm ${F.level === k ? 'on' : ''}" data-level="${k}">${n}</button>`).join('')}</div></div>
      <div class="table-wrap" data-table></div>
      <details class="docs"><summary>Parâmetros de URL pra colar nos anúncios</summary>
        <p class="help">No Gerenciador de Anúncios, em cada anúncio: Rastreamento &gt; Parâmetros de URL. É assim que o CRM liga cada lead e venda à campanha, conjunto e anúncio que trouxe.</p>
        <div class="code"><div class="code-h"><span>Parâmetros de URL</span><button class="b b-sm b-ghost" data-copy-utm>Copiar</button></div><pre>${esc(UTM_TEMPLATE)}</pre></div></details>
    </section>

    <div class="int-grid" style="margin-top:12px">
      <section class="panel int-card">
        <div class="int-h"><div><h3>Lançamentos</h3><p class="help">Receitas e despesas fora dos anúncios: ferramentas, equipe, impostos, setup…</p></div></div>
        ${entries.length ? `<div class="table-wrap"><table class="int-table"><thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th><th></th></tr></thead><tbody>
          ${entries.map((e) => `<tr data-id="${e.id}"><td class="nowrap">${new Date(e.date + 'T12:00').toLocaleDateString('pt-BR')}</td><td><span class="pill ${e.kind === 'receita' ? 'good' : 'bad'}">${e.kind === 'receita' ? 'Receita' : 'Despesa'}</span></td><td>${esc(e.category)}</td><td>${esc(e.description || '')}</td><td class="num">${brl(e.amount)}</td><td style="text-align:right"><button class="b b-sm b-ghost" data-edel aria-label="Excluir">×</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">Nenhum lançamento no período.</p>'}
      </section>
      <section class="panel int-card">
        <div class="int-h"><div><h3>Contas de anúncio</h3><p class="help">O CRM puxa o gasto da Meta a cada 3 horas (por anúncio e por dia).</p></div>${isAdmin ? '<button class="b b-sm b-primary" data-add-acc>+ Conta</button>' : ''}</div>
        ${accounts.length ? accounts.map((a) => `<div class="srow" data-id="${a.id}"><span class="plat plat-meta"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 15c0-4 2-8 4.5-8 3 0 5 8 9 8 2 0 3.5-1.5 3.5-4s-1.5-4-3.5-4c-3.5 0-5.5 8-9 8C5 15 3 14 3 15z"/></svg></span>
          <div class="grow"><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${esc(a.account_id)} · ${a.last_error ? `<span style="color:var(--fg-red)">${esc(a.last_error)}</span>` : a.last_sync_at ? 'sincronizado ' + (ago(a.last_sync_at) === 'agora' ? 'agora' : 'há ' + ago(a.last_sync_at)) : 'aguardando 1ª sincronização'}</div></div>
          ${isAdmin ? `<button class="switch ${a.enabled ? 'on' : ''}" data-acc-toggle></button><button class="b b-sm" data-acc-edit>Editar</button><button class="b b-sm b-danger" data-acc-del>×</button>` : ''}</div>`).join('')
          : `<p class="muted">${isAdmin ? 'Nenhuma conta conectada. Adicione a conta da Meta Ads com um token de acesso (permissão ads_read).' : 'Peça pra um admin conectar a conta da Meta Ads.'}</p>`}
      </section>
    </div>`;

  // tabela por nível
  renderTable(el.querySelector('[data-table]'), ins, leads, sales, saleValue);
  dailyChart(el.querySelector('[data-chart]'), r, ins, sales, entries, saleValue);

  const reload = () => renderFinance(el);
  el.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { F.period = b.dataset.period; reload(); }));
  el.querySelector('[data-apply]')?.addEventListener('click', () => { F.from = el.querySelector('[data-from]').value; F.to = el.querySelector('[data-to]').value; if (F.from > F.to) return toast('A data inicial é depois da final', true); reload(); });
  el.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', () => { F.revenue = b.dataset.rev; reload(); }));
  el.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => { F.level = b.dataset.level; reload(); }));
  el.querySelector('[data-copy-utm]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(UTM_TEMPLATE); toast('Parâmetros copiados'); } catch (e) { toast('Não consegui copiar', true); } });
  el.querySelector('[data-entry]').addEventListener('click', () => entryModal(reload));
  el.querySelectorAll('tr[data-id] [data-edel]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Excluir este lançamento?', 'Excluir'))) return;
    try { await DB.deleteFinance(b.closest('tr').dataset.id); reload(); } catch (e) { fail(e); }
  }));
  el.querySelector('[data-sync]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Sincronizando…';
    try {
      await DB.syncAds(null, 30);
      for (const wait of [3000, 4000, 6000]) { await new Promise((ok) => setTimeout(ok, wait)); await DB.processAds(); }
      toast('Gasto da Meta atualizado'); reload();
    } catch (err) { fail(err); btn.disabled = false; btn.textContent = '↻ Sincronizar Meta Ads'; }
  });
  el.querySelector('[data-add-acc]')?.addEventListener('click', () => accountModal(null, reload));
  el.querySelectorAll('.srow[data-id]').forEach((row) => {
    const a = accounts.find((x) => x.id === row.dataset.id); if (!a) return;
    row.querySelector('[data-acc-toggle]')?.addEventListener('click', async () => { try { await DB.saveAdAccount({ id: a.id, enabled: !a.enabled }); reload(); } catch (e) { fail(e); } });
    row.querySelector('[data-acc-edit]')?.addEventListener('click', () => accountModal(a, reload));
    row.querySelector('[data-acc-del]')?.addEventListener('click', async () => {
      if (!(await confirmBox(`Desconectar a conta "${a.name}"? O histórico de gasto dela também sai do financeiro.`, 'Desconectar'))) return;
      try { await DB.deleteAdAccount(a.id); reload(); } catch (e) { fail(e); }
    });
  });
}

function renderTable(host, ins, leads, sales, saleValue) {
  const key = { campaign: ['campaign_id', 'campaign_name'], adset: ['adset_id', 'adset_name'], ad: ['ad_id', 'ad_name'] }[F.level];
  const utm = { campaign: 'utm_campaign', adset: 'utm_term', ad: 'utm_content' }[F.level];
  const rows = new Map();
  ins.forEach((x) => {
    const k = x[key[0]] || x[key[1]];
    const r = rows.get(k) || { id: x[key[0]], name: x[key[1]] || '(sem nome)', campaign: x.campaign_name, spend: 0, imp: 0, clicks: 0, metaLeads: 0 };
    r.spend += Number(x.spend); r.imp += Number(x.impressions); r.clicks += Number(x.clicks); r.metaLeads += Number(x.meta_leads || 0);
    rows.set(k, r);
  });
  // liga leads e vendas às linhas pela UTM (ou pelo id da campanha em utm_id)
  const match = (l) => [...rows.values()].find((r) => (F.level === 'campaign' && l.utm_id && l.utm_id === r.id) || (l[utm] && l[utm] === r.name));
  const unmatched = { name: 'Sem anúncio identificado (orgânico, indicação, sem UTM)', spend: 0, imp: 0, clicks: 0, metaLeads: 0, leads: 0, sales: 0, rev: 0, none: true };
  [...rows.values()].forEach((r) => Object.assign(r, { leads: 0, sales: 0, rev: 0 }));
  leads.forEach((l) => { const r = match(l) || unmatched; r.leads++; });
  sales.forEach((l) => { const r = match(l) || unmatched; r.sales++; r.rev += saleValue(l); });
  const list = [...rows.values()].sort((a, b) => b.spend - a.spend);
  if (unmatched.leads || unmatched.sales) list.push(unmatched);
  if (!list.length) { host.innerHTML = '<p class="muted" style="padding:6px 0">Sem gasto nem leads no período.</p>'; return; }
  const tot = list.reduce((a, r) => ({ spend: a.spend + r.spend, imp: a.imp + r.imp, clicks: a.clicks + r.clicks, leads: a.leads + r.leads, sales: a.sales + r.sales, rev: a.rev + r.rev }), { spend: 0, imp: 0, clicks: 0, leads: 0, sales: 0, rev: 0 });
  const cell = (r) => {
    const roas = r.spend ? r.rev / r.spend : null; const profit = r.rev - r.spend;
    return `<td class="num">${r.none ? '—' : brl(r.spend)}</td><td class="num">${r.none ? '—' : num(r.imp)}</td><td class="num">${r.none || !r.imp ? '—' : pct(r.clicks, r.imp)}</td><td class="num">${r.none || !r.clicks ? '—' : brl(r.spend / r.clicks)}</td>
      <td class="num">${num(r.leads)}</td><td class="num">${r.none || !r.leads ? '—' : brl(r.spend / r.leads)}</td><td class="num">${num(r.sales)}</td><td class="num">${brl(r.rev)}</td>
      <td class="num">${roas == null ? '—' : `<span class="roas ${roas >= 1 ? 'good' : 'bad'}">${roas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x</span>`}</td><td class="num ${profit < 0 ? 'neg' : ''}">${r.none ? '—' : brl(profit)}</td>`;
  };
  host.innerHTML = `<table class="int-table fin-table"><thead><tr><th>${F.level === 'campaign' ? 'Campanha' : F.level === 'adset' ? 'Conjunto' : 'Anúncio'}</th><th class="num">Gasto</th><th class="num">Impr.</th><th class="num">CTR</th><th class="num">CPC</th><th class="num">Leads</th><th class="num">CPL</th><th class="num">Vendas</th><th class="num">Receita</th><th class="num">ROAS</th><th class="num">Lucro</th></tr></thead><tbody>
    ${list.map((r) => `<tr class="${r.none ? 'row-none' : ''}"><td><b>${esc(r.name)}</b>${F.level !== 'campaign' && r.campaign ? `<br><small class="muted">${esc(r.campaign)}</small>` : ''}</td>${cell(r)}</tr>`).join('')}
    <tr class="row-total"><td><b>Total</b></td>${cell({ ...tot, none: false })}</tr>
  </tbody></table>`;
}

// colunas agrupadas: faturamento (âmbar) × gastos (cinza), mesmo eixo em R$
function dailyChart(host, r, ins, sales, entries, saleValue) {
  const days = [];
  for (let d = new Date(r[0] + 'T12:00'); iso(d) <= r[1]; d = new Date(d.getTime() + 86400000)) days.push(iso(d));
  const data = days.map((d) => ({
    d,
    rev: sales.filter((l) => iso(new Date(l.won_at)) === d).reduce((a, l) => a + saleValue(l), 0) + entries.filter((e) => e.kind === 'receita' && e.date === d).reduce((a, e) => a + Number(e.amount), 0),
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

function entryModal(done) {
  let kind = 'despesa';
  const cats = () => CATS[kind].map((c) => `<option>${c}</option>`).join('');
  modal(`<h3>Novo lançamento</h3>
    <div class="row"><div class="seg"><button type="button" class="b" data-k="receita">Receita</button><button type="button" class="b on" data-k="despesa">Despesa</button></div></div>
    <div class="grid2"><div class="row"><label class="lbl">Valor (R$)</label><input class="inp" data-amount inputmode="decimal" placeholder="0,00"></div>
      <div class="row"><label class="lbl">Data</label><input class="inp" type="date" data-date value="${iso(new Date())}"></div></div>
    <div class="row"><label class="lbl">Categoria</label><select class="inp" data-cat>${cats()}</select></div>
    <div class="row"><label class="lbl">Descrição</label><input class="inp" data-desc maxlength="200" placeholder="Ex: Assinatura de ferramenta"></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar</button></div>`, (c, close) => {
    c.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.k; c.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); c.querySelector('[data-cat]').innerHTML = cats(); }));
    c.querySelector('[data-ok]').addEventListener('click', async () => {
      const amount = Number(c.querySelector('[data-amount]').value.replace(/\./g, '').replace(',', '.'));
      if (!(amount > 0)) return toast('Informe um valor', true);
      try {
        await DB.saveFinance({ kind, amount, date: c.querySelector('[data-date]').value, category: c.querySelector('[data-cat]').value, description: c.querySelector('[data-desc]').value.trim() || null, created_by: S.me?.id?.startsWith('demo') ? null : S.me?.id });
        close(); toast('Lançamento salvo'); done();
      } catch (e) { fail(e); }
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
