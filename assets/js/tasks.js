// Tarefas da Tracto (estilo Todoist): entrada, hoje, próximos dias, minhas, equipe e projetos.
// Adição rápida entende linguagem natural: "Enviar relatório amanhã 10h p1 @Isaque #Clientes toda semana".
import { DB } from '@shared/db.js';
import { S, esc, ICON, initials, toast, fail, modal, confirmBox, menu, popover, closePop, renderTicket, profileOf, isoDay, ago, go } from './util.js?v=2611060733';

const T = { view: 'hoje', project: null, who: 'eu', showDone: false, q: '' };
let TASKS = []; let PROJECTS = []; let loaded = false; let unsub = null;
const DAY = 86400000;
// "agora", "há 5 min", "há 2 d" ou a data
const when = (iso) => { const a = ago(iso); return a === 'agora' ? 'agora' : /\d (min|h|d)$/.test(a) ? 'há ' + a : 'em ' + a; };

const PRI = { 1: ['Prioridade 1', '#E5484D', 'Urgente'], 2: ['Prioridade 2', '#FFAD00', 'Alta'], 3: ['Prioridade 3', '#6AA8FF', 'Média'], 4: ['Prioridade 4', '', 'Normal'] };
const RECUR = [['', 'Não repete'], ['diaria', 'Todo dia'], ['dias_uteis', 'Dias úteis'], ['semanal', 'Toda semana'], ['mensal', 'Todo mês']];
const PCOLORS = ['#FFAD00', '#E5484D', '#3DDC84', '#6AA8FF', '#B58CFF', '#FF8A3D', '#4FD1C5', '#FF5C8A', '#8A8A8A'];
const svg = (d, w = 16) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  inbox: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>'),
  today: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="12" cy="15.5" r="1.6" fill="currentColor"/>'),
  upcoming: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>'),
  me: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  team: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 21a7 7 0 0 0-4-6.3"/>'),
  done: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 15),
  cal: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', 13),
  flag: svg('<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>', 14),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', 14),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 14),
  repeat: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>', 13),
  sub: svg('<path d="M6 3v12a3 3 0 0 0 3 3h9"/><path d="m15 15 3 3-3 3"/>', 13),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', 13),
  lead: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="11" r="2"/><path d="M14 10h4M14 14h3"/>', 13),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', 15),
  check: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>'
};
const VIEWS = [['entrada', 'Entrada', IC.inbox], ['hoje', 'Hoje', IC.today], ['proximos', 'Próximos', IC.upcoming], ['minhas', 'Minhas tarefas', IC.me], ['equipe', 'Equipe', IC.team], ['concluidas', 'Concluídas', IC.done]];

// ---------- datas ----------
const today = () => isoDay(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return isoDay(d); };
const nextWeekday = (w, allowToday = true) => { const d = new Date(); d.setHours(12); let k = (w - d.getDay() + 7) % 7; if (!k && !allowToday) k = 7; d.setDate(d.getDate() + k); return isoDay(d); };
const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function dueInfo(t) {
  if (!t.due_date) return null;
  const td = today(); const diff = Math.round((new Date(t.due_date + 'T12:00') - new Date(td + 'T12:00')) / DAY);
  const d = new Date(t.due_date + 'T12:00');
  let txt = diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : diff === -1 ? 'Ontem' : diff > 1 && diff < 7 ? WD[d.getDay()][0].toUpperCase() + WD[d.getDay()].slice(1)
    : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }).replace('.', '').replace(' de ', ' ');
  if (t.due_time) txt += ' ' + t.due_time.slice(0, 5);
  return { txt, cls: t.done_at ? '' : diff < 0 ? 'late' : diff === 0 ? 'today' : diff === 1 ? 'soon' : '' };
}
const TIMES = (() => { const o = []; for (let h = 6; h <= 23; h++) for (const m of ['00', '30']) o.push(`${String(h).padStart(2, '0')}:${m}`); return o; })();

// ---------- quem ----------
const team = () => (S.profiles || []).filter((p) => p.ativo !== false);
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mine = (t) => t.assignee_id === S.me?.id || (!t.assignee_id && t.created_by === S.me?.id);
const whoOk = (t) => T.who === 'todos' || (T.who === 'eu' ? mine(t) : T.who === 'ninguem' ? !t.assignee_id : t.assignee_id === T.who);
const projectOf = (id) => PROJECTS.find((p) => p.id === id);

// ---------- adição rápida em linguagem natural ----------
const WD_RE = '(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(?:-feira)?';
const wdIndex = (w) => ({ domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 })[norm(w).replace(/-feira/, '')];
export function parseQuick(raw) {
  let s = ` ${raw} `; const out = {}; const chips = [];
  const take = (re, fn) => { s = s.replace(re, (...m) => { const r = fn(...m); return r === false ? m[0] : ' '; }); };
  take(/\s[pP]([1-4])(?=\s)/, (_, n) => { out.priority = +n; chips.push(PRI[n][0]); });
  take(/\s@([\p{L}\p{N}_.-]+)/u, (m, n) => { const p = team().find((x) => norm(firstName(x.nome)).startsWith(norm(n))); if (!p) return false; out.assignee_id = p.id; chips.push(firstName(p.nome)); });
  take(/\s#([\p{L}\p{N}_-]+)/u, (m, n) => { const p = PROJECTS.find((x) => norm(x.name).replace(/\s+/g, '').startsWith(norm(n))); if (!p) return false; out.project_id = p.id; chips.push(p.name); });
  take(new RegExp(`\\s(?:toda|todo)\\s${WD_RE}(?=\\s)`, 'iu'), (_, w) => { out.recur = 'semanal'; out.due_date = nextWeekday(wdIndex(w)); chips.push('Toda ' + w.toLowerCase()); });
  take(/\s(?:todos os dias|todo dia|diariamente)(?=\s)/iu, () => { out.recur = 'diaria'; chips.push('Todo dia'); });
  take(/\s(?:dias [uú]teis|todo dia [uú]til)(?=\s)/iu, () => { out.recur = 'dias_uteis'; chips.push('Dias úteis'); });
  take(/\s(?:toda semana|semanalmente)(?=\s)/iu, () => { out.recur = 'semanal'; chips.push('Toda semana'); });
  take(/\s(?:todo m[eê]s|mensalmente)(?=\s)/iu, () => { out.recur = 'mensal'; chips.push('Todo mês'); });
  take(/\s(?:depois de amanh[aã])(?=\s)/iu, () => { out.due_date = addDays(today(), 2); });
  take(/\s(?:amanh[aã])(?=\s)/iu, () => { out.due_date = addDays(today(), 1); });
  take(/\s(?:hoje)(?=\s)/iu, () => { out.due_date = today(); });
  take(/\s(?:pr[oó]xima semana)(?=\s)/iu, () => { out.due_date = nextWeekday(1, false); });
  take(/\sem (\d{1,3}) dias?(?=\s)/iu, (_, n) => { out.due_date = addDays(today(), +n); });
  take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, (m, d, mo, y) => {
    const yr = y ? (y.length === 2 ? 2000 + +y : +y) : new Date().getFullYear(); const dt = new Date(yr, +mo - 1, +d, 12);
    if (dt.getMonth() !== +mo - 1) return false;
    if (!y && isoDay(dt) < today()) dt.setFullYear(yr + 1);
    out.due_date = isoDay(dt);
  });
  take(new RegExp(`\\s(?:n[ao]\\s)?${WD_RE}(?=\\s)`, 'iu'), (_, w) => { out.due_date = nextWeekday(wdIndex(w)); });
  take(/\s(?:[àa]s\s)?(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?=\s)/iu, (m, h, m1, m2) => { if (+h > 23) return false; out.due_time = `${String(h).padStart(2, '0')}:${m1 || m2 || '00'}`; });
  if (out.recur && !out.due_date) out.due_date = out.recur === 'dias_uteis' && [0, 6].includes(new Date().getDay()) ? nextWeekday(1) : today();
  if (out.due_time && !out.due_date) out.due_date = today();
  if (out.due_date) chips.unshift(dueInfo({ due_date: out.due_date, due_time: out.due_time }).txt);
  out.title = s.replace(/\s+/g, ' ').trim();
  out.chips = chips;
  return out;
}

