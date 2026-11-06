// Atendimento: WhatsApp dentro do CRM (via ponte no Railway + Evolution API).
// Conversas, mensagens ao vivo, áudio, anexos, respostas rápidas da cadência e o lead ao lado
// (etiquetas, estágio, follow-up, tarefa). O navegador nunca vê a chave da Evolution.
import { DB, LIVE } from '@shared/db.js';
import { go, S, esc, ICON, initials, fmtPhone, toast, fail, modal, confirmBox, menu, multiSelect, renderTicket, stageOf, labelOf, profileOf } from './util.js?v=2611060733';
import { loadSteps, stepsOf, fillMsg } from './followup.js?v=2611060733';
import { serviceName } from './contract.js?v=2611060733';

const GW = (window.TRACTO_CONFIG?.waGateway || '').replace(/\/$/, '');
const A = { state: 'loading', number: null, chats: [], jid: null, msgs: [], page: 1, pages: 1, q: '', filter: 'todas', panel: true, es: null, qr: null, media: new Map() };
const svg = (d, w = 18) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  clip: svg('<path d="m21.4 11.6-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>'),
  mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>'),
  send: svg('<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', 16),
  bolt: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'),
  phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>', 16),
  side: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>', 16),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 16),
  doc: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>', 22),
  play: svg('<path d="m6 4 14 8-14 8z"/>', 22),
  tick: '<svg width="15" height="11" viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m1 6 3 3 6-7"/></svg>',
  ticks: '<svg width="16" height="11" viewBox="0 0 18 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m1 6 3 3 6-7M8 8.5l.5.5 6-7"/></svg>',
  wa: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', 40)
};

// ---------- ponte ----------
async function token() { const s = await DB.session(); return s?.access_token || ''; }
async function api(path, body) {
  if (!LIVE) return demoApi(path, body);
  const r = await fetch(GW + path, { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
  return data;
}
async function apiGet(path) {
  if (!LIVE) return demoApi(path);
  const r = await fetch(GW + path, { headers: { Authorization: `Bearer ${await token()}` } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
  return data;
}

// ---------- utilidades ----------
const digits = (s) => String(s || '').replace(/\D/g, '');
const key8 = (d) => { d = digits(d); return d.length >= 10 ? (d.startsWith('55') ? d.slice(2, 4) : '') + d.slice(-8) : d; };
let leadIdx = null;
const leadByPhone = (phone) => {
  if (!leadIdx) { leadIdx = new Map(); [...S.leads].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach((l) => { if (l.whatsapp) leadIdx.set(key8(l.whatsapp), l); }); }
  return leadIdx.get(key8(phone)) || null;
};
const resetIdx = () => { leadIdx = null; };
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const chatName = (c) => leadByPhone(c.phone)?.nome || c.name || fmtPhone(c.phone);
const tsOf = (m) => Number(m.messageTimestamp || 0) * 1000;
const hhmm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function listTime(t) {
  if (!t) return '';
  const d = new Date(t); const now = new Date();
  if (d.toDateString() === now.toDateString()) return hhmm(t);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  if (now - d < 6 * 86400000) return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function dayLabel(t) {
  const d = new Date(t); const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Hoje';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
// tipo e conteúdo de cada mensagem da Evolution
function parse(m) {
  const x = m.message || {};
  const inner = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.documentWithCaptionMessage?.message || x;
  if (inner.conversation || inner.extendedTextMessage) return { type: 'text', text: inner.conversation || inner.extendedTextMessage.text };
  if (inner.imageMessage) return { type: 'image', text: inner.imageMessage.caption || '' };
  if (inner.stickerMessage) return { type: 'sticker' };
  if (inner.videoMessage) return { type: 'video', text: inner.videoMessage.caption || '' };
  if (inner.audioMessage) return { type: 'audio', secs: inner.audioMessage.seconds || 0 };
  if (inner.documentMessage) return { type: 'doc', name: inner.documentMessage.fileName || 'documento', text: inner.documentMessage.caption || '', size: inner.documentMessage.fileLength };
  if (inner.contactMessage) return { type: 'text', text: `Contato: ${inner.contactMessage.displayName || ''}` };
  if (inner.locationMessage) return { type: 'text', text: `Localização: https://maps.google.com/?q=${inner.locationMessage.degreesLatitude},${inner.locationMessage.degreesLongitude}` };
  if (inner.reactionMessage || inner.protocolMessage || inner.senderKeyDistributionMessage) return null;
  return { type: 'text', text: '[mensagem não suportada]' };
}
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/\n/g, '<br>');
const statusIcon = (m) => { const s = String(m.status || m.MessageUpdate?.[m.MessageUpdate.length - 1]?.status || '').toUpperCase(); return s === 'READ' || s === 'PLAYED' ? `<span class="wa-tk read">${IC.ticks}</span>` : s === 'DELIVERY_ACK' ? `<span class="wa-tk">${IC.ticks}</span>` : `<span class="wa-tk">${IC.tick}</span>`; };

// ---------- tela ----------
export async function renderAtendimento(el) {
  const stale = renderTicket(el);
  if (LIVE && !GW) { el.innerHTML = '<div class="panel empty"><h3>WhatsApp não configurado</h3><p>Falta o endereço da ponte do WhatsApp na configuração do CRM.</p></div>'; return; }
  resetIdx();
  el.innerHTML = '<div class="loading">Conectando ao WhatsApp…</div>';
  loadSteps();
  try { const s = await apiGet('/api/status'); A.state = s.state; A.number = s.number; A.name = s.name; } catch (e) { A.state = 'error'; A.err = e.message; }
  if (stale()) return;
  listen(el);
  if (A.state === 'open') { await loadChats(); if (stale()) return; }
  paint(el);
}

async function loadChats() {
  try { A.chats = await api('/api/chats'); } catch (e) { fail(e); A.chats = []; }
  badge();
}
function badge() {
  const b = document.getElementById('waBadge'); if (!b) return;
  const n = A.chats.filter((c) => c.unread > 0).length;
  b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
}

function paint(el) {
  if (A.state === 'error') { el.innerHTML = `<div class="panel empty"><h3>Não consegui falar com o WhatsApp</h3><p>${esc(A.err || '')}</p><button class="b b-primary" data-retry>Tentar de novo</button></div>`; el.querySelector('[data-retry]').addEventListener('click', () => renderAtendimento(el)); return; }
  if (A.state !== 'open') return paintConnect(el);
  el.innerHTML = `<div class="wa ${A.jid ? 'has-chat' : ''} ${A.panel ? 'with-panel' : ''}">
    <aside class="wa-list">
      <div class="wa-lh"><div class="wa-me"><b>Atendimento</b><small>${A.number ? esc(fmtPhone(A.number)) : 'WhatsApp conectado'}</small></div>
        <button class="b b-sm b-ghost fu-ic" data-new title="Nova conversa" aria-label="Nova conversa">${IC.plus}</button>
        <button class="b b-sm b-ghost fu-ic" data-conn aria-label="Conexão">${ICON.dots}</button></div>
      <label class="search wa-search">${ICON.search}<input class="inp" data-q type="search" placeholder="Buscar conversa ou número" value="${esc(A.q)}"></label>
      <div class="wa-filters">${[['todas', 'Todas'], ['naolidas', 'Não lidas'], ['leads', 'Leads'], ['marketing', 'Marketing'], ['marketplace', 'Marketplace'], ['semlead', 'Sem lead']].map(([k, n]) => `<button class="tk-chip ${A.filter === k ? 'on' : ''}" data-f="${k}">${n}</button>`).join('')}</div>
      <div class="wa-chats" data-chats></div>
    </aside>
    <section class="wa-conv" data-conv></section>
    <aside class="wa-panel" data-panel></aside>
  </div>`;
  fit(el);
  drawChats(el);
  drawConv(el);
  const qi = el.querySelector('[data-q]');
  qi.addEventListener('input', () => { A.q = qi.value; drawChats(el); });
  el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { A.filter = b.dataset.f; el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); drawChats(el); }));
  el.querySelector('[data-new]').addEventListener('click', () => newChat(el));
  el.querySelector('[data-conn]').addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'Atualizar conversas', action: async () => { await loadChats(); drawChats(el); } },
    ...(['admin', 'gestor'].includes(S.me?.role) ? [{ sep: true }, { label: 'Desconectar o WhatsApp', danger: true, action: async () => {
      if (!(await confirmBox('Desconectar o WhatsApp do CRM? Para voltar, será preciso ler o QR Code de novo.', 'Desconectar'))) return;
      try { await api('/api/logout'); A.state = 'close'; A.jid = null; paint(el); } catch (e) { fail(e); }
    } }] : [])
  ]));
}

