// Lançamento único do Financeiro: Venda, Outra receita ou Despesa.
// A venda é a mesma da Central de leads: ligada a um contato, o banco atualiza o lead (valor, contrato, data e estágio) e vice-versa.
import { DB } from '@shared/db.js';
import { S, esc, ICON, toast, fail, modal, confirmBox } from './util.js?v=2610230944';
import { contractFields, bindContract } from './contract.js?v=2610230944';

const SALE_CATS = ['Venda (contrato)', 'Contrato'];
const CATS = { despesa: ['Ferramentas', 'Equipe', 'Comissões', 'Impostos', 'Tráfego (outras plataformas)', 'Outros'], receita: ['Setup', 'Consultoria', 'Outros'] };
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const parse = (v) => Number(String(v || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
const fmt = (n) => (Number(n) > 0 ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const leadLabel = (l) => `${l.nome} · ${l.whatsapp || l.email || ''}`;
// de onde veio o cliente: só "Anúncio" entra em ROAS, CAC e campanhas (e só ele vai pra Meta)
const ORIGINS = [['pago', 'Anúncio'], ['indicacao', 'Indicação'], ['local', 'Local'], ['organico', 'Orgânico']];
const originOf = (entry, lead) => (entry && entry.source ? entry.source : lead && ['indicacao', 'local', 'organico'].includes(lead.source) ? lead.source : 'pago');

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
      <div class="row"><span class="lbl">Origem da venda</span><div class="seg en-origin" role="radiogroup" aria-label="Origem da venda">${ORIGINS.map(([k, n]) => `<button type="button" class="b ${originOf(entry, lead) === k ? 'on' : ''}" role="radio" aria-checked="${originOf(entry, lead) === k}" data-origin="${k}">${n}</button>`).join('')}</div>
        <p class="help" data-origin-help></p></div>
      ${lead ? '' : `<div class="row" data-contact><label class="lbl" for="enLead">Contato do cliente <span class="muted" style="text-transform:none;letter-spacing:0">(opcional)</span></label>
        <div class="en-contact" data-pick-contact><input class="inp" id="enLead" list="enLeads" data-lead placeholder="Nome, WhatsApp ou e-mail" autocomplete="off"><button type="button" class="b" data-new-contact>${ICON.user}Cadastrar novo</button></div>
        <datalist id="enLeads">${leadOpts.slice(0, 800).map((l) => `<option value="${esc(leadLabel(l))}"></option>`).join('')}</datalist>
        <div class="en-newc" data-newc hidden>
          <div class="grid2"><div class="row"><label class="lbl" for="enNcW">WhatsApp</label><input class="inp" id="enNcW" data-nc-wa inputmode="tel" placeholder="(62) 99999-9999"></div>
            <div class="row"><label class="lbl" for="enNcE">E-mail <span class="muted" style="text-transform:none;letter-spacing:0">(opcional)</span></label><input class="inp" id="enNcE" data-nc-email type="email" autocomplete="off"></div></div>
          <p class="help">O contato entra na Central de leads já como venda, com o nome do cliente acima. <button type="button" class="link" data-cancel-newc>Buscar um contato existente</button></p>
        </div>
        <p class="help" data-contact-help>Escolha da lista ou digite o WhatsApp ou o e-mail: se o contato não existir, ele é cadastrado na hora. Sem contato, a venda fica só no Financeiro.</p></div>`}
      ${contractFields({ service: entry?.service, plan: entry?.plan || (isSale(entry) ? ({ 6: 'semestral', 12: 'anual' })[entry.months] || 'mensal' : 'mensal'), months: entry?.months, monthly: entry?.monthly_amount, total: isSale(entry) ? entry.amount : null, first: entry?.first_amount })}
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
    // origem da venda
    let origin = originOf(entry, lead);
    const ORIGIN_HELP = { pago: 'Veio dos anúncios: entra no ROAS, no CAC e no relatório das campanhas.', indicacao: 'Veio por indicação: não entra no ROAS nem no CAC dos anúncios e não vai pra Meta.', local: 'Cliente local ou presencial: não entra no ROAS nem no CAC dos anúncios e não vai pra Meta.', organico: 'Veio do orgânico (redes sociais, site, busca): não entra no ROAS nem no CAC dos anúncios.' };
    const setOrigin = (k) => { origin = k; c.querySelectorAll('[data-origin]').forEach((b) => { const on = b.dataset.origin === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); $('[data-origin-help]').textContent = ORIGIN_HELP[k]; };
    c.querySelectorAll('[data-origin]').forEach((b) => b.addEventListener('click', () => setOrigin(b.dataset.origin)));
    setOrigin(origin);
    // contato: escolher um da Central de leads ou cadastrar um novo na hora
    let newContact = false;
    const toggleNew = (on) => { newContact = on; $('[data-newc]').hidden = !on; $('[data-pick-contact]').hidden = on; $('[data-contact-help]').hidden = on; if (on) { $('[data-lead]').value = ''; setTimeout(() => $('[data-nc-wa]').focus(), 30); } };
    $('[data-new-contact]')?.addEventListener('click', () => toggleNew(true));
    $('[data-cancel-newc]')?.addEventListener('click', () => toggleNew(false));
    $('[data-lead]')?.addEventListener('change', (e) => { const l = S.leads.find((x) => leadLabel(x) === e.target.value); if (l && !$('[data-name]').value.trim()) $('[data-name]').value = l.nome; if (l && !entry && ['indicacao', 'local', 'organico'].includes(l.source)) setOrigin(l.source); });
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
        if (txt && !newContact) {
          // aceita escolher da lista, ou digitar o WhatsApp/e-mail: acha o contato que já existe ou cadastra um novo
          const digits = txt.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
          const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(txt) ? txt.toLowerCase() : '';
          const l = S.leads.find((x) => leadLabel(x) === txt)
            || (digits.length >= 10 && S.leads.find((x) => String(x.whatsapp || '').replace(/\D/g, '').endsWith(digits)))
            || (email && S.leads.find((x) => (x.email || '').toLowerCase() === email));
          if (l) leadId = l.id;
          else if (digits.length >= 10 && digits.length <= 11) { newContact = true; $('[data-nc-wa]').value = digits; }
          else if (email) { newContact = true; $('[data-nc-email]').value = email; }
          else return toast('Contato não encontrado. Digite o WhatsApp com DDD ou o e-mail para cadastrar, ou escolha um da lista.', true);
        }
        if (!name && !leadId) return toast('Informe o cliente', true);
        if (!date) return toast('Informe a data da venda', true);
        const v = ctr.read(); if (v.error) return toast(v.error, true);
        // contato novo (cliente local, indicação...): entra na Central de leads e a venda liga nele
        if (newContact) {
          if (name.length < 2) return toast('Informe o nome do cliente', true);
          const d = $('[data-nc-wa]').value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
          if (!d && !$('[data-nc-email]').value.trim()) return toast('Informe o WhatsApp ou o e-mail do contato', true);
          if (d && (d.length < 10 || d.length > 11)) return toast('WhatsApp precisa de DDD + número', true);
          const first = [...S.stages].filter((x) => x.kind === 'open').sort((a, b) => a.position - b.position)[0];
          btn.disabled = true;
          try {
            const nl = await DB.createLead({ nome: name, whatsapp: d ? '55' + d : null, email: $('[data-nc-email]').value.trim().toLowerCase() || null, stage_id: first?.id, assigned_to: S.me?.id?.startsWith('demo') ? null : S.me?.id || null,
              form_id: 'manual', form_name: 'Venda lançada no Financeiro', source: origin === 'pago' ? 'manual' : origin, answers: [] });
            S.leads.unshift(nl); leadId = nl.id;
          } catch (err) { btn.disabled = false; return fail(err); }
        }
        row = { kind: 'receita', category: 'Venda (contrato)', description: name || S.leads.find((x) => x.id === leadId)?.nome, date, lead_id: leadId, ...v, source: origin,
          canceled_at: v.plan === 'unico' ? null : $('[data-canceled]').value || null, expense_type: null };
      } else {
        const amount = parse($('[data-amount]').value); const date = $('[data-date]').value;
        if (!date) return toast('Informe a data', true);
        if (!(amount > 0)) return toast('Informe um valor', true);
        row = { kind: type, category: $('[data-cat]').value, description: $('[data-desc]').value.trim() || null, date, amount, months: null, monthly_amount: null, first_amount: null, service: null, plan: null,
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
