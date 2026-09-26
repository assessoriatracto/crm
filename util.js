// Estado e utilitários compartilhados do CRM
import { FORMS } from '@shared/forms.js';

export const S = {
  me: null,
  leads: [],
  stages: [],
  labels: [],
  profiles: [],
  forms: FORMS,
  openId: null
};

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const FAT = ['Menos de R$15.000', 'De R$15.000 a R$30.000', 'De R$30.000 a R$50.000', 'De R$50.000 a R$100.000', 'Acima de R$100.000'];
export const FAT_SHORT = ['até 15k', '15 a 30k', '30 a 50k', '50 a 100k', '100k+'];
export const COLORS = ['#6AA8FF', '#B58CFF', '#4FD1C5', '#FFAD00', '#FF8A3D', '#3DDC84', '#FF5C8A', '#6B6B6B'];
export const INACTIVE_DAYS = 7;

export const ICON = {
  dots: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  dotsH: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  caret: '<svg class="caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>',
  check: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  phone: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  mail: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
  insta: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  wa: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.2-.6-.4zM12 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4C2.7 15.6 2.2 13.8 2.2 12 2.2 6.6 6.6 2.2 12 2.2S21.8 6.6 21.8 12 17.4 21.8 12 21.8zM12 0C5.4 0 0 5.4 0 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6c1.8 1 3.8 1.5 5.8 1.5 6.6 0 12-5.4 12-12S18.6 0 12 0z"/></svg>',
  bell: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  empty: '<svg width="120" height="90" viewBox="0 0 120 90" fill="none"><rect x="30" y="4" width="60" height="18" rx="6" style="fill:var(--c-hover)"/><circle cx="42" cy="13" r="5" style="fill:var(--c-line-strong)"/><rect x="52" y="10" width="28" height="6" rx="3" style="fill:var(--c-line-strong)"/><rect x="18" y="32" width="84" height="24" rx="8" fill="rgba(255,173,0,.16)" stroke="rgba(255,173,0,.45)"/><circle cx="33" cy="44" r="6" fill="#FFAD00"/><rect x="46" y="41" width="30" height="6" rx="3" fill="#FFAD00"/><rect x="30" y="66" width="60" height="18" rx="6" style="fill:var(--c-hover)"/><circle cx="42" cy="75" r="5" style="fill:var(--c-line-strong)"/><rect x="52" y="72" width="28" height="6" rx="3" style="fill:var(--c-line-strong)"/></svg>'
};

