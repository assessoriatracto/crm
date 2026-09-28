import { DB, LIVE, CONFIGURED } from '@shared/db.js';
import {
  go, routeName, S, $, $$, esc, ICON, FAT, COLORS, initials, isHot, stageOf, profileOf, labelOf, isInactive, isDue, fatShort, brl, pct, num,
  fmtPhone, fullDate, longDate, addedAt, ago, sourceLabel, formName, waLink, toast, fail, popover, closePop, menu, multiSelect,
  modal, confirmBox, downloadCSV, dateRange, datePicker, dateBtn
} from './util.js?v=2609281726';
import { renderDashboard } from './dashboard.js?v=2609281726';
import { renderSettings } from './admin.js?v=2609281726';
import { renderIntegrations, renderPixel, leadMetaEvents, statusPill } from './integrations.js?v=2609281726';
import { renderRecovery, loadPartials } from './recovery.js?v=2609281726';
import { showSignIn, showSignUp, showForgot, showReset, showMfa, showPending, watchIdle, AUTH_ROUTES } from './auth.js?v=2609281726';
import { openProfile } from './profile.js?v=2609281726';
import { renderBuilder } from './builder.js?v=2609281726';
import { renderFinance } from './finance.js?v=2609281726';

// ============================================================
// preferências locais (por navegador)
// ============================================================
const PREF_KEY = 'tracto_crm_prefs';
const pref = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; } })();
const savePref = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ view: V.view, showFilters: V.showFilters })); } catch (e) {} };

const V = {
  view: pref.view || 'board',
  showFilters: pref.showFilters ?? !matchMedia('(max-width:760px)').matches,
  bulkMode: false,
  sel: new Set(),
  sort: { key: 'created_at', dir: -1 },
  f: { q: '', period: 'tudo', from: '', to: '', campaigns: [], forms: [], stages: [], sources: [], assignees: [], labels: [] }
};

// ============================================================
// tema claro / escuro
// ============================================================
function applyTheme(next) {
  const root = document.documentElement;
  const set = () => {
    root.dataset.theme = next;
    try { localStorage.setItem('tracto_theme', next); } catch (e) {}
    if (routeName() === 'dashboard') route(); // redesenha gráficos com as cores novas
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return set();
  if (document.startViewTransition) { document.startViewTransition(set); return; }
  root.classList.add('theme-fade');
  set();
  setTimeout(() => root.classList.remove('theme-fade'), 420);
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-theme-toggle]'); if (!t) return;
  e.preventDefault();
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});
// ============================================================
// boot / auth / router
// ============================================================
const hashRoute = routeName;
let started = false;

async function boot() {
  const r = hashRoute();
  const enter = () => { go('leads', { replace: true }); boot(); };
  if (!CONFIGURED) return showSignIn(enter, 'O CRM está em manutenção. Tente de novo em alguns minutos.');
  // no modo demo as telas de acesso podem ser abertas pelo endereço, pra conferir o visual
  if (!LIVE && ['entrar', 'cadastro', 'esqueci', 'redefinir'].includes(r)) {
    return ({ entrar: () => showSignIn(enter), cadastro: showSignUp, esqueci: showForgot, redefinir: () => showReset(enter) })[r]();
  }
  if (r === 'cadastro') return showSignUp();
  if (r === 'esqueci') return showForgot();
  let session = null;
  try { session = await DB.session(); } catch (e) {}
  if (r === 'redefinir' && session) return showReset(enter);
  if (!session) return showSignIn(enter, r === 'confirmado' ? 'E-mail confirmado! Entre com sua senha.' : '');
  let aal = null;
  try { aal = await DB.mfaAal(); } catch (e) {}
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return showMfa(enter);
  try { S.me = await DB.me(); } catch (e) { S.me = null; }
  if (!S.me?.ativo) return showPending(S.me);
  if (AUTH_ROUTES.includes(r)) history.replaceState(null, '', '/leads');
  if (started) return route();
  started = true;
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#demoBar').hidden = LIVE;
  $('#logoutBtn').hidden = !LIVE;
  applyRole();
  await loadAll();
  DB.subscribe((type, row, table) => {
    if (table === 'leads' && type === 'INSERT' && row) toast('Novo lead: ' + row.nome);
    clearTimeout(boot._t);
    boot._t = setTimeout(async () => {
      if (table === 'partial_leads') { await refreshPartialsBadge(); if (routeName() === 'recuperacao') route(); return; }
      await loadAll(false); route();
    }, 400);
  });
  window.addEventListener('tracto:reload-leads', async () => { await loadAll(false); });
  window.addEventListener('tracto:open-lead', (e) => { if (S.leads.some((l) => l.id === e.detail)) openDrawer(e.detail); });
  refreshPartialsBadge();
  route();
  watchIdle();
  const due = S.leads.filter(isDue).length;
  if (due) toast(`Você tem ${due} lembrete${due > 1 ? 's' : ''} vencido${due > 1 ? 's' : ''}`);
}
const onNav = () => { if (!started || AUTH_ROUTES.includes(hashRoute())) boot(); else route(); };
window.addEventListener('tracto:nav', onNav);
window.addEventListener('popstate', () => window.dispatchEvent(new Event('tracto:nav')));
if (LIVE) DB.onAuth((event) => { if (event === 'PASSWORD_RECOVERY') { go('redefinir', { replace: true }); } if (event === 'SIGNED_OUT' && started) location.reload(); });

// o menu mostra só o que o papel permite (o banco também bloqueia)
const ROLE_ROUTES = { admin: null, gestor: ['leads', 'recuperacao', 'dashboard', 'financeiro', 'formularios', 'ajustes'], sdr: ['leads', 'recuperacao', 'dashboard', 'ajustes'] };
export const can = (routeName) => !ROLE_ROUTES[S.me?.role || 'sdr'] || ROLE_ROUTES[S.me?.role || 'sdr'].includes(routeName);
function applyRole() {
  $$('.side a[data-route]').forEach((a) => { a.hidden = !can(a.dataset.route); });
  const av = $('#meBtn');
  if (av) { av.textContent = (S.me?.nome || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); av.title = `${S.me?.nome} · ${({ admin: 'Admin', gestor: 'Gestor', sdr: 'SDR' })[S.me?.role] || ''}`; }
}
// mobile: barra inferior só com o essencial; o resto fica em "Mais"
const M_PRIMARY = ['leads', 'recuperacao', 'dashboard', 'financeiro'];
const M_LABEL = { leads: 'Leads', recuperacao: 'Recuperar', dashboard: 'Dashboard', financeiro: 'Financeiro', formularios: 'Formulários', integracoes: 'Integrações', pixel: 'Pixel', ajustes: 'Ajustes' };
$$('.side a[data-route]').forEach((a) => { a.dataset.m = M_LABEL[a.dataset.route] || ''; a.classList.toggle('m-sec', !M_PRIMARY.includes(a.dataset.route)); });
$('[data-more]').dataset.m = 'Mais';
function openMore() {
  const items = $$('.side a.m-sec[data-route]').filter((a) => !a.hidden);
  const icon = (a) => a.querySelector('svg').outerHTML;
  const dark = document.documentElement.dataset.theme !== 'light';
  const sh = document.createElement('div');
  sh.className = 'msheet-wrap';
  sh.innerHTML = `<div class="msheet" role="dialog" aria-label="Mais opções"><span class="msheet-grab"></span>
    <div class="msheet-me"><span class="me-btn">${esc($('#meBtn').textContent)}</span><div class="grow"><b>${esc(S.me?.nome || '')}</b><small>${esc(S.me?.email || '')}</small></div></div>
    <nav class="msheet-grid">${items.map((a) => `<a href="${a.getAttribute('href')}" class="${a.classList.contains('on') ? 'on' : ''}">${icon(a)}<span>${esc(a.dataset.m)}</span></a>`).join('')}</nav>
    <div class="msheet-list">
      <button data-ms="me">${ICON.user}<span>Meu perfil</span></button>
      <button data-ms="theme">${dark ? $('.theme-btn .i-sun').outerHTML : $('.theme-btn .i-moon').outerHTML}<span>${dark ? 'Modo claro' : 'Modo escuro'}</span></button>
      ${LIVE ? `<button data-ms="out" class="danger">${$('#logoutBtn svg').outerHTML}<span>Sair</span></button>` : ''}
    </div></div>`;
  document.body.appendChild(sh);
  requestAnimationFrame(() => sh.classList.add('open'));
  const close = () => { sh.classList.remove('open'); sh.addEventListener('transitionend', () => sh.remove(), { once: true }); setTimeout(() => sh.remove(), 400); };
  sh.addEventListener('click', (e) => {
    if (e.target === sh || e.target.closest('.msheet-grid a')) return close();
    const b = e.target.closest('[data-ms]'); if (!b) return;
    close();
    if (b.dataset.ms === 'me') openProfile();
    if (b.dataset.ms === 'theme') $('[data-theme-toggle]').click();
    if (b.dataset.ms === 'out') $('#logoutBtn').click();
  });
}
$('[data-more]').addEventListener('click', (e) => { e.preventDefault(); openMore(); });

