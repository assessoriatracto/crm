// Painel personalizável (no padrão do Nox): catálogo de blocos (indicadores, gráficos, relatórios),
// a pessoa escolhe quais aparecem, a ordem e o tamanho. Fica salvo no perfil (profiles.prefs[key]).
import { DB } from '@shared/db.js';
import { S, esc, ICON, toast, fail, modal } from './util.js?v=2610230934';

const GROUPS = ['Indicadores', 'Gráficos', 'Relatórios'];
const I = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TOOL = {
  grip: I('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
  left: I('<path d="m15 18-6-6 6-6"/>'), right: I('<path d="m9 18 6-6-6-6"/>'),
  size: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'), undo: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>'),
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>')
};

/**
 * host: onde desenhar · key: nome do painel no perfil · widgets: [{id, group, label, desc, sizes:[1,2,4], render(ctx) -> html, tone?(ctx), after?(el, ctx)}]
 * defaults: [[id, tamanho], ...] · ctx: dados já calculados
 */
export function renderBoard(host, { key, widgets, defaults, ctx }) {
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const valid = (list) => (Array.isArray(list) ? list.filter((x) => x && byId.has(x.id)).map((x) => ({ id: x.id, w: byId.get(x.id).sizes.includes(x.w) ? x.w : byId.get(x.id).sizes[0] })) : null);
  const DEFAULT = defaults.map(([id, w]) => ({ id, w }));
  const saved = valid(S.me?.prefs?.[key]);
  const st = { layout: saved && saved.length ? saved : DEFAULT, draft: null, drag: '', over: '' };

  const draw = () => {
    const items = st.draft || st.layout; const editing = !!st.draft;
    host.innerHTML = `
      <div class="ov-bar">${editing
        ? `<span class="muted">Arraste os blocos para reordenar. Use os botões de cada bloco para mudar o tamanho ou tirar do painel.</span><span class="grow"></span>
           <button class="b b-sm" data-ov="add">${TOOL.plus}Adicionar bloco</button>
           <button class="b b-sm b-ghost" data-ov="reset">${TOOL.undo}Padrão</button>
           <button class="b b-sm b-ghost" data-ov="cancel">Cancelar</button>
           <button class="b b-sm b-primary" data-ov="save">${ICON.check}Salvar painel</button>`
        : `<span class="grow"></span><button class="b b-sm" data-ov="edit">${TOOL.edit}Personalizar painel</button>`}</div>
      ${items.length ? '' : `<div class="panel ad-empty"><h3>Painel vazio</h3><p class="help">Adicione os blocos que você quer acompanhar.</p><button class="b b-primary" data-ov="add">${TOOL.plus}Adicionar bloco</button></div>`}
      <div class="ov-grid ${editing ? 'editing' : ''}">${items.map((it) => {
        const w = byId.get(it.id);
        return `<section class="ow w${it.w} ${w.group === 'Indicadores' ? 'wk' : 'wc'} ${w.tone?.(ctx) || ''}" data-id="${it.id}" ${editing ? 'draggable="true"' : ''} aria-label="${esc(w.label)}">
          ${editing ? `<div class="ow-tools">
            <span class="grip" title="Arraste para mover" data-grip>${TOOL.grip}</span>
            <button type="button" data-t="prev" aria-label="Mover ${esc(w.label)} para antes" title="Mover para antes">${TOOL.left}</button>
            <button type="button" data-t="next" aria-label="Mover ${esc(w.label)} para depois" title="Mover para depois">${TOOL.right}</button>
            ${w.sizes.length > 1 ? `<button type="button" data-t="size" aria-label="Mudar o tamanho de ${esc(w.label)}" title="Mudar o tamanho">${TOOL.size}</button>` : ''}
            <button type="button" class="red" data-t="del" aria-label="Tirar ${esc(w.label)} do painel" title="Tirar do painel">${ICON.x}</button></div>` : ''}
          ${w.render(ctx)}</section>`;
      }).join('')}</div>`;
    host.querySelectorAll('.ow').forEach((el) => byId.get(el.dataset.id).after?.(el, ctx));
    bind();
  };

  const change = (fn) => { st.draft = fn([...(st.draft || [])]); draw(); };
  const move = (id, target) => change((l) => { const it = l.find((x) => x.id === id); const rest = l.filter((x) => x.id !== id); const i = rest.findIndex((x) => x.id === target); rest.splice(i < 0 ? rest.length : i, 0, it); return rest; });
  const step = (id, dir) => change((l) => { const i = l.findIndex((x) => x.id === id); const j = i + dir; if (j < 0 || j >= l.length) return l; [l[i], l[j]] = [l[j], l[i]]; return l; });
  const resize = (id) => change((l) => l.map((x) => { if (x.id !== id) return x; const s = byId.get(id).sizes; return { ...x, w: s[(s.indexOf(x.w) + 1) % s.length] }; }));

  async function save(value) {
    const prefs = { ...(S.me?.prefs || {}), [key]: value };
    if (!value) delete prefs[key];
    try { S.me = { ...S.me, ...(await DB.updateMyProfile({ prefs })) }; S.me.prefs = prefs; st.layout = value || DEFAULT; st.draft = null; draw(); toast(value ? 'Painel salvo' : 'Painel padrão restaurado'); }
    catch (e) { fail(e); }
  }

  function picker() {
    const has = (id) => (st.draft || []).some((x) => x.id === id);
    modal(`<h3>Adicionar bloco</h3><p class="help" style="margin-top:-4px">Escolha o que acompanhar no painel. Dá para mudar a ordem e o tamanho depois.</p>
      ${GROUPS.map((g) => { const list = widgets.filter((w) => w.group === g); return list.length ? `<h4 class="wpick-h">${g}</h4><div class="wpick">${list.map((w) => `<button type="button" class="${has(w.id) ? 'on' : ''}" aria-pressed="${has(w.id)}" data-pick="${w.id}"><span class="wpick-t"><b>${esc(w.label)}</b><small>${esc(w.desc)}</small></span>${has(w.id) ? ICON.check : TOOL.plus}</button>`).join('')}</div>` : ''; }).join('')}
      <div class="modal-foot"><button class="b b-primary" data-close>Concluir</button></div>`, (m) => {
      m.closest('.modal')?.classList.add('modal-wide');
      m.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.pick; const on = has(id);
        st.draft = on ? st.draft.filter((x) => x.id !== id) : [...st.draft, { id, w: byId.get(id).sizes[0] }];
        b.classList.toggle('on', !on); b.setAttribute('aria-pressed', !on); b.lastElementChild.outerHTML = !on ? ICON.check : TOOL.plus;
        draw();
      }));
    });
  }

  function bind() {
    host.querySelector('[data-ov="edit"]')?.addEventListener('click', () => { st.draft = [...st.layout]; draw(); });
    host.querySelectorAll('[data-ov="add"]').forEach((b) => b.addEventListener('click', () => { if (!st.draft) st.draft = [...st.layout]; draw(); picker(); }));
    host.querySelector('[data-ov="reset"]')?.addEventListener('click', () => { st.draft = [...DEFAULT]; draw(); });
    host.querySelector('[data-ov="cancel"]')?.addEventListener('click', () => { st.draft = null; draw(); });
    host.querySelector('[data-ov="save"]')?.addEventListener('click', (e) => { e.currentTarget.disabled = true; save(st.draft); });
    if (!st.draft) return;
    host.querySelectorAll('.ow').forEach((el) => {
      const id = el.dataset.id;
      el.querySelector('[data-t="prev"]')?.addEventListener('click', () => step(id, -1));
      el.querySelector('[data-t="next"]')?.addEventListener('click', () => step(id, 1));
      el.querySelector('[data-t="size"]')?.addEventListener('click', () => resize(id));
      el.querySelector('[data-t="del"]')?.addEventListener('click', () => change((l) => l.filter((x) => x.id !== id)));
      // arrastar com o mouse
      el.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); st.drag = id; el.classList.add('drag'); });
      el.addEventListener('dragend', () => { st.drag = ''; el.classList.remove('drag'); host.querySelectorAll('.ow.over').forEach((x) => x.classList.remove('over')); });
      el.addEventListener('dragover', (e) => { if (!st.drag) return; e.preventDefault(); host.querySelectorAll('.ow.over').forEach((x) => x !== el && x.classList.remove('over')); if (st.drag !== id) el.classList.add('over'); });
      el.addEventListener('drop', (e) => { e.preventDefault(); if (st.drag && st.drag !== id) move(st.drag, id); st.drag = ''; });
      // toque e caneta: a alça segue o dedo (o arrasto nativo não existe no celular)
      const grip = el.querySelector('[data-grip]');
      grip.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; grip.setPointerCapture(e.pointerId); st.drag = id; el.classList.add('drag'); });
      grip.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || !st.drag) return; const o = document.elementFromPoint(e.clientX, e.clientY)?.closest('.ow'); host.querySelectorAll('.ow.over').forEach((x) => x.classList.remove('over')); if (o && o.dataset.id !== st.drag) { o.classList.add('over'); st.over = o.dataset.id; } else st.over = ''; });
      grip.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') return; const from = st.drag; const to = st.over; st.drag = ''; st.over = ''; if (from && to && to !== from) move(from, to); else draw(); });
    });
  }
  draw();
}

