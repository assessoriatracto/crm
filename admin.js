// Páginas "Formulários" e "Ajustes"
import { DB, LIVE } from '@shared/db.js';
import { formPath } from '@shared/forms.js';
import { S, $, $$, esc, COLORS, num, pct, toast, fail, confirmBox } from './util.js?v=3217c3c';
import { stageModal, moveStage, deleteStageFlow } from './app.js?v=3217c3c';

const QTYPES = ['short_text', 'long_text', 'email', 'phone', 'number', 'url', 'date', 'choice', 'multi', 'dropdown', 'yes_no', 'rating', 'scale', 'consent'];
const SITE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? location.origin : (window.TRACTO_CONFIG?.siteUrl || location.origin);
const formUrl = (id, utm = {}) => {
  const u = new URL(formPath(S.forms[id]), SITE);
  Object.entries(utm).forEach(([k, v]) => v && u.searchParams.set(k, v));
  return u.toString();
};

// ============================================================
// FORMULÁRIOS
// ============================================================
export async function renderForms(el) {
  const forms = Object.values(S.forms);
  el.innerHTML = `
    <div class="topline"><h1>Formulários</h1><div class="grow"></div><span class="muted">Últimos 30 dias</span></div>
    <div class="forms-grid">${forms.map((f) => {
      const qs = f.fields.filter((x) => QTYPES.includes(x.type));
      const rules = f.fields.filter((x) => x.logic?.length || x.showIf || x.next).length;
      return `<section class="panel form-card" data-form="${f.id}">
        <div><h3>${esc(f.name)}</h3><p class="muted" style="margin:4px 0 0">${qs.length} perguntas · ${qs.filter((q) => q.required).length} obrigatórias${rules ? ` · ${rules} regra${rules > 1 ? 's' : ''} de fluxo` : ''}</p></div>
        <div class="url">${esc(formUrl(f.id))}</div>
        <div class="form-stats"><div><b data-s="views">…</b><span>Visitas</span></div><div><b data-s="starts">…</b><span>Começaram</span></div><div><b data-s="leads">…</b><span>Leads</span></div><div><b data-s="rate">…</b><span>Conversão</span></div></div>
        <details><summary class="muted" style="cursor:pointer">Gerar link com UTM</summary>
          <div class="grid2" style="margin-top:10px"><input class="inp" data-utm="utm_source" placeholder="utm_source (ex: facebook)"><input class="inp" data-utm="utm_medium" placeholder="utm_medium (ex: paid_social)"></div>
          <input class="inp" data-utm="utm_campaign" placeholder="utm_campaign (ex: diagnostico-ferragistas)" style="margin-top:10px">
        </details>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="b b-primary" href="${esc(formUrl(f.id))}" target="_blank" rel="noopener">Abrir formulário</a><button class="b" data-copy>Copiar link</button></div>
      </section>`;
    }).join('')}</div>
    <p class="muted" style="margin-top:16px;line-height:1.6">Os formulários ficam em <b style="color:var(--c-text);font-weight:400">assets/js/forms.js</b>. Cada campo aceita tipo, obrigatório/opcional, condição pra aparecer (showIf) e regras de salto (logic). O form "Diagnóstico completo" é um modelo com todos os recursos.</p>`;

  el.querySelectorAll('.form-card').forEach((card) => {
    const id = card.dataset.form;
    const link = () => formUrl(id, Object.fromEntries($$('[data-utm]', card).map((i) => [i.dataset.utm, i.value.trim()])));
    card.querySelectorAll('[data-utm]').forEach((i) => i.addEventListener('input', () => { card.querySelector('.url').textContent = link(); card.querySelector('a.b-primary').href = link(); }));
    card.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link()); toast('Link copiado'); } catch (e) { toast('Não consegui copiar. Selecione o link acima.', true); }
    });
  });

  try {
    const from = new Date(Date.now() - 30 * 86400000);
    const ev = await DB.listEvents(from.toISOString());
    if (!el.isConnected) return;
    el.querySelectorAll('.form-card').forEach((card) => {
      const id = card.dataset.form;
      const sess = (t) => new Set(ev.filter((e) => e.form_id === id && e.event === t).map((e) => e.session_id)).size;
      const views = sess('view'); const starts = sess('start');
      const leads = S.leads.filter((l) => l.form_id === id && new Date(l.created_at) >= from).length;
      card.querySelector('[data-s="views"]').textContent = num(views);
      card.querySelector('[data-s="starts"]').textContent = num(starts);
      card.querySelector('[data-s="leads"]').textContent = num(leads);
      card.querySelector('[data-s="rate"]').textContent = views ? pct(leads, views) : '—';
    });
  } catch (e) { fail(e); }
}

