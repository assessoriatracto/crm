// Lançamento único do Financeiro: Venda, Outra receita ou Despesa.
// A venda é a mesma da Central de leads: ligada a um contato, o banco atualiza o lead (valor, contrato, data e estágio) e vice-versa.
import { DB } from '@shared/db.js';
import { S, esc, toast, fail, modal, confirmBox } from './util.js?v=2609291926';
import { contractFields, bindContract } from './contract.js?v=2609291926';

const SALE_CATS = ['Venda (contrato)', 'Contrato'];
const CATS = { despesa: ['Ferramentas', 'Equipe', 'Comissões', 'Impostos', 'Tráfego (outras plataformas)', 'Outros'], receita: ['Setup', 'Consultoria', 'Outros'] };
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const parse = (v) => Number(String(v || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
const fmt = (n) => (Number(n) > 0 ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const leadLabel = (l) => `${l.nome} · ${l.whatsapp || l.email || ''}`;

// opts.kind: 'venda' | 'receita' | 'despesa' (abre direto nesse tipo e esconde a escolha)
export function entryModal(done, entry = null, opts = {}) {
  const isSale = (e) => e && e.kind === 'receita' && SALE_CATS.includes(e.category);
  let type = entry ? (isSale(entry) ? 'venda' : entry.kind) : opts.kind || 'venda';
  const fixedEntry = !!entry?.recurring_id;
  const lead = entry?.lead_id ? S.leads.find((l) => l.id === entry.lead_id) : null;
  // contatos que ainda não têm venda (uma venda por cliente)
  const leadOpts = S.leads.filter((l) => l.id === lead?.id || !(l.won_at && Number(l.valor) > 0)).sort((a, b) => a.nome.localeCompare(b.nome));
  const title = entry ? (type === 'venda' ? 'Editar venda' : fixedEntry ? 'Editar despesa fixa (este mês)' : 'Editar lançamento') : opts.kind === 'despesa' ? 'Nova despesa variável' : type === 'venda' ? 'Nova venda' : 'Novo lançamento';
  const catOpts = (k) => [...new Set([...(CATS[k] || []), ...(entry && entry.kind === k && !isSale(entry) ? [entry.category] : [])])].map((c) => `<option ${entry?.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('');
  modal(`<h3>${title}</h3>
    ${fixedEntry ? '<p class="help" style="margin-top:-4px">O que mudar aqui vale só para este mês. O valor dos próximos meses se edita em Financeiro › Despesas.</p>' : ''}
    ${entry?.from_pipeline || lead ? `<p class="help" style="margin-top:-4px">Venda ligada a <b>${esc(lead?.nome || entry.description || '')}</b> na Central de leads. O que mudar aqui muda lá também.</p>` : ''}
    <div class="row" ${entry || opts.kind ? 'hidden' : ''}><div class="seg en-types" role="radiogroup" aria-label="Tipo de lançamento">
      ${[['venda', 'Venda'], ['receita', 'Outra receita'], ['despesa', 'Despesa']].map(([k, n]) => `<button type="button" class="b ${type === k ? 'on' : ''}" role="radio" aria-checked="${type === k}" data-t="${k}">${n}</button>`).join('')}</div></div>

    <div data-for="venda">
      <div class="grid2">
        <div class="row"><label class="lbl" for="enName">Cliente</label><input class="inp" id="enName" data-name maxlength="200" placeholder="Ex: Ferragista Silva" value="${esc(isSale(entry) ? entry.description || lead?.nome || '' : '')}"></div>
        <div class="row"><label class="lbl" for="enSD">Venda realizada em</label><input class="inp" type="date" id="enSD" data-sdate value="${isSale(entry) ? entry.date : iso(new Date())}" max="${iso(new Date())}" required></div>
      </div>
      ${lead ? '' : `<div class="row"><label class="lbl" for="enLead">Contato do cliente <span class="muted" style="text-transform:none;letter-spacing:0">(opcional)</span></label><input class="inp" id="enLead" list="enLeads" data-lead placeholder="Busque pelo nome ou WhatsApp" autocomplete="off">
        <datalist id="enLeads">${leadOpts.slice(0, 800).map((l) => `<option value="${esc(leadLabel(l))}"></option>`).join('')}</datalist>
        <p class="help">Ligando ao contato, a venda aparece na Central de leads e vai pra Meta com a campanha de origem.</p></div>`}
      ${contractFields({ service: entry?.service, plan: entry?.plan || (isSale(entry) ? ({ 6: 'semestral', 12: 'anual' })[entry.months] || 'mensal' : 'mensal'), months: entry?.months, monthly: entry?.monthly_amount, total: isSale(entry) ? entry.amount : null })}
      <div class="row" data-cancel-row><label class="lbl" for="enCan">Contrato cancelado em <span class="muted" style="text-transform:none;letter-spacing:0">(opcional, entra no churn)</span></label><input class="inp" type="date" id="enCan" data-canceled value="${entry?.canceled_at || ''}"></div>
    </div>

    <div data-for="receita despesa" hidden>
      <div class="grid2">
        <div class="row"><label class="lbl" for="enCat">Categoria</label><select class="inp" id="enCat" data-cat>${catOpts(type === 'venda' ? 'receita' : type)}</select></div>
        <div class="row"><label class="lbl" for="enD" data-date-l>Data</label><input class="inp" type="date" id="enD" data-date value="${entry && !isSale(entry) ? entry.date : iso(new Date())}"></div>
      </div>
      <div class="grid2">
        <div class="row"><label class="lbl" for="enV">Valor (R$)</label><input class="inp" id="enV" data-amount inputmode="decimal" placeholder="R$ 0,00" value="${entry && !isSale(entry) ? fmt(entry.amount) : ''}"></div>
        <div class="row"><label class="lbl" for="enDs">Descrição</label><input class="inp" id="enDs" data-desc maxlength="200" value="${esc(entry && !isSale(entry) ? entry.description || '' : '')}"></div>
      </div>
    </div>
    <div class="modal-foot">${entry ? '<button class="b b-danger" data-del style="margin-right:auto">Excluir</button>' : ''}<button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar</button></div>`, (c, close) => {
    const $ = (sel) => c.querySelector(sel);
    const ctr = bindContract(c);
    const layout = () => {
      c.querySelectorAll('[data-for]').forEach((x) => { x.hidden = !x.dataset.for.split(' ').includes(type); });
      if (type !== 'venda') { $('[data-cat]').innerHTML = catOpts(type); $('[data-date-l]').textContent = type === 'despesa' ? 'Data do pagamento' : 'Data'; $('[data-desc]').placeholder = type === 'despesa' ? 'Ex: Comissão do vendedor' : 'Ex: Setup da loja'; }
      $('[data-cancel-row]').hidden = $('[data-plan]').value === 'unico';
    };
    c.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
      type = b.dataset.t; c.querySelectorAll('[data-t]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); }); layout();
    }));
    $('[data-plan]').addEventListener('change', layout);
    $('[data-lead]')?.addEventListener('change', (e) => { const l = S.leads.find((x) => leadLabel(x) === e.target.value); if (l && !$('[data-name]').value.trim()) $('[data-name]').value = l.nome; });
    $('[data-amount]').addEventListener('blur', (e) => { const v = parse(e.target.value); if (v > 0) e.target.value = fmt(v); });
    layout();
    $('[data-del]')?.addEventListener('click', async () => {
      const msg = fixedEntry ? 'Excluir o lançamento deste mês? A despesa fixa continua nos próximos meses.' : lead ? `Excluir a venda de ${lead.nome}? Ela também sai da Central de leads (o contato continua lá).` : 'Excluir este lançamento?';
      if (!(await confirmBox(msg, 'Excluir'))) return;
      try { await DB.deleteFinance(entry.id); close(); toast('Lançamento excluído'); window.dispatchEvent(new Event('tracto:reload-leads')); done(); } catch (err) { fail(err); }
    });
    $('[data-ok]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      let row;
      if (type === 'venda') {
        const name = $('[data-name]').value.trim(); const date = $('[data-sdate]').value;
        let leadId = lead?.id || null;
        const txt = $('[data-lead]')?.value.trim();
        if (txt) { const l = S.leads.find((x) => leadLabel(x) === txt); if (!l) return toast('Escolha um contato da lista ou deixe em branco', true); leadId = l.id; }
        if (!name && !leadId) return toast('Informe o cliente', true);
        if (!date) return toast('Informe a data da venda', true);
        const v = ctr.read(); if (v.error) return toast(v.error, true);
        row = { kind: 'receita', category: 'Venda (contrato)', description: name || S.leads.find((x) => x.id === leadId)?.nome, date, lead_id: leadId, ...v,
          canceled_at: v.plan === 'unico' ? null : $('[data-canceled]').value || null, expense_type: null };
      } else {
        const amount = parse($('[data-amount]').value); const date = $('[data-date]').value;
        if (!date) return toast('Informe a data', true);
        if (!(amount > 0)) return toast('Informe um valor', true);
        row = { kind: type, category: $('[data-cat]').value, description: $('[data-desc]').value.trim() || null, date, amount, months: null, monthly_amount: null, service: null, plan: null,
          expense_type: type === 'despesa' ? (fixedEntry ? 'fixa' : 'variavel') : null };
      }
      if (entry) row.id = entry.id; else row.created_by = S.me?.id?.startsWith('demo') ? null : S.me?.id;
      btn.disabled = true;
      try {
        await DB.saveFinance(row);
        close(); toast(entry ? 'Lançamento atualizado' : type === 'venda' ? 'Venda lançada' : 'Lançamento salvo');
        if (type === 'venda') window.dispatchEvent(new Event('tracto:reload-leads')); // o lead ligado muda junto
        done();
      } catch (err) { btn.disabled = false; fail(/duplicate|unique/i.test(err.message) ? new Error('Esse contato já tem uma venda. Edite a venda dele em Financeiro › Clientes.') : err); }
    });
  });
}