// ---------- gráficos com degradê (SVG), no padrão do Nox nas cores da Tracto ----------
let gid = 0;
const short = (v) => (Math.abs(v) >= 1000 ? 'R$' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : 'R$' + Math.round(v));
const nice = (v) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v)))); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) || v; };

// colunas lado a lado com degradê. series: [{key, label, cls:'hot'|'rest'}], data: [{d, ...}], fmt(v), tip(x) -> html
export function gradBars(host, { data, series, fmt = short, tip }) {
  const draw = () => {
    const W = Math.max(300, host.clientWidth); const H = 230; const padL = 54; const padB = 24; const padT = 12; const id = 'g' + (++gid);
    const max = nice(Math.max(1, ...data.flatMap((x) => series.map((s) => x[s.key] || 0))));
    const iw = W - padL; const ih = H - padB - padT; const bw = iw / Math.max(1, data.length); const n = series.length;
    const barW = Math.max(2, Math.min(16, (bw - 6) / n)); const gap = 2;
    const y = (v) => padT + ih - (v / max) * ih;
    const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 62)));
    const bar = (x, v, cls, i) => { if (!v) return ''; const top = y(v); const h = padT + ih - top; const rr = Math.min(4, barW / 2, h); return `<path class="gb ${cls}" data-i="${i}" fill="url(#${id}-${cls})" d="M${x},${padT + ih} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + barW - rr} Q${x + barW},${top} ${x + barW},${top + rr} V${padT + ih} Z"/>`; };
    host.innerHTML = `<svg class="gchart" viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(series.map((s) => s.label).join(' e '))} por dia">
      <defs>
        <linearGradient id="${id}-hot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD27A"/><stop offset=".55" stop-color="#FFAD00"/><stop offset="1" stop-color="#B57600" stop-opacity=".85"/></linearGradient>
        <linearGradient id="${id}-rest" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--gb-rest-top)"/><stop offset="1" style="stop-color:var(--gb-rest-bot)"/></linearGradient>
      </defs>
      ${[0, max / 2, max].map((t) => `<line class="gl" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
      ${data.map((x, i) => { const cx = padL + i * bw + bw / 2; const tot = n * barW + (n - 1) * gap; return series.map((s, k) => bar(cx - tot / 2 + k * (barW + gap), x[s.key] || 0, s.cls, i)).join(''); }).join('')}
      ${data.map((x, i) => (i % every === 0 ? `<text class="ax" x="${padL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${x.d.slice(8, 10)}/${x.d.slice(5, 7)}</text>` : '')).join('')}
      ${data.map((x, i) => `<rect class="hit" data-i="${i}" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${ih}"/>`).join('')}
    </svg><div class="ctip" hidden></div>`;
    const tipEl = host.querySelector('.ctip'); const svg = host.querySelector('svg');
    svg.addEventListener('mousemove', (e) => {
      const h = e.target.closest('.hit'); if (!h) return; const i = +h.dataset.i; const x = data[i];
      host.querySelectorAll('.gb').forEach((b) => b.classList.toggle('dim', +b.dataset.i !== i));
      tipEl.innerHTML = tip(x); tipEl.hidden = false;
      const sc = svg.getBoundingClientRect().width / W; const top = Math.max(...series.map((s) => x[s.key] || 0));
      tipEl.style.left = Math.min(Math.max((padL + i * bw + bw / 2) * sc, 80), host.clientWidth - 80) + 'px';
      tipEl.style.top = y(Math.max(top, max * 0.2)) * sc + 'px';
    });
    svg.addEventListener('mouseleave', () => { tipEl.hidden = true; host.querySelectorAll('.gb').forEach((b) => b.classList.remove('dim')); });
  };
  fit(host, draw);
}

// área com degradê âmbar (uma série), linha suave e ponto ao passar o mouse
export function gradArea(host, { data, key, fmt = (v) => String(v), tip }) {
  const draw = () => {
    const W = Math.max(300, host.clientWidth); const H = 210; const padL = 40; const padB = 24; const padT = 14; const id = 'a' + (++gid);
    const max = nice(Math.max(1, ...data.map((x) => x[key] || 0)));
    const iw = W - padL - 6; const ih = H - padB - padT; const step = data.length > 1 ? iw / (data.length - 1) : 0;
    const X = (i) => padL + i * step; const Y = (v) => padT + ih - (v / max) * ih;
    const pts = data.map((x, i) => [X(i), Y(x[key] || 0)]);
    // curva suave (Catmull-Rom → Bézier)
    const path = pts.map((p, i) => { if (!i) return `M${p[0]},${p[1]}`; const p0 = pts[i - 2] || pts[i - 1]; const p1 = pts[i - 1]; const p3 = pts[i + 1] || p; const c1 = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6]; const c2 = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6]; return `C${c1[0]},${Math.min(padT + ih, c1[1])} ${c2[0]},${Math.min(padT + ih, c2[1])} ${p[0]},${p[1]}`; }).join(' ');
    const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 62)));
    host.innerHTML = `<svg class="gchart" viewBox="0 0 ${W} ${H}" height="${H}" role="img">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFAD00" stop-opacity=".42"/><stop offset=".7" stop-color="#FFAD00" stop-opacity=".08"/><stop offset="1" stop-color="#FFAD00" stop-opacity="0"/></linearGradient>
        <linearGradient id="${id}-l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C98500"/><stop offset="1" stop-color="#FFD27A"/></linearGradient></defs>
      ${[0, max / 2, max].map((t) => `<line class="gl" x1="${padL}" x2="${W}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${padL - 8}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
      ${pts.length ? `<path d="${path} L${pts[pts.length - 1][0]},${padT + ih} L${pts[0][0]},${padT + ih} Z" fill="url(#${id})"/><path d="${path}" fill="none" stroke="url(#${id}-l)" stroke-width="2.2" stroke-linecap="round"/>` : ''}
      <line class="ga-x" x1="0" x2="0" y1="${padT}" y2="${padT + ih}" style="display:none"/><circle class="ga-dot" r="4.5" style="display:none"/>
      ${data.map((x, i) => (i % every === 0 ? `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="middle">${x.d.slice(8, 10)}/${x.d.slice(5, 7)}</text>` : '')).join('')}
      <rect class="hit" x="${padL}" y="${padT}" width="${iw}" height="${ih}"/>
    </svg><div class="ctip" hidden></div>`;
    const svg = host.querySelector('svg'); const tipEl = host.querySelector('.ctip'); const dot = svg.querySelector('.ga-dot'); const ln = svg.querySelector('.ga-x');
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect(); const sc = r.width / W; const mx = (e.clientX - r.left) / sc;
      const i = Math.max(0, Math.min(data.length - 1, Math.round((mx - padL) / (step || 1)))); const p = pts[i]; if (!p) return;
      dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); dot.style.display = ''; ln.setAttribute('x1', p[0]); ln.setAttribute('x2', p[0]); ln.style.display = '';
      tipEl.innerHTML = tip(data[i]); tipEl.hidden = false;
      tipEl.style.left = Math.min(Math.max(p[0] * sc, 80), host.clientWidth - 80) + 'px'; tipEl.style.top = p[1] * sc + 'px';
    });
    svg.addEventListener('mouseleave', () => { tipEl.hidden = true; dot.style.display = 'none'; ln.style.display = 'none'; });
  };
  fit(host, draw);
}

// desenha com a largura real e redesenha quando ela muda
function fit(host, draw) {
  let lastW = 0;
  const go = () => { const w = host.clientWidth; if (w && Math.abs(w - lastW) > 4) { lastW = w; draw(); } };
  new ResizeObserver(go).observe(host); requestAnimationFrame(go);
}