// ---------- dados ----------
async function load(force = false) {
  if (loaded && !force) return;
  [TASKS, PROJECTS] = await Promise.all([DB.listTasks(), DB.listTaskProjects()]);
  loaded = true;
}
const upsertLocal = (row) => { const i = TASKS.findIndex((x) => x.id === row.id); if (i >= 0) TASKS[i] = { ...TASKS[i], ...row }; else TASKS.push(row); };
async function save(patch) { const row = await DB.saveTask(patch); upsertLocal(row || patch); refreshBadge(); return row; }

// contador do menu: minhas tarefas atrasadas ou de hoje
export async function refreshTasksBadge() {
  try { await load(); } catch (e) { return; }
  refreshBadge();
}
function refreshBadge() {
  const b = document.getElementById('taskBadge'); if (!b) return;
  const n = TASKS.filter((t) => !t.done_at && !t.parent_id && t.due_date && t.due_date <= today() && (t.assignee_id === S.me?.id || (!t.assignee_id && t.created_by === S.me?.id))).length;
  b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
  b.title = n ? `${n} tarefa${n > 1 ? 's' : ''} pra hoje ou atrasada${n > 1 ? 's' : ''}` : '';
}

// ---------- tela ----------
function viewFromPath() {
  const parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts[1] === 'projeto' && parts[2]) { T.view = 'projeto'; T.project = parts[2]; }
  else if (VIEWS.some(([k]) => k === parts[1])) { T.view = parts[1]; T.project = null; }
  else { T.view = 'hoje'; T.project = null; }
}
const setPath = (path) => { if (location.pathname !== path) history.pushState(null, '', path); };

export async function renderTasks(el) {
  const stale = renderTicket(el);
  viewFromPath();
  if (!loaded) el.innerHTML = '<div class="loading">Carregando…</div>';
  try { await load(true); } catch (e) { fail(e); }
  if (stale()) return;
  if (T.view === 'projeto' && !projectOf(T.project)) { T.view = 'hoje'; setPath('/tarefas/hoje'); }
  paint(el);
  // mudanças feitas por outras pessoas aparecem sozinhas
  unsub?.(); let tmr;
  unsub = DB.onTasks(() => { clearTimeout(tmr); tmr = setTimeout(async () => { if (!el.isConnected || !location.pathname.startsWith('/tarefas')) { unsub?.(); unsub = null; return; } try { await load(true); if (!document.querySelector('.tk-comp.open, .modal')) paint(el); refreshBadge(); } catch (e) {} }, 400); });
}

const byDue = (a, b) => (a.due_date || '9999') .localeCompare(b.due_date || '9999') || (a.due_time || '99').localeCompare(b.due_time || '99') || a.priority - b.priority || a.position - b.position;
const byPri = (a, b) => a.priority - b.priority || byDue(a, b);

