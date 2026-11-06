// Follow-up: todos os leads em aberto (e formulários incompletos) num lugar só, com cadência de mensagens
// por segmento (Marketing e Marketplace), status de cada conversa e quem precisa de um novo contato hoje.
import { DB, LIVE } from '@shared/db.js';
import { go, S, esc, ICON, initials, fmtPhone, ago, num, toast, fail, modal, confirmBox, menu, popover, closePop, renderTicket, stageOf, profileOf } from './util.js?v=2611060733';
import { resumeLink } from './recovery.js?v=2611060733';
import { serviceName } from './contract.js?v=2611060733';

const DAY = 86400000;
// "agora", "há 5 min", "há 2 d" ou a data
const when = (iso) => { const a = ago(iso); return a === 'agora' ? 'agora' : /\d (min|h|d)$/.test(a) ? 'há ' + a : 'em ' + a; };
const F = { seg: 'todos', view: 'contatar', q: '', mine: false };
const SEGS = [['marketing', 'Marketing'], ['marketplace', 'Marketplace'], ['recuperacao', 'Formulário incompleto']];
const STATUS = {
  novo: ['Novo', 'wait'], sem_resposta: ['Sem resposta', 'bad'], respondeu: ['Respondeu', 'good'], negociacao: ['Em negociação', 'hot'], encerrado: ['Encerrado', '']
};
const VIEWS = [
  ['contatar', 'Contatar hoje'], ['novos', 'Novos'], ['sem_resposta', 'Sem resposta'], ['respondeu', 'Responderam'],
  ['negociacao', 'Em negociação'], ['incompletos', 'Formulários incompletos'], ['encerrado', 'Encerrados']
];
const IC = {
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chat: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  hand: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  list: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>'
};

// ---------- cadência (compartilhada com a aba Recuperação) ----------
export async function loadSteps(force = false) {
  if (S.fuSteps && !force) return S.fuSteps;
  try { S.fuSteps = await DB.listFollowupSteps(); } catch (e) { S.fuSteps = S.fuSteps || []; }
  return S.fuSteps;
}
export const stepsOf = (seg) => (S.fuSteps || []).filter((x) => x.segment === seg).sort((a, b) => a.position - b.position);
const firstName = (n) => { const w = String(n || '').trim().split(/\s+/)[0] || ''; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''; };
// troca as variáveis da mensagem: {nome} primeiro nome do lead, {usuario} quem está enviando, {link} link de retomada
export function fillMsg(body, { nome, link = '' }) {
  const me = firstName(S.me?.nome);
  return String(body || '')
    .replace(/\{nome\}/g, firstName(nome))
    .replace(/\{usuario\}/g, me || 'o time')
    .replace(/\{link\}/g, link)
    .replace(/Oi ,/g, 'Oi,').replace(/^, /, '');
}
const waHref = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

// ---------- itens: leads em aberto + formulários incompletos ----------
const endToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };
function leadItem(l) {
  const seg = l.service === 'marketplace' ? 'marketplace' : 'marketing';
  const status = l.fu_status === 'encerrado' ? 'encerrado' : l.fu_status === 'negociacao' ? 'negociacao' : l.fu_status === 'respondeu' ? 'respondeu' : (l.fu_step || 0) > 0 ? 'sem_resposta' : 'novo';
  // lead novo entra na fila na hora; os muito antigos sem nenhum follow-up não poluem o "hoje"
  const fresh = Date.now() - new Date(l.created_at) < 30 * DAY;
  const next = status === 'encerrado' ? null : l.fu_next_at ? new Date(l.fu_next_at) : status === 'novo' && fresh ? new Date(l.created_at) : null;
  return { kind: 'lead', id: l.id, ref: l, nome: l.nome, whatsapp: l.whatsapp, email: l.email, seg, status, step: l.fu_step || 0, last: l.fu_last_at, next, owner: l.assigned_to, created: l.created_at };
}
function partialItem(p) {
  const status = (p.fu_step || 0) > 0 ? 'sem_resposta' : 'novo';
  const next = p.fu_next_at ? new Date(p.fu_next_at) : (p.fu_step || 0) === 0 ? new Date(p.updated_at) : null;
  return { kind: 'partial', id: p.id, ref: p, nome: p.nome, whatsapp: p.whatsapp, email: p.email, seg: 'recuperacao', status, step: p.fu_step || 0, last: p.contacted_at, next, owner: null, created: p.created_at };
}
function items() {
  const junk = S.stages.find((x) => x.name === 'Descarte')?.id;
  const leads = S.leads.filter((l) => (stageOf(l)?.kind || 'open') === 'open' && l.stage_id !== junk).map(leadItem);
  const partials = (S.partials || []).filter((p) => p.status === 'abandonado' && p.whatsapp).map(partialItem);
  return [...leads, ...partials];
}
export const isDueItem = (it) => it.status !== 'encerrado' && it.next && it.next <= endToday();
// contador do menu: o que eu (ou ninguém) preciso contatar hoje
export function followupDueCount() {
  return items().filter((it) => isDueItem(it) && (!it.owner || it.owner === S.me?.id)).length;
}

