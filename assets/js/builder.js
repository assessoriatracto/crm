// Construtor de formulários (estilo Typeform): lista, editor de etapas, lógica, tema e prévia ao vivo
import { DB } from '@shared/db.js';
import { FORMS, formPath } from '@shared/forms.js';
import { go, S, $, $$, esc, ICON, num, pct, toast, fail, modal, confirmBox, menu, popover, closePop } from './util.js?v=2609282321';
import { BTN_ICONS } from '@shared/form-engine.js';

const SITE = window.TRACTO_CONFIG?.siteUrl || 'https://assessoriatracto.com.br';
const B = { forms: [], editing: null, sel: null, tab: 'conteudo', device: 'desktop', dirty: false, saveT: null, frameReady: false };

// ---------- catálogo de tipos ----------
const sv = (d) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TI = {
  welcome: sv('<path d="M3 11h18M5 11V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M7 15h10M9 19h6"/>'),
  statement: sv('<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>'),
  testimonial: sv('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  short_text: sv('<path d="M4 7V5h16v2M12 5v14M9 19h6"/>'),
  email: sv('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  phone: sv('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>'),
  cpf: sv('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.6-2 3-2s2.5.5 3 2M15 10h3M15 13h3"/>'),
  cnpj: sv('<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3"/>'),
  cep: sv('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  choice: sv('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>'),
  multi: sv('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>'),
  dropdown: sv('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m14 11 2 2 2-2"/>'),
  yes_no: sv('<path d="M7 7h13l-3-3M17 17H4l3 3"/>'),
  scale: sv('<path d="M4 20V14M9 20V10M14 20V6M19 20V3"/>'),
  rating: sv('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  long_text: sv('<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>'),
  number: sv('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'),
  date: sv('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  url: sv('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  file: sv('<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>'),
  calendly: sv('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 15l2 2 4-4"/>'),
  consent: sv('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  thankyou: sv('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  external: sv('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  desktop: sv('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  check: sv('<path d="M20 6 9 17l-5-5"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>')
};
const TYPES = {
  welcome: ['Boas-vindas', 'Conteúdo'], statement: ['Mensagem', 'Conteúdo'], testimonial: ['Depoimento', 'Conteúdo'],
  short_text: ['Texto curto', 'Contato'], email: ['E-mail', 'Contato'], phone: ['WhatsApp', 'Contato'],
  cpf: ['CPF', 'Contato'], cnpj: ['CNPJ', 'Contato'], cep: ['CEP (busca endereço)', 'Contato'],
  choice: ['Escolha única', 'Escolha'], multi: ['Múltipla escolha', 'Escolha'], dropdown: ['Lista suspensa', 'Escolha'],
  yes_no: ['Sim ou não', 'Escolha'], scale: ['Escala 0 a 10', 'Escolha'], rating: ['Estrelas', 'Escolha'],
  long_text: ['Texto longo', 'Texto'], number: ['Número', 'Texto'], date: ['Data', 'Texto'], url: ['Link', 'Texto'],
  file: ['Arquivo', 'Integrações'], calendly: ['Agendamento (Calendly)', 'Integrações'], consent: ['Consentimento', 'Integrações'],
  thankyou: ['Tela final', 'Final']
};
Object.keys(TYPES).forEach((k) => TYPES[k].push(TI[k]));
const QUESTION = ['short_text', 'long_text', 'email', 'phone', 'number', 'url', 'date', 'choice', 'multi', 'dropdown', 'yes_no', 'rating', 'scale', 'consent', 'cep', 'cpf', 'cnpj', 'file', 'calendly'];
const MAPS = [['', 'Não salvar em coluna'], ['nome', 'Nome'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['instagram', 'Instagram'], ['faturamento', 'Faturamento'], ['estado', 'Estado (UF)'], ['cidade', 'Cidade']];
const OPS = [['is', 'é igual a'], ['is_not', 'é diferente de'], ['in', 'é uma destas'], ['includes', 'inclui'], ['gte', 'é maior ou igual a'], ['lte', 'é menor ou igual a'], ['filled', 'foi respondida'], ['empty', 'não foi respondida']];
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\{\{(\w+)(:\w+)?\}\}/g, '[$1]');
const slugify = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
// texto rico mínimo: só negrito, itálico e quebra de linha (o resto vira texto puro)
export function sanitizeRich(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const walk = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return n.textContent.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    if (tag === 'span' && n.dataset.tok) return `{{${n.dataset.tok.replace(/[^\w:]/g, '')}}}`;
    const inner = walk(n);
    if (tag === 'b' || tag === 'strong') return inner ? `<strong>${inner}</strong>` : '';
    if (tag === 'i' || tag === 'em') return inner ? `<em>${inner}</em>` : '';
    if (tag === 'br') return '<br>';
    if (tag === 'div' || tag === 'p') return (inner && inner !== '<br>' ? '<br>' + inner : '<br>');
    return inner;
  }).join('');
  return walk(doc.body.firstChild).replace(/^(<br>)+/, '').replace(/(<br>)+$/, '').replace(/(<br>){3,}/g, '<br><br>');
}
// {{campo}} vira etiqueta visual no editor (ninguém precisa ver a sintaxe)
function tokLabel(tok, fields) {
  const [id, mod] = tok.split(':');
  if (id === 'nome' || fields.find((y) => y.id === id)?.map === 'nome') return mod === 'first' ? 'Primeiro nome' : 'Nome';
  const f = fields.find((y) => y.id === id);
  return f ? strip(f.title).slice(0, 28) : id;
}
const withTokens = (html, fields) => String(html || '').replace(/\{\{(\w+(?::first)?)\}\}/g, (_, t) => `<span class="tok" contenteditable="false" data-tok="${t}">${esc(tokLabel(t, fields))}</span>`);
const newId = (type) => `${type.replace(/_/g, '')}_${Math.random().toString(36).slice(2, 6)}`;
const formUrl = (f) => new URL(f.slug ? `/aplicar/${f.slug}/` : '/aplicar/', SITE).toString();

function blankField(type) {
  const base = { id: newId(type), type, title: '' };
  const defaults = {
    welcome: { title: 'Título da sua página de boas-vindas', desc: 'Explique em uma frase o que a pessoa ganha respondendo.', button: 'COMEÇAR' },
    statement: { title: 'Uma mensagem entre as perguntas', button: 'Continuar' },
    testimonial: { title: 'Quem já usa', quote: 'A Tracto dobrou as vendas da nossa loja em 3 meses.', author: 'Nome do cliente', role: 'Loja de materiais, Goiânia', rating: 5, button: 'Continuar' },
    short_text: { title: 'Sua pergunta aqui', required: true }, long_text: { title: 'Conte com suas palavras', required: false, maxLength: 1000 },
    email: { title: 'Qual é o seu e-mail?', required: true, map: 'email' }, phone: { title: 'Qual seu número de WhatsApp?', required: true, map: 'whatsapp' },
    cpf: { title: 'Qual o seu CPF?', required: true }, cnpj: { title: 'Qual o CNPJ da empresa?', required: true },
    cep: { title: 'Qual o CEP da sua loja?', desc: 'Buscamos o endereço automaticamente.', required: true },
    choice: { title: 'Escolha uma opção', options: ['Opção 1', 'Opção 2'], required: true }, multi: { title: 'Escolha quantas quiser', options: ['Opção 1', 'Opção 2', 'Opção 3'], required: true, min: 1 },
    dropdown: { title: 'Escolha na lista', options: ['Opção 1', 'Opção 2'], required: true }, yes_no: { title: 'Sua pergunta de sim ou não?', required: true },
    scale: { title: 'De 0 a 10, …', min: 0, max: 10, labels: ['Nada', 'Muito'], required: true }, rating: { title: 'Como você avalia…?', max: 5, required: true },
    number: { title: 'Quantos…?', required: false }, date: { title: 'Qual a data?', required: false }, url: { title: 'Qual o site da empresa?', required: false },
    file: { title: 'Envie um arquivo', desc: 'PDF, imagem ou planilha.', required: false, maxMb: 20, accept: '.pdf,.png,.jpg,.jpeg,.xlsx,.csv' },
    calendly: { title: 'Escolha o melhor horário pra conversarmos', url: 'https://calendly.com/sua-conta/diagnostico', required: false },
    consent: { title: 'Podemos entrar em contato?', label: 'Sim, autorizo o contato', desc: 'Usamos seus dados só pra falar sobre o diagnóstico, conforme a LGPD.', required: true },
    thankyou: { title: 'Obrigado por responder!', desc: 'Em breve nossa equipe entra em contato.', cta: { label: 'FALAR NO WHATSAPP', href: 'https://wa.me/5562994759475' } }
  };
  return { ...base, ...(defaults[type] || {}) };
}

// ============================================================
// LISTA
// ============================================================
export async function renderBuilder(el) {
  const id = new URLSearchParams(location.search).get('id');
  el.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    B.forms = await DB.listForms();
    // primeira vez: traz os formulários que já estão no ar pro construtor
    if (!B.forms.length) {
      for (const f of Object.values(FORMS)) await DB.saveForm({ id: f.id, slug: f.slug, name: f.name, fields: f.fields, settings: {}, published: true });
      B.forms = await DB.listForms();
    }
  } catch (e) { fail(e); }
  if (!el.isConnected) return;
  if (id) { const f = B.forms.find((x) => x.id === id); if (f) return openEditor(el, structuredClone(f)); }
  B.editing = null;
  const since = Date.now() - 30 * 86400000;
  const LP = { trafego: 'Landing de tráfego', marketplace: 'Landing de marketplace', home: 'Página inicial' };
  el.innerHTML = `
    <div class="topline"><h1>Formulários</h1><div class="grow"></div><button class="b b-primary" data-new>+ Novo formulário</button></div>
    <div class="forms-list">${B.forms.map((f) => {
      const leads = S.leads.filter((l) => l.form_id === f.id && new Date(l.created_at) >= since).length;
      return `<article class="panel form-row" data-id="${f.id}">
        <div class="fr-main">
          <h3>${esc(f.name)}</h3>
          <div class="chips">
            ${f.published ? '<span class="chip form">Publicado</span>' : '<span class="chip">Rascunho</span>'}
            ${LP[f.id] ? `<span class="chip paid">${LP[f.id]}</span>` : ''}
            <span class="chip">${num(leads)} lead${leads === 1 ? '' : 's'} em 30 dias</span>
          </div>
        </div>
        <div class="fr-actions">
          <button class="b" data-copy-link>${ICON.link}Copiar link</button>
          <button class="b b-primary" data-edit>${ICON.edit}Editar</button>
          <button class="icon-btn" data-more data-pop-anchor aria-label="Mais opções">${ICON.dotsH}</button>
        </div>
      </article>`;
    }).join('')}</div>`;

  el.querySelector('[data-new]').addEventListener('click', () => newFormModal(el));
  el.querySelectorAll('.form-row').forEach((card) => {
    const f = B.forms.find((x) => x.id === card.dataset.id);
    card.querySelector('[data-edit]').addEventListener('click', () => { go('formularios?id=' + f.id); });
    card.querySelector('[data-copy-link]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(formUrl(f)); toast('Link copiado'); } catch (e) { toast('Não consegui copiar', true); } });
    card.querySelector('[data-more]').addEventListener('click', (e) => menu(e.currentTarget, [
      { label: 'Abrir formulário', action: () => window.open(formUrl(f), '_blank', 'noopener') },
      { label: f.published ? 'Despublicar' : 'Publicar', action: async () => {
        try { f.published = !f.published; await DB.saveForm({ id: f.id, published: f.published, slug: f.slug, name: f.name }); toast(f.published ? 'Formulário publicado' : 'Formulário despublicado'); renderBuilder(el); } catch (err) { fail(err); }
      } },
      { label: 'Duplicar', action: async () => {
        const base = slugify(f.slug || f.id) + '-copia'; let slug = base; let n = 2;
        while (B.forms.some((x) => x.slug === slug || x.id === slug)) slug = base + '-' + n++;
        try { await DB.saveForm({ id: slug, slug, name: f.name + ' (cópia)', fields: f.fields, settings: f.settings, published: false }); toast('Cópia criada como rascunho'); renderBuilder(el); } catch (err) { fail(err); }
      } },
      { sep: true },
      { label: 'Excluir', danger: true, action: async () => {
        if (!(await confirmBox(`Excluir o formulário "${f.name}"? Os leads que ele já trouxe continuam no CRM.`, 'Excluir'))) return;
        try { await DB.deleteForm(f.id); toast('Formulário excluído'); renderBuilder(el); } catch (err) { fail(err); }
      } }
    ]));
  });
}

function newFormModal(el) {
  const templates = [['blank', 'Em branco', 'Boas-vindas, nome, WhatsApp e tela final'], ...Object.values(FORMS).map((f) => [f.id, f.name, `${f.fields.filter((x) => QUESTION.includes(x.type)).length} perguntas`])];
  modal(`<h3>Novo formulário</h3>
    <div class="row"><label class="lbl">Nome</label><input class="inp" data-name maxlength="120" placeholder="Ex: Diagnóstico Marketplace"></div>
    <div class="row"><label class="lbl">Endereço</label><div class="slug-in"><span>${esc(SITE.replace(/^https?:\/\//, ''))}/aplicar/</span><input class="inp" data-slug maxlength="40" placeholder="diagnostico-marketplace"></div></div>
    <div class="row"><label class="lbl">Começar de</label><div class="tpl-list">${templates.map(([id, n, d], i) => `<label class="tpl"><input type="radio" name="tpl" value="${id}" ${i ? '' : 'checked'}><span><b>${esc(n)}</b><small>${esc(d)}</small></span></label>`).join('')}</div></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Criar e editar</button></div>`, (c, close) => {
    const nameI = c.querySelector('[data-name]'); const slugI = c.querySelector('[data-slug]');
    let touched = false;
    nameI.addEventListener('input', () => { if (!touched) slugI.value = slugify(nameI.value); });
    slugI.addEventListener('input', () => { touched = true; slugI.value = slugify(slugI.value); });
    c.querySelector('[data-ok]').addEventListener('click', async () => {
      const name = nameI.value.trim(); const slug = slugify(slugI.value);
      if (!name) return toast('Dê um nome ao formulário', true);
      if (slug.length < 2) return toast('O endereço precisa de pelo menos 2 letras', true);
      if (B.forms.some((f) => f.slug === slug || f.id === slug) || ['trafego', 'marketplace', 'diagnostico'].includes(slug) && B.forms.some((f) => f.slug === slug)) return toast('Já existe um formulário com esse endereço', true);
      const tpl = c.querySelector('input[name=tpl]:checked').value;
      const fields = tpl === 'blank' ? [blankField('welcome'), { ...blankField('short_text'), id: 'nome', title: 'Qual o seu nome e sobrenome?', map: 'nome' }, { ...blankField('phone'), id: 'whatsapp' }, { ...blankField('thankyou'), id: 'obrigado' }]
        : structuredClone(FORMS[tpl].fields);
      try {
        const f = await DB.saveForm({ id: slug, slug, name, fields, settings: {}, published: false });
        close(); go('formularios?id=' + f.id);
      } catch (e) { fail(e); }
    });
  });
}

// ============================================================
// EDITOR
// ============================================================
function openEditor(el, form) {
  B.editing = form; B.sel = form.fields[0]?.id || null; B.dirty = false; B.frameReady = false;
  form.settings = form.settings || {};
  el.innerHTML = `
    <div class="bld">
      <header class="bld-top">
        <a class="b b-ghost" href="/formularios" data-back>${ICON.back}Formulários</a>
        <input class="bld-name" data-fname value="${esc(form.name)}" maxlength="120" aria-label="Nome do formulário">
        <span class="bld-status" data-status>${form.published ? '<span class="pill good">Publicado</span>' : '<span class="pill">Rascunho</span>'}</span>
        <div class="grow"></div>
        <span class="bld-saved muted" data-saved>Salvo</span>
        <button class="b b-ic" data-settings>${TI.gear}Configurações</button>
        <a class="b" href="${esc(formUrl(form))}" target="_blank" rel="noopener" data-open>${TI.external}Abrir</a>
        <button class="b b-primary" data-publish>${form.published ? 'Salvar' : 'Publicar'}</button>
      </header>
      <div class="bld-body">
        <aside class="bld-steps"><div class="bld-steps-h"><b>Etapas</b><button class="b b-sm b-primary" data-add data-pop-anchor>+ Adicionar</button></div><ol data-list></ol></aside>
        <section class="bld-preview">
          <div class="bld-dev"><button class="b b-sm ${B.device === 'desktop' ? 'on' : ''}" data-dev="desktop">${TI.desktop}Computador</button><button class="b b-sm ${B.device === 'mobile' ? 'on' : ''}" data-dev="mobile">${TI.phone}Celular</button></div>
          <div class="bld-frame ${B.device}"><iframe title="Prévia do formulário" src="${esc(new URL('/aplicar/?preview=1', SITE).toString())}" data-frame></iframe></div>
        </section>
        <aside class="bld-props" data-props></aside>
      </div>
    </div>`;

  const frame = el.querySelector('[data-frame]');
  const onMsg = (e) => { if (e.source === frame.contentWindow && e.data?.type === 'tracto-preview-ready') { B.frameReady = true; pushPreview(); } };
  addEventListener('message', onMsg);
  const stopWatch = () => removeEventListener('message', onMsg);
  window.addEventListener('tracto:nav', () => { stopWatch(); if (B.dirty) save(); }, { once: true });

  el.querySelector('[data-fname]').addEventListener('input', (e) => { form.name = e.target.value; changed(false); });
  el.querySelector('[data-settings]').addEventListener('click', () => settingsModal(form));
  el.querySelector('[data-publish]').addEventListener('click', async () => {
    const err = validateForm(form); if (err) return toast(err, true);
    form.published = true; await save(true);
    el.querySelector('[data-status]').innerHTML = '<span class="pill good">Publicado</span>';
    el.querySelector('[data-publish]').textContent = 'Salvar';
  });
  el.querySelectorAll('[data-dev]').forEach((b) => b.addEventListener('click', () => {
    B.device = b.dataset.dev; el.querySelectorAll('[data-dev]').forEach((x) => x.classList.toggle('on', x === b));
    el.querySelector('.bld-frame').className = 'bld-frame ' + B.device;
  }));
  el.querySelector('[data-add]').addEventListener('click', (e) => addMenu(e.currentTarget));
  renderSteps(); renderProps();
}

function pushPreview() {
  const f = B.editing; if (!f || !B.frameReady) return;
  const frame = $('[data-frame]'); if (!frame) return;
  frame.contentWindow.postMessage({ type: 'tracto-preview', form: { id: f.id, name: f.name, fields: f.fields, settings: f.settings }, step: B.sel }, '*');
}

function changed(preview = true) {
  B.dirty = true;
  const s = $('[data-saved]'); if (s) { s.textContent = 'Salvando…'; s.classList.remove('ok'); }
  clearTimeout(B.saveT); B.saveT = setTimeout(() => save(), 900);
  if (preview) { clearTimeout(B.pvT); B.pvT = setTimeout(pushPreview, 250); }
}
async function save(explicit = false) {
  const f = B.editing; if (!f) return;
  clearTimeout(B.saveT);
  try {
    await DB.saveForm({ id: f.id, slug: f.slug, name: f.name.trim() || 'Sem nome', fields: f.fields, settings: f.settings, published: f.published });
    B.dirty = false;
    const s = $('[data-saved]'); if (s) { s.innerHTML = `${TI.check}Salvo`; s.classList.remove('ok'); void s.offsetWidth; s.classList.add('ok'); }
    if (explicit) toast(f.published ? 'Formulário publicado' : 'Salvo');
  } catch (e) { const s = $('[data-saved]'); if (s) s.textContent = 'Erro ao salvar'; fail(e); }
}
function validateForm(f) {
  const ids = new Set(f.fields.map((x) => x.id));
  if (!f.fields.some((x) => QUESTION.includes(x.type))) return 'Adicione pelo menos uma pergunta';
  if (!f.fields.some((x) => x.type === 'thankyou')) return 'Adicione uma tela final';
  if (!f.fields.some((x) => x.map === 'nome') || !f.fields.some((x) => x.map === 'whatsapp')) return 'O formulário precisa salvar Nome e WhatsApp (em "Salvar no CRM como")';
  for (const x of f.fields) {
    for (const r of x.logic || []) if (!ids.has(r.jump)) return `A regra da etapa "${strip(x.title).slice(0, 30)}" aponta pra uma etapa que não existe`;
    if (x.next && !ids.has(x.next)) return `A etapa "${strip(x.title).slice(0, 30)}" aponta pra uma etapa que não existe`;
    if (['choice', 'multi', 'dropdown'].includes(x.type) && !(x.options || []).filter(Boolean).length) return `A pergunta "${strip(x.title).slice(0, 30)}" precisa de opções`;
  }
  return '';
}

// ---------- lista de etapas ----------
function renderSteps() {
  const f = B.editing; const list = $('[data-list]'); if (!list) return;
  let n = 0;
  list.innerHTML = f.fields.map((x, i) => {
    const isQ = QUESTION.includes(x.type); if (isQ) n++;
    const t = TYPES[x.type] || [x.type, '', TI.statement];
    const flags = [x.showIf ? `<span title="Aparece só sob condição">${ICON.branch}</span>` : '', x.logic?.length || x.next ? `<span title="Tem regra de salto">${ICON.jump}</span>` : '', x.required ? '<span title="Obrigatória">*</span>' : ''].join('');
    return `<li class="bld-step ${x.id === B.sel ? 'on' : ''} t-${x.type}" draggable="true" data-id="${x.id}">
      <span class="bs-ic">${t[2]}</span><span class="bs-n">${isQ ? n : ''}</span>
      <span class="bs-t">${esc(strip(x.title || x.quote || t[0]).slice(0, 60) || t[0])}</span><span class="bs-f">${flags}</span></li>`;
  }).join('');
  list.querySelectorAll('.bld-step').forEach((li) => {
    li.addEventListener('click', () => { B.sel = li.dataset.id; renderSteps(); renderProps(); pushPreview(); });
    li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', li.dataset.id); li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drop'); });
    li.addEventListener('dragleave', () => li.classList.remove('drop'));
    li.addEventListener('drop', (e) => {
      e.preventDefault(); li.classList.remove('drop');
      const from = f.fields.findIndex((x) => x.id === e.dataTransfer.getData('text/plain'));
      const to = f.fields.findIndex((x) => x.id === li.dataset.id);
      if (from < 0 || from === to) return;
      const [m] = f.fields.splice(from, 1); f.fields.splice(to, 0, m);
      renderSteps(); changed();
    });
  });
}

function addMenu(anchor) {
  const groups = {};
  Object.entries(TYPES).forEach(([k, [n, g, ic]]) => { (groups[g] = groups[g] || []).push([k, n, ic]); });
  popover(anchor, Object.entries(groups).map(([g, items]) => `<div class="ph">${g}</div>${items.map(([k, n, ic]) => `<button class="pi" data-t="${k}"><span class="bs-ic sm">${ic}</span>${n}</button>`).join('')}`).join(''), (p) => {
    p.classList.add('pop-wide');
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      closePop();
      const f = B.editing; const nf = blankField(b.dataset.t);
      // entra depois da etapa selecionada, antes das telas finais
      let at = f.fields.findIndex((x) => x.id === B.sel) + 1;
      const firstEnd = f.fields.findIndex((x) => x.type === 'thankyou');
      if (nf.type !== 'thankyou' && firstEnd >= 0 && at > firstEnd) at = firstEnd;
      if (nf.type === 'welcome') at = 0;
      if (at <= 0 && nf.type !== 'welcome') at = f.fields[0]?.type === 'welcome' ? 1 : 0;
      f.fields.splice(at, 0, nf);
      B.sel = nf.id; renderSteps(); renderProps(); changed();
    });
  });
}