$('#logoutBtn').addEventListener('click', async (e) => { e.preventDefault(); await DB.signOut(); location.replace('/entrar'); });
$('#meBtn')?.addEventListener('click', (e) => { e.preventDefault(); openProfile(); });

async function refreshPartialsBadge() {
  try {
    const list = await loadPartials();
    const n = list.filter((p) => p.status === 'abandonado' && (p.whatsapp || p.email) && !p.contacted_at).length;
    const b = $('#recBadge'); b.textContent = n; b.hidden = !n;
  } catch (e) { /* aba funciona mesmo sem o contador */ }
}

export async function loadAll(showSpinner = true) {
  if (showSpinner) $('#view').innerHTML = '<div class="loading">Carregando…</div>';
  try {
    [S.leads, S.stages, S.labels, S.profiles] = await Promise.all([DB.listLeads(), DB.listStages(), DB.listLabels(), DB.listProfiles()]);
    S.stages.sort((a, b) => a.position - b.position);
  } catch (e) { fail(e); }
  $('#dueDot').hidden = !S.leads.some(isDue);
}

let lastRoute = null;
function route() {
  closePop();
  let r = hashRoute();
  if (!can(r)) { r = 'leads'; history.replaceState(null, '', '/leads'); }
  // animação grande só quando a página muda (refiltrar/atualizar não anima)
  const key = location.pathname + (location.search.includes('id=') ? '#editor' : '');
  if (key !== lastRoute) {
    lastRoute = key;
    const v = $('#view'); v.classList.remove('view-enter'); void v.offsetWidth; v.classList.add('view-enter');
    clearTimeout(route._t); route._t = setTimeout(() => v.classList.remove('view-enter'), 700);
  }
  $$('.side a[data-route]').forEach((a) => a.classList.toggle('on', a.dataset.route === r));
  const view = $('#view');
  if (r === 'dashboard') renderDashboard(view);
  else if (r === 'formularios') renderBuilder(view);
  else if (r === 'financeiro') renderFinance(view);
  else if (r === 'ajustes') renderSettings(view, async () => { await loadAll(false); });
  else if (r === 'integracoes') renderIntegrations(view);
  else if (r === 'pixel') renderPixel(view);
  else if (r === 'recuperacao') renderRecovery(view).then(refreshPartialsBadge);
  else renderLeads();
}
export const rerender = route;

// ============================================================
// filtros
// ============================================================
const periodRange = (f) => dateRange(f);
function filtered() {
  const f = V.f;
  const q = f.q.trim().toLowerCase();
  const qd = q.replace(/\D/g, '');
  const [from, to] = periodRange(f);
  return S.leads.filter((l) => {
    const c = new Date(l.created_at);
    if (from && c < from) return false;
    if (to && c > to) return false;
    if (f.campaigns.length && !f.campaigns.includes(l.utm_campaign || '__none')) return false;
    if (f.forms.length && !f.forms.includes(l.form_id)) return false;
    if (f.stages.length && !f.stages.includes(l.stage_id)) return false;
    if (f.sources.length && !f.sources.includes(l.source)) return false;
    if (f.assignees.length && !f.assignees.includes(l.assigned_to || '__none')) return false;
    if (f.labels.length && !(l.label_ids || []).some((x) => f.labels.includes(x))) return false;
    if (q && ![l.nome, l.instagram, l.email, l.utm_campaign].some((v) => (v || '').toLowerCase().includes(q)) && !(qd.length >= 3 && String(l.whatsapp).includes(qd))) return false;
    return true;
  });
}
const activeCount = (k) => V.f[k].length;
function filterBtn(key, label) {
  if (key === 'period') return dateBtn(V.f, 'data-act="f" data-k="period"');
  const n = activeCount(key);
  return `<button class="b ${n ? 'on' : ''}" data-act="f" data-k="${key}" data-pop-anchor>${esc(label)}${n ? ` <span class="count-badge">${n}</span>` : ''} ${ICON.caret}</button>`;
}
function openFilter(btn, key) {
  const set = (vals) => { V.f[key] = vals; renderLeads(); };
  const opts = {
    campaigns: () => [...new Set(S.leads.map((l) => l.utm_campaign || '__none'))].sort().map((c) => ({ value: c, label: c === '__none' ? 'Sem campanha' : c })),
    forms: () => [...new Set([...Object.keys(S.forms), ...S.leads.map((l) => l.form_id)])].map((id) => ({ value: id, label: S.forms[id]?.name || (id === 'manual' ? 'Cadastro manual' : id) })),
    stages: () => S.stages.map((s) => ({ value: s.id, label: s.name, swatch: s.color })),
    sources: () => [['pago', 'Pago'], ['organico', 'Orgânico'], ['manual', 'Manual']].map(([value, label]) => ({ value, label })),
    assignees: () => [{ value: '__none', label: 'Não atribuído' }, ...S.profiles.filter((p) => p.ativo).map((p) => ({ value: p.id, label: p.nome }))],
    labels: () => S.labels.map((x) => ({ value: x.id, label: x.name, swatch: x.color }))
  };
  const titles = { campaigns: 'Campanha', forms: 'Formulários', stages: 'Estágio', sources: 'Fonte', assignees: 'Atribuído a', labels: 'Rótulos' };
  if (key === 'period') { datePicker(btn, V.f, (st) => { Object.assign(V.f, st); renderLeads(); }); return; }
  multiSelect(btn, { title: titles[key], options: opts[key](), selected: V.f[key], onChange: set });
}

