// Página "Ajustes": estágios, rótulos, equipe, times e auditoria
import { DB, LIVE } from '@shared/db.js';
import { S, $, $$, esc, ICON, COLORS, num, pct, ago, toast, fail, confirmBox } from './util.js?v=2609282007';
import { openProfile } from './profile.js?v=2609282007';
import { stageModal, moveStage, deleteStageFlow } from './app.js?v=2609282007';

// ============================================================
// AJUSTES
// ============================================================
export async function renderSettings(el, reload) {
  const role = S.me?.role || 'sdr';
  const isAdmin = role === 'admin';
  const isManager = role === 'admin' || role === 'gestor';
  let teams = [], audit = [];
  try { [teams, audit] = await Promise.all([DB.listTeams(), isAdmin ? DB.listAudit(60) : Promise.resolve([])]); } catch (e) { fail(e); }
  if (!el.isConnected) return;
  const ROLE = { admin: 'Admin', gestor: 'Gestor', sdr: 'SDR' };
  const AUDIT = { insert: 'criou', update: 'alterou', delete: 'excluiu', export: 'exportou', view_token: 'viu token', login: 'entrou' };
  const ENT = { profiles: 'usuário', tracking_pixels: 'pixel', ad_accounts: 'conta de anúncio', api_keys: 'chave de API', webhooks: 'webhook', forms: 'formulário', leads: 'lead' };

  el.innerHTML = `
    <div class="topline"><h1>Ajustes</h1><div class="grow"></div><button class="b" data-profile>Meu perfil</button></div>
    <div class="settings">
      ${isManager ? `<section class="panel">
        <h3>Estágios do pipeline</h3>
        <p class="help">Estágios "Ganho" contam como convertidos no dashboard.</p>
        <div data-stages>${S.stages.map((s, i) => `
          <div class="srow" data-id="${s.id}">
            <input type="color" value="${s.color}" data-sf="color" aria-label="Cor">
            <input class="inp grow" value="${esc(s.name)}" maxlength="40" data-sf="name" aria-label="Nome">
            <select class="inp" data-sf="kind" style="width:auto"><option value="open" ${s.kind === 'open' ? 'selected' : ''}>Andamento</option><option value="won" ${s.kind === 'won' ? 'selected' : ''}>Ganho</option><option value="lost" ${s.kind === 'lost' ? 'selected' : ''}>Perdido</option></select>
            <button class="b b-sm b-ghost" data-mv="-1" ${i ? '' : 'disabled'} aria-label="Subir">${ICON.up}</button>
            <button class="b b-sm b-ghost" data-mv="1" ${i < S.stages.length - 1 ? '' : 'disabled'} aria-label="Descer">${ICON.down}</button>
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
      </section>` : ''}

      <section class="panel span2">
        <h3>Equipe e permissões</h3>
        <div class="int-h" style="margin:0"><p class="help" style="flex:1">Quem você convidar cria a conta pelo link, confirma o e-mail e aparece aqui aguardando liberação.</p>${isAdmin ? '<button class="b b-sm" data-invite>Copiar link de cadastro</button>' : ''}</div>
        <p class="help"><b style="color:var(--c-text);font-weight:400">Admin</b> vê e configura tudo · <b style="color:var(--c-text);font-weight:400">Gestor</b> vê todos os leads, formulários e financeiro · <b style="color:var(--c-text);font-weight:400">SDR</b> vê só os leads dele e os sem dono.</p>
        <div class="table-wrap"><table class="int-table team-table"><thead><tr><th>Pessoa</th><th>Papel</th><th>Time</th><th>Pushcut</th><th>Acesso</th></tr></thead><tbody>
        ${S.profiles.map((p) => `
          <tr data-id="${p.id}">
            <td><div class="td-lead"><span class="av">${esc((p.nome || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</span><div><b>${esc(p.nome)}${p.id === S.me?.id ? ' <span class="muted" style="font-weight:400">(você)</span>' : ''}</b><small>${esc(p.email)}${p.cargo ? ' · ' + esc(p.cargo) : ''}</small></div></div></td>
            <td>${isAdmin ? `<select class="inp" data-role style="width:auto">${Object.entries(ROLE).map(([k, n]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ROLE[p.role] || ''}</td>
            <td>${isAdmin ? `<select class="inp" data-team style="width:auto"><option value="">Sem time</option>${teams.map((t) => `<option value="${t.id}" ${p.team_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : esc(teams.find((t) => t.id === p.team_id)?.name || '—')}</td>
            <td>${p.pushcut_url ? '<span class="pill good">Ativo</span>' : '<span class="muted">—</span>'}</td>
            <td>${isAdmin ? `<button class="switch ${p.ativo ? 'on' : ''}" data-toggle ${p.id === S.me?.id ? 'disabled' : ''} aria-label="Acesso ativo"></button>` : p.ativo ? 'Ativo' : 'Inativo'}</td>
          </tr>`).join('')}
        </tbody></table></div>
      </section>

      ${isAdmin ? `<section class="panel">
        <h3>Times e distribuição</h3>
        <p class="help">Com o rodízio ligado, cada lead novo vai automaticamente pro SDR do time que recebeu lead há mais tempo, e ele é avisado no Pushcut.</p>
        <div data-teams>${teams.map((t) => `<div class="srow" data-id="${t.id}"><input class="inp grow" value="${esc(t.name)}" maxlength="40" data-tn>
          <label class="nowrap muted" style="display:flex;align-items:center;gap:8px">Rodízio <button class="switch ${t.auto_assign ? 'on' : ''}" data-auto></button></label>
          <span class="muted nowrap">${S.profiles.filter((p) => p.team_id === t.id).length} pessoas</span><button class="b b-sm b-danger" data-tdel aria-label="Excluir">×</button></div>`).join('') || '<p class="muted">Nenhum time ainda.</p>'}</div>
        <div class="srow"><input class="inp grow" data-new-team placeholder="Novo time (ex: Comercial)" maxlength="40"><button class="b b-primary b-sm" data-add-team>Criar</button></div>
      </section>

      <section class="panel">
        <h3>Auditoria</h3>
        <p class="help">Quem fez o quê com usuários, credenciais e dados (LGPD). Tokens nunca aparecem aqui.</p>
        <div class="audit">${audit.length ? audit.map((a) => `<div class="audit-row"><span class="muted nowrap">${ago(a.created_at)}</span><span><b>${esc(a.actor_name || 'Sistema')}</b> ${AUDIT[a.action] || esc(a.action)} ${ENT[a.entity] || esc(a.entity)}${a.details?.nome ? ` <i>${esc(a.details.nome)}</i>` : a.details?.email ? ` <i>${esc(a.details.email)}</i>` : ''}${a.details?.token_alterado ? ' (token trocado)' : ''}</span></div>`).join('') : '<p class="muted">Nada registrado ainda.</p>'}</div>
      </section>` : ''}
    </div>`;

  const refresh = async () => { await reload(); renderSettings(el, reload); };
  el.querySelector('[data-profile]').addEventListener('click', () => openProfile());
  el.querySelector('[data-invite]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.origin + '/cadastro'); toast('Link de cadastro copiado'); } catch (e) { toast('Não consegui copiar', true); }
  });

  if (isManager) {
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
  }

  if (!isAdmin) return;
  // equipe: acesso, papel e time
  el.querySelectorAll('.team-table tr[data-id]').forEach((row) => {
    const p = S.profiles.find((x) => x.id === row.dataset.id);
    const save = async (patch, msg) => {
      try { await DB.updateProfile(p.id, patch); Object.assign(p, patch); toast(msg); }
      catch (err) { fail(err); refresh(); }
    };
    row.querySelector('[data-toggle]')?.addEventListener('click', (e) => { const on = !p.ativo; e.currentTarget.classList.toggle('on', on); save({ ativo: on }, on ? 'Acesso liberado' : 'Acesso removido'); });
    row.querySelector('[data-role]').addEventListener('change', (e) => save({ role: e.target.value }, 'Papel alterado'));
    row.querySelector('[data-team]').addEventListener('change', (e) => save({ team_id: e.target.value || null }, 'Time alterado'));
  });
  // times
  el.querySelectorAll('[data-teams] .srow').forEach((row) => {
    const t = teams.find((x) => x.id === row.dataset.id);
    row.querySelector('[data-tn]').addEventListener('change', async (e) => { try { await DB.saveTeam({ id: t.id, name: e.target.value.trim() }); toast('Time salvo'); } catch (err) { fail(err); } });
    row.querySelector('[data-auto]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const on = !t.auto_assign;
      if (on && teams.some((x) => x.auto_assign && x.id !== t.id)) return toast('Só um time pode ter rodízio ligado', true);
      try { await DB.saveTeam({ id: t.id, auto_assign: on }); t.auto_assign = on; btn.classList.toggle('on', on); toast(on ? 'Rodízio ligado' : 'Rodízio desligado'); } catch (err) { fail(err); }
    });
    row.querySelector('[data-tdel]').addEventListener('click', async () => {
      if (!(await confirmBox(`Excluir o time "${t.name}"?`, 'Excluir'))) return;
      try { await DB.deleteTeam(t.id); refresh(); } catch (err) { fail(err); }
    });
  });
  const addTeam = async () => {
    const i = el.querySelector('[data-new-team]'); const name = i.value.trim(); if (!name) return;
    if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) return toast('Já existe um time com esse nome', true);
    try { await DB.saveTeam({ name }); refresh(); toast('Time criado'); } catch (err) { fail(err); }
  };
  el.querySelector('[data-add-team]').addEventListener('click', addTeam);
  el.querySelector('[data-new-team]').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTeam(); });
}
