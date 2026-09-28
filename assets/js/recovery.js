// Aba "Recuperação": formulários começados e não concluídos (salvos automaticamente a cada resposta)
import { DB, LIVE } from '@shared/db.js';
import { formPath } from '@shared/forms.js';
import { go, S, $, $$, esc, ICON, initials, fmtPhone, fullDate, ago, num, pct, toast, fail, modal, confirmBox } from './util.js?v=2609281931';

const SITE = window.TRACTO_CONFIG?.siteUrl || 'https://assessoriatracto.com.br';
const STATUS = {
  abandonado: ['Abandonado', 'bad'], em_andamento: ['Preenchendo agora', 'wait'], recuperado: ['Recuperado', 'good'], descartado: ['Descartado', '']
};
const TABS = [['abandonado', 'Abandonados'], ['em_andamento', 'Em andamento'], ['recuperado', 'Recuperados'], ['descartado', 'Descartados'], ['todos', 'Todos']];
const R = { tab: 'abandonado', q: '', list: [] };

export const resumeLink = (p) => {
  const form = S.forms[p.form_id];
  const u = new URL(form ? formPath(form) : '/aplicar/', SITE);
  u.searchParams.set('retomar', p.resume_token);
  return u.toString();
};
const recoveryMsg = (p) => {
  const first = (p.nome || '').trim().split(/\s+/)[0];
  return `Oi${first ? ' ' + first : ''}, tudo bem? Aqui é da Tracto. Vi que você começou o diagnóstico pra sua loja e parou no meio. `
    + `Suas respostas ficaram salvas, é só continuar daqui (leva menos de 1 minuto): ${resumeLink(p)}`;
};
const waUrl = (p) => `https://wa.me/${String(p.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(recoveryMsg(p))}`;
const hasContact = (p) => !!(p.whatsapp || p.email);

export async function loadPartials() {
  await DB.sweepPartials();
  S.partials = await DB.listPartials();
  return S.partials;
}

export async function renderRecovery(el, { quiet = false } = {}) {
  if (!quiet) el.innerHTML = '<div class="loading">Carregando…</div>';
  try { await loadPartials(); } catch (e) { fail(e); S.partials = []; }
  if (!el.isConnected) return;
  paint(el);
}

