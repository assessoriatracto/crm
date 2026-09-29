// Financeiro > Despesas: fixas (cadastradas uma vez, lançadas todo mês) e variáveis (lançamentos avulsos)
import { DB } from '@shared/db.js';
import { S, esc, ICON, brl, num, toast, fail, modal, menu, confirmBox } from './util.js?v=2609291931';

const E = { type: 'todas' };
const CATS_FIXED = ['Ferramentas', 'Equipe', 'Contador', 'Aluguel', 'Impostos', 'Outros'];
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const parse = (v) => Number(String(v || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
const fmtN = (n) => (Number(n) > 0 ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const fmtD = (d) => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
const isFixed = (e) => !!(e.recurring_id || e.expense_type === 'fixa');
const monthStart = (d = new Date()) => iso(new Date(d.getFullYear(), d.getMonth(), 1));

// próximo vencimento de uma despesa fixa (a partir de hoje)
function nextDue(r, today = new Date()) {
  if (!r.active) return null;
  for (let k = 0; k < 3; k++) {
    const y = today.getFullYear(); const m = today.getMonth() + k;
    const last = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(r.due_day, last), 12);
    if (iso(d) < iso(today) || iso(d) < r.start_date) continue;
    if (r.end_date && iso(d) > r.end_date) return null;
    return d;
  }
  return null;
}
const statusOf = (r) => (r.end_date && r.end_date < iso(new Date()) ? 'encerrada' : r.active ? 'ativa' : 'pausada');

export async function renderExpenses(host, F, { range, entryModal }) {
  host.innerHTML = '<div class="loading">Carregando…</div>';
  const r = range();
  let recur = [], entries = [], ins = [];
  try {
    await DB.runRecurring();
    [recur, entries, ins] = await Promise.all([DB.listRecurring(), DB.listFinance(r[0], r[1]), DB.listInsights(r[0], r[1]).catch(() => [])]);
  } catch (e) { fail(e); }
  if (!host.isConnected) return;
  const reload = () => renderExpenses(host, F, { range, entryModal });

  const exp = entries.filter((e) => e.kind === 'despesa');
  const fixed = exp.filter(isFixed).reduce((s, e) => s + Number(e.amount), 0);
  const variable = exp.filter((e) => !isFixed(e)).reduce((s, e) => s + Number(e.amount), 0);
  const ads = ins.reduce((s, x) => s + Number(x.spend), 0);
  const total = fixed + variable + ads;
  const activeR = recur.filter((x) => statusOf(x) === 'ativa');
  const monthly = activeR.reduce((s, x) => s + Number(x.amount), 0);

  // por categoria (anúncios da Meta entram como categoria própria)
  const byCat = new Map();
  exp.forEach((e) => byCat.set(e.category, (byCat.get(e.category) || 0) + Number(e.amount)));
  if (ads) byCat.set('Anúncios (Meta)', ads);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map((c) => c[1]));

  const rows = exp.filter((e) => E.type === 'todas' || (E.type === 'fixas' ? isFixed(e) : !isFixed(e)));
  const upcoming = recur.map((x) => ({ r: x, d: nextDue(x) })).filter((x) => x.d && x.d - Date.now() < 31 * 86400000).sort((a, b) => a.d - b.d);
  const recurSorted = [...recur].sort((a, b) => ({ ativa: 0, pausada: 1, encerrada: 2 })[statusOf(a)] - ({ ativa: 0, pausada: 1, encerrada: 2 })[statusOf(b)] || Number(b.amount) - Number(a.amount));
  const PILL = { ativa: '', pausada: '<span class="pill wait">Pausada</span>', encerrada: '<span class="pill">Encerrada</span>' };

  host.innerHTML = `
    <div class="kx-grid kx-4">
      <section class="panel kx accent"><span class="kx-l">Total de despesas</span><div class="kx-vr"><span class="kx-v">${brl(total)}</span></div><div class="kx-s">no período, com anúncios</div></section>
      <section class="panel kx"><span class="kx-l">Despesas fixas</span><div class="kx-vr"><span class="kx-v">${brl(fixed)}</span></div><div class="kx-s">${total ? Math.round((fixed / total) * 100) + '% do total' : 'no período'}</div></section>
      <section class="panel kx"><span class="kx-l">Despesas variáveis</span><div class="kx-vr"><span class="kx-v">${brl(variable)}</span></div><div class="kx-s">${total ? Math.round((variable / total) * 100) + '% do total' : 'no período'}</div></section>
      <section class="panel kx"><span class="kx-l">Custo fixo mensal</span><div class="kx-vr"><span class="kx-v">${brl(monthly)}</span></div><div class="kx-s">${activeR.length ? `${num(activeR.length)} despesa${activeR.length === 1 ? '' : 's'} fixa${activeR.length === 1 ? '' : 's'} ativa${activeR.length === 1 ? '' : 's'}` : 'nenhuma cadastrada'}</div></section>
    </div>

    <div class="ex-grid">
      <section class="panel ex-card">
        <div class="ex-h"><div><h3>Despesas fixas</h3><p class="help">Cadastre uma vez. Entram sozinhas no financeiro todo mês, no dia do vencimento.</p></div><button class="b b-primary b-sm" data-new-fixed>+ Despesa fixa</button></div>
        ${recur.length ? `<div class="ex-list">${recurSorted.map((x) => { const st = statusOf(x); const nd = nextDue(x); return `
          <div class="ex-row ${st !== 'ativa' ? 'off' : ''}" data-r="${x.id}">
            <div class="ex-main" data-edit role="button" tabindex="0"><b>${esc(x.name)}</b><small>${esc(x.category)} · vence dia ${x.due_day}${nd ? ` · próximo ${fmtD(iso(nd))}` : ''}</small></div>
            <span class="ex-st">${PILL[st]}</span><span class="ex-v">${brl(x.amount)}<small>/mês</small></span>
            ${st === 'encerrada' ? '<span class="ex-sw"></span>' : `<input type="checkbox" class="ios-switch ex-sw" role="switch" data-toggle ${x.active ? 'checked' : ''} aria-label="${x.active ? 'Pausar' : 'Retomar'} ${esc(x.name)}" title="${x.active ? 'Ativa: clique pra pausar' : 'Pausada: clique pra retomar'}">`}
            <button class="b b-sm b-ghost" data-more aria-label="Ações">${ICON.dotsH}</button>
          </div>`; }).join('')}</div>` : '<div class="ex-empty"><p class="muted">Nenhuma despesa fixa ainda. Exemplos: ferramentas (CRM, design, IA), equipe, contador, aluguel.</p></div>'}
      </section>

      <div class="ex-side">
        <section class="panel ex-card">
          <div class="ex-h"><div><h3>Por categoria</h3><p class="help">No período, com anúncios</p></div></div>
          ${cats.length ? `<div class="ex-bars">${cats.map(([n, v]) => `<div class="ex-bar"><span class="n" title="${esc(n)}">${esc(n)}</span><span class="track"><span class="fill ${n === 'Anúncios (Meta)' ? 'ads' : ''}" style="--w:${(v / maxCat) * 100}%"></span></span><span class="v">${brl(v)}</span></div>`).join('')}</div>` : '<p class="muted empty-line">Nenhuma despesa no período.</p>'}
        </section>
        <section class="panel ex-card">
          <div class="ex-h"><div><h3>Próximos vencimentos</h3><p class="help">Próximos 30 dias</p></div></div>
          ${upcoming.length ? `<div class="soon">${upcoming.slice(0, 6).map(({ r: x, d }) => `<div class="soon-row"><span class="soon-d">${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span><span class="soon-t"><b>${esc(x.name)}</b><small>${brl(x.amount)}</small></span></div>`).join('')}</div>` : '<p class="muted empty-line">Nada vence nos próximos 30 dias.</p>'}
        </section>
      </div>
    </div>

    <section class="panel ex-card" style="margin-top:12px">
      <div class="ex-h ex-h-wrap"><div><h3>Lançamentos de despesa</h3><p class="help">Tudo o que saiu no período (anúncios da Meta ficam na Visão geral)</p></div>
        <div class="seg">${[['todas', 'Todas'], ['fixas', 'Fixas'], ['variaveis', 'Variáveis']].map(([k, n]) => `<button class="b b-sm ${E.type === k ? 'on' : ''}" data-et="${k}">${n}</button>`).join('')}</div>
        <button class="b b-primary b-sm" data-new-var>+ Despesa variável</button></div>
      ${rows.length ? `<div class="table-wrap"><table class="int-table"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Tipo</th><th class="num">Valor</th><th></th></tr></thead><tbody>
        ${rows.map((e) => `<tr data-id="${e.id}" class="row-click" title="Clique para editar"><td class="nowrap">${new Date(e.date + 'T12:00').toLocaleDateString('pt-BR')}${e.date > iso(new Date()) ? '<small class="muted">a vencer</small>' : ''}</td><td>${esc(e.description || '')}</td><td>${esc(e.category)}</td><td><span class="pill ${isFixed(e) ? '' : 'wait'}">${isFixed(e) ? 'Fixa' : 'Variável'}</span></td><td class="num">${brl(e.amount)}</td><td style="text-align:right"><span class="row-acts"><button class="b b-sm b-ghost" data-eedit aria-label="Editar">${ICON.edit}</button><button class="b b-sm b-ghost" data-edel aria-label="Excluir">${ICON.x}</button></span></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted empty-line">Nenhuma despesa no período.</p>'}
    </section>`;

  host.querySelector('[data-new-fixed]').addEventListener('click', () => recurringModal(null, reload));
  host.querySelector('[data-new-var]').addEventListener('click', () => entryModal(reload, null, { kind: 'despesa' }));
  host.querySelectorAll('[data-et]').forEach((b) => b.addEventListener('click', () => { E.type = b.dataset.et; reload(); }));
  host.querySelectorAll('.ex-row').forEach((row) => {
    const x = recur.find((y) => y.id === row.dataset.r); if (!x) return;
    const edit = () => recurringModal(x, reload);
    row.querySelector('[data-edit]').addEventListener('click', edit);
    row.querySelector('[data-edit]').addEventListener('keydown', (e) => { if (e.key === 'Enter') edit(); });
    row.querySelector('[data-toggle]')?.addEventListener('change', async (e) => {
      const on = e.target.checked;
      try {
        // retomar começa do mês atual (os meses parados não são lançados)
        await DB.saveRecurring({ id: x.id, active: on, ...(on ? { generated_until: iso(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)) } : {}) });
        toast(on ? `${x.name} retomada` : `${x.name} pausada. Não entra nos próximos meses.`);
        reload();
      } catch (err) { e.target.checked = !on; fail(err); }
    });
    row.querySelector('[data-more]').addEventListener('click', (e) => menu(e.currentTarget, [
      { label: 'Editar', action: edit },
      ...(statusOf(x) !== 'encerrada' ? [{ label: 'Encerrar (parar de lançar)', action: async () => {
        if (!(await confirmBox(`Encerrar ${x.name}? Os lançamentos já feitos continuam no histórico.`, 'Encerrar'))) return;
        try { await DB.saveRecurring({ id: x.id, end_date: iso(new Date()) }); toast('Despesa encerrada'); reload(); } catch (err) { fail(err); }
      } }] : [{ label: 'Reativar', action: async () => {
        try { await DB.saveRecurring({ id: x.id, end_date: null, active: true, generated_until: iso(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)) }); toast('Despesa reativada'); reload(); } catch (err) { fail(err); }
      } }]),
      { label: 'Excluir', action: async () => {
        if (!(await confirmBox(`Excluir ${x.name}? Os lançamentos já feitos continuam no histórico.`, 'Excluir'))) return;
        try { await DB.deleteRecurring(x.id); toast('Despesa fixa excluída'); reload(); } catch (err) { fail(err); }
      } }
    ]));
  });
  host.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-edel]')) return;
    const entry = entries.find((x) => x.id === tr.dataset.id); if (entry) entryModal(reload, entry);
  }));
  host.querySelectorAll('tr[data-id] [data-edel]').forEach((b) => b.addEventListener('click', async () => {
    const entry = entries.find((x) => x.id === b.closest('tr').dataset.id);
    if (!(await confirmBox(entry?.recurring_id ? 'Excluir o lançamento deste mês? A despesa fixa continua nos próximos meses.' : 'Excluir este lançamento?', 'Excluir'))) return;
    try { await DB.deleteFinance(entry.id); reload(); } catch (e) { fail(e); }
  }));
}