// ---------- tela ----------
export async function renderFollowup(el) {
  const stale = renderTicket(el);
  if (!S.fuSteps) el.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const [, partials] = await Promise.all([loadSteps(), DB.listPartials().catch(() => S.partials || [])]);
    S.partials = partials;
  } catch (e) { fail(e); }
  if (stale()) return;
  paint(el);
}

function paint(el) {
  const all = items();
  const now = endToday(); const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const segOk = (it) => F.seg === 'todos' || it.seg === F.seg || (F.view === 'incompletos' && it.seg === 'recuperacao');
  const mineOk = (it) => !F.mine || it.owner === S.me?.id || !it.owner;
  const scoped = all.filter((it) => mineOk(it) && (F.seg === 'todos' || it.seg === F.seg));
  const inView = (it, v) => v === 'contatar' ? isDueItem(it)
    : v === 'incompletos' ? it.kind === 'partial'
      : it.kind === 'lead' && it.status === (v === 'novos' ? 'novo' : v);
  const q = F.q.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
  const list = all.filter((it) => mineOk(it) && segOk(it) && inView(it, F.view) &&
    (!q || (it.nome || '').toLowerCase().includes(q) || (it.email || '').toLowerCase().includes(q) || (qd.length >= 3 && String(it.whatsapp || '').includes(qd))))
    .sort((a, b) => (a.next ? a.next - 0 : Infinity) - (b.next ? b.next - 0 : Infinity) || new Date(b.created) - new Date(a.created));

  const leadsScoped = scoped.filter((x) => x.kind === 'lead');
  const due = scoped.filter(isDueItem);
  const late = due.filter((x) => x.next < startToday);
  const touched = leadsScoped.filter((x) => x.step > 0 || ['respondeu', 'negociacao'].includes(x.status));
  const replied = leadsScoped.filter((x) => ['respondeu', 'negociacao'].includes(x.status));
  const count = (v) => all.filter((it) => mineOk(it) && segOk(it) && inView(it, v)).length;
  const manager = ['admin', 'gestor'].includes(S.me?.role);

  el.innerHTML = `
    <div class="topline"><h1>Follow-up</h1><div class="grow"></div>
      <div class="seg" role="radiogroup" aria-label="Segmento">${[['todos', 'Todos'], ['marketing', 'Marketing'], ['marketplace', 'Marketplace']].map(([k, n]) => `<button class="b ${F.seg === k ? 'on' : ''}" data-seg="${k}" role="radio" aria-checked="${F.seg === k}">${n}</button>`).join('')}</div>
      ${manager ? `<button class="b" data-cadence>${IC.list}Cadência</button>` : `<button class="b" data-cadence>${IC.list}Ver cadência</button>`}
    </div>
    <div class="kx-grid kx-4 fu-kpis">
      <section class="panel kx accent"><span class="kx-l">Contatar hoje</span><div class="kx-vr"><span class="kx-v">${num(due.length)}</span></div><div class="kx-s">${late.length ? `<span class="cf-neg">${num(late.length)} atrasado${late.length > 1 ? 's' : ''}</span>` : 'nenhum atrasado'}</div></section>
      <section class="panel kx"><span class="kx-l">Sem resposta</span><div class="kx-vr"><span class="kx-v">${num(leadsScoped.filter((x) => x.status === 'sem_resposta').length)}</span></div><div class="kx-s">na cadência de mensagens</div></section>
      <section class="panel kx"><span class="kx-l">Responderam</span><div class="kx-vr"><span class="kx-v">${num(replied.length)}</span></div><div class="kx-s">${touched.length ? `${Math.round((replied.length / touched.length) * 100)}% de quem recebeu contato` : 'taxa de resposta aparece aqui'}</div></section>
      <section class="panel kx"><span class="kx-l">Em negociação</span><div class="kx-vr"><span class="kx-v">${num(leadsScoped.filter((x) => x.status === 'negociacao').length)}</span></div><div class="kx-s">conversas avançadas</div></section>
    </div>
    <section class="panel toolbar">
      <div class="tb-row">
        <div class="seg seg-tabs fu-tabs">${VIEWS.map(([k, n]) => `<button class="b ${F.view === k ? 'on' : ''}" data-view="${k}">${n} <span class="muted">${count(k)}</span></button>`).join('')}</div>
      </div>
      <div class="tb-row">
        <label class="search">${ICON.search}<input class="inp" data-q type="search" placeholder="Buscar nome, WhatsApp, e-mail" value="${esc(F.q)}"></label>
        <div class="grow"></div>
        ${manager ? `<div class="seg">${[[false, 'Toda a equipe'], [true, 'Meus leads']].map(([k, n]) => `<button class="b b-sm ${F.mine === k ? 'on' : ''}" data-mine="${k}">${n}</button>`).join('')}</div>` : ''}
      </div>
    </section>
    <div class="fu-list">${list.length ? list.map(row).join('') : `<div class="panel empty"><h3>${F.view === 'contatar' ? 'Tudo em dia' : 'Nada por aqui'}</h3><p>${F.view === 'contatar' ? 'Ninguém precisa de contato agora. Novos leads e próximos toques da cadência aparecem aqui no dia certo.' : 'Nenhum lead nesse filtro.'}</p></div>`}</div>`;

  el.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => { F.seg = b.dataset.seg; paint(el); }));
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { F.view = b.dataset.view; paint(el); }));
  el.querySelectorAll('[data-mine]').forEach((b) => b.addEventListener('click', () => { F.mine = b.dataset.mine === 'true'; paint(el); }));
  el.querySelector('[data-cadence]').addEventListener('click', () => cadenceEditor(manager, () => paint(el)));
  const qi = el.querySelector('[data-q]');
  qi.addEventListener('input', () => { F.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { const pos = qi.selectionStart; paint(el); const n = el.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); }, 180); });

  const refresh = () => { paint(el); window.dispatchEvent(new Event('tracto:fu-changed')); };
  el.querySelectorAll('.fu-row').forEach((r) => {
    const it = all.find((x) => x.id === r.dataset.id && x.kind === r.dataset.kind); if (!it) return;
    r.querySelector('[data-send]')?.addEventListener('click', () => send(it, refresh));
    r.querySelector('[data-preview]')?.addEventListener('click', () => preview(it, refresh));
    r.querySelector('[data-replied]')?.addEventListener('click', () => setStatus(it, 'respondeu', refresh));
    r.querySelector('[data-nego]')?.addEventListener('click', () => setStatus(it, 'negociacao', refresh));
    r.querySelector('[data-touch]')?.addEventListener('click', () => touch(it, refresh));
    r.querySelector('[data-more]')?.addEventListener('click', (e) => moreMenu(e.currentTarget, it, refresh));
    r.querySelector('[data-open]')?.addEventListener('click', () => openItem(it));
  });
}