// ---------- formatação ----------
export const initials = (n) => String(n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const fatIdx = (l) => FAT.indexOf(l.faturamento);
export const fatShort = (f) => FAT_SHORT[FAT.indexOf(f)] || '';
export const isHot = (l) => fatIdx(l) >= 3;
export const stageOf = (l) => S.stages.find((s) => s.id === l.stage_id);
export const profileOf = (id) => S.profiles.find((p) => p.id === id);
export const labelOf = (id) => S.labels.find((x) => x.id === id);
export const isInactive = (l) => (stageOf(l)?.kind || 'open') === 'open' && Date.now() - new Date(l.last_activity_at || l.created_at) > INACTIVE_DAYS * 86400000;
export const isDue = (l) => l.reminder_at && new Date(l.reminder_at) <= new Date();
export const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const pct = (a, b) => (b ? (Math.round((a / b) * 1000) / 10).toLocaleString('pt-BR') + '%' : '—');
export const num = (n) => Number(n || 0).toLocaleString('pt-BR');
export const fmtPhone = (w) => {
  const d = String(w || '').replace(/\D/g, '');
  const n = d.replace(/^55(?=\d{10,11}$)/, '');
  if (n.length === 11) return `+55 (${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `+55 (${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return w ? '+' + d : '';
};
export const fullDate = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const longDate = (iso) => {
  const d = new Date(iso);
  const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s[0].toUpperCase() + s.slice(1) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};
export const addedAt = (iso) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d >= today) return 'hoje às ' + t;
  if (d >= today - 86400000) return 'ontem às ' + t;
  return 'em ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' às ' + t;
};
export const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' d';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};
export const sourceLabel = (s) => ({ pago: 'Pago', organico: 'Orgânico', manual: 'Manual' }[s] || s);
export const formName = (l) => S.forms[l.form_id]?.name || l.form_name || (l.form_id === 'manual' ? 'Cadastro manual' : l.form_id);
export const waLink = (l, msg) => {
  const first = (l.nome || '').split(' ')[0];
  const text = msg ?? `Oi ${first}, tudo bem? Aqui é da Tracto. Vi que você preencheu nosso formulário e queria entender melhor o momento da sua loja.`;
  return `https://wa.me/${String(l.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
};

// ---------- toast ----------
export function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3400);
}
export const fail = (e) => { console.error(e); toast('Algo deu errado: ' + (e?.message || 'tente de novo'), true); };

// ---------- popover ----------
let openPop = null;
export function closePop() { openPop?.remove(); openPop = null; }
export function popover(anchor, html, bind) {
  closePop();
  const p = document.createElement('div');
  p.className = 'pop';
  p.innerHTML = html;
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect();
  const w = p.offsetWidth;
  const h = p.offsetHeight;
  let left = Math.min(r.left, innerWidth - w - 12);
  let top = r.bottom + 6;
  if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 6);
  p.style.left = Math.max(12, left) + 'px';
  p.style.top = top + 'px';
  openPop = p;
  bind?.(p);
  return p;
}
document.addEventListener('mousedown', (e) => { if (openPop && !openPop.contains(e.target) && !e.target.closest('[data-pop-anchor]')) closePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
window.addEventListener('resize', closePop);

// menu simples: items = [{label, action, danger, sep, header}]
export function menu(anchor, items) {
  const html = items.map((it, i) => it.sep ? '<hr>' : it.header ? `<div class="ph">${esc(it.header)}</div>` :
    `<button class="pi ${it.danger ? 'danger' : ''}" data-i="${i}">${it.swatch ? `<span class="swatch" style="background:${it.swatch}"></span>` : ''}${esc(it.label)}${it.checked ? `<span style="margin-left:auto;color:var(--amber)">${ICON.check}</span>` : ''}</button>`).join('');
  popover(anchor, html, (p) => p.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    closePop(); items[+b.dataset.i].action?.();
  }));
}

// multi-seleção com checkboxes: options = [{value, label, swatch}]
export function multiSelect(anchor, { title, options, selected, onChange, search = options.length > 8 }) {
  const sel = new Set(selected);
  const render = (p, q = '') => {
    p.querySelector('.ms-list').innerHTML = options.filter((o) => !q || o.label.toLowerCase().includes(q)).map((o) =>
      `<button class="pi" data-v="${esc(o.value)}"><span class="cbx ${sel.has(o.value) ? 'on' : ''}">${sel.has(o.value) ? ICON.check : ''}</span>${o.swatch ? `<span class="swatch" style="background:${o.swatch}"></span>` : ''}<span style="overflow:hidden;text-overflow:ellipsis">${esc(o.label)}</span></button>`).join('') || '<div class="ph">Nada encontrado</div>';
  };
  popover(anchor, `${title ? `<div class="ph">${esc(title)}</div>` : ''}${search ? '<input class="inp ms-q" placeholder="Buscar">' : ''}<div class="ms-list"></div><hr><div class="pfoot"><button class="b b-sm b-ghost ms-clear">Limpar</button><button class="b b-sm b-primary ms-done">Aplicar</button></div>`, (p) => {
    render(p);
    p.querySelector('.ms-q')?.addEventListener('input', (e) => render(p, e.target.value.toLowerCase()));
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b) { const v = b.dataset.v; sel.has(v) ? sel.delete(v) : sel.add(v); render(p, p.querySelector('.ms-q')?.value.toLowerCase() || ''); }
      if (e.target.closest('.ms-clear')) { sel.clear(); onChange([]); closePop(); }
      if (e.target.closest('.ms-done')) { onChange([...sel]); closePop(); }
    });
  });
}

// ---------- modal ----------
export function modal(html, bind) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-card">${html}</div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
  m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  bind?.(m.querySelector('.modal-card'), close);
  setTimeout(() => m.querySelector('input:not([type=hidden]), select, textarea')?.focus(), 30);
  return close;
}
export function confirmBox(text, okLabel = 'Confirmar', danger = true) {
  return new Promise((resolve) => {
    modal(`<h3>${esc(text)}</h3><div class="modal-foot"><button class="b" data-close data-no>Cancelar</button><button class="b ${danger ? 'b-danger' : 'b-primary'}" data-ok>${esc(okLabel)}</button></div>`, (c, close) => {
      c.querySelector('[data-ok]').addEventListener('click', () => { close(); resolve(true); });
      c.querySelector('[data-no]').addEventListener('click', () => resolve(false));
    });
  });
}

// ---------- CSV ----------
export function downloadCSV(name, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
