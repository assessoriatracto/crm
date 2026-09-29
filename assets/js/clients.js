// Financeiro > Clientes: contratos ativos, cancelamentos (churn) e origem de cada venda (campanha › conjunto › anúncio).
import { DB } from '@shared/db.js';
import { S, esc, ICON, brl, num, toast, fail, modal, menu, dateRange } from './util.js?v=2609282307';
import { contracts, activeAt } from './dashboard.js?v=2609282307';

const C = { status: 'ativos', q: '' };
const REASONS = ['Preço', 'Resultado abaixo do esperado', 'Atendimento', 'Fechou ou vendeu a loja', 'Cortou custos', 'Foi para outra agência', 'Outro'];
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' });
const statusOf = (c, t = new Date()) => (c.canceled && c.canceled <= t ? 'cancelado' : c.end <= t ? 'encerrado' : c.start > t ? 'futuro' : 'ativo');
const originTxt = (o) => [o?.utm_campaign, o?.utm_term, o?.utm_content].filter(Boolean).join(' › ');

export async function renderClients(host, F, reload) {
  host.innerHTML = '<div class="loading">Carregando…</div>';
  let entries = [], settings = null, ins = [];
  try {
    [entries, settings, ins] = await Promise.all([
      DB.listFinance('2000-01-01', iso(new Date())), DB.getTracking().catch(() => null),
      DB.listInsights(iso(new Date(Date.now() - 400 * 86400000)), iso(new Date())).catch(() => [])
    ]);
  } catch (e) { fail(e); }
  if (!host.isConnected) return;
  const months = settings?.contract_months || 12;
  const list = contracts(entries, months);
  const now = new Date();
  const [ra, rb] = dateRange(F); const a = ra || new Date('2000-01-01'); const b = rb || now;
  const active = list.filter((c) => activeAt(c, now));
  const activeStart = list.filter((c) => activeAt(c, a));
  const canceledR = list.filter((c) => c.canceled && c.canceled >= a && c.canceled <= b);
  const mrr = active.reduce((s, c) => s + c.monthly, 0);
  const lostMrr = canceledR.reduce((s, c) => s + c.monthly, 0);
  const churn = activeStart.length ? canceledR.length / activeStart.length : null;
  const noOrigin = list.filter((c) => !c.origin?.utm_campaign && !c.origin?.utm_id).length;

  const q = C.q.trim().toLowerCase();
  const rows = list.filter((c) => {
    const st = statusOf(c);
    if (C.status === 'ativos' && st !== 'ativo') return false;
    if (C.status === 'cancelados' && st !== 'cancelado') return false;
    if (C.status === 'encerrados' && st !== 'encerrado') return false;
    if (C.status === 'sem_origem' && (c.origin?.utm_campaign || c.origin?.utm_id)) return false;
    if (C.status === 'periodo' && !(c.start >= a && c.start <= b)) return false;
    return !q || `${c.name} ${originTxt(c.origin)}`.toLowerCase().includes(q);
  }).sort((x, y) => (statusOf(x) === 'ativo' ? 0 : 1) - (statusOf(y) === 'ativo' ? 0 : 1) || y.start - x.start);
  const count = (k) => list.filter((c) => (k === 'periodo' ? c.start >= a && c.start <= b : k === 'todos' ? true : k === 'sem_origem' ? !c.origin?.utm_campaign && !c.origin?.utm_id : statusOf(c) === ({ ativos: 'ativo', cancelados: 'cancelado', encerrados: 'encerrado' })[k])).length;
  const PILL = { ativo: '<span class="pill good">Ativo</span>', cancelado: '<span class="pill bad">Cancelado</span>', encerrado: '<span class="pill">Encerrado</span>', futuro: '<span class="pill wait">A começar</span>' };

  host.innerHTML = `
    <div class="kx-grid kx-4 cl-kpis">
      <section class="panel kx accent"><span class="kx-l">Clientes ativos hoje</span><div class="kx-vr"><span class="kx-v">${num(active.length)}</span></div><div class="kx-s">MRR ${brl(mrr)}</div></section>
      <section class="panel kx"><span class="kx-l">Cancelamentos no período</span><div class="kx-vr"><span class="kx-v">${num(canceledR.length)}</span></div><div class="kx-s">${lostMrr ? `−${brl(lostMrr)}/mês de receita` : 'nenhuma receita perdida'}</div></section>
      <section class="panel kx"><span class="kx-l">Churn do período</span><div class="kx-vr"><span class="kx-v">${churn == null ? '—' : (churn * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'}</span></div><div class="kx-s">cancelados ÷ ativos no início</div></section>
      <section class="panel kx"><span class="kx-l">Vendas sem origem</span><div class="kx-vr"><span class="kx-v">${num(noOrigin)}</span></div><div class="kx-s">${noOrigin ? 'defina a campanha pra medir o ROAS' : 'todas com campanha definida'}</div></section>
    </div>
    <section class="panel cl-card">
      <div class="cl-head">
        <div class="seg cl-seg">${[['periodo', 'Fechados no período'], ['ativos', 'Ativos'], ['cancelados', 'Cancelados'], ['encerrados', 'Encerrados'], ['sem_origem', 'Sem origem'], ['todos', 'Todos']].map(([k, n]) => `<button class="b b-sm ${C.status === k ? 'on' : ''}" data-cs="${k}">${n}<span class="cl-n">${num(count(k))}</span></button>`).join('')}</div>
        <label class="adt-search">${ICON.search}<input type="search" data-cq placeholder="Buscar cliente ou campanha" value="${esc(C.q)}"></label>
        <button class="b b-primary" data-new-client>+ Novo cliente</button>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="int-table cl-table"><thead><tr><th>Cliente</th><th>Status</th><th class="num">Mensalidade</th><th>Fechado em</th><th>Término</th><th>Origem da venda</th><th></th></tr></thead><tbody>
        ${rows.map((c) => { const st = statusOf(c); return `<tr data-c="${c.id}">
          <td><b class="ellip-1" title="${esc(c.name)}">${esc(c.name)}</b><small class="muted">${c.kind === 'lead' ? 'Venda pelo pipeline' : 'Venda lançada'} · ${c.months} ${c.months === 1 ? 'mês' : 'meses'}</small></td>
          <td>${PILL[st]}${st === 'cancelado' ? `<small class="muted cl-why">${fmt(c.canceled)}${c.reason ? ' · ' + esc(c.reason) : ''}</small>` : ''}</td>
          <td class="num">${brl(c.monthly)}</td>
          <td class="nowrap">${fmt(c.start)}${c.kind === 'entry' && c.entry.created_at && iso(new Date(c.entry.created_at)) !== iso(c.start) ? `<small class="muted">lançado em ${fmt(new Date(c.entry.created_at))}</small>` : ''}</td>
          <td class="nowrap">${fmt(st === 'cancelado' ? c.canceled : c.end)}</td>
          <td>${originTxt(c.origin) ? `<span class="cl-origin" title="${esc(originTxt(c.origin))}">${esc(originTxt(c.origin))}</span>${c.lead ? '' : '<small class="muted">sem lead: não vai pra Meta</small>'}` : '<button class="b b-sm" data-origin>Definir origem</button>'}</td>
          <td class="cl-act"><button class="b b-sm b-ghost" data-more aria-label="Ações">${ICON.dotsH}</button></td></tr>`; }).join('')}
      </tbody></table></div>` : `<p class="muted empty-line">${list.length ? 'Nenhum cliente nesse filtro.' : 'Ainda não há vendas. Elas aparecem aqui quando um lead vai pra "Venda realizada" com mensalidade, ou quando você lança uma venda no Financeiro.'}</p>`}
    </section>`;

  host.querySelectorAll('[data-cs]').forEach((btn) => btn.addEventListener('click', () => { C.status = btn.dataset.cs; renderClients(host, F, reload); }));
  let t; host.querySelector('[data-cq]').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { C.q = e.target.value; renderClients(host, F, reload).then(() => { const i = host.querySelector('[data-cq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 200); });
  const done = () => renderClients(host, F, reload);
  host.querySelector('[data-new-client]').addEventListener('click', () => clientModal(null, months, done));
  host.querySelectorAll('tr[data-c]').forEach((tr) => {
    const c = list.find((x) => x.id === tr.dataset.c); if (!c) return;
    tr.querySelector('[data-origin]')?.addEventListener('click', () => originModal(c, ins, done));
    tr.querySelector('[data-more]').addEventListener('click', (e) => {
      const st = statusOf(c);
      menu(e.currentTarget, [
        { label: 'Editar cliente', action: () => clientModal(c, months, done) },
        st === 'cancelado' ? { label: 'Desfazer cancelamento', action: () => saveCancel(c, null, null, done) } : { label: 'Registrar cancelamento', action: () => cancelModal(c, done) },
        { label: originTxt(c.origin) ? 'Alterar origem da venda' : 'Definir origem da venda', action: () => originModal(c, ins, done) },
        ...(c.lead ? [{ label: 'Abrir lead', action: () => { history.pushState(null, '', '/leads'); window.dispatchEvent(new Event('tracto:nav')); setTimeout(() => window.dispatchEvent(new CustomEvent('tracto:open-lead', { detail: c.lead.id })), 150); } }] : [])
      ]);
    });
  });
}

async function saveCancel(c, date, reason, done) {
  const patch = { canceled_at: date, cancel_reason: reason };
  try {
    if (c.kind === 'lead') { await DB.updateLeads([c.lead.id], patch); Object.assign(c.lead, patch); } else await DB.saveFinance({ id: c.entry.id, ...patch });
    toast(date ? 'Cancelamento registrado' : 'Cancelamento desfeito');
    window.dispatchEvent(new Event('tracto:reload-leads'));
    done();
  } catch (e) { fail(e); }
}

function cancelModal(c, done) {
  modal(`<h3>Registrar cancelamento</h3>
    <p class="help" style="margin-top:-4px"><b>${esc(c.name)}</b> · ${brl(c.monthly)}/mês. O cancelamento entra no churn e tira a mensalidade do MRR a partir da data.</p>
    <div class="grid2">
      <div class="row"><label class="lbl">Data do cancelamento</label><input class="inp" type="date" data-d value="${iso(new Date())}" max="${iso(new Date())}"></div>
      <div class="row"><label class="lbl">Motivo</label><select class="inp" data-r>${REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div>
    </div>
    <div class="row"><label class="lbl">Observação (opcional)</label><input class="inp" data-o maxlength="120" placeholder="Ex: pediu pra pausar até março"></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-danger-solid" data-ok>Registrar cancelamento</button></div>`, (m, close) => {
    m.querySelector('[data-ok]').addEventListener('click', async () => {
      const d = m.querySelector('[data-d]').value;
      if (!d) return toast('Informe a data', true);
      if (new Date(d + 'T12:00') < c.start) return toast('A data é antes do início do contrato', true);
      const o = m.querySelector('[data-o]').value.trim();
      close(); saveCancel(c, d, m.querySelector('[data-r]').value + (o ? ' · ' + o : ''), done);
    });
  });
}

