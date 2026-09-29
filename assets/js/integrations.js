// Abas "Integrações" (API + webhooks) e "Pixel" (Meta Pixel + Conversions API)
import { DB, LIVE } from '@shared/db.js';
import { S, $, $$, esc, FAT, ICON, BRAND, num, pct, brl, fullDate, ago, toast, fail, modal, confirmBox, menu } from './util.js?v=2609282300';
import { hbars } from './dashboard.js?v=2609282300';
import { PIXEL_EVENTS_RECOMMENDED } from '@shared/db.js';

const EVENTS = [
  ['lead.created', 'Lead criado', 'form, API ou cadastro manual'],
  ['lead.stage_changed', 'Mudou de estágio', 'qualquer movimento no pipeline'],
  ['lead.won', 'Venda realizada', 'entrou num estágio do tipo Ganho'],
  ['lead.lost', 'Lead perdido', 'entrou num estágio do tipo Perdido'],
  ['lead.assigned', 'Responsável alterado', ''],
  ['lead.updated', 'Dados alterados', 'contato, valor, faturamento ou rótulos'],
  ['note.created', 'Nota adicionada', ''],
  ['lead.abandoned', 'Formulário abandonado', 'parou no meio e deixou contato (30 min sem responder)'],
  ['lead.recovered', 'Lead recuperado', 'formulário incompleto colocado no pipeline'],
  ['lead.deleted', 'Lead excluído', '']
];
const META_EVENTS = ['Lead', 'Contact', 'SubmitApplication', 'CompleteRegistration', 'Schedule', 'StartTrial', 'Subscribe', 'Purchase'];

const cfg = () => window.TRACTO_CONFIG || {};
const apiBase = () => (cfg().supabaseUrl || 'https://SEU-PROJETO.supabase.co').replace(/\/$/, '');
const anonKey = () => cfg().supabaseAnonKey || 'SUA_ANON_KEY';
const leadName = (id) => S.leads.find((l) => l.id === id)?.nome || (id ? 'lead removido' : '—');

function statusPill(code, response) {
  if (code === 0 && /demo/i.test(response || '')) return '<span class="pill">Demo</span>';
  if (code == null) return response ? `<span class="pill bad" title="${esc(response)}">Falhou</span>` : '<span class="pill wait">Enviando…</span>';
  if (code >= 200 && code < 300) return `<span class="pill good">${code}</span>`;
  return `<span class="pill bad" title="${esc(response || '')}">${code || 'Erro'}</span>`;
}
function codeBlock(code, label) {
  return `<div class="code">${label ? `<div class="code-h"><span>${esc(label)}</span><button class="b b-sm b-ghost" data-copy>Copiar</button></div>` : ''}<pre>${esc(code)}</pre></div>`;
}
function bindCopy(el) {
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const text = b.dataset.copy || b.closest('.code')?.querySelector('pre')?.textContent || '';
    try { await navigator.clipboard.writeText(text); toast('Copiado'); } catch (err) { toast('Não consegui copiar', true); }
  });
}
const demoNote = () => (LIVE ? '' : '<div class="demo-inline">Modo demo: nada é enviado de verdade. Os disparos aparecem nos logs como "Demo".</div>');