// ============================================================
// AJUSTES
// ============================================================
export function renderSettings(el, reload) {
  el.innerHTML = `
    <div class="topline"><h1>Ajustes</h1></div>
    <div class="settings">
      <section class="panel">
        <h3>Estágios do pipeline</h3>
        <p class="help">Estágios "Ganho" contam como convertidos no dashboard.</p>
        <div data-stages>${S.stages.map((s, i) => `
          <div class="srow" data-id="${s.id}">
            <input type="color" value="${s.color}" data-sf="color" aria-label="Cor">
            <input class="inp grow" value="${esc(s.name)}" maxlength="40" data-sf="name" aria-label="Nome">
            <select class="inp" data-sf="kind" style="width:auto"><option value="open" ${s.kind === 'open' ? 'selected' : ''}>Andamento</option><option value="won" ${s.kind === 'won' ? 'selected' : ''}>Ganho</option><option value="lost" ${s.kind === 'lost' ? 'selected' : ''}>Perdido</option></select>
            <button class="b b-sm b-ghost" data-mv="-1" ${i ? '' : 'disabled'} aria-label="Subir">↑</button>
            <button class="b b-sm b-ghost" data-mv="1" ${i < S.stages.length - 1 ? '' : 'disabled'} aria-label="Descer">↓</button>
            <button class="b b-sm b-danger" data-del aria-label="Excluir">×</button>
          </div>`).join('')}</div>
        <button class="b" style="margin-top:12px" data-add-stage>+ Adicionar estágio</button>
      </section>

      <section class="panel">
        <h3>Rótulos</h3>
        <p class="help">Etiquetas pra organizar leads (ex: Prioridade, Indicação, Retornar).</p>
        <div data-labels>${S.labels.map((x) => `
          <div class="srow" data-id="${x.id}">
            <input type="color" value="${x.color}" data-lf="color" aria-label="Cor">
            <input class="inp grow" value="${esc(x.name)}" maxlength="30" data-lf="name" aria-label="Nome">
            <span class="muted nowrap">${S.leads.filter((l) => (l.label_ids || []).includes(x.id)).length} leads</span>
            <button class="b b-sm b-danger" data-ldel aria-label="Excluir">×</button>
          </div>`).join('') || '<p class="muted">Nenhum rótulo ainda.</p>'}</div>
        <div class="srow"><input class="inp grow" data-new-label placeholder="Novo rótulo" maxlength="30"><button class="b b-primary b-sm" data-add-label>Criar</button></div>
      </section>

      <section class="panel">
        <h3>Equipe</h3>
        <p class="help">${LIVE ? 'Pra adicionar alguém: Supabase > Authentication > Users > Add user. A pessoa aparece aqui inativa e você libera o acesso.' : 'No modo demo a equipe é fictícia.'}</p>
        ${S.profiles.map((p) => `
          <div class="srow" data-id="${p.id}">
            <span class="av sm" style="width:30px;height:30px;font-size:11px">${esc(p.nome.slice(0, 2).toUpperCase())}</span>
            <div class="grow"><div>${esc(p.nome)}${p.id === S.me?.id ? ' <span class="muted">(você)</span>' : ''}</div><div class="muted" style="font-size:12px">${esc(p.email)}</div></div>
            <button class="switch ${p.ativo ? 'on' : ''}" data-toggle ${p.id === S.me?.id ? 'disabled' : ''} aria-label="Acesso ativo"></button>
          </div>`).join('')}
      </section>
    </div>`;

  const refresh = async () => { await reload(); renderSettings(el, reload); };

  // estágios
  el.querySelector('[data-stages]').addEventListener('change', async (e) => {
    const row = e.target.closest('.srow'); const s = S.stages.find((x) => x.id === row.dataset.id);
    const k = e.target.dataset.sf; if (!k) return;
    const v = e.target.value.trim(); if (k === 'name' && !v) return toast('O estágio precisa de nome', true);
    try { Object.assign(s, await DB.saveStage({ id: s.id, name: s.name, color: s.color, kind: s.kind, position: s.position, [k]: v })); toast('Estágio salvo'); } catch (err) { fail(err); }
  });
  el.querySelector('[data-stages]').addEventListener('click', async (e) => {
    const row = e.target.closest('.srow'); if (!row) return;
    const i = S.stages.findIndex((x) => x.id === row.dataset.id);
    if (e.target.closest('[data-mv]')) { await moveStage(i, +e.target.closest('[data-mv]').dataset.mv); }
    if (e.target.closest('[data-del]')) deleteStageFlow(S.stages[i]);
  });
  el.querySelector('[data-add-stage]').addEventListener('click', () => stageModal());

  // rótulos
  el.querySelector('[data-labels]').addEventListener('change', async (e) => {
    const row = e.target.closest('.srow'); const x = S.labels.find((y) => y.id === row?.dataset.id);
    const k = e.target.dataset.lf; if (!k || !x) return;
    const v = e.target.value.trim(); if (!v) return;
    try { Object.assign(x, await DB.saveLabel({ id: x.id, name: x.name, color: x.color, [k]: v })); toast('Rótulo salvo'); } catch (err) { fail(err); }
  });
  el.querySelector('[data-labels]').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-ldel]')) return;
    const x = S.labels.find((y) => y.id === e.target.closest('.srow').dataset.id);
    if (!(await confirmBox(`Excluir o rótulo "${x.name}"? Ele sai de todos os leads.`, 'Excluir'))) return;
    try { await DB.deleteLabel(x.id); await refresh(); toast('Rótulo excluído'); } catch (err) { fail(err); }
  });
  const addLabel = async () => {
    const i = el.querySelector('[data-new-label]'); const name = i.value.trim(); if (!name) return;
    if (S.labels.some((x) => x.name.toLowerCase() === name.toLowerCase())) return toast('Esse rótulo já existe', true);
    try { await DB.saveLabel({ name, color: COLORS[S.labels.length % COLORS.length] }); await refresh(); toast('Rótulo criado'); } catch (err) { fail(err); }
  };
  el.querySelector('[data-add-label]').addEventListener('click', addLabel);
  el.querySelector('[data-new-label]').addEventListener('keydown', (e) => { if (e.key === 'Enter') addLabel(); });

  // equipe
  el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const p = S.profiles.find((x) => x.id === b.closest('.srow').dataset.id);
    try { await DB.updateProfile(p.id, { ativo: !p.ativo }); p.ativo = !p.ativo; b.classList.toggle('on', p.ativo); toast(p.ativo ? 'Acesso liberado' : 'Acesso removido'); } catch (err) { fail(err); }
  }));
}