function paint(el) {
  const all = S.partials || [];
  const since = Date.now() - 30 * 86400000;
  const abandoned = all.filter((p) => p.status === 'abandonado');
  const recovered = all.filter((p) => p.status === 'recuperado' && new Date(p.updated_at) >= since);
  const live = all.filter((p) => p.status === 'em_andamento');
  const q = R.q.trim().toLowerCase();
  const list = all.filter((p) => (R.tab === 'todos' || p.status === R.tab) &&
    (!q || [p.nome, p.email, p.instagram, p.utm_campaign].some((v) => (v || '').toLowerCase().includes(q)) || (q.replace(/\D/g, '').length >= 3 && String(p.whatsapp || '').includes(q.replace(/\D/g, '')))));

  el.innerHTML = `
    <div class="topline"><h1>Recuperação</h1><div class="grow"></div><button class="b b-refresh" data-reload>${ICON.refresh}Atualizar</button></div>
    <p class="muted" style="margin:-6px 0 14px;max-width:760px;line-height:1.55">Cada resposta do formulário é salva na hora. Quem para no meio aparece aqui com o que já preencheu. Depois de 30 minutos parado vira <b style="color:var(--c-text);font-weight:400">abandonado</b>. Mande o link de retomada: a pessoa continua de onde parou, sem digitar de novo.</p>
    <section class="panel kpis">
      <div class="k warn"><span>Abandonados com contato:</span><b>${num(abandoned.filter(hasContact).length)}</b></div>
      <div class="k"><span>Sem contato:</span><b>${num(abandoned.filter((p) => !hasContact(p)).length)}</b></div>
      <div class="k hot"><span>Preenchendo agora:</span><b>${num(live.length)}</b></div>
      <div class="k"><span>Recuperados (30 dias):</span><b>${num(recovered.length)}</b></div>
      <div class="k"><span>Taxa de recuperação:</span><b>${pct(recovered.length, recovered.length + abandoned.filter(hasContact).length)}</b></div>
    </section>
    <section class="panel toolbar">
      <div class="tb-row">
        <div class="seg">${TABS.map(([k, n]) => `<button class="b ${R.tab === k ? 'on' : ''}" data-tab="${k}">${n}${k !== 'todos' ? ` <span class="muted">${all.filter((p) => p.status === k).length}</span>` : ''}</button>`).join('')}</div>
        <div class="grow"></div>
        <label class="search">${ICON.search}<input class="inp" data-q type="search" placeholder="Buscar nome, WhatsApp, e-mail" value="${esc(R.q)}"></label>
      </div>
    </section>
    <div style="height:12px"></div>
    ${list.length ? `<div class="panel table-wrap"><table class="rec-table"><thead><tr><th>Pessoa</th><th>Contato</th><th>Progresso</th><th>Formulário</th><th>Origem</th><th>Última resposta</th><th></th></tr></thead><tbody>
      ${list.map((p) => {
        const total = p.total_steps || 6; const done = Math.min(p.step_index || 0, total);
        const [label, cls] = STATUS[p.status] || [p.status, ''];
        const step = S.forms[p.form_id]?.fields.find((f) => f.id === p.step_id);
        return `<tr data-id="${p.id}">
          <td><div class="td-lead"><span class="av">${esc(initials(p.nome || '?'))}</span><div><b>${esc(p.nome || 'Sem nome ainda')}</b><small><span class="pill ${cls}">${label}</span>${p.contacted_at ? ' <span class="pill">Contatado</span>' : ''}</small></div></div></td>
          <td class="nowrap">${p.whatsapp ? esc(fmtPhone(p.whatsapp)) : '<span class="muted">sem WhatsApp</span>'}${p.email ? `<br><small class="muted">${esc(p.email)}</small>` : ''}</td>
          <td style="min-width:170px"><div class="prog"><i style="width:${(done / total) * 100}%"></i></div><small class="muted">${done} de ${total} · parou em ${esc(step ? step.title.replace(/<[^>]+>/g, '').replace(/\{\{[^}]+\}\}/g, '…').slice(0, 42) : p.step_id || '—')}</small></td>
          <td>${esc((p.form_name || p.form_id || '').replace('Assessoria Tracto - ', ''))}</td>
          <td>${esc(p.utm_campaign || p.utm_source || '—')}</td>
          <td class="nowrap" title="${fullDate(p.updated_at)}">${ago(p.updated_at)}</td>
          <td class="rec-actions">
            ${p.status === 'abandonado' || p.status === 'em_andamento' ? `
              ${p.whatsapp ? `<a class="b b-sm b-primary" href="${waUrl(p)}" target="_blank" rel="noopener" data-wa>${ICON.wa}Recuperar</a>` : ''}
              <button class="b b-sm" data-copy-link title="Copiar link de retomada">Link</button>
              <button class="b b-sm" data-convert title="Colocar no pipeline sem esperar">Virar lead</button>
              <button class="b b-sm b-ghost" data-discard aria-label="Descartar">×</button>` : p.lead_id ? '<button class="b b-sm" data-open-lead>Ver lead</button>' : ''}
          </td>
        </tr>`;
      }).join('')}
    </tbody></table></div>` : `<div class="panel empty"><h3>Nada por aqui</h3><p>${R.tab === 'abandonado' ? 'Nenhum formulário abandonado. Quando alguém parar no meio, aparece aqui.' : 'Nenhum registro nesse filtro.'}</p></div>`}`;

  const reload = () => renderRecovery(el, { quiet: true });
  el.querySelector('[data-reload]').addEventListener('click', (e) => { e.currentTarget.classList.add('is-spinning'); reload(); });
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { R.tab = b.dataset.tab; paint(el); }));
  const qi = el.querySelector('[data-q]');
  qi.addEventListener('input', () => { R.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { const pos = qi.selectionStart; paint(el); const n = el.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); }, 180); });

  el.querySelectorAll('tr[data-id]').forEach((row) => {
    const p = all.find((x) => x.id === row.dataset.id);
    row.addEventListener('click', (e) => { if (!e.target.closest('button, a')) detail(p, reload); });
    row.querySelector('[data-wa]')?.addEventListener('click', () => markContacted(p));
    row.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(resumeLink(p)); toast('Link de retomada copiado'); } catch (e) { toast('Não consegui copiar', true); }
    });
    row.querySelector('[data-convert]')?.addEventListener('click', () => convert(p, reload));
    row.querySelector('[data-discard]')?.addEventListener('click', async () => {
      if (!(await confirmBox(`Descartar o formulário de ${p.nome || 'sem nome'}?`, 'Descartar'))) return;
      try { await DB.updatePartial(p.id, { status: 'descartado', updated_at: new Date().toISOString() }); toast('Descartado'); reload(); } catch (e) { fail(e); }
    });
    row.querySelector('[data-open-lead]')?.addEventListener('click', () => { go('leads'); setTimeout(() => window.dispatchEvent(new CustomEvent('tracto:open-lead', { detail: p.lead_id })), 120); });
  });
}