function nextLabel(d) {
  if (!d) return '';
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const diff = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - s) / DAY);
  if (diff < 0) return `<span class="fu-late">${IC.clock}atrasado ${-diff === 1 ? '1 dia' : `${-diff} dias`}</span>`;
  if (diff === 0) return `<span class="fu-today">${IC.clock}hoje</span>`;
  if (diff === 1) return `<span>${IC.clock}amanhã</span>`;
  return `<span>${IC.clock}${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')}</span>`;
}

function row(it) {
  const steps = stepsOf(it.seg); const n = steps.length;
  const [label, cls] = STATUS[it.status];
  const inCadence = ['novo', 'sem_resposta'].includes(it.status);
  const ended = inCadence && it.step >= n && n > 0;
  const owner = it.owner ? profileOf(it.owner) : null;
  const stage = it.kind === 'lead' ? stageOf(it.ref) : null;
  const dots = n ? `<span class="fu-dots" title="Toque ${Math.min(it.step, n)} de ${n}">${steps.map((_, i) => `<i class="${i < it.step ? 'on' : ''}"></i>`).join('')}</span>` : '';
  const seg = it.seg === 'recuperacao' ? '<span class="pill">Formulário incompleto</span>' : `<span class="pill svc svc-${it.seg}">${esc(serviceName(it.seg))}</span>`;
  let primary = '';
  if (!it.whatsapp) primary = '<span class="muted fu-nowa">sem WhatsApp</span>';
  else if (inCadence && !ended) primary = `<button class="b b-sm b-primary" data-send>${ICON.wa}Enviar toque ${it.step + 1}</button><button class="b b-sm b-ghost fu-ic" data-preview title="Ver e editar a mensagem antes" aria-label="Ver mensagem">${ICON.edit}</button>`;
  else if (it.status === 'respondeu' || it.status === 'negociacao' || ended) primary = `<a class="b b-sm" data-touch href="${waHref(it.whatsapp, `Oi ${firstName(it.nome)}, tudo certo?`)}" target="_blank" rel="noopener">${ICON.wa}Chamar</a>`;
  return `<article class="panel fu-row ${isDueItem(it) ? 'due' : ''}" data-id="${it.id}" data-kind="${it.kind}">
    <button class="fu-who" data-open title="${it.kind === 'lead' ? 'Abrir lead' : 'Ver formulário'}">
      <span class="av">${esc(initials(it.nome || '?'))}</span>
      <span class="fu-id"><b>${esc(it.nome || 'Sem nome')}</b><small>${it.whatsapp ? esc(fmtPhone(it.whatsapp)) : esc(it.email || '')}</small></span>
    </button>
    <div class="fu-info">
      <div class="fu-tags"><span class="pill ${cls}">${ended ? 'Cadência concluída' : label}</span>${seg}${stage ? `<span class="pill">${esc(stage.name)}</span>` : ''}${owner ? `<span class="pill" title="Responsável">${esc(firstName(owner.nome))}</span>` : ''}</div>
      <div class="fu-meta">${dots}${inCadence && n ? `<span>${it.step ? `toque ${Math.min(it.step, n)} de ${n}` : 'nenhum contato ainda'}</span>` : ''}${it.last ? `<span>último contato ${esc(when(it.last))}</span>` : ''}${it.next ? nextLabel(it.next) : ''}</div>
    </div>
    <div class="fu-act">
      ${primary}
      ${it.kind === 'lead' && inCadence ? `<button class="b b-sm" data-replied>${IC.chat}Respondeu</button>` : ''}
      ${it.kind === 'lead' && it.status === 'respondeu' ? `<button class="b b-sm" data-nego>${IC.hand}Em negociação</button>` : ''}
      <button class="b b-sm b-ghost fu-ic" data-more aria-label="Mais ações">${ICON.dots}</button>
    </div>
  </article>`;
}