function groups() {
  const td = today();
  const open = TASKS.filter((t) => !t.parent_id && !t.done_at);
  const q = norm(T.q.trim());
  if (q) {
    const hits = TASKS.filter((t) => !t.parent_id && (norm(t.title).includes(q) || norm(t.notes).includes(q))).sort((a, b) => !!a.done_at - !!b.done_at || byDue(a, b));
    return { title: 'Busca', sub: `${hits.length} resultado${hits.length === 1 ? '' : 's'} para "${T.q.trim()}"`, groups: [{ name: '', list: hits }] };
  }
  const scoped = open.filter(whoOk);
  if (T.view === 'entrada') {
    const list = TASKS.filter((t) => !t.parent_id && !t.project_id && whoOk(t) && (T.showDone || !t.done_at)).sort((a, b) => !!a.done_at - !!b.done_at || byPri(a, b));
    return { title: 'Entrada', sub: 'Tarefas sem projeto', groups: [{ name: '', list, add: {} }], doneToggle: true };
  }
  if (T.view === 'projeto') {
    const p = projectOf(T.project);
    const list = TASKS.filter((t) => !t.parent_id && t.project_id === p.id && whoOk(t) && (T.showDone || !t.done_at)).sort((a, b) => !!a.done_at - !!b.done_at || byPri(a, b));
    const nodate = list.filter((t) => !t.due_date && !t.done_at); const dated = list.filter((t) => t.due_date || t.done_at);
    return { title: p.name, color: p.color, sub: `${list.filter((t) => !t.done_at).length} abertas`, groups: [{ name: '', list: dated.concat(nodate), add: { project_id: p.id } }], doneToggle: true, project: p };
  }
  if (T.view === 'hoje') {
    const late = scoped.filter((t) => t.due_date && t.due_date < td).sort(byDue);
    const now = scoped.filter((t) => t.due_date === td).sort((a, b) => (a.due_time || '99').localeCompare(b.due_time || '99') || a.priority - b.priority);
    const d = new Date();
    return { title: 'Hoje', sub: d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }), groups: [...(late.length ? [{ name: 'Atrasadas', list: late, late: true }] : []), { name: late.length ? 'Hoje' : '', list: now, add: { due_date: td } }] };
  }
  if (T.view === 'proximos') {
    const out = [];
    for (let k = 0; k < 14; k++) {
      const day = addDays(td, k); const list = scoped.filter((t) => t.due_date === day).sort((a, b) => (a.due_time || '99').localeCompare(b.due_time || '99') || a.priority - b.priority);
      if (!list.length && k > 1) continue;
      const d = new Date(day + 'T12:00');
      out.push({ name: `${d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '').replace(' de ', ' ')} · ${k === 0 ? 'Hoje' : k === 1 ? 'Amanhã' : WD[d.getDay()][0].toUpperCase() + WD[d.getDay()].slice(1)}`, list, add: { due_date: day } });
    }
    const later = scoped.filter((t) => t.due_date && t.due_date > addDays(td, 13)).sort(byDue);
    if (later.length) out.push({ name: 'Mais adiante', list: later });
    const late = scoped.filter((t) => t.due_date && t.due_date < td).sort(byDue);
    if (late.length) out.unshift({ name: 'Atrasadas', list: late, late: true });
    return { title: 'Próximos', sub: 'Os próximos 14 dias', groups: out };
  }
  if (T.view === 'minhas') {
    const my = open.filter((t) => t.assignee_id === S.me?.id);
    const w = addDays(td, 7);
    return { title: 'Minhas tarefas', sub: 'Tudo que está com você', noWho: true, groups: [
      { name: 'Atrasadas', list: my.filter((t) => t.due_date && t.due_date < td).sort(byDue), late: true },
      { name: 'Hoje', list: my.filter((t) => t.due_date === td).sort(byDue), add: { due_date: td, assignee_id: S.me?.id } },
      { name: 'Próximos 7 dias', list: my.filter((t) => t.due_date > td && t.due_date <= w).sort(byDue) },
      { name: 'Mais adiante', list: my.filter((t) => t.due_date > w).sort(byDue) },
      { name: 'Sem data', list: my.filter((t) => !t.due_date).sort(byPri), add: { assignee_id: S.me?.id } }
    ].filter((g) => g.list.length || g.add) };
  }
  if (T.view === 'equipe') {
    const people = team().map((p) => ({ p, list: open.filter((t) => t.assignee_id === p.id).sort(byDue) }));
    const none = open.filter((t) => !t.assignee_id).sort(byDue);
    return { title: 'Equipe', sub: 'Demandas de cada pessoa', noWho: true, team: true, groups: [...people.map(({ p, list }) => ({ name: p.nome, person: p, list, add: { assignee_id: p.id } })), ...(none.length ? [{ name: 'Sem responsável', list: none, add: {} }] : [])] };
  }
  // concluídas
  const done = TASKS.filter((t) => !t.parent_id && t.done_at && whoOk(t)).sort((a, b) => b.done_at.localeCompare(a.done_at));
  const by = new Map(); done.forEach((t) => { const k = isoDay(new Date(t.done_at)); by.set(k, [...(by.get(k) || []), t]); });
  return { title: 'Concluídas', sub: 'Últimos 30 dias', groups: [...by.entries()].map(([k, list]) => { const d = new Date(k + 'T12:00'); return { name: k === td ? 'Hoje' : k === addDays(td, -1) ? 'Ontem' : d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }).replace('.', ''), list }; }) };
}

function counts() {
  const td = today(); const open = TASKS.filter((t) => !t.parent_id && !t.done_at);
  return {
    entrada: open.filter((t) => !t.project_id && whoOk(t)).length,
    hoje: open.filter((t) => whoOk(t) && t.due_date && t.due_date <= td).length,
    proximos: open.filter((t) => whoOk(t) && t.due_date && t.due_date > td && t.due_date <= addDays(td, 13)).length,
    minhas: open.filter((t) => t.assignee_id === S.me?.id).length,
    equipe: open.length, concluidas: 0
  };
}
const whoLabel = () => (T.who === 'todos' ? 'Toda a equipe' : T.who === 'eu' ? 'Minhas e sem responsável' : T.who === 'ninguem' ? 'Sem responsável' : firstName(profileOf(T.who)?.nome) || 'Pessoa');