async function markContacted(p) {
  if (p.contacted_at) return;
  p.contacted_at = new Date().toISOString();
  try { await DB.updatePartial(p.id, { contacted_at: p.contacted_at, contacted_by: S.me?.id && LIVE ? S.me.id : null }); } catch (e) { /* não bloqueia o WhatsApp */ }
}

async function convert(p, done) {
  if (!p.nome) return toast('Precisa ter pelo menos o nome pra virar lead', true);
  if (!(await confirmBox(`Colocar ${p.nome} no pipeline agora? Ele entra como recuperado e não conta como conversão nos anúncios.`, 'Virar lead', false))) return;
  try {
    const id = await DB.convertPartial(p.id);
    toast('Lead criado no pipeline');
    window.dispatchEvent(new CustomEvent('tracto:reload-leads', { detail: id }));
    done();
  } catch (e) { fail(e); }
}

function detail(p, done) {
  const form = S.forms[p.form_id];
  const answered = new Map((p.answers || []).map((a) => [a.id, a]));
  const questions = form ? form.fields.filter((f) => !['welcome', 'thankyou', 'statement'].includes(f.type)) : [];
  modal(`<h3>${esc(p.nome || 'Sem nome ainda')}</h3>
    <p class="help">${esc(p.form_name || p.form_id)} · começou ${esc(fullDate(p.created_at))} · última resposta ${esc(ago(p.updated_at))} atrás</p>
    <div class="answers" style="margin:14px 0">${questions.length ? questions.map((f) => {
      const a = answered.get(f.id);
      const title = f.title.replace(/<[^>]+>/g, '').replace(/\{\{[^}]+\}\}/g, '…');
      return `<div><div class="q">${esc(title)}</div><div class="a ${a ? '' : 'muted'}" style="${a ? '' : 'font-weight:400'}">${a ? esc(a.value) : 'não respondeu'}</div></div>`;
    }).join('') : (p.answers || []).map((a) => `<div><div class="q">${esc(a.label)}</div><div class="a">${esc(a.value)}</div></div>`).join('')}</div>
    <div class="row"><label class="lbl">Link de retomada</label><div class="code"><div class="code-h"><span>O formulário abre já preenchido</span><button class="b b-sm b-ghost" data-copy>Copiar</button></div><pre>${esc(resumeLink(p))}</pre></div></div>
    <div class="row"><label class="lbl">Mensagem sugerida</label><textarea class="inp" rows="4" data-msg>${esc(recoveryMsg(p))}</textarea></div>
    <div class="modal-foot">
      <button class="b" data-close>Fechar</button>
      ${p.status === 'abandonado' || p.status === 'em_andamento' ? `<button class="b" data-convert>Virar lead</button>${p.whatsapp ? `<a class="b b-primary" data-wa target="_blank" rel="noopener">${ICON.wa}Enviar no WhatsApp</a>` : ''}` : ''}
    </div>`, (c, close) => {
    c.addEventListener('click', async (e) => {
      if (e.target.closest('[data-copy]')) { try { await navigator.clipboard.writeText(resumeLink(p)); toast('Link copiado'); } catch (err) { toast('Não consegui copiar', true); } }
    });
    const wa = c.querySelector('[data-wa]');
    if (wa) {
      const sync = () => { wa.href = `https://wa.me/${String(p.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(c.querySelector('[data-msg]').value)}`; };
      sync(); c.querySelector('[data-msg]').addEventListener('input', sync);
      wa.addEventListener('click', () => { markContacted(p); });
    }
    c.querySelector('[data-convert]')?.addEventListener('click', () => { close(); convert(p, done); });
  });
}