// ---------- painel de propriedades ----------
function renderProps() {
  const f = B.editing; const box = $('[data-props]'); if (!box) return;
  const x = f.fields.find((y) => y.id === B.sel);
  if (!x) { box.innerHTML = '<p class="muted" style="padding:18px">Escolha uma etapa.</p>'; return; }
  const t = TYPES[x.type] || [x.type];
  const isQ = QUESTION.includes(x.type);
  const tabs = isQ || x.type === 'statement' || x.type === 'testimonial' ? ['conteudo', 'logica'] : ['conteudo'];
  if (!tabs.includes(B.tab)) B.tab = 'conteudo';
  const others = f.fields.filter((y) => y.id !== x.id);
  const qBefore = f.fields.slice(0, f.fields.indexOf(x)).filter((y) => QUESTION.includes(y.type));
  const inp = (k, label, v, extra = '') => `<div class="row"><label class="lbl">${label}</label><input class="inp" data-k="${k}" value="${esc(v ?? '')}" ${extra}></div>`;
  const area = (k, label, v, rows = 2, help = '') => `<div class="row"><div class="rte-head"><label class="lbl">${label}</label><div class="rte-bar"><button type="button" data-cmd="bold" title="Negrito"><b>N</b></button><button type="button" data-cmd="italic" title="Itálico (destaque dourado)"><i>I</i></button><button type="button" class="rte-ins" data-ins data-pop-anchor title="Inserir resposta">+ Resposta</button></div></div>
    <div class="inp rte" contenteditable="true" role="textbox" aria-multiline="true" data-rk="${k}" style="min-height:${rows * 22 + 18}px">${withTokens(sanitizeRich(String(v ?? '').replace(/\n/g, '<br>')), f.fields)}</div>${help ? `<p class="help">${help}</p>` : ''}</div>`;
  // seletor visual de ícone do botão
  const iconPick = (k, cur, auto) => `<div class="row"><label class="lbl">Ícone do botão</label><div class="icon-pick" role="radiogroup">
    ${auto ? `<button type="button" class="ip ${!cur ? 'on' : ''}" data-icon-k="${k}" data-icon="" role="radio" aria-checked="${!cur}" title="Automático"><span class="ip-auto">Auto</span></button>` : ''}
    <button type="button" class="ip ${cur === 'none' ? 'on' : ''}" data-icon-k="${k}" data-icon="none" role="radio" aria-checked="${cur === 'none'}" title="Sem ícone"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/></svg></button>
    ${Object.entries(BTN_ICONS).map(([ik, [n, svg]]) => `<button type="button" class="ip ${cur === ik ? 'on' : ''}" data-icon-k="${k}" data-icon="${ik}" role="radio" aria-checked="${cur === ik}" title="${n}">${svg}</button>`).join('')}
  </div>${auto ? '<p class="help">Automático: ícone do WhatsApp em links do WhatsApp e seta nos demais.</p>' : ''}</div>`;
  const tog = (k, label, v) => `<label class="bld-tog"><span>${label}</span><button type="button" class="switch ${v ? 'on' : ''}" data-tog="${k}"></button></label>`;
  let html = '';
  if (B.tab === 'conteudo') {
    html += x.type === 'testimonial'
      ? inp('title', 'Chamada (opcional)', x.title) + area('quote', 'Depoimento', x.quote, 3) + inp('author', 'Nome', x.author) + inp('role', 'Cargo, empresa ou cidade', x.role) + imageRow('photo', 'Foto', x.photo) +
        `<div class="row"><label class="lbl">Estrelas</label><select class="inp" data-k="rating">${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${+x.rating === n ? 'selected' : ''}>${n ? n + (n === 1 ? ' estrela' : ' estrelas') : 'Sem estrelas'}</option>`).join('')}</select></div>`
      : area('title', 'Título', x.title, 2, 'Use "+ Resposta" pra chamar a pessoa pelo nome ou repetir uma resposta anterior.') + area('desc', 'Descrição', x.desc, 2);
    if (x.type !== 'thankyou') html += imageRow('image', 'Imagem (opcional)', x.image);
    if (x.type === 'welcome' || x.type === 'statement' || x.type === 'testimonial') html += inp('button', 'Texto do botão', x.button) + iconPick('icon', x.icon || (x.type === 'welcome' ? 'arrow' : 'none'));
    if (isQ) html += tog('required', 'Obrigatória', x.required);
    if (['short_text', 'long_text', 'email', 'number', 'url'].includes(x.type)) html += inp('placeholder', 'Texto de exemplo (placeholder)', x.placeholder, 'placeholder="Sua resposta..."');
    if (x.type === 'short_text') html += tog('instagram', 'É um @ do Instagram (limpa @, espaços e link)', x.transform === 'instagram');
    if (x.type === 'email') html += tog('business', 'Exigir e-mail de trabalho (recusa Gmail, Hotmail…)', x.business);
    if (['choice', 'multi', 'dropdown'].includes(x.type)) html += optionsEditor(x);
    if (x.type === 'multi') html += `<div class="grid2">${inp('min', 'Mínimo', x.min, 'type="number" min="0"')}${inp('max', 'Máximo', x.max, 'type="number" min="0"')}</div>`;
    if (x.type === 'scale') html += `<div class="grid2">${inp('min', 'De', x.min ?? 0, 'type="number"')}${inp('max', 'Até', x.max ?? 10, 'type="number"')}</div><div class="grid2">${inp('label0', 'Legenda do início', x.labels?.[0])}${inp('label1', 'Legenda do fim', x.labels?.[1])}</div>`;
    if (x.type === 'number') html += `<div class="grid2">${inp('min', 'Mínimo', x.min, 'type="number"')}${inp('max', 'Máximo', x.max, 'type="number"')}</div>`;
    if (x.type === 'long_text') html += inp('maxLength', 'Limite de caracteres', x.maxLength, 'type="number" min="10"');
    if (x.type === 'consent') html += inp('label', 'Texto do aceite', x.label);
    if (x.type === 'file') html += inp('accept', 'Tipos aceitos', x.accept, 'placeholder=".pdf,.png,.jpg ou image/*"') + inp('maxMb', 'Tamanho máximo (MB, até 50)', x.maxMb, 'type="number" min="1" max="50"');
    if (x.type === 'calendly') html += inp('url', 'Link do Calendly', x.url, 'placeholder="https://calendly.com/sua-conta/reuniao"') + '<p class="help">Nome e e-mail já respondidos entram preenchidos no agendamento. Quando a pessoa agenda, o formulário avança sozinho.</p>';
    if (x.type === 'thankyou') {
      html += `<h4 class="px-h" style="margin-top:14px">Botão</h4><div class="grid2">${inp('cta_label', 'Texto', x.cta?.label)}${inp('cta_href', 'Link', x.cta?.href, 'placeholder="https://wa.me/55…"')}</div>${iconPick('cta_icon', x.cta?.icon || '', true)}
        <h4 class="px-h" style="margin-top:14px">Redirecionar ao final</h4>${inp('redir_url', 'Link', x.redirect?.url, 'placeholder="https://… (deixe vazio pra não redirecionar)"')}${inp('redir_delay', 'Depois de quantos segundos', x.redirect?.delay ?? 5, 'type="number" min="0" max="60"')}`;
    }
    if (isQ && x.type !== 'file' && x.type !== 'calendly') html += `<div class="row"><label class="lbl">Salvar no CRM como</label><select class="inp" data-k="map">${MAPS.map(([k, n]) => `<option value="${k}" ${(x.map || '') === k ? 'selected' : ''}>${n}</option>`).join('')}</select><p class="help">Nome, WhatsApp e e-mail alimentam o lead e a correspondência dos pixels.</p></div>`;
  } else {
    html += `<h4 class="px-h">Mostrar esta etapa</h4>
      <div class="row"><select class="inp" data-showmode><option value="always" ${!x.showIf ? 'selected' : ''}>Sempre</option><option value="if" ${x.showIf ? 'selected' : ''}>Só se…</option></select></div>
      ${x.showIf ? condEditor(x.showIf, qBefore, 'show') : ''}
      <h4 class="px-h" style="margin-top:18px">Depois desta etapa</h4>
      <div data-rules>${(x.logic || []).map((r, i) => `<div class="rule" data-i="${i}"><div class="rule-h">Regra ${i + 1}<button class="b b-sm b-ghost" data-rm-rule="${i}" aria-label="Remover">×</button></div>
        ${condEditor(r.if, [...qBefore, ...(isQ ? [x] : [])], 'rule' + i)}
        <div class="row"><label class="lbl">Ir para</label><select class="inp" data-jump="${i}">${others.map((o) => `<option value="${o.id}" ${r.jump === o.id ? 'selected' : ''}>${esc((TYPES[o.type] || [''])[0] + ': ' + strip(o.title || o.quote).slice(0, 40))}</option>`).join('')}</select></div></div>`).join('')}</div>
      <button class="b b-sm" data-add-rule>+ Adicionar regra</button>
      <div class="row" style="margin-top:14px"><label class="lbl">Se nenhuma regra valer, ir para</label><select class="inp" data-next><option value="">Próxima etapa da lista</option>${others.map((o) => `<option value="${o.id}" ${x.next === o.id ? 'selected' : ''}>${esc((TYPES[o.type] || [''])[0] + ': ' + strip(o.title || o.quote).slice(0, 40))}</option>`).join('')}</select></div>`;
  }
  const pk = B.sel + '|' + B.tab;
  if (renderProps._k !== pk) { renderProps._k = pk; box.classList.remove('swap-in'); void box.offsetWidth; box.classList.add('swap-in'); }
  box.innerHTML = `
    <div class="bp-h"><span class="bs-ic">${t[2] || TI.statement}</span><b>${esc(t[0])}</b><div class="grow"></div>
      <button class="card-menu" data-step-more data-pop-anchor aria-label="Ações da etapa">${ICON.dotsH}</button></div>
    ${tabs.length > 1 ? `<div class="bp-tabs">${tabs.map((k) => `<button class="${B.tab === k ? 'on' : ''}" data-tab="${k}">${k === 'conteudo' ? 'Conteúdo' : 'Lógica'}</button>`).join('')}</div>` : ''}
    <div class="bp-body">${html}</div>`;
  bindProps(box, x);
}

function imageRow(k, label, v) {
  return `<div class="row"><label class="lbl">${label}</label><div class="img-row">${v ? `<img src="${esc(v)}" alt="">` : ''}<input class="inp" data-k="${k}" value="${esc(v && !String(v).startsWith('data:') ? v : '')}" placeholder="${v?.startsWith?.('data:') ? 'Imagem enviada' : 'https://… ou envie'}"><label class="b b-sm">Enviar<input type="file" accept="image/*" data-up="${k}" hidden></label>${v ? `<button class="b b-sm b-ghost" data-clear="${k}" aria-label="Remover">×</button>` : ''}</div></div>`;
}
function optionsEditor(x) {
  return `<div class="row"><label class="lbl">Opções</label><div class="opts" data-opts>${(x.options || []).map((o, i) => `<div class="opt"><span class="opt-k">${String.fromCharCode(65 + i)}</span><input class="inp" data-opt="${i}" value="${esc(o)}"><button class="b b-sm b-ghost" data-opt-up="${i}" ${i ? '' : 'disabled'} aria-label="Subir">${ICON.up}</button><button class="b b-sm b-ghost" data-opt-rm="${i}" aria-label="Remover">×</button></div>`).join('')}</div>
    <button class="b b-sm" data-opt-add>+ Opção</button>${x.type === 'choice' ? `<label class="bld-tog" style="margin-top:10px"><span>Opção "Outro" com texto livre</span><button type="button" class="switch ${x.other ? 'on' : ''}" data-tog="other"></button></label>` : ''}</div>`;
}
function condEditor(cond, fields, key) {
  const list = cond?.all || cond?.any || (cond ? [cond] : []);
  const mode = cond?.any ? 'any' : 'all';
  if (!fields.length) return '<p class="help">Não há perguntas antes desta etapa pra usar na condição.</p>';
  return `<div class="cond" data-cond="${key}">
    ${list.length > 1 ? `<select class="inp cond-mode" data-cmode><option value="all" ${mode === 'all' ? 'selected' : ''}>Todas as condições</option><option value="any" ${mode === 'any' ? 'selected' : ''}>Qualquer condição</option></select>` : ''}
    ${list.map((c, i) => {
      const fld = fields.find((y) => y.id === c.field) || fields[0];
      const opts = fld.type === 'yes_no' ? ['Sim', 'Não'] : fld.options || null;
      const val = Array.isArray(c.value) ? c.value : c.value != null ? [c.value] : [];
      return `<div class="cond-row" data-ci="${i}">
        <select class="inp" data-cf>${fields.map((y) => `<option value="${y.id}" ${y.id === fld.id ? 'selected' : ''}>${esc(strip(y.title).slice(0, 36))}</option>`).join('')}</select>
        <select class="inp" data-co>${OPS.map(([k, n]) => `<option value="${k}" ${c.op === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
        ${['filled', 'empty'].includes(c.op) ? '' : opts && ['is', 'is_not', 'in', 'includes'].includes(c.op)
          ? `<div class="cond-vals">${opts.map((o) => `<label><input type="checkbox" data-cv value="${esc(o)}" ${val.includes(o) ? 'checked' : ''}>${esc(o)}</label>`).join('')}</div>`
          : `<input class="inp" data-cvt value="${esc(val.join(', '))}" placeholder="valor">`}
        ${list.length > 1 ? `<button class="b b-sm b-ghost" data-crm="${i}" aria-label="Remover condição">×</button>` : ''}
      </div>`;
    }).join('')}
    <button class="b b-sm b-ghost" data-cadd>+ condição</button></div>`;
}
function readCond(box, fields) {
  const rows = [...box.querySelectorAll('.cond-row')].map((r) => {
    const field = r.querySelector('[data-cf]').value; const op = r.querySelector('[data-co]').value;
    const fld = fields.find((y) => y.id === field);
    let value;
    const checks = [...r.querySelectorAll('[data-cv]:checked')].map((c) => c.value);
    const txt = r.querySelector('[data-cvt]')?.value;
    if (r.querySelector('[data-cv]')) value = ['in', 'includes'].includes(op) ? checks : checks[0];
    else if (txt != null) value = ['gte', 'lte', 'gt', 'lt'].includes(op) || ['scale', 'rating', 'number'].includes(fld?.type) ? Number(txt) : ['in', 'includes'].includes(op) ? txt.split(',').map((v) => v.trim()).filter(Boolean) : txt.trim();
    return ['filled', 'empty'].includes(op) ? { field, op } : { field, op, value };
  });
  if (rows.length <= 1) return rows[0] || null;
  return { [box.querySelector('[data-cmode]')?.value === 'any' ? 'any' : 'all']: rows };
}

function bindProps(box, x) {
  const f = B.editing;
  const qBefore = f.fields.slice(0, f.fields.indexOf(x)).filter((y) => QUESTION.includes(y.type));
  const refresh = () => { renderSteps(); renderProps(); changed(); };
  box.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { B.tab = b.dataset.tab; renderProps(); }));
  box.querySelector('[data-step-more]').addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'Duplicar etapa', action: () => { const c = { ...structuredClone(x), id: newId(x.type) }; delete c.map; f.fields.splice(f.fields.indexOf(x) + 1, 0, c); B.sel = c.id; refresh(); } },
    { label: 'Mover pra cima', action: () => { const i = f.fields.indexOf(x); if (i > 0) { [f.fields[i - 1], f.fields[i]] = [f.fields[i], f.fields[i - 1]]; refresh(); } } },
    { label: 'Mover pra baixo', action: () => { const i = f.fields.indexOf(x); if (i < f.fields.length - 1) { [f.fields[i + 1], f.fields[i]] = [f.fields[i], f.fields[i + 1]]; refresh(); } } },
    { sep: true },
    { label: 'Excluir etapa', danger: true, action: async () => {
      const used = f.fields.some((y) => y !== x && ((y.logic || []).some((r) => r.jump === x.id || JSON.stringify(r.if).includes(`"${x.id}"`)) || y.next === x.id || JSON.stringify(y.showIf || {}).includes(`"${x.id}"`)));
      if (used && !(await confirmBox('Outras etapas usam esta em regras de fluxo. As regras que apontam pra ela vão ser removidas. Excluir mesmo assim?', 'Excluir'))) return;
      f.fields.forEach((y) => { y.logic = (y.logic || []).filter((r) => r.jump !== x.id && !JSON.stringify(r.if).includes(`"${x.id}"`)); if (!y.logic.length) delete y.logic; if (y.next === x.id) delete y.next; if (JSON.stringify(y.showIf || {}).includes(`"${x.id}"`)) delete y.showIf; });
      const i = f.fields.indexOf(x); f.fields.splice(i, 1); B.sel = f.fields[Math.max(0, i - 1)]?.id; refresh();
    } }
  ]));

  // ícone dos botões
  box.querySelectorAll('[data-icon-k]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.iconK; const v = b.dataset.icon;
    if (k === 'cta_icon') { x.cta = x.cta || {}; if (v) x.cta.icon = v; else delete x.cta.icon; } else x.icon = v;
    b.parentElement.querySelectorAll('.ip').forEach((o) => { o.classList.toggle('on', o === b); o.setAttribute('aria-checked', o === b); });
    changed();
  }));
  // conteúdo
  box.querySelectorAll('[data-k]').forEach((i) => i.addEventListener('input', () => {
    const k = i.dataset.k; let v = i.value;
    if (['min', 'max', 'maxLength', 'maxMb', 'rating'].includes(k)) v = v === '' ? undefined : Number(v);
    if (k === 'maxMb' && v > 50) v = 50;
    if (k === 'map') { f.fields.forEach((y) => { if (y !== x && y.map === v && v) delete y.map; }); v = v || undefined; }
    if (k === 'label0' || k === 'label1') { x.labels = x.labels || ['', '']; x.labels[k === 'label0' ? 0 : 1] = v; }
    else if (k === 'cta_label' || k === 'cta_href') { x.cta = x.cta || {}; x.cta[k === 'cta_label' ? 'label' : 'href'] = v; if (!x.cta.label && !x.cta.href) delete x.cta; }
    else if (k === 'redir_url' || k === 'redir_delay') { x.redirect = x.redirect || {}; if (k === 'redir_url') x.redirect.url = v.trim(); else x.redirect.delay = Math.max(0, Math.min(60, Number(v) || 0)); if (!x.redirect.url) delete x.redirect; }
    else if (v === '' || v === undefined) delete x[k]; else x[k] = v;
    if (k === 'title' || k === 'quote') renderSteps();
    changed();
  }));
  box.querySelectorAll('[data-tog]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.tog; const on = !b.classList.contains('on'); b.classList.toggle('on', on);
    if (k === 'instagram') { if (on) x.transform = 'instagram'; else delete x.transform; }
    else if (on) x[k] = true; else delete x[k];
    if (k === 'required') renderSteps();
    changed();
  }));
  box.querySelectorAll('[data-up]').forEach((up) => up.addEventListener('change', async () => {
    const file = up.files[0]; if (!file) return;
    try { x[up.dataset.up] = await DB.uploadMedia(file); renderProps(); changed(); toast('Imagem enviada'); } catch (e) { fail(e); }
  }));
  box.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => { delete x[b.dataset.clear]; renderProps(); changed(); }));
  // texto rico
  box.querySelectorAll('[data-rk]').forEach((ed) => {
    ed.addEventListener('input', () => {
      const v = sanitizeRich(ed.innerHTML);
      if (v) x[ed.dataset.rk] = v; else delete x[ed.dataset.rk];
      if (ed.dataset.rk === 'title' || ed.dataset.rk === 'quote') renderSteps();
      changed();
    });
    ed.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
  });
  box.querySelectorAll('[data-ins]').forEach((b) => b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const ed = b.closest('.row').querySelector('[data-rk]');
    const sel = window.getSelection(); const range = sel.rangeCount && ed.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    const prev = f.fields.slice(0, f.fields.indexOf(x)).filter((y) => QUESTION.includes(y.type) && y.type !== 'file');
    const opts = [...(prev.some((y) => y.map === 'nome') ? [['nome:first', 'Primeiro nome'], ['nome', 'Nome completo']] : []), ...prev.filter((y) => y.map !== 'nome').map((y) => [y.id, strip(y.title).slice(0, 40)])];
    if (!opts.length) return toast('Não há respostas antes desta etapa pra inserir', true);
    menu(b, opts.map(([tok, label]) => ({ label, action: () => {
      const chip = document.createElement('span'); chip.className = 'tok'; chip.contentEditable = 'false'; chip.dataset.tok = tok; chip.textContent = tokLabel(tok, f.fields);
      if (range) { range.deleteContents(); range.insertNode(chip); range.setStartAfter(chip); } else ed.appendChild(chip);
      ed.appendChild(document.createTextNode(' '));
      ed.dispatchEvent(new Event('input'));
    } })));
  }));
  box.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const ed = b.closest('.row').querySelector('[data-rk]'); ed.focus();
    document.execCommand(b.dataset.cmd); ed.dispatchEvent(new Event('input'));
  }));

  // opções
  box.querySelectorAll('[data-opt]').forEach((i) => i.addEventListener('input', () => { x.options[+i.dataset.opt] = i.value; changed(); }));
  box.querySelectorAll('[data-opt-rm]').forEach((b) => b.addEventListener('click', () => { x.options.splice(+b.dataset.optRm, 1); renderProps(); changed(); }));
  box.querySelectorAll('[data-opt-up]').forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.optUp; [x.options[i - 1], x.options[i]] = [x.options[i], x.options[i - 1]]; renderProps(); changed(); }));
  box.querySelector('[data-opt-add]')?.addEventListener('click', () => { x.options = [...(x.options || []), `Opção ${(x.options || []).length + 1}`]; renderProps(); changed(); setTimeout(() => { const all = box.querySelectorAll('[data-opt]'); all[all.length - 1]?.select(); }, 30); });

  // lógica: mostrar se…
  box.querySelector('[data-showmode]')?.addEventListener('change', (e) => {
    if (e.target.value === 'always') delete x.showIf;
    else if (qBefore.length) x.showIf = { field: qBefore[qBefore.length - 1].id, op: 'filled' };
    else { toast('Não há perguntas antes desta etapa', true); e.target.value = 'always'; return; }
    renderProps(); renderSteps(); changed();
  });
  const bindCond = (key, getSet, fields) => {
    const c = box.querySelector(`[data-cond="${key}"]`); if (!c) return;
    const upd = (rerender) => { getSet(readCond(c, fields)); if (rerender) renderProps(); renderSteps(); changed(); };
    c.querySelectorAll('[data-cf], [data-co], [data-cmode]').forEach((s) => s.addEventListener('change', () => {
      if (s.matches('[data-cf]')) { const row = s.closest('.cond-row'); row.querySelectorAll('[data-cv]').forEach((cb) => { cb.checked = false; }); const t = row.querySelector('[data-cvt]'); if (t) t.value = ''; }
      upd(true);
    }));
    c.querySelectorAll('[data-cv]').forEach((cb) => cb.addEventListener('change', () => upd(false)));
    c.querySelectorAll('[data-cvt]').forEach((t) => t.addEventListener('input', () => upd(false)));
    c.querySelector('[data-cadd]').addEventListener('click', () => {
      const cur = readCond(c, fields); const list = cur?.all || cur?.any || (cur ? [cur] : []);
      list.push({ field: fields[fields.length - 1].id, op: 'filled' });
      getSet({ all: list }); renderProps(); changed();
    });
    c.querySelectorAll('[data-crm]').forEach((b) => b.addEventListener('click', () => {
      const cur = readCond(c, fields); const list = cur?.all || cur?.any || []; list.splice(+b.dataset.crm, 1);
      getSet(list.length === 1 ? list[0] : { [cur.any ? 'any' : 'all']: list }); renderProps(); changed();
    }));
  };
  bindCond('show', (v) => { if (v) x.showIf = v; else delete x.showIf; }, qBefore);
  const ruleFields = [...qBefore, ...(QUESTION.includes(x.type) ? [x] : [])];
  (x.logic || []).forEach((r, i) => bindCond('rule' + i, (v) => { r.if = v; }, ruleFields));
  box.querySelectorAll('[data-jump]').forEach((s) => s.addEventListener('change', () => { x.logic[+s.dataset.jump].jump = s.value; changed(); }));
  box.querySelectorAll('[data-rm-rule]').forEach((b) => b.addEventListener('click', () => { x.logic.splice(+b.dataset.rmRule, 1); if (!x.logic.length) delete x.logic; renderProps(); renderSteps(); changed(); }));
  box.querySelector('[data-add-rule]')?.addEventListener('click', () => {
    if (!ruleFields.length) return toast('Não há perguntas pra usar na regra', true);
    const target = f.fields.find((y) => y.type === 'thankyou' && y !== x) || f.fields.find((y) => y !== x);
    x.logic = [...(x.logic || []), { if: { field: ruleFields[ruleFields.length - 1].id, op: 'filled' }, jump: target.id }];
    renderProps(); renderSteps(); changed();
  });
  box.querySelector('[data-next]')?.addEventListener('change', (e) => { if (e.target.value) x.next = e.target.value; else delete x.next; renderSteps(); changed(); });
}