function paint(el) {
  const g = groups(); const c = counts();
  const openIn = (p) => TASKS.filter((t) => !t.parent_id && !t.done_at && t.project_id === p.id).length;
  const isOn = (k) => !T.q && T.view === k;
  el.innerHTML = `<div class="tk">
    <aside class="tk-nav">
      <button class="b b-primary tk-addbtn" data-quick>${IC.plus}Adicionar tarefa</button>
      <label class="search tk-search">${ICON.search}<input class="inp" data-q type="search" placeholder="Buscar tarefas" value="${esc(T.q)}"></label>
      <nav class="tk-views">${VIEWS.map(([k, n, ic]) => `<a href="/tarefas/${k}" class="${isOn(k) ? 'on' : ''}" data-v="${k}">${ic}<span>${n}</span>${c[k] ? `<small>${c[k]}</small>` : ''}</a>`).join('')}</nav>
      <div class="tk-ph"><span>Projetos</span><button class="b b-sm b-ghost fu-ic" data-new-project aria-label="Novo projeto" title="Novo projeto">${IC.plus}</button></div>
      <nav class="tk-projects">${PROJECTS.map((p) => `<a href="/tarefas/projeto/${p.id}" class="${!T.q && T.view === 'projeto' && T.project === p.id ? 'on' : ''}" data-p="${p.id}"><i class="tk-dot" style="background:${esc(p.color)}"></i><span>${esc(p.name)}</span>${openIn(p) ? `<small>${openIn(p)}</small>` : ''}</a>`).join('') || '<p class="muted tk-noproj">Crie projetos pra separar as demandas: Clientes, Comercial, Conteúdo…</p>'}</nav>
    </aside>
    <section class="tk-main">
      <header class="tk-head">
        <div class="tk-title">${g.color ? `<i class="tk-dot lg" style="background:${esc(g.color)}"></i>` : ''}<div><h1>${esc(g.title)}</h1><p class="sub">${esc(g.sub || '')}</p></div></div>
        <div class="tk-tools">
          ${g.noWho ? '' : `<button class="b b-sm" data-who>${IC.user}${esc(whoLabel())}${ICON.caret}</button>`}
          ${g.doneToggle ? `<button class="b b-sm ${T.showDone ? 'on' : ''}" data-showdone>${IC.done}${T.showDone ? 'Ocultar concluídas' : 'Mostrar concluídas'}</button>` : ''}
          ${g.project ? `<button class="b b-sm b-ghost fu-ic" data-pmenu aria-label="Opções do projeto">${ICON.dots}</button>` : ''}
        </div>
      </header>
      <div class="tk-groups">${g.groups.map((gr, gi) => group(gr, gi, g)).join('') || '<div class="tk-empty">Nada concluído nos últimos 30 dias.</div>'}</div>
    </section>
  </div>`;

  // navegação
  el.querySelectorAll('[data-v]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); T.view = a.dataset.v; T.project = null; T.q = ''; setPath('/tarefas/' + T.view); paint(el); }));
  el.querySelectorAll('[data-p]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); T.view = 'projeto'; T.project = a.dataset.p; T.q = ''; setPath('/tarefas/projeto/' + T.project); paint(el); }));
  el.querySelector('[data-new-project]').addEventListener('click', () => projectModal(null, (p) => { T.view = 'projeto'; T.project = p.id; setPath('/tarefas/projeto/' + p.id); paint(el); }));
  el.querySelector('[data-pmenu]')?.addEventListener('click', (e) => projectMenu(e.currentTarget, g.project, el));
  el.querySelector('[data-showdone]')?.addEventListener('click', () => { T.showDone = !T.showDone; paint(el); });
  el.querySelector('[data-who]')?.addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'Minhas e sem responsável', checked: T.who === 'eu', action: () => { T.who = 'eu'; paint(el); } },
    { label: 'Toda a equipe', checked: T.who === 'todos', action: () => { T.who = 'todos'; paint(el); } },
    { label: 'Sem responsável', checked: T.who === 'ninguem', action: () => { T.who = 'ninguem'; paint(el); } },
    { sep: true },
    ...team().map((p) => ({ label: p.nome, checked: T.who === p.id, action: () => { T.who = p.id; paint(el); } }))
  ]));
  const qi = el.querySelector('[data-q]');
  qi.addEventListener('input', () => { T.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { const pos = qi.selectionStart; paint(el); const n = el.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); }, 200); });
  el.querySelector('[data-quick]').addEventListener('click', () => taskModal(defaultsFor(g.groups.find((x) => x.add)?.add || {}), () => paint(el)));

  // grupos e linhas
  el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const gr = g.groups[+b.dataset.add]; const box = b.closest('.tk-group').querySelector('.tk-addwrap');
    b.hidden = true; composer(box, defaultsFor(gr.add), { inline: true, onDone: () => paint(el), onCancel: () => { box.innerHTML = ''; b.hidden = false; } });
  }));
  el.querySelectorAll('[data-late-today]').forEach((b) => b.addEventListener('click', async () => {
    const late = TASKS.filter((t) => !t.parent_id && !t.done_at && whoOk(t) && t.due_date && t.due_date < today());
    try { for (const t of late) await save({ id: t.id, due_date: today() }); toast(`${late.length} tarefa${late.length > 1 ? 's' : ''} reagendada${late.length > 1 ? 's' : ''} pra hoje`); } catch (e) { fail(e); }
    paint(el);
  }));
  bindRows(el, () => paint(el));
}

const defaultsFor = (add = {}) => ({ project_id: T.view === 'projeto' ? T.project : null, assignee_id: T.who !== 'todos' && T.who !== 'eu' && T.who !== 'ninguem' ? T.who : S.me?.id || null, ...add });

function group(gr, gi, g) {
  const head = gr.person
    ? (() => { const late = gr.list.filter((t) => t.due_date && t.due_date < today()).length; const td = gr.list.filter((t) => t.due_date === today()).length;
      return `<div class="tk-gh tk-person"><span class="av">${esc(initials(gr.person.nome))}</span><b>${esc(gr.person.nome)}</b><span class="muted">${gr.list.length} aberta${gr.list.length === 1 ? '' : 's'}</span>${late ? `<span class="pill bad">${late} atrasada${late > 1 ? 's' : ''}</span>` : ''}${td ? `<span class="pill good">${td} hoje</span>` : ''}</div>`; })()
    : gr.name ? `<div class="tk-gh ${gr.late ? 'late' : ''}"><b>${esc(gr.name)}</b><span class="muted">${gr.list.length || ''}</span>${gr.late && gr.list.length ? '<button class="b b-sm b-ghost tk-link" data-late-today>Reagendar tudo pra hoje</button>' : ''}</div>` : '';
  const empty = !gr.list.length && gi === 0 && !gr.person && !g.groups.slice(1).some((x) => x.list.length) && T.view !== 'proximos'
    ? `<div class="tk-empty">${T.view === 'hoje' ? 'Nada pra hoje. Aproveite pra adiantar o que vem por aí.' : 'Nenhuma tarefa aqui ainda.'}</div>` : '';
  return `<div class="tk-group ${g.team ? 'tk-team' : ''}">${head}<div class="tk-rows">${gr.list.map((t) => rowHtml(t, g)).join('')}</div>${empty}
    ${gr.add ? `<div class="tk-addwrap"></div><button class="tk-addrow" data-add="${gi}">${IC.plus}<span>Adicionar tarefa</span></button>` : ''}</div>`;
}