// ============================================================
// página de leads
// ============================================================
function renderLeads() {
  const list = filtered();
  const view = $('#view');
  const first = S.stages.find((s) => s.kind === 'open');
  const won = list.filter((l) => stageOf(l)?.kind === 'won');
  const anyFilter = V.f.q || V.f.period !== 'tudo' || ['campaigns', 'forms', 'stages', 'sources', 'assignees', 'labels'].some((k) => V.f[k].length);
  const scrollX = $('.board')?.scrollLeft || 0;

  view.innerHTML = `
    <div class="topline"><h1>Central de <em>leads</em></h1><div class="grow"></div>
      <button class="b b-primary" data-act="new-lead">+ Novo lead</button></div>
    <section class="panel toolbar">
      <div class="tb-row">
        <div class="seg">
          <button class="b ${V.view === 'board' ? 'on' : ''}" data-act="view" data-v="board"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="4.5" height="16" rx="1"/><rect x="9.75" y="4" width="4.5" height="12" rx="1"/><rect x="16.5" y="4" width="4.5" height="8" rx="1"/></svg><span class="tb-t">Visualização de pipeline</span></button>
          <button class="b ${V.view === 'table' ? 'on' : ''}" data-act="view" data-v="table"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/></svg><span class="tb-t">Visualização de tabela</span></button>
        </div>
        <div class="grow"></div>
        <button class="b" data-act="toggle-filters"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg><span class="tb-t">${V.showFilters ? 'Ocultar filtros' : 'Mostrar filtros'}</span><span class="tb-m">Filtros</span>${anyFilter ? '<i class="tb-dot"></i>' : ''}</button>
      </div>
      <div class="tb-row filters" ${V.showFilters ? '' : 'hidden'}>
        <button class="b tb-desk" data-act="add-stage">Adicionar estágio personalizado</button>
        <button class="b tb-desk ${V.bulkMode ? 'on' : ''}" data-act="bulk">Edição em massa</button>
        <span class="vsep tb-desk"></span>
        <label class="search">${ICON.search}<input class="inp" data-q type="search" placeholder="Buscar nome, @, WhatsApp, e-mail" value="${esc(V.f.q)}"></label>
        ${filterBtn('campaigns', 'Campanha')}${filterBtn('forms', 'Formulários')}${filterBtn('period', 'Selecionar datas')}${filterBtn('stages', 'Estágio')}${filterBtn('sources', 'Fonte')}${filterBtn('assignees', 'Atribuído a')}${filterBtn('labels', 'Rótulos')}
        ${anyFilter ? '<button class="b b-ghost" data-act="clear">Limpar filtros</button>' : ''}
        <button class="b" data-act="more" data-pop-anchor aria-label="Mais ações">${ICON.dotsH}</button>
      </div>
    </section>
    <section class="panel kpis">
      <div class="k"><span>Leads${anyFilter ? ' filtrados' : ''}:</span><b>${num(list.length)}</b></div>
      <div class="k"><span>Leads em análise:</span><b>${num(list.filter((l) => l.stage_id === first?.id).length)}</b></div>
      <div class="k hot"><span>Quentes (50k+):</span><b>${num(list.filter(isHot).length)}</b></div>
      <div class="k"><span>Leads convertidos:</span><b>${won.length ? num(won.length) : '--'}</b></div>
      <div class="k"><span>Taxa de conversão:</span><b>${won.length ? pct(won.length, list.length) : '--'}</b></div>
      ${list.some(isDue) ? `<div class="k warn"><span>Lembretes vencidos:</span><b>${list.filter(isDue).length}</b></div>` : ''}
      <div class="grow"></div><a class="link" href="/dashboard">Ver dashboard</a>
    </section>
    <section id="leadsBody"></section>`;

  const body = $('#leadsBody');
  if (V.view === 'board') { body.innerHTML = boardHtml(list); $('.board').scrollLeft = scrollX; }
  else body.innerHTML = tableHtml(list);
  if (renderLeads._view && renderLeads._view !== V.view) body.classList.add('swap-in');
  renderLeads._view = V.view;
  if (V.flash) { $(`.card[data-id="${V.flash}"]`)?.classList.add('moved'); V.flash = null; }
  renderBulkBar();
}

// ---------- pipeline ----------
function chipsHtml(l) {
  const out = [];
  if (l.source === 'pago') out.push('<span class="chip paid">Pago</span>');
  else if (l.source === 'organico') out.push('<span class="chip">Orgânico</span>');
  if (isInactive(l)) out.push('<span class="chip inactive" title="Sem atividade há 7+ dias">Inativo</span>');
  out.push(l.recovered_from ? '<span class="chip rem">Recuperado</span>' : l.form_id === 'manual' ? '<span class="chip">Cadastro manual</span>' : l.form_id === 'api' ? '<span class="chip">Via API</span>' : '<span class="chip form">Formulário preenchido</span>');
  if (isHot(l)) out.push(`<span class="chip hot">${fatShort(l.faturamento)}</span>`);
  if (l.reminder_at) out.push(`<span class="chip ${isDue(l) ? 'due' : 'rem'}">${ICON.bell}${isDue(l) ? 'Vencido' : new Date(l.reminder_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>`);
  (l.label_ids || []).map(labelOf).filter(Boolean).forEach((x) => out.push(`<span class="chip tag" style="--c:${x.color}">${esc(x.name)}</span>`));
  return out.join('');
}
function cardHtml(l) {
  const p = profileOf(l.assigned_to);
  const sel = V.sel.has(l.id);
  return `<article class="card ${sel ? 'sel' : ''}" draggable="${!V.bulkMode}" data-id="${l.id}">
    ${V.bulkMode ? `<span class="cbx ${sel ? 'on' : ''}">${ICON.check}</span>` : ''}
    <div class="card-top">
      <span class="av ${isHot(l) ? 'hot' : ''}">${esc(initials(l.nome))}</span>
      <div class="card-main"><div class="card-name">${esc(l.nome)}</div><div class="card-sub">${l.instagram ? '@' + esc(l.instagram) : esc(fmtPhone(l.whatsapp))}</div></div>
      ${V.bulkMode ? '' : `<button class="card-menu" data-act="card-menu" data-pop-anchor aria-label="Ações">${ICON.dots}</button>`}
    </div>
    <div class="chips">${chipsHtml(l)}</div>
    <div class="card-foot">${p ? `<span class="av sm" title="${esc(p.nome)}">${esc(initials(p.nome))}</span>` : ''}${l.valor ? `<span>${brl(l.valor)}/mês</span>` : ''}<span class="grow"></span><span title="${fullDate(l.created_at)}">${ago(l.created_at)}</span></div>
  </article>`;
}
function boardHtml(list) {
  return `<div class="board">${S.stages.map((s) => {
    const items = list.filter((l) => l.stage_id === s.id);
    const soma = items.reduce((a, l) => a + Number(l.valor || 0), 0);
    return `<div class="col" data-stage="${s.id}">
      <div class="col-head"><span class="dot" style="background:${s.color}"></span><span class="col-name" title="${esc(s.name)}">${esc(s.name)}</span><span class="col-count">${items.length}</span><button class="card-menu" data-act="col-menu" data-pop-anchor aria-label="Opções do estágio">${ICON.dotsH}</button></div>
      ${s.kind !== 'open' || soma ? `<div class="col-kind">${s.kind === 'won' ? 'Ganho' : s.kind === 'lost' ? 'Perdido' : ''}${soma ? (s.kind !== 'open' ? ' · ' : '') + brl(soma) + '/mês' : ''}</div>` : ''}
      <div class="col-body">${items.length ? items.map(cardHtml).join('') : `<div class="col-empty">${ICON.empty}<b style="color:var(--c-text);font-size:14px">Nenhum lead no estágio<br>${esc(s.name)}</b></div>`}</div>
    </div>`;
  }).join('')}<button class="col-add" data-act="add-stage">+ Adicionar estágio</button></div>`;
}