function recurringModal(x, done) {
  const catOpts = [...new Set([...CATS_FIXED, ...(x ? [x.category] : [])])];
  modal(`<h3>${x ? 'Editar despesa fixa' : 'Nova despesa fixa'}</h3>
    <p class="help" style="margin-top:-4px">${x ? 'O novo valor vale a partir do próximo lançamento. Os meses já lançados não mudam.' : 'Entra sozinha no financeiro todo mês, no dia do vencimento, até você pausar ou encerrar.'}</p>
    <div class="row"><label class="lbl" for="rcN">Nome</label><input class="inp" id="rcN" data-n maxlength="120" value="${esc(x?.name || '')}" placeholder="Ex: Assinatura do Canva"></div>
    <div class="grid2">
      <div class="row"><label class="lbl" for="rcC">Categoria</label><select class="inp" id="rcC" data-c>${catOpts.map((c) => `<option ${x?.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="row"><label class="lbl" for="rcV">Valor mensal (R$)</label><input class="inp" id="rcV" data-v inputmode="decimal" placeholder="0,00" value="${fmtN(x?.amount)}"></div>
    </div>
    <div class="grid3">
      <div class="row"><label class="lbl" for="rcD">Vence todo dia</label><input class="inp" id="rcD" data-d inputmode="numeric" value="${x?.due_day || 10}"></div>
      <div class="row"><label class="lbl" for="rcS">Desde</label><input class="inp" type="date" id="rcS" data-s value="${x?.start_date || monthStart()}"></div>
      <div class="row"><label class="lbl" for="rcE">Até <span class="muted" style="text-transform:none;letter-spacing:0">(opcional)</span></label><input class="inp" type="date" id="rcE" data-e value="${x?.end_date || ''}"></div>
    </div>
    <p class="help" data-hint></p>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>${x ? 'Salvar' : 'Cadastrar'}</button></div>`, (m, close) => {
    const $m = (s) => m.querySelector(s);
    const hint = () => {
      const s = $m('[data-s]').value; const past = s && s < monthStart();
      const n = past ? (() => { const a = new Date(s + 'T12:00'); const b = new Date(); return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1; })() : 0;
      $m('[data-hint]').textContent = !x && past ? `Vamos lançar os ${n} meses desde ${new Date(s + 'T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}, pra o histórico ficar completo.` : '';
    };
    $m('[data-s]').addEventListener('change', hint); hint();
    $m('[data-v]').addEventListener('blur', (e) => { const v = parse(e.target.value); if (v > 0) e.target.value = fmtN(v); });
    $m('[data-d]').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 2); });
    $m('[data-ok]').addEventListener('click', async (e) => {
      const name = $m('[data-n]').value.trim(); const amount = parse($m('[data-v]').value); const due = Number($m('[data-d]').value);
      const start = $m('[data-s]').value; const end = $m('[data-e]').value || null;
      if (!name) return toast('Dê um nome pra despesa', true);
      if (!(amount > 0)) return toast('Informe o valor mensal', true);
      if (!(due >= 1 && due <= 31)) return toast('Dia do vencimento entre 1 e 31', true);
      if (!start) return toast('Informe desde quando', true);
      if (end && end < start) return toast('A data final é antes do início', true);
      const btn = e.currentTarget; btn.disabled = true;
      try {
        await DB.saveRecurring({ ...(x ? { id: x.id } : { created_by: S.me?.id?.startsWith('demo') ? null : S.me?.id }), name, category: $m('[data-c]').value, amount, due_day: due, start_date: start, end_date: end,
          // começou antes do que estava: lança os meses que faltam
          ...(x && start < x.start_date ? { generated_until: null } : {}) });
        close(); toast(x ? 'Despesa fixa atualizada' : 'Despesa fixa cadastrada'); done();
      } catch (err) { btn.disabled = false; fail(err); }
    });
  });
}