function filtered() {
  const q = A.q.trim().toLowerCase(); const qd = digits(q);
  return A.chats.filter((c) => {
    const l = leadByPhone(c.phone);
    if (A.filter === 'naolidas' && !c.unread) return false;
    if (A.filter === 'leads' && !l) return false;
    if (A.filter === 'semlead' && l) return false;
    if ((A.filter === 'marketing' || A.filter === 'marketplace') && (!l || (l.service === 'marketplace' ? 'marketplace' : 'marketing') !== A.filter)) return false;
    if (!q) return true;
    return chatName(c).toLowerCase().includes(q) || (qd.length >= 3 && c.phone.includes(qd));
  });
}
function drawChats(el) {
  const host = el.querySelector('[data-chats]'); if (!host) return;
  const list = filtered();
  host.innerHTML = list.length ? list.map((c) => {
    const l = leadByPhone(c.phone); const st = l ? stageOf(l) : null;
    return `<button class="wa-chat ${A.jid === c.jid ? 'on' : ''}" data-jid="${esc(c.jid)}">
      ${c.picture ? `<img class="wa-av" src="${esc(c.picture)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="wa-av">${esc(initials(chatName(c)))}</span>`}
      <span class="wa-ci"><span class="wa-cr"><b>${esc(chatName(c))}</b><small class="${c.unread ? 'hot' : ''}">${esc(listTime(c.at))}</small></span>
        <span class="wa-cr"><span class="wa-last">${c.last?.fromMe ? `<span class="wa-tk">${IC.tick}</span>` : ''}${esc(c.last?.text || '')}</span>${c.unread ? `<span class="wa-unread">${c.unread}</span>` : ''}</span>
        ${l ? `<span class="wa-ctags"><span class="pill svc svc-${l.service === 'marketplace' ? 'marketplace' : 'marketing'}">${esc(serviceName(l.service === 'marketplace' ? 'marketplace' : 'marketing'))}</span>${st ? `<span class="pill"><i class="tk-dot" style="background:${esc(st.color || 'var(--gray-3)')}"></i>${esc(st.name)}</span>` : ''}</span>` : ''}
      </span></button>`;
  }).join('') : `<div class="wa-none">${A.chats.length ? 'Nenhuma conversa nesse filtro.' : 'Nenhuma conversa ainda. As mensagens novas aparecem aqui na hora.'}</div>`;
  host.querySelectorAll('[data-jid]').forEach((b) => b.addEventListener('click', () => openChat(el, b.dataset.jid)));
}

async function openChat(el, jid) {
  A.jid = jid; A.msgs = []; A.page = 1; A.pages = 1;
  el.querySelector('.wa')?.classList.add('has-chat');
  el.querySelectorAll('.wa-chat').forEach((b) => b.classList.toggle('on', b.dataset.jid === jid));
  drawConv(el, true);
  try {
    const r = await api('/api/messages', { jid, page: 1 });
    if (A.jid !== jid) return;
    A.msgs = (r.records || []).slice().reverse(); A.pages = r.pages || 1;
  } catch (e) { fail(e); }
  drawConv(el);
  // marca como lidas
  const c = A.chats.find((x) => x.jid === jid);
  if (c?.unread) {
    const ids = A.msgs.filter((m) => !m.key?.fromMe).slice(-c.unread).map((m) => m.key.id);
    c.unread = 0; drawChats(el); badge();
    api('/api/read', { jid, ids }).catch(() => {});
  }
}

function drawConv(el, loading = false) {
  const host = el.querySelector('[data-conv]'); const panel = el.querySelector('[data-panel]');
  if (!host) return;
  if (!A.jid) { host.innerHTML = `<div class="wa-empty">${IC.wa}<h3>WhatsApp da Tracto</h3><p>Escolha uma conversa ao lado ou comece uma nova. Tudo que você envia aqui sai pelo número conectado.</p></div>`; if (panel) panel.innerHTML = ''; return; }
  const c = A.chats.find((x) => x.jid === A.jid) || { jid: A.jid, phone: digits(A.jid.split('@')[0]) };
  const l = leadByPhone(c.phone);
  host.innerHTML = `<header class="wa-ch">
      <button class="b b-sm b-ghost fu-ic wa-back" data-back aria-label="Voltar">${IC.back}</button>
      ${c.picture ? `<img class="wa-av" src="${esc(c.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="wa-av">${esc(initials(chatName(c)))}</span>`}
      <div class="wa-chn"><b>${esc(chatName(c))}</b><small>${esc(fmtPhone(c.phone))}${l && c.name && c.name !== l.nome ? ` · ${esc(c.name)}` : ''}</small></div>
      <a class="b b-sm b-ghost fu-ic" href="tel:+${esc(c.phone)}" title="Ligar pelo celular" aria-label="Ligar">${IC.phone}</a>
      <button class="b b-sm b-ghost fu-ic ${A.panel ? 'on' : ''}" data-toggle-panel title="Painel do lead" aria-label="Painel do lead">${IC.side}</button>
    </header>
    <div class="wa-msgs" data-msgs>${loading ? '<div class="loading">Carregando mensagens…</div>' : msgsHtml()}</div>
    <footer class="wa-comp" data-comp>
      <button class="b b-ghost fu-ic" data-quick title="Respostas rápidas" aria-label="Respostas rápidas">${IC.bolt}</button>
      <button class="b b-ghost fu-ic" data-attach title="Enviar arquivo" aria-label="Anexar">${IC.clip}</button>
      <input type="file" data-file hidden multiple accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip">
      <textarea class="inp wa-input" data-text rows="1" placeholder="Digite uma mensagem"></textarea>
      <button class="b b-primary wa-sendbtn" data-send aria-label="Gravar áudio">${IC.mic}</button>
    </footer>`;
  const box = host.querySelector('[data-msgs]');
  box.scrollTop = box.scrollHeight;
  bindMsgs(el, box);
  host.querySelector('[data-back]').addEventListener('click', () => { A.jid = null; el.querySelector('.wa')?.classList.remove('has-chat'); drawConv(el); drawChats(el); });
  host.querySelector('[data-toggle-panel]').addEventListener('click', (e) => {
    if (window.innerWidth <= 1100) return modal('<div data-mpanel></div>', (m) => { m.closest('.modal-card').classList.add('wa-pmodal'); drawPanel(el, c, leadByPhone(c.phone), m.querySelector('[data-mpanel]')); });
    A.panel = !A.panel; el.querySelector('.wa').classList.toggle('with-panel', A.panel); e.currentTarget.classList.toggle('on', A.panel); });
  bindComposer(el, host, c, l);
  drawPanel(el, c, l);
}

function msgsHtml() {
  if (!A.msgs.length) return '<div class="wa-none">Nenhuma mensagem nesta conversa ainda.</div>';
  let day = ''; let out = A.page < A.pages ? '<div class="wa-more"><button class="b b-sm" data-older>Carregar mensagens anteriores</button></div>' : '';
  for (const m of A.msgs) {
    const p = parse(m); if (!p) continue;
    const t = tsOf(m); const dl = dayLabel(t);
    if (dl !== day) { day = dl; out += `<div class="wa-day"><span>${esc(dl)}</span></div>`; }
    out += bubble(m, p, t);
  }
  return out;
}
function bubble(m, p, t) {
  const me = !!m.key?.fromMe; const id = esc(m.key?.id || '');
  let body = '';
  if (p.type === 'text') body = `<div class="wa-tx">${linkify(p.text)}</div>`;
  else if (p.type === 'image' || p.type === 'sticker') body = `<div class="wa-media ${p.type}" data-media="${id}" data-kind="image"><span class="wa-ph">Carregando imagem…</span></div>${p.text ? `<div class="wa-tx">${linkify(p.text)}</div>` : ''}`;
  else if (p.type === 'video') body = `<div class="wa-media video" data-media="${id}" data-kind="video" data-manual><button class="wa-play" data-load>${IC.play}<span>Carregar vídeo</span></button></div>${p.text ? `<div class="wa-tx">${linkify(p.text)}</div>` : ''}`;
  else if (p.type === 'audio') body = `<div class="wa-media audio" data-media="${id}" data-kind="audio"><span class="wa-ph">Carregando áudio${p.secs ? ` (${Math.floor(p.secs / 60)}:${String(p.secs % 60).padStart(2, '0')})` : ''}…</span></div>`;
  else if (p.type === 'doc') body = `<button class="wa-doc" data-doc="${id}" data-name="${esc(p.name)}">${IC.doc}<span><b>${esc(p.name)}</b><small>${p.size ? `${Math.max(1, Math.round(Number(p.size) / 1024))} KB · ` : ''}baixar</small></span></button>${p.text ? `<div class="wa-tx">${linkify(p.text)}</div>` : ''}`;
  return `<div class="wa-b ${me ? 'me' : ''}" data-id="${id}">${body}<span class="wa-meta">${hhmm(t)}${me ? statusIcon(m) : ''}</span></div>`;
}

function bindMsgs(el, box) {
  box.querySelector('[data-older]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true; const jid = A.jid; const h = box.scrollHeight;
    try { const r = await api('/api/messages', { jid, page: A.page + 1 }); if (A.jid !== jid) return; A.page += 1; A.pages = r.pages || A.pages; A.msgs = (r.records || []).slice().reverse().concat(A.msgs); } catch (err) { fail(err); }
    box.innerHTML = msgsHtml(); box.scrollTop = box.scrollHeight - h; bindMsgs(el, box);
  });
  // mídia carrega quando aparece na tela
  const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); if (!en.target.hasAttribute('data-manual')) loadMedia(en.target); } }), { root: box, rootMargin: '200px' });
  box.querySelectorAll('[data-media]').forEach((n) => io.observe(n));
  box.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => loadMedia(b.closest('[data-media]'))));
  box.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', async () => {
    try { const d = await mediaOf(b.dataset.doc); const a = document.createElement('a'); a.href = d; a.download = b.dataset.name || 'arquivo'; a.click(); } catch (e) { fail(e); }
  }));
}
async function mediaOf(id, mp4 = false) {
  if (A.media.has(id)) return A.media.get(id);
  const r = await api('/api/media', { id, mp4 });
  const url = `data:${r.mimetype || 'application/octet-stream'};base64,${r.base64}`;
  A.media.set(id, url); return url;
}
async function loadMedia(n) {
  const id = n.dataset.media; const kind = n.dataset.kind;
  n.innerHTML = '<span class="wa-ph">Carregando…</span>';
  try {
    const url = await mediaOf(id, kind === 'video');
    if (kind === 'image') { n.innerHTML = `<img src="${url}" alt="">`; n.querySelector('img').addEventListener('click', () => modal(`<img class="wa-zoom" src="${url}" alt="">`)); }
    else if (kind === 'audio') n.innerHTML = `<audio controls preload="metadata" src="${url}"></audio>`;
    else n.innerHTML = `<video controls src="${url}"></video>`;
  } catch (e) { n.innerHTML = '<span class="wa-ph">Não consegui carregar</span>'; }
}

// ---------- envio ----------
function bindComposer(el, host, c, l) {
  const ta = host.querySelector('[data-text]'); const btn = host.querySelector('[data-send]');
  const sync = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; const has = !!ta.value.trim(); btn.innerHTML = has ? IC.send : IC.mic; btn.setAttribute('aria-label', has ? 'Enviar' : 'Gravar áudio'); };
  ta.addEventListener('input', sync);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } });
  const sendText = async () => {
    const text = ta.value.trim(); if (!text) return;
    ta.value = ''; sync();
    const tmp = optimistic(el, { conversation: text });
    try { await api('/api/send/text', { number: c.phone, text }); settle(el, tmp); } catch (e) { fail(e); failMsg(el, tmp); ta.value = text; sync(); }
  };
  btn.addEventListener('click', () => (ta.value.trim() ? sendText() : record(el, host, c)));
  host.querySelector('[data-attach]').addEventListener('click', () => host.querySelector('[data-file]').click());
  host.querySelector('[data-file]').addEventListener('change', (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) attach(el, c, files); });
  host.querySelector('[data-quick]').addEventListener('click', (e) => {
    const seg = l ? (l.service === 'marketplace' ? 'marketplace' : 'marketing') : 'marketing';
    const steps = stepsOf(seg);
    const me = firstName(S.me?.nome);
    const items = [
      { header: `Cadência ${serviceName(seg)}` },
      ...steps.map((s, i) => ({ label: `Toque ${i + 1}: ${fillMsg(s.body, { nome: l?.nome || c.name || '' }).slice(0, 60)}…`, action: () => { ta.value = fillMsg(s.body, { nome: l?.nome || c.name || '' }); sync(); ta.focus(); } })),
      { sep: true }, { header: 'Atalhos' },
      { label: 'Saudação', action: () => { ta.value = `Oi ${firstName(l?.nome || c.name)}, tudo bem? Aqui é ${me || 'o time'} da Tracto.`; sync(); ta.focus(); } },
      { label: 'Pedir horário pra ligação', action: () => { ta.value = 'Qual o melhor horário pra eu te ligar hoje? Leva uns 15 minutos.'; sync(); ta.focus(); } }
    ];
    menu(e.currentTarget, items);
  });
  sync();
}
let tmpId = 0;
function optimistic(el, message, extra = {}) {
  const id = 'tmp-' + (++tmpId);
  const m = { key: { id, fromMe: true, remoteJid: A.jid }, message, messageTimestamp: Math.floor(Date.now() / 1000), status: 'PENDING', ...extra };
  A.msgs.push(m);
  const box = el.querySelector('[data-msgs]');
  if (box) { box.querySelector('.wa-none')?.remove(); const p = parse(m); box.insertAdjacentHTML('beforeend', bubble(m, p, tsOf(m)).replace('class="wa-b me"', 'class="wa-b me sending"')); box.scrollTop = box.scrollHeight; }
  const c = A.chats.find((x) => x.jid === A.jid);
  if (c) { c.last = { text: parse(m)?.text || '[mídia]', fromMe: true }; c.at = Date.now(); A.chats.sort((a, b) => b.at - a.at); drawChats(el); }
  return id;
}
const settle = (el, id) => el.querySelector(`.wa-b[data-id="${id}"]`)?.classList.remove('sending');
const failMsg = (el, id) => { el.querySelector(`.wa-b[data-id="${id}"]`)?.remove(); A.msgs = A.msgs.filter((m) => m.key.id !== id); };

const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
function attach(el, c, files) {
  const big = files.find((f) => f.size > 25 * 1024 * 1024);
  if (big) return toast(`${big.name} passa de 25 MB`, true);
  const one = files.length === 1 ? files[0] : null;
  const isImg = (f) => f.type.startsWith('image/');
  modal(`<h3>Enviar ${files.length > 1 ? `${files.length} arquivos` : 'arquivo'}</h3>
    <div class="wa-prev">${files.map((f) => isImg(f) ? `<img src="${URL.createObjectURL(f)}" alt="">` : `<div class="wa-doc">${IC.doc}<span><b>${esc(f.name)}</b><small>${Math.max(1, Math.round(f.size / 1024))} KB</small></span></div>`).join('')}</div>
    ${one && !one.type.startsWith('audio/') ? '<div class="row"><input class="inp" data-cap placeholder="Legenda (opcional)"></div>' : ''}
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-go>${IC.send}Enviar</button></div>`, (m, close) => {
    m.querySelector('[data-go]').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true; const cap = m.querySelector('[data-cap]')?.value.trim() || '';
      close();
      for (const f of files) {
        const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'document';
        const msg = kind === 'image' ? { imageMessage: { caption: cap } } : kind === 'video' ? { videoMessage: { caption: cap } } : kind === 'audio' ? { audioMessage: {} } : { documentMessage: { fileName: f.name, caption: cap, fileLength: f.size } };
        const tmp = optimistic(el, msg);
        try {
          const b64 = await toB64(f);
          if (kind === 'audio') await api('/api/send/audio', { number: c.phone, audio: b64 });
          else await api('/api/send/media', { number: c.phone, mediatype: kind, mimetype: f.type || 'application/octet-stream', media: b64, fileName: f.name, caption: cap });
          settle(el, tmp);
        } catch (err) { fail(err); failMsg(el, tmp); }
      }
    });
  });
}

// gravação de áudio (vai como mensagem de voz)
async function record(el, host, c) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Este navegador não grava áudio', true);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return toast('Libere o microfone no navegador pra gravar', true); }
  const type = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined); const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const comp = host.querySelector('[data-comp]'); const saved = comp.innerHTML;
  const t0 = Date.now(); let cancel = false;
  comp.innerHTML = `<button class="b b-ghost fu-ic" data-cancel aria-label="Descartar áudio">${IC.trash}</button><div class="wa-rec"><i></i><span data-t>0:00</span><small>Gravando…</small></div><button class="b b-primary wa-sendbtn" data-stop aria-label="Enviar áudio">${IC.send}</button>`;
  const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); comp.querySelector('[data-t]').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
  const restore = () => { clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); comp.innerHTML = saved; bindComposer(el, host, c, leadByPhone(c.phone)); };
  rec.onstop = async () => {
    restore(); if (cancel || Date.now() - t0 < 700) return;
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/ogg' });
    const tmp = optimistic(el, { audioMessage: { seconds: Math.round((Date.now() - t0) / 1000) } });
    try { await api('/api/send/audio', { number: c.phone, audio: await toB64(blob) }); settle(el, tmp); } catch (e) { fail(e); failMsg(el, tmp); }
  };
  comp.querySelector('[data-cancel]').addEventListener('click', () => { cancel = true; rec.stop(); });
  comp.querySelector('[data-stop]').addEventListener('click', () => rec.stop());
  rec.start(250);
}

// ---------- painel do lead ----------
function drawPanel(el, c, l, target) {
  const host = target || el.querySelector('[data-panel]'); if (!host) return;
  const redraw = (lead) => drawPanel(el, c, lead, target);
  if (!l) {
    host.innerHTML = `<div class="wa-pn"><h4>Contato fora do CRM</h4><p class="muted">${esc(c.name || fmtPhone(c.phone))} ainda não é um lead.</p><button class="b b-primary" data-mklead>${IC.plus}Criar lead</button></div>`;
    host.querySelector('[data-mklead]').addEventListener('click', () => createLead(el, c, target));
    return;
  }
  const st = stageOf(l); const owner = l.assigned_to ? profileOf(l.assigned_to) : null;
  const seg = l.service === 'marketplace' ? 'marketplace' : 'marketing';
  const fu = l.fu_status === 'negociacao' ? 'Em negociação' : l.fu_status === 'respondeu' ? 'Respondeu' : l.fu_status === 'encerrado' ? 'Encerrado' : (l.fu_step || 0) > 0 ? `Sem resposta · toque ${l.fu_step}` : 'Novo';
  host.innerHTML = `<div class="wa-pn">
    <div class="wa-pn-h"><span class="av">${esc(initials(l.nome))}</span><div><b>${esc(l.nome)}</b><small>${esc(l.email || fmtPhone(l.whatsapp))}</small></div></div>
    <div class="wa-pn-tags"><span class="pill svc svc-${seg}">${esc(serviceName(seg))}</span>${st ? `<span class="pill"><i class="tk-dot" style="background:${esc(st.color || 'var(--gray-3)')}"></i>${esc(st.name)}</span>` : ''}</div>
    <div class="wa-pn-row"><span class="lbl">Responsável</span><span>${esc(owner?.nome || 'Ninguém')}</span></div>
    <div class="wa-pn-row"><span class="lbl">Follow-up</span><span>${esc(fu)}</span></div>
    <div class="wa-pn-sec"><span class="lbl">Etiquetas</span><div class="wa-labels">${(l.label_ids || []).map(labelOf).filter(Boolean).map((x) => `<span class="pill" style="background:${esc(x.color)}22;color:${esc(x.color)}">${esc(x.name)}</span>`).join('')}<button class="tk-chip" data-labels>${IC.plus}Etiquetar</button></div></div>
    <div class="wa-pn-sec"><span class="lbl">Ações</span>
      <div class="wa-pn-act">
        ${l.fu_status !== 'respondeu' ? '<button class="b b-sm" data-fu="respondeu">Respondeu</button>' : ''}
        ${l.fu_status !== 'negociacao' ? '<button class="b b-sm" data-fu="negociacao">Em negociação</button>' : ''}
        <button class="b b-sm" data-task>Criar tarefa</button>
        <button class="b b-sm" data-note>Anotar</button>
        <button class="b b-sm b-primary" data-open-lead>Abrir no pipeline</button>
      </div></div>
  </div>`;
  host.querySelector('[data-labels]').addEventListener('click', (e) => multiSelect(e.currentTarget, {
    title: 'Etiquetas', options: S.labels.map((x) => ({ value: x.id, label: x.name, swatch: x.color })), selected: l.label_ids || [],
    onChange: async (ids) => { try { await DB.updateLeads([l.id], { label_ids: ids }); l.label_ids = ids; toast('Etiquetas salvas'); redraw(l); drawChats(el); } catch (err) { fail(err); } }
  }));
  host.querySelectorAll('[data-fu]').forEach((b) => b.addEventListener('click', async () => {
    const status = b.dataset.fu; const now = new Date().toISOString();
    const next = new Date(Date.now() + (status === 'respondeu' ? 1 : 2) * 86400000); next.setHours(9, 0, 0, 0);
    try { const patch = { fu_status: status, fu_last_at: now, fu_next_at: next.toISOString() }; await DB.updateLeads([l.id], patch); Object.assign(l, patch); DB.addActivity(l.id, 'followup', `Follow-up: ${status === 'respondeu' ? 'lead respondeu' : 'em negociação'}`, S.me).catch(() => {}); toast(status === 'respondeu' ? 'Marcado como respondeu' : 'Em negociação'); redraw(l); window.dispatchEvent(new Event('tracto:fu-changed')); } catch (err) { fail(err); }
  }));
  host.querySelector('[data-task]').addEventListener('click', async () => { const { taskModal } = await import('./tasks.js?v=2611060733'); taskModal({ title: `Retornar ${l.nome}`, lead_id: l.id, due_date: new Date().toISOString().slice(0, 10), assignee_id: S.me?.id || null }); });
  host.querySelector('[data-note]').addEventListener('click', () => modal(`<h3>Anotação sobre ${esc(firstName(l.nome))}</h3><div class="row"><textarea class="inp" rows="4" data-n placeholder="O que foi conversado, objeções, próximos passos"></textarea></div><div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar no histórico</button></div>`, (m, close) => {
    m.querySelector('[data-ok]').addEventListener('click', async () => { const v = m.querySelector('[data-n]').value.trim(); if (!v) return; try { await DB.addActivity(l.id, 'note', v.slice(0, 1000), S.me); toast('Anotação salva no lead'); close(); } catch (err) { fail(err); } });
  }));
  host.querySelector('[data-open-lead]').addEventListener('click', () => { go('leads'); setTimeout(() => window.dispatchEvent(new CustomEvent('tracto:open-lead', { detail: l.id })), 120); });
}

function createLead(el, c, target) {
  let seg = 'marketing';
  modal(`<h3>Criar lead</h3>
    <div class="row"><label class="lbl" for="waNome">Nome</label><input class="inp" id="waNome" data-nome value="${esc(c.name || '')}" placeholder="Nome do contato"></div>
    <div class="row"><span class="lbl">Serviço</span><div class="seg">${[['marketing', 'Marketing'], ['marketplace', 'Marketplace']].map(([k, n]) => `<button type="button" class="b ${k === seg ? 'on' : ''}" data-s="${k}">${n}</button>`).join('')}</div></div>
    <p class="help">WhatsApp: ${esc(fmtPhone(c.phone))}. Entra no primeiro estágio do pipeline, atribuído a você.</p>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Criar lead</button></div>`, (m, close) => {
    m.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { seg = b.dataset.s; m.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); }));
    m.querySelector('[data-ok]').addEventListener('click', async (e) => {
      const nome = m.querySelector('[data-nome]').value.trim(); if (nome.length < 2) return toast('Informe o nome', true);
      e.currentTarget.disabled = true;
      const first = [...S.stages].filter((x) => x.kind === 'open').sort((a, b) => a.position - b.position)[0];
      try {
        const lead = await DB.createLead({ nome, whatsapp: c.phone.startsWith('55') ? c.phone : '55' + c.phone, stage_id: first?.id, assigned_to: S.me?.id?.startsWith('demo') ? null : S.me?.id || null, form_id: 'manual', form_name: 'WhatsApp (Atendimento)', source: 'manual', service: seg, answers: [], fu_status: 'respondeu', fu_last_at: new Date().toISOString() });
        S.leads.unshift(lead); resetIdx(); toast('Lead criado'); close(); drawChats(el); drawPanel(el, c, lead, target);
        window.dispatchEvent(new CustomEvent('tracto:reload-leads'));
      } catch (err) { e.currentTarget.disabled = false; fail(err); }
    });
  });
}

function newChat(el) {
  modal(`<h3>Nova conversa</h3>
    <div class="row"><label class="lbl" for="waNum">WhatsApp ou nome do lead</label><input class="inp" id="waNum" data-num placeholder="(62) 99999-9999 ou nome" autocomplete="off"></div>
    <div class="wa-pick" data-pick></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Abrir conversa</button></div>`, (m, close) => {
    const inp = m.querySelector('[data-num]'); const pick = m.querySelector('[data-pick]');
    const open = (phone) => {
      let d = digits(phone); if (d.length === 10 || d.length === 11) d = '55' + d;
      if (d.length < 12) return toast('Informe DDD + número', true);
      const jid = `${d}@s.whatsapp.net`;
      if (!A.chats.some((x) => x.jid === jid)) A.chats.unshift({ jid, phone: d, name: leadByPhone(d)?.nome || null, unread: 0, at: Date.now(), last: null });
      close(); drawChats(el); openChat(el, jid);
    };
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      const hits = q.length < 2 || digits(q).length > 4 ? [] : S.leads.filter((l) => l.whatsapp && l.nome.toLowerCase().includes(q)).slice(0, 6);
      pick.innerHTML = hits.map((l) => `<button class="pi" data-ph="${esc(l.whatsapp)}"><span class="av">${esc(initials(l.nome))}</span><span><b>${esc(l.nome)}</b><small class="muted"> ${esc(fmtPhone(l.whatsapp))}</small></span></button>`).join('');
      pick.querySelectorAll('[data-ph]').forEach((b) => b.addEventListener('click', () => open(b.dataset.ph)));
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(inp.value); });
    m.querySelector('[data-ok]').addEventListener('click', () => open(inp.value));
  });
}

// ---------- conexão (QR Code) ----------
function paintConnect(el) {
  const manager = ['admin', 'gestor'].includes(S.me?.role);
  el.innerHTML = `<div class="wa-connect panel">
    <div class="wa-cx-text">
      <h1>Conectar o WhatsApp</h1>
      <p class="muted">Use o WhatsApp da Tracto direto no CRM, junto com os leads. As mensagens continuam aparecendo no celular normalmente.</p>
      <ol class="wa-steps"><li>Abra o WhatsApp no celular</li><li>Toque em <b>Mais opções</b> ou <b>Configurações</b> e entre em <b>Dispositivos conectados</b></li><li>Toque em <b>Conectar dispositivo</b></li><li>Aponte o celular para o QR Code ao lado</li></ol>
    </div>
    <div class="wa-qr" data-qr>${manager ? (A.qr ? `<img src="${A.qr}" alt="QR Code do WhatsApp">` : '<button class="b b-primary" data-gen>Gerar QR Code</button>') : '<p class="muted">Peça a um gestor para conectar o WhatsApp.</p>'}</div>
  </div>`;
  el.querySelector('[data-gen]')?.addEventListener('click', () => genQr(el));
  if (manager && !A.qr) genQr(el);
}
async function genQr(el) {
  const host = el.querySelector('[data-qr]'); if (host) host.innerHTML = '<div class="loading">Gerando QR Code…</div>';
  try {
    const r = await api('/api/connect');
    if (r.state === 'open') { A.state = 'open'; await loadChats(); return paint(el); }
    A.qr = r.qr; if (host) host.innerHTML = A.qr ? `<img src="${A.qr}" alt="QR Code do WhatsApp"><small class="muted">O código renova sozinho</small>` : '<button class="b b-primary" data-gen>Gerar QR Code</button>';
    host?.querySelector('[data-gen]')?.addEventListener('click', () => genQr(el));
  } catch (e) { if (host) host.innerHTML = `<p class="muted">${esc(e.message)}</p><button class="b b-primary" data-gen>Tentar de novo</button>`; host?.querySelector('[data-gen]')?.addEventListener('click', () => genQr(el)); }
}

// ---------- ao vivo ----------
function listen(el) {
  if (!LIVE) return;
  A.es?.close();
  const start = async () => {
    if (!el.isConnected || !location.pathname.startsWith('/atendimento')) return;
    const es = new EventSource(`${GW}/api/events?token=${encodeURIComponent(await token())}`);
    A.es = es;
    es.addEventListener('message', (e) => onMessage(el, JSON.parse(e.data)));
    es.addEventListener('connection', async (e) => {
      const d = JSON.parse(e.data);
      if (d.state === 'open' && A.state !== 'open') { A.state = 'open'; A.qr = null; A.number = d.number || A.number; toast('WhatsApp conectado'); await loadChats(); paint(el); }
      else if (d.state === 'close' && A.state === 'open') { A.state = 'close'; paint(el); }
    });
    es.addEventListener('qr', (e) => { const d = JSON.parse(e.data); if (d.qr && A.state !== 'open') { A.qr = d.qr; const img = el.querySelector('[data-qr] img'); if (img) img.src = d.qr; } });
    es.addEventListener('status', (e) => { const d = JSON.parse(e.data); const list = Array.isArray(d) ? d : [d]; list.forEach((u) => { const m = A.msgs.find((x) => x.key?.id === (u.keyId || u.key?.id)); if (m) { m.status = u.status; const b = el.querySelector(`.wa-b[data-id="${m.key.id}"] .wa-tk`); if (b) b.outerHTML = statusIcon(m); } }); });
    es.onerror = () => { es.close(); setTimeout(start, 4000); };
  };
  start();
}
function onMessage(el, { jid, msg }) {
  if (!el.isConnected) return;
  let c = A.chats.find((x) => x.jid === jid);
  const p = parse(msg); if (!p) return;
  if (!c) { c = { jid, phone: digits(jid.split('@')[0]), name: msg.pushName || null, unread: 0, at: 0, last: null }; A.chats.unshift(c); }
  if (!msg.key.fromMe && msg.pushName) c.name = msg.pushName;
  c.at = tsOf(msg) || Date.now(); c.last = { text: p.text || ({ image: '[imagem]', audio: '[áudio]', video: '[vídeo]', doc: '[documento]', sticker: '[figurinha]' })[p.type] || '', fromMe: !!msg.key.fromMe };
  if (A.jid === jid) {
    // a mensagem que eu mandei já está na tela (otimista): troca pela real
    if (msg.key.fromMe) { const tmp = A.msgs.find((m) => String(m.key.id).startsWith('tmp-') && (parse(m)?.type === p.type) && (p.type !== 'text' || parse(m).text === p.text)); if (tmp) { el.querySelector(`.wa-b[data-id="${tmp.key.id}"]`)?.remove(); A.msgs = A.msgs.filter((m) => m !== tmp); } }
    if (!A.msgs.some((m) => m.key?.id === msg.key.id)) {
      A.msgs.push(msg);
      const box = el.querySelector('[data-msgs]');
      if (box) { const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160; box.querySelector('.wa-none')?.remove(); box.insertAdjacentHTML('beforeend', bubble(msg, p, tsOf(msg))); const n = box.lastElementChild.querySelector('[data-media]:not([data-manual])'); if (n) loadMedia(n); if (near || msg.key.fromMe) box.scrollTop = box.scrollHeight; }
      if (!msg.key.fromMe && document.visibilityState === 'visible') api('/api/read', { jid, ids: [msg.key.id] }).catch(() => {});
    }
  } else if (!msg.key.fromMe) c.unread = (c.unread || 0) + 1;
  A.chats.sort((a, b) => b.at - a.at);
  drawChats(el); badge();
}

// ---------- modo demonstração (sem ponte): dados de exemplo pra ver a tela ----------
const DEMO = { state: 'open', chats: null, msgs: {} };
function demoApi(path, body = {}) {
  const now = Date.now();
  if (!DEMO.chats) {
    const ls = S.leads.filter((l) => l.whatsapp).slice(0, 6);
    DEMO.chats = [...ls.map((l, i) => ({ jid: `${digits(l.whatsapp)}@s.whatsapp.net`, phone: digits(l.whatsapp), name: firstName(l.nome), picture: null, unread: i < 2 ? i + 1 : 0, at: now - i * 3600000, last: { text: i % 2 ? 'Pode me ligar às 15h?' : 'Oi, tenho interesse sim', fromMe: false } })),
      { jid: '5511988887777@s.whatsapp.net', phone: '5511988887777', name: 'Carla (fornecedor)', picture: null, unread: 0, at: now - 86400000 * 2, last: { text: 'Segue o orçamento', fromMe: false } }];
  }
  if (path === '/api/status') return { state: DEMO.state, number: '5562994759475', name: 'Tracto' };
  if (path === '/api/chats') return DEMO.chats;
  if (path === '/api/messages') {
    const t = Math.floor(now / 1000);
    const recs = DEMO.msgs[body.jid] || [
      { key: { id: 'd1', fromMe: true, remoteJid: body.jid }, message: { conversation: 'Oi, tudo bem? Aqui é da Tracto. Vi que você preencheu nosso formulário.\n\nPosso te ligar rapidinho?' }, messageTimestamp: t - 90000, status: 'READ' },
      { key: { id: 'd2', fromMe: false, remoteJid: body.jid }, message: { conversation: 'Oi, tenho interesse sim' }, messageTimestamp: t - 3600 },
      { key: { id: 'd3', fromMe: false, remoteJid: body.jid }, message: { conversation: 'Pode me ligar às 15h? Meu site é https://minhaloja.com.br' }, messageTimestamp: t - 3500 },
      { key: { id: 'd4', fromMe: true, remoteJid: body.jid }, message: { conversation: 'Combinado! Te ligo às 15h.' }, messageTimestamp: t - 3400, status: 'DELIVERY_ACK' }
    ].reverse();
    DEMO.msgs[body.jid] = recs;
    return { records: recs, pages: 1 };
  }
  if (path.startsWith('/api/send/')) return { ok: true };
  if (path === '/api/read') return { ok: true };
  if (path === '/api/media') return { base64: '', mimetype: 'image/png' };
  if (path === '/api/connect') return { qr: null, state: 'open' };
  return {};
}

// lead mudou (ex.: respondeu, etiqueta, estágio): atualiza a lista e o painel sem perder a conversa
window.addEventListener('tracto:leads-updated', () => {
  const el = document.querySelector('#view'); if (!el?.querySelector('.wa')) return;
  resetIdx(); drawChats(el);
  if (A.jid) { const c = A.chats.find((x) => x.jid === A.jid) || { jid: A.jid, phone: digits(A.jid.split('@')[0]) }; drawPanel(el, c, leadByPhone(c.phone)); }
});

// ocupa exatamente a altura que sobra na tela (com ou sem a barra de demonstração / menu do celular)
function fit(el) {
  const wa = el.querySelector('.wa'); if (!wa) return;
  const bottom = window.innerWidth <= 760 ? 96 : 16;
  wa.style.height = Math.max(420, window.innerHeight - wa.getBoundingClientRect().top - window.scrollY - bottom) + 'px';
}
window.addEventListener('resize', () => { const el = document.querySelector('#view'); if (el?.querySelector('.wa')) fit(el); });