// ============================================================
// INTEGRAÇÕES
// ============================================================
export async function renderIntegrations(el, { quiet = false } = {}) {
  if (!quiet) el.innerHTML = '<div class="loading">Carregando…</div>';
  let keys = [], hooks = [], dels = [];
  try {
    await DB.refreshIntegrations();
    [keys, hooks, dels] = await Promise.all([DB.listApiKeys(), DB.listWebhooks(), DB.listDeliveries(60)]);
  } catch (e) { fail(e); }
  if (!el.isConnected) return;
  const hookName = (id) => hooks.find((w) => w.id === id)?.name || '—';

  const createEx = JSON.stringify({ api_key: 'trk_SUA_CHAVE', lead: { nome: 'João da Silva', whatsapp: '62999998888', email: 'joao@loja.com', instagram: 'lojadojoao', faturamento: 'De R$30.000 a R$50.000', estagio: 'Em análise', utm_source: 'google', utm_campaign: 'pesquisa-ferragens', respostas: [{ label: 'Como conheceu?', value: 'Indicação' }] } }, null, 2);
  const listEx = JSON.stringify({ api_key: 'trk_SUA_CHAVE', desde: '2026-09-01T00:00:00Z', limite: 100 }, null, 2);
  const updEx = JSON.stringify({ api_key: 'trk_SUA_CHAVE', lead_id: 'UUID_DO_LEAD', dados: { estagio: 'Reunião agendada', valor: 3500, nota: 'Agendou pelo Calendly', responsavel_email: 'luiz@assessoriatracto.com.br' } }, null, 2);
  const curl = (fn, body) => `curl -X POST '${apiBase()}/rest/v1/rpc/${fn}' \\\n  -H 'apikey: ${anonKey()}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
  const payloadEx = JSON.stringify({ id: 1234, evento: 'lead.stage_changed', enviado_em: '2026-09-26T14:02:11Z', dados: { lead: { id: 'b1f…', nome: 'Alves Roberto', whatsapp: '5513997974512', email: 'alves@loja.com', faturamento: 'De R$50.000 a R$100.000', estagio: { id: '…', nome: 'Reunião agendada', tipo: 'open' }, responsavel: { nome: 'Isaque', email: 'isaque@…' }, rotulos: ['Prioridade'], formulario: { id: 'trafego', nome: 'Assessoria Tracto - Tráfego Pago' }, fonte: 'pago', utm: { source: 'facebook', campaign: 'diagnostico' }, respostas: [{ label: 'Qual seu número de Whatsapp?', value: '+5513997974512' }] }, estagio_anterior: { nome: 'Qualificado' } } }, null, 2);
  const verifyEx = `// Node/Express: valide a assinatura com o corpo cru da requisição
import crypto from 'node:crypto';
app.post('/tracto', express.raw({ type: 'application/json' }), (req, res) => {
  const assinatura = req.get('X-Tracto-Signature');            // "sha256=…"
  const esperado = 'sha256=' + crypto.createHmac('sha256', process.env.TRACTO_SECRET)
    .update(req.body).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado))) return res.sendStatus(401);
  const { evento, dados } = JSON.parse(req.body);
  // … seu código
  res.sendStatus(200);
});`;

  el.innerHTML = `
    <div class="topline"><h1>Integrações</h1><div class="grow"></div><button class="b b-refresh" data-refresh>${ICON.refresh}Atualizar status</button></div>
    <div class="int-grid">
      <section class="panel int-card">
        <div class="int-h"><div><h3>API de leads</h3><p class="help">Crie, liste e atualize leads a partir de outros sistemas (Zapier, Make, n8n, planilhas, outra landing page).</p></div>
          <button class="b b-primary" data-new-key>+ Nova chave</button></div>
        ${keys.length ? `<div class="table-wrap"><table class="int-table"><thead><tr><th>Nome</th><th>Chave</th><th>Criada</th><th>Último uso</th><th></th></tr></thead><tbody>
          ${keys.map((k) => `<tr data-id="${k.id}" class="${k.revoked ? 'revoked' : ''}"><td>${esc(k.name)}</td><td><code>${esc(k.prefix)}…</code></td><td>${new Date(k.created_at).toLocaleDateString('pt-BR')}</td><td>${k.last_used_at ? ago(k.last_used_at) : '<span class="muted">nunca</span>'}</td>
            <td style="text-align:right">${k.revoked ? '<span class="pill">Revogada</span>' : '<button class="b b-sm b-danger" data-revoke>Revogar</button>'}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">Nenhuma chave criada ainda.</p>'}
        <div class="conn">
          <div class="conn-row"><span>Endereço da API</span><code>${esc(apiBase())}/rest/v1/rpc/api_create_lead</code><button class="b b-sm" data-copy="${esc(apiBase())}/rest/v1/rpc/api_create_lead">Copiar</button></div>
          <div class="conn-row"><span>Chave pública (header apikey)</span><code>${esc(anonKey().slice(0, 18))}…</code><button class="b b-sm" data-copy="${esc(anonKey())}">Copiar</button></div>
          <p class="help" style="margin:8px 0 0">Passe esses dados e uma chave criada aqui pra quem for configurar a integração (Zapier, Make, n8n). O guia completo está no repositório, em docs/api.md.</p>
        </div>
      </section>

      <section class="panel int-card">
        <div class="int-h"><div><h3>Webhooks</h3><p class="help">O CRM avisa outros sistemas na hora em que algo acontece com um lead. Cada envio é assinado com HMAC-SHA256.</p></div>
          <button class="b b-primary" data-new-hook>+ Novo webhook</button></div>
        ${hooks.length ? hooks.map((w) => `
          <div class="hook" data-id="${w.id}">
            <div class="hook-main">
              <div class="hook-title"><b>${esc(w.name)}</b>${w.format === 'pushcut' ? ' <span class="pill wait">Pushcut</span>' : ''}${w.active ? '' : ' <span class="pill">Pausado</span>'}</div>
              <div class="hook-url">${esc(w.url)}</div>
              <div class="chips">${w.events.map((ev) => `<span class="chip">${esc(EVENTS.find(([k]) => k === ev)?.[1] || ev)}</span>`).join('')}</div>
            </div>
            <div class="hook-actions">
              <button class="switch ${w.active ? 'on' : ''}" data-toggle aria-label="Ativo"></button>
              <button class="b b-sm" data-test>Testar</button>
              <button class="b b-sm" data-secret>Segredo</button>
              <button class="b b-sm" data-edit>Editar</button>
              <button class="b b-sm b-danger" data-del aria-label="Excluir">×</button>
            </div>
          </div>`).join('') : '<p class="muted">Nenhum webhook cadastrado.</p>'}
        <p class="help" style="margin-top:12px">Cada envio vai assinado, pra quem recebe confirmar que veio do CRM. O guia de formato e assinatura está no repositório, em docs/webhooks.md.</p>
      </section>

      <section class="panel int-card span-all">
        <div class="int-h"><div><h3>Últimos envios de webhook</h3><p class="help">Status HTTP devolvido por cada destino.</p></div></div>
        ${dels.length ? `<div class="table-wrap"><table class="int-table"><thead><tr><th>Quando</th><th>Webhook</th><th>Evento</th><th>Lead</th><th>Status</th></tr></thead><tbody>
          ${dels.map((d) => `<tr><td class="nowrap" title="${fullDate(d.created_at)}">${ago(d.created_at)}</td><td>${esc(hookName(d.webhook_id))}</td><td>${esc(EVENTS.find(([k]) => k === d.event)?.[1] || (d.event === 'webhook.test' ? 'Teste' : d.event))}</td><td>${esc(leadName(d.lead_id))}</td><td>${statusPill(d.status_code, d.response)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">Nenhum envio ainda.</p>'}
      </section>
    </div>`;

  bindCopy(el);
  const reload = () => renderIntegrations(el, { quiet: true });
  el.querySelector('[data-refresh]').addEventListener('click', (e) => { e.currentTarget.classList.add('is-spinning'); reload(); });
  el.querySelector('[data-new-key]').addEventListener('click', () => newKeyModal(reload));
  el.querySelector('[data-new-hook]').addEventListener('click', () => hookModal(null, reload));
  el.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('tr').dataset.id;
    if (!(await confirmBox('Revogar esta chave? Os sistemas que usam ela param de funcionar na hora.', 'Revogar'))) return;
    try { await DB.revokeApiKey(id); toast('Chave revogada'); reload(); } catch (e) { fail(e); }
  }));
  el.querySelectorAll('.hook').forEach((row) => {
    const w = hooks.find((x) => x.id === row.dataset.id);
    row.querySelector('[data-toggle]').addEventListener('click', async () => {
      try { await DB.saveWebhook({ id: w.id, active: !w.active }); toast(w.active ? 'Webhook pausado' : 'Webhook ativado'); reload(); } catch (e) { fail(e); }
    });
    row.querySelector('[data-test]').addEventListener('click', async () => {
      if (!w.active) return toast('Ative o webhook pra testar', true);
      try { await DB.testWebhook(w.id); toast('Envio de teste disparado'); setTimeout(reload, 1500); } catch (e) { fail(e); }
    });
    row.querySelector('[data-secret]').addEventListener('click', () => modal(`<h3>Segredo de ${esc(w.name)}</h3>
      <p class="help">Entregue esse código só pra quem configurar o sistema que recebe os avisos. Ele confirma que o aviso veio do CRM.</p>
      ${codeBlock(w.secret, 'Segredo')}<div class="modal-foot"><button class="b" data-close>Fechar</button></div>`, (c) => bindCopy(c)));
    row.querySelector('[data-edit]').addEventListener('click', () => hookModal(w, reload));
    row.querySelector('[data-del]').addEventListener('click', async () => {
      if (!(await confirmBox(`Excluir o webhook "${w.name}"?`, 'Excluir'))) return;
      try { await DB.deleteWebhook(w.id); toast('Webhook excluído'); reload(); } catch (e) { fail(e); }
    });
  });
}

function newKeyModal(done) {
  modal(`<h3>Nova chave de API</h3>
    <div class="row"><label class="lbl">Nome (onde vai ser usada)</label><input class="inp" data-name maxlength="60" placeholder="Ex: Zapier, Make, Site parceiro"></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Criar chave</button></div>`, (c, close) => {
    const go = async () => {
      const name = c.querySelector('[data-name]').value.trim();
      if (!name) return toast('Dê um nome pra chave', true);
      try {
        const key = await DB.createApiKey(name);
        close();
        modal(`<h3>Chave criada</h3><p class="help"><b>Copie agora.</b> Por segurança ela não aparece de novo; se perder, revogue e crie outra.</p>
          ${codeBlock(key, name)}<div class="modal-foot"><button class="b b-primary" data-close>Já copiei</button></div>`, (c2) => bindCopy(c2));
        done();
      } catch (e) { fail(e); }
    };
    c.querySelector('[data-ok]').addEventListener('click', go);
    c.querySelector('[data-name]').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

function hookModal(w, done) {
  const sel = new Set(w?.events || ['lead.created', 'lead.stage_changed']);
  modal(`<h3>${w ? 'Editar webhook' : 'Novo webhook'}</h3>
    <div class="row"><label class="lbl">Nome</label><input class="inp" data-name maxlength="60" value="${esc(w?.name || '')}" placeholder="Ex: Zapier, n8n, planilha"></div>
    <div class="row"><label class="lbl">Formato</label><div class="seg"><button type="button" class="b ${(w?.format || 'json') === 'json' ? 'on' : ''}" data-fmt="json">JSON (Zapier, n8n, Make…)</button><button type="button" class="b ${w?.format === 'pushcut' ? 'on' : ''}" data-fmt="pushcut">Pushcut (celular)</button></div>
      <p class="help" style="margin-top:6px" data-fmt-help>${w?.format === 'pushcut' ? 'Notificação no celular com título, resumo e link direto pro CRM. No app Pushcut crie uma notificação e copie a URL do webhook.' : 'Corpo JSON completo, assinado com HMAC-SHA256.'}</p></div>
    <div class="row"><label class="lbl">URL de destino</label><input class="inp" data-url type="url" value="${esc(w?.url || '')}" placeholder="https://hooks.zapier.com/…"></div>
    <div class="row"><label class="lbl">Eventos</label><div class="ev-list">${EVENTS.map(([k, n, d]) => `
      <label class="ev"><input type="checkbox" value="${k}" ${sel.has(k) ? 'checked' : ''}><span><b>${esc(n)}</b>${d ? `<small>${esc(d)}</small>` : ''}</span></label>`).join('')}</div></div>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar</button></div>`, (c, close) => {
    let format = w?.format || 'json';
    c.querySelectorAll('[data-fmt]').forEach((b) => b.addEventListener('click', () => {
      format = b.dataset.fmt;
      c.querySelectorAll('[data-fmt]').forEach((x) => x.classList.toggle('on', x === b));
      c.querySelector('[data-fmt-help]').textContent = format === 'pushcut' ? 'Notificação no celular com título, resumo e link direto pro CRM. No app Pushcut crie uma notificação e copie a URL do webhook.' : 'Corpo JSON completo, assinado com HMAC-SHA256.';
      c.querySelector('[data-url]').placeholder = format === 'pushcut' ? 'https://api.pushcut.io/…/notifications/Novo%20lead' : 'https://hooks.zapier.com/…';
    }));
    c.querySelector('[data-ok]').addEventListener('click', async () => {
      const name = c.querySelector('[data-name]').value.trim();
      const url = c.querySelector('[data-url]').value.trim();
      const events = $$('.ev input:checked', c).map((i) => i.value);
      if (format === 'pushcut' && !/^https:\/\/api\.pushcut\.io\//.test(url)) return toast('A URL do Pushcut começa com https://api.pushcut.io/', true);
      if (!name) return toast('Dê um nome ao webhook', true);
      if (!/^https?:\/\/\S+\.\S+/.test(url)) return toast('Informe uma URL válida (https://…)', true);
      if (!events.length) return toast('Escolha pelo menos um evento', true);
      try { await DB.saveWebhook({ ...(w ? { id: w.id } : {}), name, url, events, format }); close(); toast('Webhook salvo'); done(); } catch (e) { fail(e); }
    });
  });
}

// ============================================================
// PIXELS DE RASTREAMENTO (Meta, GA4, Google Ads)
// ============================================================
const PLATFORMS = {
  meta: { name: 'Facebook Meta', short: 'Meta', idLabel: 'ID do Pixel', idHelp: 'Gerenciador de Eventos > Fontes de dados > seu pixel. É o número que aparece abaixo do nome.', idPh: 'Ex: 1234567890123456',
    credLabel: 'API de Conversão (token)', credHelp: 'Gerenciador de Eventos > seu pixel > Configurações > API de Conversões > Gerar token de acesso. Com o token, o CRM envia as conversões também pelo servidor, com IP, navegador e dados criptografados. É o que dá nota alta.', credPh: 'EAA…' },
  ga4: { name: 'Google Analytics 4', short: 'GA4', idLabel: 'ID da métrica (Measurement ID)', idHelp: 'Google Analytics > Administrador > Fluxos de dados > seu site. Começa com G-.', idPh: 'G-XXXXXXXXXX',
    credLabel: 'API secret do Measurement Protocol', credHelp: 'No mesmo fluxo de dados > Chaves secretas da API do Measurement Protocol > Criar. Usado pra enviar os eventos do funil (lead qualificado, venda) pelo servidor.', credPh: 'Ex: aB3dE_fGh…' },
  google_ads: { name: 'Google Ads', short: 'Google Ads', idLabel: 'ID da conversão', idHelp: 'Google Ads > Metas > Conversões > sua conversão de lead > Configuração da tag. É o "AW-" seguido de números.', idPh: 'AW-123456789',
    credLabel: 'Rótulo da conversão', credHelp: 'Na mesma tela, o texto depois da barra em "send_to": AW-123456789/<b>esteRotulo</b>. Ative "Conversões otimizadas" na conversão pra receber e-mail e telefone.', credPh: 'AbCdEfGhIj' }
};
const PLATFORM_ICON = BRAND;
// o que cada chave de evento significa em cada plataforma
const EVENT_ROWS = [
  ['page_view', 'Visita à página', { meta: 'PageView', ga4: 'page_view' }, 'Toda abertura do formulário'],
  ['view_content', 'Visualização do formulário', { meta: 'ViewContent', ga4: 'form_view' }, 'Sinal de interesse'],
  ['form_start', 'Início do preenchimento', { meta: 'IniciouFormulario', ga4: 'form_start' }, 'Quando começa a responder: captura quem tem intenção real'],
  ['form_step', 'Cada pergunta respondida', { meta: 'EtapaFormulario', ga4: 'form_progress' }, 'Mostra onde as pessoas desistem (mais volume de eventos)'],
  ['lead', 'Formulário concluído', { meta: 'Lead', ga4: 'generate_lead', google_ads: 'Conversão' }, 'CONVERSÃO: só quando a pessoa envia o formulário', true],
  ['funnel', 'Etapas do funil no CRM', { meta: 'LeadQualificado, ReuniaoAgendada, VendaRealizada…', ga4: 'qualify_lead, close_convert_lead…' }, 'Enviados pelo servidor quando o lead avança no pipeline. Não contam como conversão.']
];
const eventsFor = (platform) => EVENT_ROWS.filter(([k]) => platform !== 'google_ads' || k === 'lead');

// nota estimada de correspondência (0–10) a partir dos dados que os leads realmente trazem
function matchScore(leads, px) {
  if (!leads.length) return null;
  const cov = (fn) => leads.filter(fn).length / leads.length;
  const server = !!px?.access_token || px?.platform === 'google_ads';
  const parts = [
    [cov((l) => l.email), 2.2], [cov((l) => l.whatsapp), 2.2], [cov((l) => /\s/.test((l.nome || '').trim())), 0.8],
    [cov((l) => l.estado), 0.4], [1, 0.6 /* país */], [cov((l) => l.visitor_id || l.id), 0.8 /* external_id */],
    [server ? cov((l) => l.fbc || l.gclid) : 0, 1.2], [server ? cov((l) => l.fbp) : 0, 0.8],
    [server ? cov((l) => l.client_ip) : 0, 0.6], [server ? cov((l) => l.user_agent) : 0, 0.4]
  ];
  const max = parts.reduce((a, [, w]) => a + w, 0);
  return Math.min(10, Math.round((parts.reduce((a, [c, w]) => a + c * w, 0) / max) * 100) / 10);
}

const PX = { platform: '' , q: '' };

export async function renderPixel(el, { quiet = false } = {}) {
  if (!quiet) el.innerHTML = '<div class="loading">Carregando…</div>';
  let settings = null, pixels = [], events = [];
  try {
    await DB.refreshIntegrations();
    [settings, pixels, events] = await Promise.all([DB.getTracking(), DB.listPixels(), DB.listTrackingEvents({ limit: 100 })]);
  } catch (e) { fail(e); }
  if (!el.isConnected) return;
  if (!settings) { el.innerHTML = '<div class="panel empty"><h3>Configuração não encontrada</h3><p>Rode o supabase/schema.sql atualizado no Supabase.</p></div>'; return; }

  const since = Date.now() - 30 * 86400000;
  const formLeads = S.leads.filter((l) => l.form_id !== 'manual' && !l.recovered_from && new Date(l.created_at) >= since);
  const bestPx = pixels.find((p) => p.platform === 'meta' && p.access_token && p.enabled) || pixels.find((p) => p.platform === 'meta');
  const score = matchScore(formLeads, bestPx);
  const q = PX.q.trim().toLowerCase();
  const list = pixels.filter((p) => (!PX.platform || p.platform === PX.platform) && (!q || (p.name + ' ' + p.pixel_id).toLowerCase().includes(q)));
  const sent = events.filter((e) => !e.test);

  el.innerHTML = `
    <div class="topline"><h1>Pixels de rastreamento</h1><div class="grow"></div><button class="b b-refresh" data-refresh>${ICON.refresh}Atualizar status</button></div>
    <section class="panel px-toolbar">
      <label class="search">${ICON.search}<input class="inp" data-q type="search" placeholder="Buscar…" value="${esc(PX.q)}"></label>
      <button class="b ${PX.platform ? 'on' : ''}" data-plat data-pop-anchor><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>${PX.platform ? PLATFORMS[PX.platform].name : 'Plataforma'}</button>
      <div class="grow"></div>
      <button class="b b-primary" data-add>+ Adicionar pixel</button>
    </section>
    <section class="panel table-wrap" style="margin-top:12px">
      ${list.length ? `<table class="px-table"><thead><tr><th>Pixel de rastreamento</th><th>Plataforma</th><th>ID do pixel</th><th>Envio</th><th>Data de criação</th><th></th></tr></thead><tbody>
        ${list.map((p) => `<tr data-id="${p.id}">
          <td><div class="px-name"><button class="switch ${p.enabled ? 'on' : ''}" data-toggle aria-label="Ativo"></button><span>${esc(p.name)}</span></div></td>
          <td><span class="plat plat-${p.platform}">${PLATFORM_ICON[p.platform]}</span>${PLATFORMS[p.platform].name}</td>
          <td><span class="id-chip">${esc(p.pixel_id)}<button data-copy="${esc(p.pixel_id)}" aria-label="Copiar">${copyIcon}</button></span></td>
          <td>${p.platform === 'google_ads' ? (p.conversion_label ? '<span class="pill good">Navegador + conversões otimizadas</span>' : '<span class="pill bad">Falta o rótulo</span>')
            : p.access_token ? '<span class="pill good">Navegador + servidor</span>' : '<span class="pill wait">Só navegador</span>'}</td>
          <td class="nowrap">${new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })} ${new Date(p.created_at).toLocaleTimeString('pt-BR')}</td>
          <td style="text-align:right"><button class="card-menu" data-menu data-pop-anchor aria-label="Ações">${ICON.dotsH}</button></td>
        </tr>`).join('')}
      </tbody></table>` : '<div class="empty"><h3>Nenhum pixel</h3><p>Adicione o pixel da Meta, o Google Analytics ou uma conversão do Google Ads.</p></div>'}
    </section>

    <div class="int-grid" style="margin-top:12px">
      <section class="panel int-card">
        <div class="score-card">
          <span class="score-badge">${ICON.trend}${score == null ? '—' : score.toFixed(1)}</span>
          <div><b>Nota de correspondência estimada${score == null ? '' : score >= 8.5 ? ': excelente' : score >= 7 ? ': boa' : ': pode melhorar'}</b>
          <p class="help" style="margin:4px 0 0">Calculada pelos identificadores que os leads dos últimos 30 dias trazem${bestPx?.access_token ? ' e pelo envio via servidor' : '. Cole o token da API de Conversão pra somar IP, navegador e clique no anúncio'}. A nota oficial aparece no Gerenciador de Eventos em até 48 horas.</p></div>
        </div>
        <div data-coverage style="margin-top:14px"></div>
      </section>

      <section class="panel int-card">
        <div class="int-h"><div><h3>O que conta como conversão</h3><p class="help">Somente <b style="color:var(--c-text)">formulário concluído</b>. Os outros eventos alimentam o algoritmo com sinais de intenção, mas usam nomes personalizados e não viram conversão.</p></div></div>
        <table class="int-table conv-table"><thead><tr><th>Momento</th><th>Meta</th><th>Google</th></tr></thead><tbody>
          ${EVENT_ROWS.map(([k, n, names, , conv]) => `<tr class="${conv ? 'is-conv' : ''}"><td>${conv ? '<span class="pill good">Conversão</span> ' : ''}${n}</td><td><code>${esc(names.meta)}</code></td><td><code>${esc(names.ga4)}</code>${names.google_ads ? ' · <code>Conversão Ads</code>' : ''}</td></tr>`).join('')}
        </tbody></table>
      </section>

      <section class="panel int-card span-all">
        <div class="int-h"><div><h3>O que vai pra Meta e pro Google</h3><p class="help">Só dois eventos, pra não gerar duplicidade nem confundir o algoritmo. Mover o lead no pipeline não envia nada.</p></div></div>
        <div class="ev2">
          <div class="ev2-i"><span class="ev2-n">1</span><div><b>Lead</b><small>Quando o formulário é concluído. Vai pelo navegador e pelo servidor com o mesmo ID, e a Meta conta uma vez só. É a conversão das campanhas.</small></div></div>
          <div class="ev2-i"><span class="ev2-n">2</span><div><b>Venda</b><small>Uma vez por cliente, quando ele está em "${esc(S.stages.find((x) => x.kind === 'won')?.name || 'Venda realizada')}" e já tem mensalidade. Leva o valor do contrato e a campanha, o conjunto e o anúncio de origem. Venda pelo pipeline e venda lançada no Financeiro usam o mesmo ID, então nunca duplicam.</small></div></div>
        </div>
        ${S.stages.filter((x) => x.kind === 'won').map((st) => `<div class="table-wrap" style="margin-top:12px"><table class="int-table funnel-map"><thead><tr><th>Estágio de venda</th><th>Nome do evento na Meta</th><th>Evento no GA4</th><th>Valor enviado</th></tr></thead><tbody>
          <tr data-stage="${st.id}"><td><span class="stage-pill"><span class="dot" style="background:${st.color}"></span>${esc(st.name)}</span></td>
            <td><input class="inp" data-meta maxlength="40" placeholder="VendaRealizada" value="${esc(st.meta_event || '')}"></td>
            <td><input class="inp" data-ga4 maxlength="40" placeholder="close_convert_lead" value="${esc(st.ga4_event || '')}"></td>
            <td><select class="inp" data-val><option value="contract" ${st.meta_value === 'contract' ? 'selected' : ''}>Valor do contrato</option><option value="none" ${st.meta_value !== 'contract' ? 'selected' : ''}>Sem valor</option></select></td></tr>
        </tbody></table></div>`).join('')}
        <p class="help" style="margin-top:10px">Nome sem espaço. Deixe <code>VendaRealizada</code> pra não misturar com eventos padrão da Meta.</p>
      </section>

      <section class="panel int-card">
        <div class="int-h"><div><h3>Valor da venda</h3><p class="help">Leads e etapas do funil vão sem valor. Só a venda confirmada (estágio de venda) envia valor: a mensalidade do lead × meses de contrato. É esse sinal que ensina a Meta e o Google a buscar quem compra.</p></div></div>
        <div class="srow"><span class="grow">Meses de contrato</span><input class="inp" style="width:80px" data-months inputmode="numeric" value="${settings.contract_months}"></div>
        <div class="sec-actions"><button class="b b-primary" data-save-values>Salvar</button></div>
      </section>

      <section class="panel int-card">
        <div class="int-h"><div><h3>O que é enviado</h3></div></div>
        <ul class="how">
          <li><b>Dados do lead</b> (e-mail, telefone, nome e localização) vão criptografados. Nem a Meta nem o Google recebem o dado aberto.</li>
          <li><b>Dados da visita</b> (navegador e clique no anúncio) ajudam a reconhecer quem clicou no anúncio.</li>
          <li><b>Contexto</b>: formulário, faixa de faturamento, estágio no funil e campanha. <b>Valor só na venda confirmada.</b></li>
          <li>Cada conversão vai pelo navegador e pelo servidor e é <b>contada uma vez só</b>.</li>
        </ul>
      </section>

      <section class="panel int-card span-all">
        <div class="int-h"><div><h3>Eventos enviados pelo servidor</h3><p class="help">${sent.length ? `${num(sent.filter((e) => e.status_code >= 200 && e.status_code < 300).length)} de ${num(sent.length)} aceitos nos últimos envios.` : 'Os envios aparecem aqui com a resposta da Meta e do Google.'}</p></div></div>
        ${events.length ? `<div class="table-wrap"><table class="int-table"><thead><tr><th>Quando</th><th>Plataforma</th><th>Evento</th><th>Lead</th><th>Valor</th><th>Status</th></tr></thead><tbody>
          ${events.map((e) => { const v = e.payload?.data?.[0]?.custom_data?.value ?? e.payload?.events?.[0]?.params?.value; return `<tr><td class="nowrap" title="${fullDate(e.created_at)}">${ago(e.created_at)}</td><td>${PLATFORMS[e.platform]?.short || e.platform} <span class="muted">${esc(String(e.pixel_id).slice(-6))}</span></td><td><code>${esc(e.event_name)}</code>${e.test ? ' <span class="pill">teste</span>' : ''}</td><td>${esc(leadName(e.lead_id))}</td><td>${v != null ? brl(v) : '—'}</td><td>${statusPill(e.status_code, e.response)}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="muted">Nenhum evento enviado ainda.</p>'}
      </section>
    </div>`;

  // cobertura dos identificadores
  const n = formLeads.length;
  const COV = [
    ['E-mail', (l) => l.email], ['Telefone', (l) => l.whatsapp], ['Nome e sobrenome', (l) => /\s/.test((l.nome || '').trim())], ['Estado', (l) => l.estado],
    ['ID do visitante', (l) => l.visitor_id], ['Clique no anúncio (fbc/gclid)', (l) => l.fbc || l.gclid], ['Navegador (fbp)', (l) => l.fbp], ['IP', (l) => l.client_ip], ['User agent', (l) => l.user_agent]
  ];
  hbars($('[data-coverage]', el), COV.map(([name, fn]) => { const c = formLeads.filter(fn).length; const r = c / (n || 1); return { name, value: c, note: n ? pct(c, n) : '—', color: r >= 0.7 ? 'var(--viz-1)' : r >= 0.3 ? 'var(--ramp-2)' : 'var(--viz-gray)' }; }), { max: n || 1 });

  const reload = () => renderPixel(el, { quiet: true });
  bindCopy(el);
  el.querySelector('[data-refresh]').addEventListener('click', (e) => { e.currentTarget.classList.add('is-spinning'); reload(); });
  el.querySelector('[data-add]').addEventListener('click', () => pixelDrawer(null, formLeads, reload));
  const qi = el.querySelector('[data-q]');
  qi.addEventListener('input', () => { PX.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { reload().then(() => { const i = el.querySelector('[data-q]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); }, 250); });
  el.querySelector('[data-plat]').addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'Todas as plataformas', checked: !PX.platform, action: () => { PX.platform = ''; reload(); } },
    ...Object.entries(PLATFORMS).map(([k, v]) => ({ label: v.name, checked: PX.platform === k, action: () => { PX.platform = k; reload(); } }))
  ]));
  el.querySelectorAll('tr[data-id]').forEach((row) => {
    const p = pixels.find((x) => x.id === row.dataset.id);
    row.querySelector('[data-toggle]').addEventListener('click', async () => {
      try { await DB.savePixel({ id: p.id, enabled: !p.enabled }); toast(p.enabled ? 'Pixel desativado' : 'Pixel ativado'); reload(); } catch (e) { fail(e); }
    });
    row.querySelector('[data-menu]').addEventListener('click', (e) => menu(e.currentTarget, [
      { label: 'Editar', action: () => pixelDrawer(p, formLeads, reload) },
      ...(p.platform !== 'google_ads' ? [{ label: 'Enviar evento de teste', action: async () => { try { await DB.testPixel(p.id); toast('Evento de teste enviado. Confira em "Eventos de teste" no gerenciador.'); setTimeout(reload, 2500); } catch (err) { fail(err); } } }] : []),
      { sep: true },
      { label: 'Excluir pixel', danger: true, action: async () => {
        if (!(await confirmBox(`Excluir o pixel "${p.name}"? Os eventos param de ser enviados na hora.`, 'Excluir'))) return;
        try { await DB.deletePixel(p.id); toast('Pixel excluído'); reload(); } catch (err) { fail(err); }
      } }
    ]));
  });

  // eventos do funil por estágio
  el.querySelectorAll('tr[data-stage]').forEach((row) => {
    const s = S.stages.find((x) => x.id === row.dataset.stage);
    const persist = async () => {
      const clean = (v) => v.trim().replace(/[^\w]/g, '') || null;
      const patch = { id: s.id, name: s.name, color: s.color, kind: s.kind, position: s.position,
        meta_event: clean(row.querySelector('[data-meta]').value), ga4_event: clean(row.querySelector('[data-ga4]').value), meta_value: row.querySelector('[data-val]').value };
      if (['Lead', 'Purchase', 'CompleteRegistration', 'SubmitApplication', 'Schedule', 'Contact'].includes(patch.meta_event)) toast(`"${patch.meta_event}" é um evento padrão e pode contar como conversão na Meta`, true);
      try { Object.assign(s, await DB.saveStage(patch)); row.querySelector('[data-meta]').value = s.meta_event || ''; row.querySelector('[data-ga4]').value = s.ga4_event || ''; toast(`${s.name}: salvo`); } catch (e) { fail(e); }
    };
    row.querySelectorAll('input, select').forEach((i) => i.addEventListener('change', persist));
  });

  el.querySelector('[data-save-values]').addEventListener('click', async () => {
    const months = Math.round(Number(el.querySelector('[data-months]').value));
    if (!(months >= 1 && months <= 60)) return toast('Meses entre 1 e 60', true);
    try { await DB.saveTracking({ contract_months: months }); toast('Salvo'); reload(); } catch (e) { fail(e); }
  });
}

const copyIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

// ---------- painel lateral: adicionar / editar pixel (3 etapas) ----------
function pixelDrawer(px, formLeads, done) {
  const st = {
    step: 1,
    platform: px?.platform || 'meta',
    name: px?.name || '', pixel_id: px?.pixel_id || '',
    cred: '', test_event_code: px?.test_event_code || '',
    mode: px?.mode || 'recommended',
    events: { ...PIXEL_EVENTS_RECOMMENDED, ...(px?.events || {}) }
  };
  const credSaved = px && (px.platform === 'google_ads' ? px.conversion_label : px.access_token);
  const scrim = document.createElement('div'); scrim.className = 'scrim on';
  const dr = document.createElement('aside'); dr.className = 'drawer px-drawer'; dr.setAttribute('aria-label', px ? 'Editar pixel' : 'Adicionar pixel');
  document.body.append(scrim, dr);
  requestAnimationFrame(() => dr.classList.add('on'));
  const close = () => { dr.classList.remove('on'); scrim.classList.remove('on'); setTimeout(() => { dr.remove(); scrim.remove(); }, 300); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && !$('.modal')) close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', close);

  const P = () => PLATFORMS[st.platform];
  const readStep1 = () => {
    st.name = dr.querySelector('[data-name]').value.trim();
    st.pixel_id = dr.querySelector('[data-pid]').value.trim().replace(/\s/g, '');
    st.cred = dr.querySelector('[data-cred]').value.trim();
    st.test_event_code = dr.querySelector('[data-test-code]')?.value.trim() || '';
  };
  const validStep1 = () => {
    if (!st.name) return 'Dê um nome ao pixel';
    if (st.platform === 'meta' && !/^\d{10,20}$/.test(st.pixel_id)) return 'O ID do pixel da Meta tem só números (10 a 20 dígitos)';
    if (st.platform === 'ga4' && !/^G-[A-Z0-9]{4,}$/i.test(st.pixel_id)) return 'O ID do GA4 começa com G-';
    if (st.platform === 'google_ads' && !/^AW-\d{6,}$/i.test(st.pixel_id)) return 'O ID do Google Ads começa com AW- seguido de números';
    if (st.platform === 'google_ads' && !st.cred && !credSaved) return 'Informe o rótulo da conversão do Google Ads';
    return '';
  };
  const willServer = () => st.platform === 'google_ads' || !!(st.cred || credSaved);
  const estScore = () => matchScore(formLeads, { platform: st.platform, access_token: willServer() ? 'x' : null });

  const render = () => {
    const bars = [1, 2, 3].map((i) => `<i class="${i <= st.step ? 'on' : ''}"></i>`).join('');
    let body = '';
    if (st.step === 1) {
      body = `
        ${px ? '' : `<div class="row"><label class="lbl">Plataforma</label><div class="plat-pick">${Object.entries(PLATFORMS).map(([k, v]) => `<button type="button" class="plat-opt ${st.platform === k ? 'on' : ''}" data-plat="${k}"><span class="plat plat-${k}">${PLATFORM_ICON[k]}</span>${v.name}</button>`).join('')}</div></div>`}
        <div class="row"><label class="lbl">Nome do pixel</label><input class="inp" data-name maxlength="80" value="${esc(st.name)}" placeholder="Ex: Pixel Tracto [BM principal]"></div>
        <div class="row"><label class="lbl">${P().idLabel}</label><input class="inp" data-pid value="${esc(st.pixel_id)}" placeholder="${P().idPh}" ${px ? 'readonly' : ''}><p class="help">${P().idHelp}</p></div>
        <div class="row"><label class="lbl">${P().credLabel} ${st.platform === 'google_ads' ? '' : '<span class="muted" style="text-transform:none;letter-spacing:0">(opcional, recomendado)</span>'}</label>
          ${st.platform === 'meta' ? `<textarea class="inp" data-cred rows="3" autocomplete="off" spellcheck="false" placeholder="${credSaved ? '•••••••• salvo · cole outro pra trocar' : P().credPh}">${esc(st.cred)}</textarea>` : `<input class="inp" data-cred autocomplete="off" spellcheck="false" value="${esc(st.cred)}" placeholder="${credSaved && st.platform !== 'google_ads' ? '•••••••• salvo · cole outro pra trocar' : credSaved || P().credPh}">`}
          <p class="help">${P().credHelp}</p></div>
        ${st.platform === 'meta' ? `<div class="row"><label class="lbl">Código de evento de teste <span class="muted" style="text-transform:none;letter-spacing:0">(opcional)</span></label><input class="inp" data-test-code value="${esc(st.test_event_code)}" placeholder="TEST12345"><p class="help">Com ele, os eventos aparecem em "Eventos de teste" no Gerenciador. Apague quando terminar de testar.</p></div>` : ''}`;
    } else if (st.step === 2) {
      const s = estScore();
      const rows = eventsFor(st.platform);
      body = `
        <div class="score-card big"><span class="score-badge">${ICON.trend}${s == null ? '—' : s.toFixed(1)}</span><div><b>Nota de correspondência estimada${s == null ? '' : s >= 8.5 ? ': excelente' : s >= 7 ? ': boa' : ''}</b>
          <p class="help" style="margin:4px 0 0">${willServer() ? 'O CRM envia os eventos com dados completos pelo navegador e pelo servidor. Isso faz o anúncio reconhecer quem converteu e aprender a mostrar pra pessoas parecidas, gastando menos.' : 'Sem o token, só o navegador envia. Bloqueadores de anúncio e iOS derrubam parte dos eventos. Volte e cole o token pra nota subir.'}</p></div></div>
        <h4 class="px-h">O que vamos rastrear</h4><p class="help">Use a recomendação da Tracto ou personalize do seu jeito.</p>
        <label class="mode-card ${st.mode === 'recommended' ? 'on' : ''}"><input type="radio" name="mode" value="recommended" ${st.mode === 'recommended' ? 'checked' : ''}>
          <div><b>Recomendação da Tracto</b> <span class="pill good">Converte mais</span>
          <p class="help" style="margin:4px 0 10px">Rastreamos cada etapa no momento certo pro algoritmo entender quem tem intenção real. Só o formulário concluído conta como conversão.</p>
          <ul class="ev-check">${rows.filter(([k]) => PIXEL_EVENTS_RECOMMENDED[k]).map(([, n, names, d, conv]) => `<li>${ICON.check}<span><b>${n}</b> <span class="muted">(${esc(names[st.platform] || '')})</span>${conv ? ' <span class="pill good">Conversão</span>' : ''}<br><small>${esc(d)}</small></span></li>`).join('')}</ul></div></label>
        <label class="mode-card ${st.mode === 'custom' ? 'on' : ''}"><input type="radio" name="mode" value="custom" ${st.mode === 'custom' ? 'checked' : ''}>
          <div><b>Personalizado</b><p class="help" style="margin:4px 0 0">Escolha cada evento. Ideal pra quem já tem uma estratégia de tráfego definida.</p>
          ${st.mode === 'custom' ? `<div class="ev-list" style="margin-top:10px">${rows.map(([k, n, names, d, conv]) => `<label class="ev"><input type="checkbox" data-ev="${k}" ${st.events[k] ? 'checked' : ''}><span><b>${n}</b> <code>${esc(names[st.platform] || '')}</code>${conv ? ' <span class="pill good">Conversão</span>' : ''}<small>${esc(d)}</small></span></label>`).join('')}</div>` : ''}</div></label>`;
    } else {
      const evs = st.mode === 'recommended' ? { ...PIXEL_EVENTS_RECOMMENDED } : st.events;
      const on = eventsFor(st.platform).filter(([k]) => evs[k]);
      body = `
        <h4 class="px-h">Revisão</h4>
        <dl class="kv review">
          <dt>Plataforma</dt><dd>${P().name}</dd><dt>Nome</dt><dd>${esc(st.name)}</dd><dt>${P().idLabel}</dt><dd><code>${esc(st.pixel_id)}</code></dd>
          <dt>Envio</dt><dd>${st.platform === 'google_ads' ? 'Navegador, com conversões otimizadas (e-mail e telefone)' : willServer() ? 'Navegador + servidor (dados completos)' : 'Só navegador'}</dd>
          <dt>Eventos</dt><dd>${on.map(([, n, names, , conv]) => `${conv ? '<b>' : ''}${n}${conv ? ' (conversão)</b>' : ''} <span class="muted">${esc(names[st.platform] || '')}</span>`).join('<br>') || '<span class="muted">nenhum</span>'}</dd>
        </dl>
        ${!evs.lead ? '<p class="help" style="color:var(--fg-red)">A conversão (formulário concluído) está desligada. Esse pixel não vai registrar leads.</p>' : ''}`;
    }
    dr.innerHTML = `
      <div class="dr-head"><h2>${px ? 'Editar pixel' : 'Adicionar pixel'}</h2><button class="icon-btn" data-x aria-label="Fechar">${ICON.x}</button></div>
      <div class="dr-body"><div class="sec">
        <div class="steps-bar">${bars}</div>
        ${body}
      </div></div>
      <div class="px-foot">${st.step > 1 ? '<button class="b" data-back>Voltar</button>' : '<span></span>'}<button class="b b-primary" data-next>${st.step < 3 ? 'Avançar' : px ? 'Salvar alterações' : 'Adicionar pixel'}</button></div>`;

    dr.querySelector('[data-x]').addEventListener('click', close);
    dr.querySelectorAll('[data-plat]').forEach((b) => b.addEventListener('click', () => { readStep1(); st.platform = b.dataset.plat; render(); }));
    dr.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => { st.mode = r.value; if (st.mode === 'recommended') st.events = { ...PIXEL_EVENTS_RECOMMENDED }; render(); }));
    dr.querySelectorAll('[data-ev]').forEach((c) => c.addEventListener('change', () => { st.events[c.dataset.ev] = c.checked; }));
    dr.querySelector('[data-back]')?.addEventListener('click', () => { if (st.step === 1) return; st.step--; render(); });
    dr.querySelector('[data-next]').addEventListener('click', async () => {
      if (st.step === 1) { readStep1(); const err = validStep1(); if (err) return toast(err, true); st.step = 2; return render(); }
      if (st.step === 2) { st.step = 3; return render(); }
      const row = {
        ...(px ? { id: px.id } : {}), name: st.name, platform: st.platform, pixel_id: st.platform === 'ga4' || st.platform === 'google_ads' ? st.pixel_id.toUpperCase() : st.pixel_id,
        mode: st.mode, events: st.mode === 'recommended' ? { ...PIXEL_EVENTS_RECOMMENDED } : st.events,
        test_event_code: st.platform === 'meta' ? st.test_event_code || null : null
      };
      if (st.cred) { if (st.platform === 'google_ads') row.conversion_label = st.cred; else row.access_token = st.cred; }
      try { await DB.savePixel(row); close(); toast(px ? 'Pixel atualizado' : 'Pixel adicionado'); done(); }
      catch (e) { fail(/duplicate|unique|já está/i.test(e.message) ? new Error('esse pixel já está cadastrado') : e); }
    });
    setTimeout(() => dr.querySelector('.dr-body input:not([readonly]), .dr-body textarea')?.focus(), 60);
  };
  render();
}

// eventos enviados de um lead (painel lateral)
export async function leadMetaEvents(leadId) {
  try { await DB.refreshIntegrations(); return await DB.listTrackingEvents({ limit: 40, leadId }); } catch (e) { return []; }
}
export { statusPill };