// ---------- ações ----------
const patchItem = async (it, patch) => {
  if (it.kind === 'lead') { await DB.updateLeads([it.id], patch); Object.assign(it.ref, patch); }
  else { await DB.updatePartial(it.id, patch); Object.assign(it.ref, patch); }
};
const log = (it, body) => { if (it.kind === 'lead') DB.addActivity(it.id, 'followup', body, S.me).catch(() => {}); };
const plusDays = (n) => { const d = new Date(Date.now() + n * DAY); d.setHours(9, 0, 0, 0); return d; };

function messageFor(it) {
  const step = stepsOf(it.seg)[it.step];
  return step ? fillMsg(step.body, { nome: it.nome, link: it.kind === 'partial' ? resumeLink(it.ref) : '' }) : '';
}
// registra o toque enviado e agenda o próximo pela cadência
async function recordSend(it) {
  const steps = stepsOf(it.seg); const k = it.step; const nx = steps[k + 1];
  const now = new Date().toISOString();
  const next = nx ? new Date(Date.now() + nx.wait_days * DAY).toISOString() : null;
  try {
    if (it.kind === 'lead') await patchItem(it, { fu_step: k + 1, fu_status: 'sem_resposta', fu_last_at: now, fu_next_at: next, last_activity_at: now });
    else await patchItem(it, { fu_step: k + 1, fu_next_at: next, contacted_at: it.ref.contacted_at || now, contacted_by: it.ref.contacted_by || (LIVE ? S.me?.id : null) });
    log(it, `Follow-up: toque ${k + 1} de ${steps.length} enviado no WhatsApp`);
    toast(nx ? `Toque ${k + 1} registrado. Próximo em ${nx.wait_days === 1 ? '1 dia' : `${nx.wait_days} dias`}` : 'Último toque da cadência registrado');
  } catch (e) { fail(e); }
}
function send(it, done) {
  const text = messageFor(it); if (!text) return;
  window.open(waHref(it.whatsapp, text), '_blank', 'noopener');
  recordSend(it).then(done);
}
function preview(it, done) {
  const steps = stepsOf(it.seg);
  modal(`<h3>Toque ${it.step + 1} de ${steps.length} · ${esc(it.nome || '')}</h3>
    <p class="help">Revise ou ajuste a mensagem só pra este envio. Para mudar a cadência de todos, use o botão Cadência.</p>
    <div class="row"><textarea class="inp" rows="7" data-msg>${esc(messageFor(it))}</textarea></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><a class="b b-primary" data-go target="_blank" rel="noopener">${ICON.wa}Enviar no WhatsApp</a></div>`, (c, close) => {
    const a = c.querySelector('[data-go]'); const ta = c.querySelector('[data-msg]');
    const sync = () => { a.href = waHref(it.whatsapp, ta.value); }; sync(); ta.addEventListener('input', sync);
    a.addEventListener('click', () => { close(); recordSend(it).then(done); });
  });
}
async function setStatus(it, status, done) {
  const now = new Date().toISOString();
  try {
    await patchItem(it, { fu_status: status, fu_last_at: now, fu_next_at: status === 'encerrado' ? null : plusDays(status === 'respondeu' ? 1 : 2).toISOString() });
    log(it, `Follow-up: ${({ respondeu: 'lead respondeu', negociacao: 'em negociação', encerrado: 'follow-up encerrado' })[status]}`);
    toast(({ respondeu: 'Marcado como respondeu. Novo contato amanhã', negociacao: 'Em negociação. Novo contato em 2 dias', encerrado: 'Follow-up encerrado' })[status]);
  } catch (e) { fail(e); }
  done();
}
// conversa em andamento: registra o contato e agenda o próximo
async function touch(it, done) {
  const now = new Date().toISOString();
  try { await patchItem(it, { fu_last_at: now, fu_next_at: plusDays(2).toISOString(), last_activity_at: now }); log(it, 'Follow-up: contato feito no WhatsApp'); toast('Contato registrado. Próximo em 2 dias'); } catch (e) { fail(e); }
  done();
}
function reschedule(anchor, it, done) {
  const opt = [[0, 'Hoje'], [1, 'Amanhã'], [2, 'Em 2 dias'], [7, 'Em 1 semana']];
  popover(anchor, `<div class="ph">Próximo contato</div>${opt.map(([d, n]) => `<button class="pi" data-d="${d}">${n}<span class="muted" style="margin-left:auto">${plusDays(d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')}</span></button>`).join('')}<hr><div style="padding:6px 8px"><input class="inp" type="date" data-custom></div>`, (p) => {
    const apply = async (d) => { closePop(); try { await patchItem(it, { fu_next_at: d.toISOString() }); toast(`Próximo contato em ${d.toLocaleDateString('pt-BR')}`); } catch (e) { fail(e); } done(); };
    p.addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) apply(plusDays(+b.dataset.d)); });
    p.querySelector('[data-custom]').addEventListener('change', (e) => { if (e.target.value) apply(new Date(e.target.value + 'T09:00')); });
  });
}
function moreMenu(anchor, it, done) {
  const isLead = it.kind === 'lead';
  menu(anchor, [
    ...(isLead && it.status !== 'respondeu' ? [{ label: 'Marcar que respondeu', action: () => setStatus(it, 'respondeu', done) }] : []),
    ...(isLead && it.status !== 'negociacao' ? [{ label: 'Marcar em negociação', action: () => setStatus(it, 'negociacao', done) }] : []),
    { label: 'Reagendar próximo contato', action: () => reschedule(anchor, it, done) },
    ...(['novo', 'sem_resposta'].includes(it.status) && it.step < stepsOf(it.seg).length ? [{ label: `Pular toque ${it.step + 1}`, action: async () => { const nx = stepsOf(it.seg)[it.step + 1]; try { await patchItem(it, { fu_step: it.step + 1, fu_next_at: nx ? new Date().toISOString() : null }); toast('Toque pulado'); } catch (e) { fail(e); } done(); } }] : []),
    ...(it.step > 0 || it.status !== 'novo' ? [{ label: 'Reiniciar cadência', action: async () => { try { await patchItem(it, isLead ? { fu_step: 0, fu_status: null, fu_next_at: new Date().toISOString() } : { fu_step: 0, fu_next_at: new Date().toISOString() }); log(it, 'Follow-up: cadência reiniciada'); toast('Cadência reiniciada'); } catch (e) { fail(e); } done(); } }] : []),
    { label: 'Criar tarefa', action: async () => { const { taskModal } = await import('./tasks.js?v=2611060733'); taskModal({ title: `Retornar ${it.nome || ''}`.trim(), lead_id: isLead ? it.id : null, due_date: new Date().toISOString().slice(0, 10), assignee_id: S.me?.id || null }); } },
    { label: isLead ? 'Abrir lead' : 'Abrir em Recuperação', action: () => openItem(it) },
    { sep: true },
    isLead
      ? (it.status === 'encerrado' ? { label: 'Retomar follow-up', action: async () => { try { await patchItem(it, { fu_status: it.step ? 'sem_resposta' : null, fu_next_at: new Date().toISOString() }); toast('Follow-up retomado'); } catch (e) { fail(e); } done(); } }
        : { label: 'Encerrar follow-up', danger: true, action: async () => { if (await confirmBox(`Encerrar o follow-up de ${it.nome}? Ele sai da fila de contatos.`, 'Encerrar')) setStatus(it, 'encerrado', done); } })
      : { label: 'Descartar formulário', danger: true, action: async () => { if (!(await confirmBox(`Descartar o formulário de ${it.nome || 'sem nome'}?`, 'Descartar'))) return; try { await DB.updatePartial(it.id, { status: 'descartado', updated_at: new Date().toISOString() }); it.ref.status = 'descartado'; toast('Descartado'); } catch (e) { fail(e); } done(); } }
  ]);
}
function openItem(it) {
  if (it.kind === 'lead') { go('leads'); setTimeout(() => window.dispatchEvent(new CustomEvent('tracto:open-lead', { detail: it.id })), 120); }
  else go('recuperacao');
}