// ---------- tabela ----------
const COLS = [
  ['nome', 'Nome'], ['whatsapp', 'Contato'], ['stage', 'Estágio'], ['assigned', 'Atribuído a'], ['labels', 'Rótulos'],
  ['faturamento', 'Faturamento'], ['form', 'Formulário'], ['source', 'Fonte'], ['utm_campaign', 'Campanha'], ['created_at', 'Criado em']
];
function sortVal(l, k) {
  if (k === 'stage') return stageOf(l)?.position ?? 99;
  if (k === 'assigned') return profileOf(l.assigned_to)?.nome || '~';
  if (k === 'faturamento') return FAT.indexOf(l.faturamento);
  if (k === 'form') return formName(l);
  if (k === 'labels') return (l.label_ids || []).length;
  return (l[k] ?? '').toString().toLowerCase();
}
function tableHtml(list) {
  if (!list.length) return `<div class="panel empty"><h3>Nenhum lead encontrado</h3><p>Ajuste os filtros ou aguarde novas respostas do formulário.</p></div>`;
  const { key, dir } = V.sort;
  const rows = [...list].sort((a, b) => { const x = sortVal(a, key); const y = sortVal(b, key); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  const all = rows.every((l) => V.sel.has(l.id));
  return `<div class="panel table-wrap"><table><thead><tr>
      <th class="col-sel"><button type="button" class="cbx ${all ? 'on' : ''}" data-act="sel-all" role="checkbox" aria-checked="${all}" aria-label="Selecionar todos">${ICON.check}</button></th>
      ${COLS.map(([k, n]) => `<th class="sortable" data-act="sort" data-k="${k}">${n}${key === k ? (dir > 0 ? ICON.up : ICON.down) : ''}</th>`).join('')}
    </tr></thead><tbody>
    ${rows.map((l) => {
      const s = stageOf(l); const p = profileOf(l.assigned_to); const sel = V.sel.has(l.id);
      return `<tr data-id="${l.id}" class="${sel ? 'sel' : ''}">
        <td class="col-sel"><button type="button" class="cbx ${sel ? 'on' : ''}" data-act="sel" role="checkbox" aria-checked="${sel}" aria-label="Selecionar">${ICON.check}</button></td>
        <td><div class="td-lead"><span class="av ${isHot(l) ? 'hot' : ''}">${esc(initials(l.nome))}</span><div><b>${esc(l.nome)}</b><small>${l.instagram ? '@' + esc(l.instagram) : ''}</small></div></div></td>
        <td class="nowrap">${esc(fmtPhone(l.whatsapp))}${l.email ? `<br><small class="muted">${esc(l.email)}</small>` : ''}</td>
        <td class="nowrap">${s ? `<span class="stage-pill"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span>` : '—'}</td>
        <td class="nowrap">${p ? esc(p.nome) : '<span class="muted">Não atribuído</span>'}</td>
        <td>${(l.label_ids || []).map(labelOf).filter(Boolean).map((x) => `<span class="chip tag" style="--c:${x.color}">${esc(x.name)}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
        <td class="nowrap">${esc(l.faturamento || '—')}</td>
        <td class="nowrap">${esc(formName(l).replace('Assessoria Tracto - ', ''))}</td>
        <td>${sourceLabel(l.source)}</td>
        <td class="ellip" title="${esc(l.utm_campaign || '')}">${esc(l.utm_campaign || '—')}</td>
        <td class="nowrap" title="${fullDate(l.created_at)}">${new Date(l.created_at).toLocaleDateString('pt-BR')} <small class="muted">${new Date(l.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
}

// ---------- edição em massa ----------
function renderBulkBar() {
  $('.bulk')?.remove();
  if (!V.sel.size) return;
  const bar = document.createElement('div');
  bar.className = 'bulk';
  bar.innerHTML = `<b>${V.sel.size} selecionado${V.sel.size > 1 ? 's' : ''}</b>
    <button class="b b-sm" data-b="stage" data-pop-anchor>Mover para estágio ${ICON.caret}</button>
    <button class="b b-sm" data-b="assign" data-pop-anchor>Atribuir ${ICON.caret}</button>
    <button class="b b-sm" data-b="label" data-pop-anchor>Rótulo ${ICON.caret}</button>
    <button class="b b-sm" data-b="export">Exportar</button>
    <button class="b b-sm b-danger" data-b="delete">Excluir</button>
    <button class="b b-sm b-ghost" data-b="cancel">Cancelar</button>`;
  document.body.appendChild(bar);
  bar.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-b]'); if (!b) return;
    const ids = [...V.sel];
    const act = b.dataset.b;
    if (act === 'cancel') { V.sel.clear(); V.bulkMode = false; renderLeads(); }
    if (act === 'stage') menu(b, S.stages.map((s) => ({ label: s.name, swatch: s.color, action: () => patch(ids, { stage_id: s.id }, `${ids.length} movido(s) para ${s.name}`) })));
    if (act === 'assign') menu(b, [{ label: 'Não atribuído', action: () => patch(ids, { assigned_to: null }) }, ...S.profiles.filter((p) => p.ativo).map((p) => ({ label: p.nome, action: () => patch(ids, { assigned_to: p.id }, `${ids.length} atribuído(s) a ${p.nome}`) }))]);
    if (act === 'label') {
      if (!S.labels.length) return toast('Crie rótulos em Ajustes ou no painel de um lead');
      menu(b, S.labels.map((x) => ({ label: x.name, swatch: x.color, action: async () => {
        try {
          for (const id of ids) {
            const l = S.leads.find((y) => y.id === id);
            if ((l.label_ids || []).includes(x.id)) continue;
            l.label_ids = [...(l.label_ids || []), x.id];
            await DB.updateLeads([id], { label_ids: l.label_ids });
            await DB.addActivity(id, 'label', 'Rótulo adicionado: ' + x.name, S.me);
          }
          toast('Rótulo aplicado'); renderLeads();
        } catch (err) { fail(err); }
      } })));
    }
    if (act === 'export') exportCSV(S.leads.filter((l) => V.sel.has(l.id)));
    if (act === 'delete') {
      if (!(await confirmBox(`Excluir ${ids.length} lead${ids.length > 1 ? 's' : ''}? Isso não pode ser desfeito.`, 'Excluir'))) return;
      try { await DB.deleteLeads(ids); S.leads = S.leads.filter((l) => !V.sel.has(l.id)); V.sel.clear(); toast('Leads excluídos'); renderLeads(); } catch (err) { fail(err); }
    }
  });
}

export async function patch(ids, p, msg) {
  const before = ids.map((id) => ({ ...S.leads.find((l) => l.id === id) }));
  S.leads.forEach((l) => { if (ids.includes(l.id)) Object.assign(l, p, { last_activity_at: new Date().toISOString() }); });
  route(); if (S.openId && ids.includes(S.openId)) renderDrawer();
  try {
    await DB.updateLeads(ids, p);
    if (msg) toast(msg);
    if (S.openId && ids.includes(S.openId)) loadActivity();
  } catch (e) {
    before.forEach((b) => Object.assign(S.leads.find((l) => l.id === b.id) || {}, b));
    route(); fail(e);
  }
}

function exportCSV(list) {
  const qs = [...new Set(list.flatMap((l) => (l.answers || []).map((a) => a.label)))];
  const head = ['Criado em', 'Nome', 'WhatsApp', 'E-mail', 'Instagram', 'Faturamento', 'Estágio', 'Atribuído a', 'Rótulos', 'Valor', 'Formulário', 'Fonte', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', ...qs];
  const rows = list.map((l) => [fullDate(l.created_at), l.nome, fmtPhone(l.whatsapp), l.email, l.instagram, l.faturamento, stageOf(l)?.name, profileOf(l.assigned_to)?.nome,
    (l.label_ids || []).map(labelOf).filter(Boolean).map((x) => x.name).join(', '), l.valor, formName(l), sourceLabel(l.source), l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content,
    ...qs.map((q) => (l.answers || []).find((a) => a.label === q)?.value)]);
  downloadCSV(`leads-tracto-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...rows]);
  DB.auditEvent('export', 'leads', { quantidade: list.length });
}

// ---------- eventos da página de leads ----------
const view = $('#view');
view.addEventListener('input', (e) => {
  if (e.target.matches('[data-q]')) {
    V.f.q = e.target.value;
    clearTimeout(view._t);
    view._t = setTimeout(() => { const pos = e.target.selectionStart; renderLeads(); const i = $('[data-q]'); i.focus(); i.setSelectionRange(pos, pos); }, 180);
  }
});
view.addEventListener('click', async (e) => {
  if (!$('#leadsBody')) return; // outras páginas tratam seus cliques
  const a = e.target.closest('[data-act]');
  const card = e.target.closest('.card[data-id]');
  const row = e.target.closest('tr[data-id]');
  const act = a?.dataset.act;

  if (act === 'view') { V.view = a.dataset.v; savePref(); renderLeads(); return; }
  if (act === 'toggle-filters') { V.showFilters = !V.showFilters; savePref(); renderLeads(); return; }
  if (act === 'bulk') { V.bulkMode = !V.bulkMode; if (!V.bulkMode) V.sel.clear(); renderLeads(); return; }
  if (act === 'f') { openFilter(a, a.dataset.k); return; }
  if (act === 'clear') { V.f = { q: '', period: 'tudo', from: '', to: '', campaigns: [], forms: [], stages: [], sources: [], assignees: [], labels: [] }; renderLeads(); return; }
  if (act === 'new-lead') { newLeadModal(); return; }
  if (act === 'add-stage') { stageModal(); return; }
  if (act === 'more') { const mob = matchMedia('(max-width:760px)').matches; menu(a, [...(mob ? [{ label: 'Adicionar estágio personalizado', action: () => stageModal() }, { label: V.bulkMode ? 'Sair da edição em massa' : 'Edição em massa', action: () => { V.bulkMode = !V.bulkMode; V.sel.clear(); renderLeads(); } }] : []), { label: 'Exportar leads filtrados (CSV)', action: () => exportCSV(filtered()) }, { label: 'Gerenciar estágios e rótulos', action: () => { go('ajustes'); } }]); return; }
  if (act === 'sort') { const k = a.dataset.k; V.sort = { key: k, dir: V.sort.key === k ? -V.sort.dir : (k === 'created_at' ? -1 : 1) }; renderLeads(); return; }
  if (act === 'sel-all') { const list = filtered(); const all = list.every((l) => V.sel.has(l.id)); list.forEach((l) => (all ? V.sel.delete(l.id) : V.sel.add(l.id))); renderLeads(); return; }
  if (act === 'sel' && row) { toggleSel(row.dataset.id); return; }
  if (act === 'col-menu') { colMenu(a, a.closest('.col').dataset.stage); return; }
  if (act === 'card-menu' && card) { cardMenu(a, card.dataset.id); return; }

  if (card) { if (V.bulkMode) toggleSel(card.dataset.id); else openDrawer(card.dataset.id); return; }
  if (row) openDrawer(row.dataset.id);
});
function toggleSel(id) { V.sel.has(id) ? V.sel.delete(id) : V.sel.add(id); renderLeads(); }

// drag & drop entre estágios
let dragId = null;
view.addEventListener('dragstart', (e) => {
  const c = e.target.closest?.('.card'); if (!c) return;
  dragId = c.dataset.id; c.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
});
view.addEventListener('dragend', (e) => { e.target.closest?.('.card')?.classList.remove('dragging'); $$('.col.drop').forEach((c) => c.classList.remove('drop')); });
view.addEventListener('dragover', (e) => {
  const col = e.target.closest?.('.col'); if (!col || !dragId) return;
  e.preventDefault();
  $$('.col.drop').forEach((c) => c !== col && c.classList.remove('drop'));
  col.classList.add('drop');
});
view.addEventListener('drop', (e) => {
  const col = e.target.closest?.('.col'); if (!col || !dragId) return;
  e.preventDefault(); col.classList.remove('drop');
  const l = S.leads.find((x) => x.id === dragId);
  const s = S.stages.find((x) => x.id === col.dataset.stage);
  if (l && s && l.stage_id !== s.id) { V.flash = l.id; patch([l.id], { stage_id: s.id }); }
  dragId = null;
});

function cardMenu(btn, id) {
  const l = S.leads.find((x) => x.id === id);
  menu(btn, [
    { label: 'Abrir lead', action: () => openDrawer(id) },
    { label: 'Chamar no WhatsApp', action: () => window.open(waLink(l), '_blank', 'noopener') },
    { sep: true }, { header: 'Mover para' },
    ...S.stages.filter((s) => s.id !== l.stage_id).map((s) => ({ label: s.name, swatch: s.color, action: () => patch([id], { stage_id: s.id }) })),
    { sep: true },
    { label: 'Excluir lead', danger: true, action: () => deleteLead(id) }
  ]);
}
function colMenu(btn, stageId) {
  const i = S.stages.findIndex((s) => s.id === stageId);
  const s = S.stages[i];
  menu(btn, [
    { label: 'Editar estágio', action: () => stageModal(s) },
    ...(i > 0 ? [{ label: 'Mover para a esquerda', action: () => moveStage(i, -1) }] : []),
    ...(i < S.stages.length - 1 ? [{ label: 'Mover para a direita', action: () => moveStage(i, 1) }] : []),
    { sep: true },
    { label: 'Excluir estágio', danger: true, action: () => deleteStageFlow(s) }
  ]);
}
export async function moveStage(i, d) {
  const a = S.stages[i]; const b = S.stages[i + d];
  [a.position, b.position] = [b.position, a.position];
  S.stages.sort((x, y) => x.position - y.position);
  route();
  try { await DB.saveStage({ id: a.id, name: a.name, color: a.color, kind: a.kind, position: a.position }); await DB.saveStage({ id: b.id, name: b.name, color: b.color, kind: b.kind, position: b.position }); } catch (e) { fail(e); }
}
export async function deleteStageFlow(s) {
  const count = S.leads.filter((l) => l.stage_id === s.id).length;
  const others = S.stages.filter((x) => x.id !== s.id);
  if (!others.length) return toast('O pipeline precisa de pelo menos um estágio', true);
  modal(`<h3>Excluir o estágio "${esc(s.name)}"?</h3>
    ${count ? `<div class="row"><label class="lbl">Mover os ${count} lead(s) para</label><select class="inp" data-to>${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div>` : '<p class="muted">Nenhum lead está nesse estágio.</p>'}
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-danger" data-ok>Excluir estágio</button></div>`, (c, close) => {
    c.querySelector('[data-ok]').addEventListener('click', async () => {
      const to = c.querySelector('[data-to]')?.value || null;
      try {
        await DB.deleteStage(s.id, to);
        S.leads.forEach((l) => { if (l.stage_id === s.id) l.stage_id = to; });
        S.stages = S.stages.filter((x) => x.id !== s.id);
        close(); toast('Estágio excluído'); route();
      } catch (e) { fail(e); }
    });
  });
}
export function stageModal(s) {
  const color = s?.color || COLORS[S.stages.length % COLORS.length];
  modal(`<h3>${s ? 'Editar estágio' : 'Adicionar estágio personalizado'}</h3>
    <div class="row"><label class="lbl">Nome</label><input class="inp" data-name maxlength="40" value="${esc(s?.name || '')}" placeholder="Ex: Proposta enviada"></div>
    <div class="row"><label class="lbl">Tipo</label><select class="inp" data-kind>
      <option value="open" ${s?.kind === 'open' ? 'selected' : ''}>Em andamento</option>
      <option value="won" ${s?.kind === 'won' ? 'selected' : ''}>Ganho (conta como convertido)</option>
      <option value="lost" ${s?.kind === 'lost' ? 'selected' : ''}>Perdido</option></select></div>
    <div class="row"><label class="lbl">Cor</label><div class="colors">${COLORS.map((c) => `<button type="button" data-c="${c}" class="${c === color ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar</button></div>`, (c, close) => {
    let col = color;
    c.querySelector('.colors').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; col = b.dataset.c; $$('.colors button', c).forEach((x) => x.classList.toggle('on', x === b)); });
    const save = async () => {
      const name = c.querySelector('[data-name]').value.trim();
      if (!name) return toast('Dê um nome ao estágio', true);
      const row = { name, color: col, kind: c.querySelector('[data-kind]').value, position: s ? s.position : Math.max(-1, ...S.stages.map((x) => x.position)) + 1 };
      if (s) row.id = s.id;
      try {
        const saved = await DB.saveStage(row);
        if (s) Object.assign(s, saved); else S.stages.push(saved);
        close(); toast(s ? 'Estágio atualizado' : 'Estágio criado'); route();
      } catch (e) { fail(e); }
    };
    c.querySelector('[data-ok]').addEventListener('click', save);
    c.querySelector('[data-name]').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  });
}