function rowHtml(t, g) {
  const due = dueInfo(t); const subs = TASKS.filter((x) => x.parent_id === t.id); const subDone = subs.filter((x) => x.done_at).length;
  const p = projectOf(t.project_id); const who = t.assignee_id ? profileOf(t.assignee_id) : null;
  const lead = t.lead_id ? S.leads?.find((l) => l.id === t.lead_id) : null;
  const ncom = t._ncom || 0;
  return `<div class="tk-row ${t.done_at ? 'is-done' : ''}" data-id="${t.id}">
    <button class="tk-check p${t.priority}" data-check aria-label="${t.done_at ? 'Reabrir tarefa' : 'Concluir tarefa'}" title="${t.done_at ? 'Reabrir' : 'Concluir'}">${IC.check}</button>
    <div class="tk-body" data-open>
      <div class="tk-ttl">${esc(t.title)}</div>
      ${t.notes ? `<div class="tk-notes">${esc(t.notes.split('\n')[0].slice(0, 140))}</div>` : ''}
      <div class="tk-meta">
        ${due ? `<span class="tk-due ${due.cls}">${IC.cal}${esc(due.txt)}${t.recur ? IC.repeat : ''}</span>` : ''}
        ${subs.length ? `<span>${IC.sub}${subDone}/${subs.length}</span>` : ''}
        ${ncom ? `<span>${IC.chat}${ncom}</span>` : ''}
        ${lead ? `<span class="tk-leadchip">${IC.lead}${esc(lead.nome)}</span>` : ''}
      </div>
    </div>
    <div class="tk-side">
      ${p && T.view !== 'projeto' ? `<span class="tk-proj"><i class="tk-dot" style="background:${esc(p.color)}"></i>${esc(p.name)}</span>` : ''}
      ${who && !(g.team) ? `<span class="tk-av" title="${esc(who.nome)}">${esc(initials(who.nome))}</span>` : ''}
    </div>
  </div>`;
}

function bindRows(root, done) {
  root.querySelectorAll('.tk-row').forEach((r) => {
    const t = TASKS.find((x) => x.id === r.dataset.id); if (!t) return;
    r.querySelector('[data-check]').addEventListener('click', (e) => { e.stopPropagation(); toggleDone(t, r, done); });
    r.querySelector('[data-open]').addEventListener('click', () => openTask(t, done));
  });
}

// concluir com animação e "Desfazer"
async function toggleDone(t, r, done) {
  const before = { due_date: t.due_date, done_at: t.done_at };
  const closing = !t.done_at;
  r?.classList.add(closing ? 'is-closing' : 'is-opening');
  try {
    const row = await save({ id: t.id, done_at: closing ? new Date().toISOString() : null });
    const rec = closing && row && !row.done_at && row.due_date !== before.due_date;
    setTimeout(done, closing ? 320 : 0);
    if (closing) undoToast(rec ? `Concluída. Próxima em ${dueInfo(row).txt.toLowerCase()}` : 'Tarefa concluída', async () => { try { await save({ id: t.id, done_at: null, due_date: before.due_date }); done(); } catch (e) { fail(e); } });
  } catch (e) { r?.classList.remove('is-closing', 'is-opening'); fail(e); }
}
function undoToast(msg, onUndo) {
  const host = document.getElementById('toasts'); if (!host) return toast(msg);
  const el = document.createElement('div'); el.className = 'toast tk-toast';
  el.innerHTML = `<span>${esc(msg)}</span><button type="button">Desfazer</button>`;
  host.appendChild(el);
  const kill = () => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 200); };
  el.querySelector('button').addEventListener('click', () => { kill(); onUndo(); });
  setTimeout(kill, 5000);
}