// ---------- editor da cadência ----------
function cadenceEditor(canEdit, done) {
  let seg = F.seg === 'marketplace' ? 'marketplace' : 'marketing';
  const draft = {}; SEGS.forEach(([k]) => { draft[k] = stepsOf(k).map((x) => ({ wait_days: x.wait_days, body: x.body })); });
  modal(`<div class="fu-cad">
      <h3>Cadência de follow-up</h3>
      <p class="help">A sequência de mensagens de cada segmento. O primeiro toque sai assim que o lead entra; os próximos, depois dos dias indicados, contando do toque anterior. Quando o lead responde, a cadência para.</p>
      <div class="seg fu-cad-seg" role="radiogroup">${SEGS.map(([k, n]) => `<button class="b b-sm" data-cs="${k}">${n}</button>`).join('')}</div>
      <p class="help fu-vars">Variáveis: <code>{nome}</code> primeiro nome do lead, <code>{usuario}</code> seu primeiro nome<span data-linkvar>, <code>{link}</code> link pra continuar o formulário</span></p>
      <div class="fu-steps" data-steps></div>
      ${canEdit ? '<button class="b b-sm" data-add>+ Adicionar toque</button>' : '<p class="help">Só gestores e administradores editam a cadência.</p>'}
    </div>
    <div class="modal-foot"><button class="b" data-close>${canEdit ? 'Cancelar' : 'Fechar'}</button>${canEdit ? '<button class="b b-primary" data-save>Salvar cadência</button>' : ''}</div>`, (c, close) => {
    c.closest('.modal-card').classList.add('modal-wide');
    const host = c.querySelector('[data-steps]');
    const collect = () => { draft[seg] = [...host.querySelectorAll('.fu-step')].map((s) => ({ wait_days: Math.max(0, Math.min(60, parseInt(s.querySelector('[data-wait]')?.value, 10) || 0)), body: s.querySelector('[data-body]').value })); };
    const draw = () => {
      c.querySelectorAll('[data-cs]').forEach((b) => b.classList.toggle('on', b.dataset.cs === seg));
      c.querySelector('[data-linkvar]').hidden = seg !== 'recuperacao';
      host.innerHTML = draft[seg].map((x, i) => `<div class="fu-step">
        <div class="fu-step-h"><span class="fu-step-n">${i + 1}</span><b>Toque ${i + 1}</b>
          ${i === 0 ? '<span class="muted">no dia da entrada</span>' : `<label class="fu-wait"><input class="inp" data-wait inputmode="numeric" value="${x.wait_days}" ${canEdit ? '' : 'disabled'}><span>dia${x.wait_days === 1 ? '' : 's'} depois do anterior</span></label>`}
          <div class="grow"></div>${canEdit && draft[seg].length > 1 ? `<button class="b b-sm b-ghost fu-ic" data-del="${i}" aria-label="Excluir toque">${ICON.x}</button>` : ''}</div>
        <textarea class="inp" rows="4" data-body ${canEdit ? '' : 'readonly'}>${esc(x.body)}</textarea>
        <div class="fu-prev"><span class="muted">Prévia:</span> ${esc(fillMsg(x.body, { nome: 'Marina Souza', link: 'https://assessoriatracto.com.br/aplicar/?retomar=…' }))}</div>
      </div>`).join('');
      host.querySelectorAll('[data-body]').forEach((ta) => ta.addEventListener('input', () => { ta.nextElementSibling.innerHTML = `<span class="muted">Prévia:</span> ${esc(fillMsg(ta.value, { nome: 'Marina Souza', link: 'https://assessoriatracto.com.br/aplicar/?retomar=…' }))}`; }));
      host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        collect();
        if (!(await confirmBox(`Excluir o toque ${+b.dataset.del + 1} da cadência?`, 'Excluir'))) return;
        draft[seg].splice(+b.dataset.del, 1); draw();
      }));
    };
    c.querySelectorAll('[data-cs]').forEach((b) => b.addEventListener('click', () => { collect(); seg = b.dataset.cs; draw(); }));
    c.querySelector('[data-add]')?.addEventListener('click', () => { collect(); draft[seg].push({ wait_days: 2, body: 'Oi {nome}, ' }); draw(); host.lastElementChild?.querySelector('[data-body]')?.focus(); });
    c.querySelector('[data-save]')?.addEventListener('click', async (e) => {
      collect();
      for (const [k, n] of SEGS) if (draft[k].some((x) => !x.body.trim())) return toast(`Preencha todas as mensagens de ${n}`, true);
      const btn = e.currentTarget; btn.disabled = true;
      try {
        for (const [k] of SEGS) {
          const before = JSON.stringify(stepsOf(k).map((x) => ({ wait_days: x.wait_days, body: x.body })));
          if (before !== JSON.stringify(draft[k])) await DB.saveFollowupSteps(k, draft[k].map((x, i) => ({ ...x, wait_days: i === 0 ? 0 : x.wait_days })));
        }
        await loadSteps(true); toast('Cadência salva'); close(); done();
      } catch (err) { btn.disabled = false; fail(err); }
    });
    draw();
  });
}