function newLeadModal() {
  modal(`<h3>Novo lead</h3>
    <div class="row"><label class="lbl">Nome</label><input class="inp" data-f="nome" required></div>
    <div class="grid2"><div class="row"><label class="lbl">WhatsApp</label><input class="inp" data-f="whatsapp" placeholder="(62) 99999-9999"></div>
    <div class="row"><label class="lbl">Instagram</label><input class="inp" data-f="instagram" placeholder="loja"></div></div>
    <div class="row"><label class="lbl">E-mail</label><input class="inp" data-f="email" type="email"></div>
    <div class="grid2"><div class="row"><label class="lbl">Faturamento</label><select class="inp" data-f="faturamento"><option value="">—</option>${FAT.map((f) => `<option>${f}</option>`).join('')}</select></div>
    <div class="row"><label class="lbl">Estágio</label><select class="inp" data-f="stage_id">${S.stages.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div></div>
    <div class="row"><label class="lbl">Atribuído a</label><select class="inp" data-f="assigned_to"><option value="">Não atribuído</option>${S.profiles.filter((p) => p.ativo).map((p) => `<option value="${p.id}" ${p.id === S.me?.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar lead</button></div>`, (c, close) => {
    c.querySelector('[data-ok]').addEventListener('click', async () => {
      const v = Object.fromEntries($$('[data-f]', c).map((i) => [i.dataset.f, i.value.trim()]));
      const d = v.whatsapp.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
      if (v.nome.length < 2) return toast('Informe o nome', true);
      if (d && (d.length < 10 || d.length > 11)) return toast('WhatsApp precisa de DDD + número', true);
      try {
        const lead = await DB.createLead({
          nome: v.nome, whatsapp: d ? '55' + d : null, email: v.email || null, instagram: v.instagram.replace(/[@\s]/g, '').toLowerCase() || null,
          faturamento: v.faturamento || null, stage_id: v.stage_id, assigned_to: v.assigned_to || null,
          form_id: 'manual', form_name: 'Cadastro manual', source: 'manual', answers: []
        });
        S.leads.unshift(lead); close(); toast('Lead criado'); route(); openDrawer(lead.id);
      } catch (e) { fail(e); }
    });
  });
}

async function deleteLead(id) {
  const l = S.leads.find((x) => x.id === id);
  if (!(await confirmBox(`Excluir o lead ${l.nome}? Isso não pode ser desfeito.`, 'Excluir lead'))) return;
  try { await DB.deleteLeads([id]); S.leads = S.leads.filter((x) => x.id !== id); if (S.openId === id) closeDrawer(); toast('Lead excluído'); route(); } catch (e) { fail(e); }
}

// ============================================================
// painel do lead (drawer)
// ============================================================
const drawer = $('#drawer');
function openDrawer(id) {
  S.openId = id;
  renderDrawer();
  drawer.classList.add('on', 'opening'); drawer.setAttribute('aria-hidden', 'false');
  setTimeout(() => drawer.classList.remove('opening'), 500);
  $('#scrim').classList.add('on');
  drawer.querySelector('.dr-body').scrollTop = 0;
  loadActivity();
}
function closeDrawer() {
  S.openId = null;
  drawer.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('on');
}
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.openId && !$('.modal') && !$('.pop')) closeDrawer(); });

function renderDrawer() {
  const l = S.leads.find((x) => x.id === S.openId);
  if (!l) return closeDrawer();
  const scroll = drawer.querySelector('.dr-body')?.scrollTop || 0;
  const note = drawer.querySelector('[data-note]')?.value || '';
  const remOn = !!l.reminder_at;
  const toLocal = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const tracking = [['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'], ['utm_campaign', 'Campanha'], ['utm_content', 'Anúncio'], ['utm_term', 'Termo'], ['referrer', 'Página de origem']].filter(([k]) => l[k]);
  drawer.innerHTML = `
    <div class="dr-head"><span class="av ${isHot(l) ? 'hot' : ''}">${esc(initials(l.nome))}</span><h2>${esc(l.nome)}</h2><button class="icon-btn" data-d="close" aria-label="Fechar">${ICON.x}</button></div>
    <div class="dr-body">
      <div class="sec">
        <div class="meta-line">Lead adicionado ${addedAt(l.created_at)}</div>
        <div class="chips">${chipsHtml(l)}</div>
        <div class="meta-links">${(l.answers || []).length ? '<button class="link" data-d="answers">Ver respostas do formulário</button>' : ''}${l.utm_campaign ? `<span class="muted">Campanha: ${esc(l.utm_campaign)}</span>` : ''}</div>
      </div>
      <div class="sec">
        <div class="contact">
          ${l.whatsapp ? `<div class="ci">${ICON.phone}<span class="grow">${esc(fmtPhone(l.whatsapp))}</span></div>` : ''}
          ${l.email ? `<div class="ci">${ICON.mail}<a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div>` : ''}
          ${l.instagram ? `<div class="ci">${ICON.insta}<a href="https://instagram.com/${encodeURIComponent(l.instagram)}" target="_blank" rel="noopener">@${esc(l.instagram)}</a></div>` : ''}
        </div>
        <div class="quick">
          ${l.whatsapp ? `<a class="b b-primary" href="${waLink(l)}" target="_blank" rel="noopener">${ICON.wa}Chamar no WhatsApp</a>` : ''}
          <button class="b" data-d="edit">Editar informações de contato</button>
        </div>
      </div>
      <div class="sec">
        <h4>Rótulos</h4>
        <p class="help">Os rótulos ajudam você a descrever e organizar seus cadastros.</p>
        <div class="lbl-list">${(l.label_ids || []).map(labelOf).filter(Boolean).map((x) => `<span class="chip tag" style="--c:${x.color}">${esc(x.name)}<button data-d="unlabel" data-id="${x.id}" aria-label="Remover">×</button></span>`).join('')}</div>
        <label class="search" style="max-width:none">${ICON.search}<input class="inp" data-lblq placeholder="Pesquisar ou criar uma etiqueta" data-pop-anchor autocomplete="off"></label>
      </div>
      <div class="sec">
        <h4>Gerenciamento do lead</h4>
        <div class="grid2" style="margin-top:10px">
          <div><label class="lbl">Atribuído a</label><select class="inp" data-field="assigned_to"><option value="">Não atribuído</option>${S.profiles.filter((p) => p.ativo || p.id === l.assigned_to).map((p) => `<option value="${p.id}" ${p.id === l.assigned_to ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>
          <div><label class="lbl">Estágio</label><select class="inp" data-field="stage_id">${S.stages.map((s) => `<option value="${s.id}" ${s.id === l.stage_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        </div>
        <div style="margin-top:10px"><label class="lbl">Valor do contrato (R$/mês)</label><input class="inp" data-field="valor" inputmode="decimal" value="${l.valor ?? ''}" placeholder="0"></div>
      </div>
      <div class="sec">
        <h4>Lembrete</h4>
        <label class="radio"><input type="radio" name="rem" value="none" ${remOn ? '' : 'checked'}>Nenhum lembrete</label>
        <label class="radio"><input type="radio" name="rem" value="on" ${remOn ? 'checked' : ''}>Programar um lembrete</label>
        <div data-rem ${remOn ? '' : 'hidden'} style="margin-top:8px">
          <div class="grid2"><input class="inp" type="datetime-local" data-rem-at value="${remOn ? toLocal(l.reminder_at) : ''}"><input class="inp" data-rem-note placeholder="Sobre o quê?" maxlength="200" value="${esc(l.reminder_note || '')}"></div>
          <div class="sec-actions"><button class="b b-sm b-primary" data-d="rem-save">Salvar lembrete</button></div>
        </div>
      </div>
      <div class="sec">
        <h4>Notas</h4>
        <p class="help">As notas ajudam você a se lembrar de detalhes importantes sobre seus cadastros.</p>
        <div class="note-box"><textarea class="inp" data-note maxlength="1000" placeholder="Escreva uma nota...">${esc(note)}</textarea><span class="counter">${note.length}/1000</span></div>
        <div class="sec-actions"><button class="b b-primary" data-d="note" ${note.trim() ? '' : 'disabled'}>Salvar</button></div>
        <h4 style="margin-top:16px">Atividade</h4>
        <div class="timeline" id="timeline"><span class="muted">Carregando…</span></div>
      </div>
      <div class="sec" id="answersSec">
        <h4>Respostas do formulário</h4>
        <div class="form-meta">${esc(formName(l))}<br>Identificação do lead ${esc(l.id.slice(0, 8).toUpperCase())}<br>Enviado em ${esc(longDate(l.created_at))}.</div>
        ${(l.answers || []).length ? `<div class="answers">${l.answers.map((a) => `<div><div class="q">${esc(a.label)}</div><div class="a">${a.type === 'file' || /^respostas\//.test(a.value) ? `<button class="b b-sm" data-d="file" data-path="${esc(a.value)}">${ICON.clip}${esc(a.file_name || a.value.split('/').pop().replace(/^[\w-]{36}-/, ''))}</button>` : esc(a.value)}</div></div>`).join('')}</div>` : '<p class="muted">Lead cadastrado manualmente, sem respostas de formulário.</p>'}
      </div>
      <div class="sec" id="metaSec" hidden><h4>Eventos enviados (Meta e Google)</h4><div class="meta-evs"></div></div>
      ${tracking.length ? `<div class="sec"><h4>Rastreamento</h4><dl class="kv" style="margin:10px 0 0">${tracking.map(([k, n]) => `<dt>${n}</dt><dd>${esc(l[k])}</dd>`).join('')}<dt>Fonte</dt><dd>${sourceLabel(l.source)}</dd></dl></div>` : ''}
      <div class="dr-foot"><button class="b b-danger" data-d="delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>Excluir lead</button></div>
    </div>`;
  drawer.querySelector('.dr-body').scrollTop = scroll;
  if (drawer._acts) paintActivity(drawer._acts);
}

async function loadMetaEvents() {
  const id = S.openId;
  const evs = await leadMetaEvents(id);
  if (id !== S.openId) return;
  const sec = $('#metaSec'); if (!sec) return;
  // um evento por linha (o mesmo evento vai pra cada pixel)
  const byId = new Map();
  evs.filter((e) => !e.test).forEach((e) => { const k = e.platform + e.event_id; if (!byId.has(k)) byId.set(k, { ...e, pixels: 0, ok: 0 }); const r = byId.get(k); r.pixels++; if (e.status_code >= 200 && e.status_code < 300) r.ok++; });
  const rows = [...byId.values()];
  sec.hidden = !rows.length;
  sec.querySelector('.meta-evs').innerHTML = rows.map((e) => {
    const v = e.payload?.data?.[0]?.custom_data?.value;
    const v2 = v ?? e.payload?.events?.[0]?.params?.value;
    return `<div class="meta-ev"><code>${esc(e.event_name)}</code><span class="muted">${e.platform === 'ga4' ? 'GA4 · ' : ''}${fullDate(e.created_at)}${v2 != null ? ' · ' + brl(v2) : ''}</span>${e.ok === e.pixels ? `<span class="pill good">${e.pixels} pixel${e.pixels > 1 ? 's' : ''}</span>` : statusPill(e.status_code, e.response)}</div>`;
  }).join('');
}

async function loadActivity() {
  loadMetaEvents();
  const id = S.openId;
  try {
    const acts = await DB.listActivity(id);
    if (id !== S.openId) return;
    drawer._acts = acts;
    paintActivity(acts);
  } catch (e) { fail(e); }
}
function paintActivity(acts) {
  const tl = $('#timeline'); if (!tl) return;
  tl.innerHTML = acts.length ? acts.map((a) => `<div class="tl ${a.type}"><span class="ic"></span><div><div class="tm">${esc(a.author_name || 'Sistema')} · ${fullDate(a.created_at)}</div><div class="tx">${esc(a.body)}</div></div></div>`).join('') : '<span class="muted">Sem atividade ainda.</span>';
}

drawer.addEventListener('input', (e) => {
  if (e.target.matches('[data-note]')) {
    drawer.querySelector('.counter').textContent = `${e.target.value.length}/1000`;
    drawer.querySelector('[data-d="note"]').disabled = !e.target.value.trim();
  }
  if (e.target.matches('[data-lblq]')) labelPicker(e.target);
});
drawer.addEventListener('focusin', (e) => { if (e.target.matches('[data-lblq]')) labelPicker(e.target); });
drawer.addEventListener('change', async (e) => {
  const f = e.target.dataset.field;
  if (e.target.name === 'rem') {
    const on = e.target.value === 'on';
    drawer.querySelector('[data-rem]').hidden = !on;
    if (!on && S.leads.find((l) => l.id === S.openId).reminder_at) patch([S.openId], { reminder_at: null, reminder_note: null });
    return;
  }
  if (!f) return;
  let v = e.target.value.trim();
  if (f === 'valor') { v = v ? Number(v.replace(/\./g, '').replace(',', '.')) : null; if (v !== null && Number.isNaN(v)) return toast('Valor inválido', true); }
  else v = v || null;
  patch([S.openId], { [f]: v }, f === 'valor' ? 'Valor salvo' : null);
});
drawer.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-d]'); if (!b) return;
  const id = S.openId;
  const l = S.leads.find((x) => x.id === id);
  const act = b.dataset.d;
  if (act === 'close') closeDrawer();
  if (act === 'answers') $('#answersSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (act === 'file') {
    try { const url = await DB.fileUrl(b.dataset.path); if (url) window.open(url, '_blank', 'noopener'); else toast('No modo demo os arquivos não são guardados'); } catch (err) { fail(err); }
  }
  if (act === 'delete') deleteLead(id);
  if (act === 'edit') editContact(l);
  if (act === 'unlabel') {
    const x = labelOf(b.dataset.id);
    await patch([id], { label_ids: (l.label_ids || []).filter((y) => y !== b.dataset.id) });
    DB.addActivity(id, 'label', 'Rótulo removido: ' + (x?.name || ''), S.me).then(loadActivity).catch(() => {});
  }
  if (act === 'note') {
    const t = drawer.querySelector('[data-note]');
    const body = t.value.trim(); if (!body) return;
    b.disabled = true;
    try {
      await DB.addActivity(id, 'note', body, S.me);
      l.last_activity_at = new Date().toISOString();
      t.value = ''; drawer.querySelector('.counter').textContent = '0/1000';
      toast('Nota salva'); loadActivity(); route();
    } catch (err) { fail(err); b.disabled = false; }
  }
  if (act === 'rem-save') {
    const at = drawer.querySelector('[data-rem-at]').value;
    if (!at) return toast('Escolha data e hora do lembrete', true);
    patch([id], { reminder_at: new Date(at).toISOString(), reminder_note: drawer.querySelector('[data-rem-note]').value.trim() || null }, 'Lembrete programado');
  }
});

function labelPicker(input) {
  const l = S.leads.find((x) => x.id === S.openId);
  const q = input.value.trim();
  const has = new Set(l.label_ids || []);
  const matches = S.labels.filter((x) => !has.has(x.id) && x.name.toLowerCase().includes(q.toLowerCase()));
  const exact = S.labels.some((x) => x.name.toLowerCase() === q.toLowerCase());
  const html = matches.map((x) => `<button class="pi" data-lid="${x.id}"><span class="swatch" style="background:${x.color}"></span>${esc(x.name)}</button>`).join('')
    + (q && !exact ? `<button class="pi" data-new>+ Criar rótulo "${esc(q)}"</button>` : '')
    || '<div class="ph">Digite pra criar um rótulo</div>';
  const add = async (x) => {
    closePop(); input.value = '';
    await patch([l.id], { label_ids: [...(l.label_ids || []), x.id] });
    DB.addActivity(l.id, 'label', 'Rótulo adicionado: ' + x.name, S.me).then(loadActivity).catch(() => {});
  };
  popover(input, html, (p) => {
    p.style.width = input.offsetWidth + 'px';
    p.addEventListener('mousedown', (e) => e.preventDefault());
    p.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lid]');
      if (b) return add(labelOf(b.dataset.lid));
      if (e.target.closest('[data-new]')) {
        try { const x = await DB.saveLabel({ name: q.slice(0, 30), color: COLORS[S.labels.length % COLORS.length] }); S.labels.push(x); add(x); } catch (err) { fail(err); }
      }
    });
  });
  input.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const b = $('.pop [data-lid], .pop [data-new]'); b?.click();
  };
}

function editContact(l) {
  modal(`<h3>Editar informações de contato</h3>
    <div class="row"><label class="lbl">Nome</label><input class="inp" data-f="nome" value="${esc(l.nome)}"></div>
    <div class="grid2"><div class="row"><label class="lbl">WhatsApp</label><input class="inp" data-f="whatsapp" value="${esc(fmtPhone(l.whatsapp))}"></div>
    <div class="row"><label class="lbl">Instagram</label><input class="inp" data-f="instagram" value="${esc(l.instagram || '')}"></div></div>
    <div class="row"><label class="lbl">E-mail</label><input class="inp" data-f="email" type="email" value="${esc(l.email || '')}"></div>
    <div class="row"><label class="lbl">Faturamento</label><select class="inp" data-f="faturamento"><option value="">—</option>${FAT.map((f) => `<option ${f === l.faturamento ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar</button></div>`, (c, close) => {
    c.querySelector('[data-ok]').addEventListener('click', async () => {
      const v = Object.fromEntries($$('[data-f]', c).map((i) => [i.dataset.f, i.value.trim()]));
      const d = v.whatsapp.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
      if (v.nome.length < 2) return toast('Informe o nome', true);
      if (d && (d.length < 10 || d.length > 11)) return toast('WhatsApp precisa de DDD + número', true);
      close();
      await patch([l.id], { nome: v.nome, whatsapp: d ? '55' + d : null, email: v.email || null, instagram: v.instagram.replace(/[@\s]/g, '').toLowerCase() || null, faturamento: v.faturamento || null }, 'Contato atualizado');
      DB.addActivity(l.id, 'edit', 'Informações de contato editadas', S.me).then(loadActivity).catch(() => {});
    });
  });
}

// demo
$('#seedBtn').addEventListener('click', async () => {
  $('#seedBtn').disabled = true;
  await DB.seed(Object.values(S.forms));
  await loadAll(false); route(); toast('Leads de exemplo criados');
  $('#seedBtn').disabled = false;
});

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (routeName() === 'dashboard') route(); }, 250); });

setInterval(() => { if (hashRoute() === 'leads' && !S.openId && !$('.pop') && !$('.modal') && document.activeElement?.tagName !== 'INPUT') route(); }, 60000);
boot().catch((e) => { console.error(e); window.__crmFail?.(); });