// ---------- compositor (adição rápida) ----------
function composer(host, defaults, { inline = false, onDone, onCancel } = {}) {
  const sel = { title: '', notes: '', due_date: null, due_time: null, priority: 4, assignee_id: null, project_id: null, recur: null, lead_id: null, ...defaults };
  host.innerHTML = `<div class="tk-comp open">
    <input class="tk-comp-in" data-title maxlength="300" placeholder="Nome da tarefa" value="${esc(sel.title || '')}" autocomplete="off">
    <textarea class="tk-comp-notes" data-notes rows="1" placeholder="Descrição"></textarea>
    <div class="tk-hint" data-hint>Dica: escreva "amanhã 10h", "sexta", "p1", "@nome", "#projeto" ou "toda semana" no nome</div>
    <div class="tk-chips" data-chips></div>
    <div class="tk-comp-foot"><div class="grow"></div><button class="b b-sm" data-cancel>Cancelar</button><button class="b b-sm b-primary" data-add disabled>Adicionar tarefa</button></div>
  </div>`;
  const $ = (s) => host.querySelector(s);
  const inp = $('[data-title]'); const notes = $('[data-notes]');
  const eff = () => { const p = parseQuick(inp.value); const o = { ...sel }; ['due_date', 'due_time', 'priority', 'assignee_id', 'project_id', 'recur'].forEach((k) => { if (p[k] !== undefined) o[k] = p[k]; }); o.title = p.title; o.parsed = p.chips; return o; };
  const chips = () => {
    const o = eff();
    const due = o.due_date ? dueInfo(o) : null; const who = o.assignee_id ? profileOf(o.assignee_id) : null; const pj = projectOf(o.project_id);
    $('[data-chips]').innerHTML = `
      <button type="button" class="tk-chip ${due ? 'set ' + due.cls : ''}" data-c="date">${IC.cal}${due ? esc(due.txt) : 'Data'}</button>
      <button type="button" class="tk-chip ${o.priority < 4 ? 'set' : ''}" data-c="pri"><span style="color:${PRI[o.priority][1] || 'inherit'}">${IC.flag}</span>${o.priority < 4 ? 'P' + o.priority : 'Prioridade'}</button>
      <button type="button" class="tk-chip ${who ? 'set' : ''}" data-c="who">${IC.user}${who ? esc(firstName(who.nome)) : 'Responsável'}</button>
      <button type="button" class="tk-chip ${pj ? 'set' : ''}" data-c="proj">${pj ? `<i class="tk-dot" style="background:${esc(pj.color)}"></i>${esc(pj.name)}` : `${IC.inbox}Entrada`}</button>
      <button type="button" class="tk-chip ${o.recur ? 'set' : ''}" data-c="rec">${IC.repeat}${o.recur ? esc(RECUR.find(([k]) => k === o.recur)[1]) : 'Repetir'}</button>`;
    $('[data-add]').disabled = !o.title;
    $('[data-hint]').innerHTML = o.parsed.length ? `Entendi: ${o.parsed.map((x) => `<b>${esc(x)}</b>`).join(' · ')}` : 'Dica: escreva "amanhã 10h", "sexta", "p1", "@nome", "#projeto" ou "toda semana" no nome';
  };
  // escolher pelos botões limpa o que veio do texto pra aquele campo
  const pickSet = (k, v) => { sel[k] = v; const p = parseQuick(inp.value); if (p[k] !== undefined) inp.value = stripToken(inp.value, k); chips(); inp.focus(); };
  $('[data-chips]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c;
    if (c === 'date') datePop(b, eff(), (d, tm) => { sel.due_date = d; sel.due_time = tm; const p = parseQuick(inp.value); if (p.due_date !== undefined || p.due_time !== undefined) { inp.value = stripToken(stripToken(inp.value, 'due_date'), 'due_time'); } chips(); inp.focus(); });
    if (c === 'pri') menu(b, [1, 2, 3, 4].map((n) => ({ label: `${PRI[n][0]} · ${PRI[n][2]}`, swatch: PRI[n][1] || 'var(--gray-3)', checked: eff().priority === n, action: () => pickSet('priority', n) })));
    if (c === 'who') menu(b, [{ label: 'Ninguém', checked: !eff().assignee_id, action: () => pickSet('assignee_id', null) }, ...team().map((p) => ({ label: p.nome, checked: eff().assignee_id === p.id, action: () => pickSet('assignee_id', p.id) }))]);
    if (c === 'proj') menu(b, [{ label: 'Entrada', checked: !eff().project_id, action: () => pickSet('project_id', null) }, ...PROJECTS.map((p) => ({ label: p.name, swatch: p.color, checked: eff().project_id === p.id, action: () => pickSet('project_id', p.id) }))]);
    if (c === 'rec') menu(b, RECUR.map(([k, n]) => ({ label: n, checked: (eff().recur || '') === k, action: () => { pickSet('recur', k || null); if (k && !eff().due_date) { sel.due_date = today(); chips(); } } })));
  });
  const submit = async () => {
    const o = eff(); if (!o.title) return;
    $('[data-add]').disabled = true;
    try {
      const row = { title: o.title, notes: notes.value.trim() || null, due_date: o.due_date || null, due_time: o.due_time || null, priority: o.priority, assignee_id: o.assignee_id || null, project_id: o.project_id || null, recur: o.recur || null, lead_id: o.lead_id || null, parent_id: o.parent_id || null, position: Date.now() };
      await save(row);
      toast('Tarefa adicionada');
      inp.value = ''; notes.value = ''; chips(); inp.focus();
      onDone?.(row);
    } catch (e) { fail(e); $('[data-add]').disabled = false; }
  };
  inp.addEventListener('input', chips);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape' && inline) { e.stopPropagation(); onCancel?.(); } });
  notes.addEventListener('input', () => { notes.style.height = 'auto'; notes.style.height = notes.scrollHeight + 'px'; });
  $('[data-add]').addEventListener('click', submit);
  $('[data-cancel]').addEventListener('click', () => onCancel?.());
  chips(); setTimeout(() => inp.focus(), 20);
}
function stripToken(text, k) {
  const res = {
    priority: [/\s[pP][1-4](?=\s)/], assignee_id: [/\s@[\p{L}\p{N}_.-]+/u], project_id: [/\s#[\p{L}\p{N}_-]+/u],
    recur: [/\s(?:toda|todo)\s(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(?:-feira)?(?=\s)/iu, /\s(?:todos os dias|todo dia|diariamente|dias [uú]teis|todo dia [uú]til|toda semana|semanalmente|todo m[eê]s|mensalmente)(?=\s)/iu],
    due_date: [/\s(?:depois de amanh[aã]|amanh[aã]|hoje|pr[oó]xima semana)(?=\s)/iu, /\sem \d{1,3} dias?(?=\s)/iu, /\s\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?=\s)/, /\s(?:n[ao]\s)?(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(?:-feira)?(?=\s)/iu],
    due_time: [/\s(?:[àa]s\s)?\d{1,2}(?:h(?:\d{2})?|:\d{2})(?=\s)/iu]
  }[k] || [];
  let s = ` ${text} `; res.forEach((re) => { s = s.replace(re, ' '); });
  return s.replace(/\s+/g, ' ').trim() + ' ';
}
function datePop(anchor, cur, onPick) {
  const td = today(); const opts = [[td, 'Hoje'], [addDays(td, 1), 'Amanhã'], [nextWeekday(6, false) === addDays(td, 1) ? addDays(td, 2) : nextWeekday(6, false), 'Fim de semana'], [nextWeekday(1, false), 'Próxima semana']];
  popover(anchor, `<div class="ph">Data</div>${opts.map(([d, n]) => `<button class="pi" data-d="${d}">${n}<span class="muted" style="margin-left:auto">${dueInfo({ due_date: d }).txt}</span></button>`).join('')}
    <button class="pi" data-d="">Sem data</button><hr>
    <div class="tk-dp"><input class="inp" type="date" data-dd value="${cur.due_date || ''}"><select class="inp" data-tm><option value="">Sem horário</option>${TIMES.map((x) => `<option value="${x}" ${cur.due_time?.slice(0, 5) === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="pfoot"><button class="b b-sm b-primary" data-ok>Aplicar</button></div>`, (p) => {
    p.addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) { closePop(); onPick(b.dataset.d || null, b.dataset.d ? p.querySelector('[data-tm]').value || null : null); } });
    p.querySelector('[data-ok]').addEventListener('click', () => { const d = p.querySelector('[data-dd]').value; const tm = p.querySelector('[data-tm]').value; closePop(); onPick(d || (tm ? today() : null), tm || null); });
  }, { closable: true });
}

// modal com o compositor (usado pelo botão "Adicionar tarefa", pelo atalho Q e pelo Follow-up)
export async function taskModal(defaults = {}, onDone) {
  try { await load(); } catch (e) { return fail(e); }
  modal('<h3>Nova tarefa</h3><div data-comp></div>', (c, close) => {
    c.closest('.modal-card').classList.add('tk-modal');
    composer(c.querySelector('[data-comp]'), defaults, { onDone: () => { close(); onDone?.(); if (!onDone && location.pathname.startsWith('/tarefas')) window.dispatchEvent(new Event('tracto:nav')); }, onCancel: close });
  });
}

// ---------- detalhe da tarefa ----------
function openTask(t, done) {
  const lead = t.lead_id ? S.leads?.find((l) => l.id === t.lead_id) : null;
  const author = profileOf(t.created_by);
  modal(`<div class="tk-detail">
    <div class="tk-d-main">
      ${t.parent_id ? `<button class="b b-sm b-ghost tk-link" data-parent>${IC.sub}${esc(TASKS.find((x) => x.id === t.parent_id)?.title || 'Tarefa principal')}</button>` : ''}
      <div class="tk-d-top"><button class="tk-check p${t.priority} ${t.done_at ? 'on' : ''}" data-check aria-label="Concluir">${IC.check}</button>
        <textarea class="tk-d-title" data-title rows="1" maxlength="300">${esc(t.title)}</textarea></div>
      <textarea class="tk-d-notes inp" data-notes rows="3" placeholder="Descrição, links, detalhes da demanda">${esc(t.notes || '')}</textarea>
      ${t.parent_id ? '' : `<div class="tk-sec"><div class="tk-sec-h">${IC.sub}<b>Subtarefas</b><span class="muted" data-subcount></span></div><div data-subs></div><div data-subadd></div></div>`}
      <div class="tk-sec"><div class="tk-sec-h">${IC.chat}<b>Comentários</b></div><div class="tk-comments" data-comments><div class="muted">Carregando…</div></div>
        <div class="tk-c-new"><textarea class="inp" data-cbody rows="2" placeholder="Escreva um comentário ou atualização"></textarea><button class="b b-sm b-primary" data-csend disabled>Comentar</button></div></div>
    </div>
    <aside class="tk-d-side">
      <div class="row"><label class="lbl">Projeto</label><select class="inp" data-f="project_id"><option value="">Entrada</option>${PROJECTS.map((p) => `<option value="${p.id}" ${t.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="row"><label class="lbl">Responsável</label><select class="inp" data-f="assignee_id"><option value="">Ninguém</option>${team().map((p) => `<option value="${p.id}" ${t.assignee_id === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>
      <div class="row"><label class="lbl">Data</label><input class="inp" type="date" data-f="due_date" value="${t.due_date || ''}"></div>
      <div class="row"><label class="lbl">Horário</label><select class="inp" data-f="due_time"><option value="">Sem horário</option>${TIMES.map((x) => `<option value="${x}" ${t.due_time?.slice(0, 5) === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="row"><label class="lbl">Prioridade</label><div class="tk-pri">${[1, 2, 3, 4].map((n) => `<button type="button" class="b b-sm ${t.priority === n ? 'on' : ''}" data-pri="${n}" title="${PRI[n][2]}"><span style="color:${PRI[n][1] || 'var(--gray-3)'}">${IC.flag}</span>P${n}</button>`).join('')}</div></div>
      ${t.parent_id ? '' : `<div class="row"><label class="lbl">Repetir</label><select class="inp" data-f="recur">${RECUR.map(([k, n]) => `<option value="${k}" ${(t.recur || '') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`}
      ${lead ? `<div class="row"><label class="lbl">Lead</label><button class="b b-sm tk-leadbtn" data-lead>${IC.lead}${esc(lead.nome)}</button></div>` : ''}
      <p class="help tk-d-by">Criada ${author ? `por ${esc(firstName(author.nome))} ` : ''}${esc(when(t.created_at))}${t.done_at ? ` · concluída ${esc(when(t.done_at))}` : ''}</p>
      <button class="b b-sm tk-del" data-del>${IC.trash}Excluir tarefa</button>
    </aside>
  </div>`, (c, close) => {
    c.closest('.modal-card').classList.add('modal-wide', 'tk-modal');
    const set = async (patch, msg) => { try { Object.assign(t, await save({ id: t.id, ...patch })); if (msg) toast(msg); done(); } catch (e) { fail(e); } };
    const ttl = c.querySelector('[data-title]');
    const fit = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }; fit(ttl); ttl.addEventListener('input', () => fit(ttl));
    ttl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ttl.blur(); } });
    ttl.addEventListener('blur', () => { const v = ttl.value.replace(/\s+/g, ' ').trim(); if (!v) { ttl.value = t.title; return; } if (v !== t.title) set({ title: v }); });
    const nt = c.querySelector('[data-notes]'); nt.addEventListener('blur', () => { const v = nt.value.trim() || null; if (v !== (t.notes || null)) set({ notes: v }); });
    c.querySelectorAll('[data-f]').forEach((f) => f.addEventListener('change', () => {
      const k = f.dataset.f; let v = f.value || null;
      const patch = { [k]: v };
      if (k === 'due_time' && v && !t.due_date) { patch.due_date = today(); c.querySelector('[data-f="due_date"]').value = patch.due_date; }
      if (k === 'recur' && v && !t.due_date) { patch.due_date = today(); c.querySelector('[data-f="due_date"]').value = patch.due_date; }
      if (k === 'due_date' && !v) { patch.due_time = null; patch.recur = null; }
      set(patch);
    }));
    c.querySelectorAll('[data-pri]').forEach((b) => b.addEventListener('click', () => {
      c.querySelectorAll('[data-pri]').forEach((x) => x.classList.toggle('on', x === b));
      const chk = c.querySelector('.tk-d-top .tk-check'); chk.className = chk.className.replace(/\bp[1-4]\b/, 'p' + b.dataset.pri);
      set({ priority: +b.dataset.pri });
    }));
    c.querySelector('[data-check]').addEventListener('click', async () => {
      const wasRec = t.recur && !t.parent_id && !t.done_at;
      await toggleDone(t, null, done);
      if (!wasRec) close(); else { c.querySelector('[data-f="due_date"]').value = t.due_date || ''; loadComments(); }
    });
    c.querySelector('[data-lead]')?.addEventListener('click', () => { close(); go('leads'); setTimeout(() => window.dispatchEvent(new CustomEvent('tracto:open-lead', { detail: t.lead_id })), 120); });
    c.querySelector('[data-parent]')?.addEventListener('click', () => { const p = TASKS.find((x) => x.id === t.parent_id); if (p) { close(); setTimeout(() => openTask(p, done), 180); } });
    c.querySelector('[data-del]').addEventListener('click', async () => {
      const subs = TASKS.filter((x) => x.parent_id === t.id).length;
      if (!(await confirmBox(`Excluir a tarefa "${t.title}"${subs ? ` e as ${subs} subtarefas` : ''}?`, 'Excluir'))) return;
      try { await DB.deleteTask(t.id); TASKS = TASKS.filter((x) => x.id !== t.id && x.parent_id !== t.id); toast('Tarefa excluída'); refreshBadge(); close(); done(); } catch (e) { fail(e); }
    });

    // subtarefas
    const subsHost = c.querySelector('[data-subs]');
    const drawSubs = () => {
      if (!subsHost) return;
      const subs = TASKS.filter((x) => x.parent_id === t.id).sort((a, b) => !!a.done_at - !!b.done_at || a.position - b.position);
      c.querySelector('[data-subcount]').textContent = subs.length ? `${subs.filter((x) => x.done_at).length}/${subs.length}` : '';
      subsHost.innerHTML = subs.map((s) => rowHtml(s, { team: false })).join('');
      subsHost.querySelectorAll('.tk-row').forEach((r) => {
        const s = TASKS.find((x) => x.id === r.dataset.id);
        r.querySelector('[data-check]').addEventListener('click', async (e) => { e.stopPropagation(); try { await save({ id: s.id, done_at: s.done_at ? null : new Date().toISOString() }); drawSubs(); done(); } catch (err) { fail(err); } });
        r.querySelector('[data-open]').addEventListener('click', () => { close(); setTimeout(() => openTask(s, done), 180); });
      });
    };
    if (subsHost) {
      drawSubs();
      const addHost = c.querySelector('[data-subadd]');
      const btn = () => { addHost.innerHTML = `<button class="tk-addrow" data-sadd>${IC.plus}<span>Adicionar subtarefa</span></button>`; addHost.querySelector('[data-sadd]').addEventListener('click', () => composer(addHost, { parent_id: t.id, project_id: t.project_id, assignee_id: t.assignee_id }, { inline: true, onDone: () => { drawSubs(); done(); }, onCancel: btn })); };
      btn();
    }

    // comentários
    const cHost = c.querySelector('[data-comments]');
    const loadComments = async () => {
      try {
        const list = await DB.listTaskComments(t.id); t._ncom = list.length;
        cHost.innerHTML = list.length ? list.map((m) => `<div class="tk-c"><span class="av">${esc(initials(m.author_name || '?'))}</span><div class="grow"><div class="tk-c-h"><b>${esc(m.author_name || 'Alguém')}</b><span class="muted">${esc(when(m.created_at))}</span>${m.author_id === S.me?.id || ['admin', 'gestor'].includes(S.me?.role) ? `<button class="b b-sm b-ghost fu-ic" data-cdel="${m.id}" aria-label="Excluir comentário">${ICON.x}</button>` : ''}</div><div class="tk-c-b">${esc(m.body)}</div></div></div>`).join('') : '<div class="muted tk-c-empty">Nenhum comentário ainda.</div>';
        cHost.querySelectorAll('[data-cdel]').forEach((b) => b.addEventListener('click', async () => {
          if (!(await confirmBox('Excluir este comentário?', 'Excluir'))) return;
          try { await DB.deleteTaskComment(b.dataset.cdel); loadComments(); } catch (e) { fail(e); }
        }));
      } catch (e) { cHost.innerHTML = '<div class="muted">Não consegui carregar os comentários.</div>'; }
    };
    loadComments();
    const cb = c.querySelector('[data-cbody]'); const cs = c.querySelector('[data-csend]');
    cb.addEventListener('input', () => { cs.disabled = !cb.value.trim(); });
    const sendC = async () => { const v = cb.value.trim(); if (!v) return; cs.disabled = true; try { await DB.addTaskComment(t.id, v, S.me); cb.value = ''; loadComments(); done(); } catch (e) { fail(e); cs.disabled = false; } };
    cs.addEventListener('click', sendC);
    cb.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendC(); } });
  });
}

// ---------- projetos ----------
function projectModal(p, onSaved) {
  let color = p?.color || PCOLORS[PROJECTS.length % PCOLORS.length];
  modal(`<h3>${p ? 'Editar projeto' : 'Novo projeto'}</h3>
    <div class="row"><label class="lbl" for="pjName">Nome</label><input class="inp" id="pjName" data-name maxlength="60" placeholder="Ex.: Clientes, Comercial, Conteúdo" value="${esc(p?.name || '')}"></div>
    <div class="row"><span class="lbl">Cor</span><div class="tk-colors">${PCOLORS.map((c) => `<button type="button" class="tk-color ${c === color ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('')}</div></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-save>${p ? 'Salvar' : 'Criar projeto'}</button></div>`, (c, close) => {
    c.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => { color = b.dataset.color; c.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); }));
    const go2 = async () => {
      const name = c.querySelector('[data-name]').value.trim(); if (!name) return toast('Dê um nome ao projeto', true);
      try { const row = await DB.saveTaskProject({ ...(p ? { id: p.id } : { position: PROJECTS.length }), name, color }); const i = PROJECTS.findIndex((x) => x.id === row.id); if (i >= 0) PROJECTS[i] = row; else PROJECTS.push(row); toast(p ? 'Projeto salvo' : 'Projeto criado'); close(); onSaved?.(row); } catch (e) { fail(e); }
    };
    c.querySelector('[data-save]').addEventListener('click', go2);
    c.querySelector('[data-name]').addEventListener('keydown', (e) => { if (e.key === 'Enter') go2(); });
  });
}
function projectMenu(anchor, p, el) {
  menu(anchor, [
    { label: 'Editar nome e cor', action: () => projectModal(p, () => paint(el)) },
    { sep: true },
    { label: 'Excluir projeto', danger: true, action: async () => {
      const n = TASKS.filter((t) => t.project_id === p.id).length;
      if (!(await confirmBox(`Excluir o projeto "${p.name}"${n ? ` e as ${n} tarefas dele` : ''}? Não dá pra desfazer.`, 'Excluir'))) return;
      try { await DB.deleteTaskProject(p.id); PROJECTS = PROJECTS.filter((x) => x.id !== p.id); TASKS = TASKS.filter((t) => t.project_id !== p.id); toast('Projeto excluído'); T.view = 'hoje'; T.project = null; setPath('/tarefas/hoje'); refreshBadge(); paint(el); } catch (e) { fail(e); }
    } }
  ]);
}

// atalho: Q abre "Nova tarefa" em qualquer tela
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'q' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"], .modal') || document.querySelector('.modal')) return;
  if (!document.getElementById('app') || document.getElementById('app').hidden) return;
  e.preventDefault(); taskModal({ assignee_id: S.me?.id || null, due_date: location.pathname.startsWith('/tarefas/hoje') || location.pathname === '/tarefas' ? today() : null });
});