// novo cliente / editar cliente (nome, mensalidade, meses e data em que o contrato foi fechado)
function clientModal(c, months, done) {
  const isLead = c?.kind === 'lead';
  const e = c?.entry;
  const leadOpts = S.leads.filter((l) => !l.won_at).sort((x, y) => x.nome.localeCompare(y.nome));
  const fmtN = (n) => (Number(n) > 0 ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const parse = (v) => Number(String(v || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  modal(`<h3>${c ? 'Editar cliente' : 'Novo cliente'}</h3>
    <p class="help" style="margin-top:-4px">${c ? 'As mudanças valem pro MRR, churn e ticket médio.' : 'Use pra clientes que fecharam fora do pipeline ou antes do CRM.'}</p>
    <div class="row"><label class="lbl">Nome do cliente</label><input class="inp" data-n maxlength="120" value="${esc(c?.name || '')}" placeholder="Ex: Ferragista Silva"></div>
    <div class="grid3">
      <div class="row"><label class="lbl">Mensalidade (R$)</label><input class="inp" data-m inputmode="decimal" value="${fmtN(c?.monthly)}" placeholder="0,00"></div>
      <div class="row"><label class="lbl">Meses de contrato</label><input class="inp" data-mo inputmode="numeric" value="${c?.months || months}"></div>
      <div class="row"><label class="lbl">Contrato fechado em</label><input class="inp" type="date" data-d value="${c ? iso(c.start) : ''}" max="${iso(new Date())}" required></div>
    </div>
    <p class="help" data-tot></p>
    ${!c ? `<div class="row"><label class="lbl">Contato do cliente (opcional)</label><input class="inp" list="clNewLeads" data-lead placeholder="Busque pelo nome ou WhatsApp">
      <datalist id="clNewLeads">${leadOpts.slice(0, 800).map((l) => `<option value="${esc(`${l.nome} · ${l.whatsapp || l.email || ''}`)}"></option>`).join('')}</datalist>
      <p class="help">Ligando ao lead, a venda vai pra Meta com os dados dele e a campanha de origem.</p></div>` : ''}
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>${c ? 'Salvar' : 'Adicionar cliente'}</button></div>`, (m, close) => {
    const $m = (x) => m.querySelector(x);
    const tot = () => { const v = parse($m('[data-m]').value); const n = Math.round(parse($m('[data-mo]').value)); $m('[data-tot]').textContent = v > 0 && n > 0 ? `Contrato total: ${brl(v * n)}` : ''; };
    ['[data-m]', '[data-mo]'].forEach((x) => $m(x).addEventListener('input', tot)); tot();
    $m('[data-m]').addEventListener('blur', (ev) => { const v = parse(ev.target.value); if (v > 0) ev.target.value = fmtN(v); });
    if (!c) {
      $m('[data-lead]').addEventListener('change', (ev) => {
        const l = S.leads.find((x) => `${x.nome} · ${x.whatsapp || x.email || ''}` === ev.target.value);
        if (l && !$m('[data-n]').value.trim()) $m('[data-n]').value = l.nome;
      });
    }
    $m('[data-ok]').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const name = $m('[data-n]').value.trim(); const monthly = parse($m('[data-m]').value); const mo = Math.round(parse($m('[data-mo]').value)); const d = $m('[data-d]').value;
      if (name.length < 2) return toast('Informe o nome do cliente', true);
      if (!(monthly > 0)) return toast('Informe a mensalidade', true);
      if (!(mo >= 1 && mo <= 120)) return toast('Meses de contrato entre 1 e 120', true);
      if (!d) return toast('Informe quando o contrato foi fechado', true);
      let leadId = null;
      if (!c) {
        const txt = $m('[data-lead]').value.trim();
        const l = txt ? S.leads.find((x) => `${x.nome} · ${x.whatsapp || x.email || ''}` === txt) : null;
        if (txt && !l) return toast('Escolha um lead da lista ou deixe em branco', true);
        leadId = l?.id || null;
      }
      btn.disabled = true;
      try {
        if (isLead) {
          await DB.updateLeads([c.lead.id], { nome: name, valor: monthly, contract_months: mo === months ? null : mo, won_at: new Date(d + 'T12:00').toISOString() });
          Object.assign(c.lead, { nome: name, valor: monthly, contract_months: mo === months ? null : mo, won_at: new Date(d + 'T12:00').toISOString() });
        } else {
          await DB.saveFinance({ ...(e ? { id: e.id } : { kind: 'receita', category: 'Venda (contrato)', lead_id: leadId, created_by: S.me?.id?.startsWith('demo') ? null : S.me?.id }),
            description: name, date: d, months: mo, monthly_amount: monthly, amount: monthly * mo });
        }
        close(); toast(c ? 'Cliente atualizado' : 'Cliente adicionado');
        window.dispatchEvent(new Event('tracto:reload-leads'));
        done();
      } catch (err) { btn.disabled = false; fail(err); }
    });
  });
}

// origem da venda: escolhe campanha › conjunto › anúncio da Meta (e o lead, se for venda lançada)
function originModal(c, ins, done) {
  const camps = new Map();
  ins.forEach((x) => {
    const k = x.campaign_id || x.campaign_name; if (!k) return;
    const cp = camps.get(k) || { id: x.campaign_id, name: x.campaign_name, spend: 0, sets: new Map() };
    cp.spend += Number(x.spend);
    const sk = x.adset_id || x.adset_name;
    if (sk) { const st = cp.sets.get(sk) || { name: x.adset_name, ads: new Set() }; if (x.ad_name) st.ads.add(x.ad_name); cp.sets.set(sk, st); }
    camps.set(k, cp);
  });
  const clist = [...camps.values()].sort((x, y) => y.spend - x.spend);
  const o = c.origin || {};
  const needLead = c.kind === 'entry';
  const leadOpts = S.leads.filter((l) => !l.won_at || l.id === c.lead?.id).sort((x, y) => x.nome.localeCompare(y.nome));
  modal(`<h3>Origem da venda</h3>
    <p class="help" style="margin-top:-4px"><b>${esc(c.name)}</b>. Vendas de leads que chegaram pelos formulários já vêm com a origem sozinhas (pelos parâmetros de URL). Aqui você define para as vendas antigas ou lançadas à mão.</p>
    ${needLead ? `<div class="row"><label class="lbl">Contato do cliente</label><input class="inp" list="clLeads" data-lead placeholder="Busque pelo nome ou WhatsApp" value="${esc(c.lead ? `${c.lead.nome} · ${c.lead.whatsapp || c.lead.email || ''}` : '')}">
      <datalist id="clLeads">${leadOpts.slice(0, 800).map((l) => `<option value="${esc(`${l.nome} · ${l.whatsapp || l.email || ''}`)}"></option>`).join('')}</datalist>
      <p class="help">Com o lead ligado, a venda vai pra Meta com os dados dele (e-mail e telefone criptografados), o valor do contrato e a campanha. É isso que ensina a Meta a buscar quem compra.</p></div>` : ''}
    <div class="row"><label class="lbl">Campanha</label><select class="inp" data-cp><option value="">Selecione</option>${clist.map((cp, i) => `<option value="${i}" ${(o.utm_id && o.utm_id === cp.id) || o.utm_campaign === cp.name ? 'selected' : ''}>${esc(cp.name)}</option>`).join('')}<option value="manual">Outra (digitar)</option></select></div>
    <div class="row" data-manual hidden><label class="lbl">Nome da campanha</label><input class="inp" data-cpn maxlength="200" value="${esc(o.utm_campaign || '')}"></div>
    <div class="grid2">
      <div class="row"><label class="lbl">Conjunto (opcional)</label><select class="inp" data-st></select></div>
      <div class="row"><label class="lbl">Anúncio (opcional)</label><select class="inp" data-ad></select></div>
    </div>
    <div class="modal-foot">${o.utm_campaign ? '<button class="b b-ghost" data-clear style="margin-right:auto">Remover origem</button>' : ''}<button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar</button></div>`, (m, close) => {
    const $m = (s) => m.querySelector(s);
    const fill = () => {
      const v = $m('[data-cp]').value; const cp = clist[+v];
      $m('[data-manual]').hidden = v !== 'manual';
      const sets = cp ? [...cp.sets.values()] : [];
      $m('[data-st]').innerHTML = `<option value="">—</option>${sets.map((st, i) => `<option value="${i}" ${o.utm_term === st.name ? 'selected' : ''}>${esc(st.name)}</option>`).join('')}`;
      fillAds();
    };
    const fillAds = () => {
      const cp = clist[+$m('[data-cp]').value]; const st = cp ? [...cp.sets.values()][+$m('[data-st]').value] : null;
      const ads = st ? [...st.ads] : cp ? [...new Set([...cp.sets.values()].flatMap((x) => [...x.ads]))] : [];
      $m('[data-ad]').innerHTML = `<option value="">—</option>${ads.map((a) => `<option ${o.utm_content === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}`;
    };
    $m('[data-cp]').addEventListener('change', fill); $m('[data-st]').addEventListener('change', fillAds); fill();
    if (!clist.length || (o.utm_campaign && !clist.some((cp) => cp.name === o.utm_campaign))) { if (o.utm_campaign) { $m('[data-cp]').value = 'manual'; fill(); } }
    const save = async (org) => {
      try {
        let leadId = c.lead?.id || null;
        if (needLead) {
          const txt = $m('[data-lead]').value.trim();
          const l = txt ? S.leads.find((x) => `${x.nome} · ${x.whatsapp || x.email || ''}` === txt) : null;
          if (txt && !l) return toast('Escolha um lead da lista', true);
          leadId = l?.id || null;
        }
        if (c.kind === 'lead') {
          await DB.updateLeads([c.lead.id], { ...org, ...(org.utm_campaign ? { utm_source: c.lead.utm_source || 'facebook', source: 'pago' } : {}) });
          Object.assign(c.lead, org);
        } else {
          await DB.saveFinance({ id: c.entry.id, ...org, lead_id: leadId });
        }
        close(); toast(needLead && leadId && !c.entry.meta_sent_at ? 'Origem salva e venda enviada pra Meta' : 'Origem da venda salva');
        window.dispatchEvent(new Event('tracto:reload-leads'));
        done();
      } catch (e) { fail(e); }
    };
    $m('[data-clear]')?.addEventListener('click', () => save({ utm_campaign: null, utm_term: null, utm_content: null, utm_id: null }));
    $m('[data-ok]').addEventListener('click', () => {
      const v = $m('[data-cp]').value;
      if (!v) return toast('Escolha a campanha', true);
      if (v === 'manual') { const n = $m('[data-cpn]').value.trim(); if (!n) return toast('Digite o nome da campanha', true); return save({ utm_campaign: n, utm_term: null, utm_content: null, utm_id: null }); }
      const cp = clist[+v]; const st = [...cp.sets.values()][+$m('[data-st]').value];
      save({ utm_campaign: cp.name, utm_id: cp.id || null, utm_term: st?.name || null, utm_content: $m('[data-ad]').value || null });
    });
  });
}