// ---------- configurações do formulário ----------
function settingsModal(form) {
  const s = form.settings; const th = s.theme || {};
  modal(`<h3>Configurações do formulário</h3>
    <div class="row"><label class="lbl">Endereço</label><div class="slug-in"><span>${esc(SITE.replace(/^https?:\/\//, ''))}/aplicar/</span><input class="inp" data-slug value="${esc(form.slug)}" maxlength="40" ${['trafego', 'marketplace', 'diagnostico', ''].includes(form.slug) && Object.values(FORMS).some((x) => x.id === form.id) ? 'readonly title="Endereço usado nas landing pages"' : ''}></div></div>
    <div class="row"><label class="lbl">Título da aba do navegador</label><input class="inp" data-title value="${esc(s.title || '')}" placeholder="${esc(form.name)}"></div>
    <h4 class="px-h" style="margin-top:16px">Visual</h4>
    <div class="grid3">
      <div class="row"><label class="lbl">Cor principal</label><div class="color-in"><input type="color" data-c="primary" value="${th.primary || '#FFAD00'}"><code>${th.primary || '#FFAD00'}</code></div></div>
      <div class="row"><label class="lbl">Fundo</label><div class="color-in"><input type="color" data-c="bg" value="${th.bg || '#000000'}"><code>${th.bg || '#000000'}</code></div></div>
      <div class="row"><label class="lbl">Texto</label><div class="color-in"><input type="color" data-c="text" value="${th.text || '#FFFFFF'}"><code>${th.text || '#FFFFFF'}</code></div></div>
    </div>
    ${imageRow('logo', 'Logotipo (opcional)', th.logo)}
    <label class="bld-tog"><span>Remover a marca "Tracto Assessoria de Marketing" do rodapé</span><button type="button" class="switch ${s.hideBrand ? 'on' : ''}" data-st="hideBrand"></button></label>
    <label class="bld-tog"><span>Mostrar aviso de Política de Privacidade (LGPD)</span><button type="button" class="switch ${s.privacy !== false ? 'on' : ''}" data-st="privacy"></button></label>
    <h4 class="px-h" style="margin-top:16px">Urgência</h4>
    <div class="grid2"><div class="row"><label class="lbl">Timer (minutos, 0 = sem timer)</label><input class="inp" type="number" min="0" max="240" data-timer value="${s.timer?.minutes || 0}"></div>
      <div class="row"><label class="lbl">Texto do timer</label><input class="inp" data-timer-label value="${esc(s.timer?.label || 'Condição especial expira em')}"></div></div>
    <h4 class="px-h" style="margin-top:16px">Rastreamento</h4>
    <label class="bld-tog"><span>Pixels ativos neste formulário<small class="muted" style="display:block;font-size:12px;margin-top:2px">Meta, GA4, Google Ads e GTM cadastrados na aba Pixel, no navegador e pelo servidor. Ligado por padrão.</small></span><button type="button" class="switch ${s.pixels !== false ? 'on' : ''}" data-st="pixels"></button></label>
    <div class="row"><label class="lbl">Google Tag Manager deste formulário (opcional)</label><input class="inp" data-gtm value="${esc(s.gtm || '')}" placeholder="GTM-XXXXXXX"><p class="help">Os pixels da aba Pixel já valem pra todos os formulários. Use isto só se este formulário precisar de um contêiner GTM próprio.</p></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Aplicar</button></div>`, (c, close) => {
    const temp = { theme: { ...th }, hideBrand: s.hideBrand, privacy: s.privacy !== false, pixels: s.pixels !== false };
    c.querySelectorAll('[data-c]').forEach((i) => i.addEventListener('input', () => { temp.theme[i.dataset.c] = i.value.toUpperCase(); i.nextElementSibling.textContent = i.value.toUpperCase(); }));
    c.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); temp[b.dataset.st] = on; }));
    c.querySelector('[data-up="logo"]').addEventListener('change', async (e) => { try { temp.theme.logo = await DB.uploadMedia(e.target.files[0]); toast('Logo enviado'); } catch (err) { fail(err); } });
    c.querySelector('[data-k="logo"]').addEventListener('input', (e) => { temp.theme.logo = e.target.value.trim() || undefined; });
    c.querySelector('[data-clear="logo"]')?.addEventListener('click', () => { delete temp.theme.logo; toast('Logo removido ao aplicar'); });
    c.querySelector('[data-ok]').addEventListener('click', () => {
      const slug = slugify(c.querySelector('[data-slug]').value);
      if (slug !== form.slug && B.forms.some((f) => f.slug === slug && f.id !== form.id)) return toast('Já existe um formulário com esse endereço', true);
      const gtm = c.querySelector('[data-gtm]').value.trim().toUpperCase();
      if (gtm && !/^GTM-[A-Z0-9]{4,}$/.test(gtm)) return toast('O ID do GTM começa com GTM-', true);
      const minutes = Math.max(0, Math.min(240, Math.round(Number(c.querySelector('[data-timer]').value) || 0)));
      form.slug = slug;
      form.settings = {
        ...s, theme: Object.fromEntries(Object.entries(temp.theme).filter(([, v]) => v)), hideBrand: !!temp.hideBrand, privacy: temp.privacy, pixels: temp.pixels,
        title: c.querySelector('[data-title]').value.trim() || undefined, gtm: gtm || undefined,
        timer: minutes ? { minutes, label: c.querySelector('[data-timer-label]').value.trim() } : undefined
      };
      const open = $('[data-open]'); if (open) open.href = formUrl(form);
      close(); changed(); toast('Configurações aplicadas');
    });
  });
}
