// Importar leads de planilha (Respondi, formulários da Meta, Typeform, Google Forms…): CSV ou Excel.
// Não duplica (WhatsApp/e-mail), mantém a data original e nunca manda conversão pra Meta.
import { DB } from '@shared/db.js';
import { S, esc, num, toast, fail, modal } from './util.js?v=2609282311';

const ORIGINS = [['respondi', 'Respondi'], ['meta_form', 'Formulário da Meta (planilha)'], ['typeform', 'Typeform'], ['google_forms', 'Google Forms'], ['planilha', 'Outra planilha']];
const FIELDS = [
  ['', 'Guardar como resposta'], ['skip', 'Ignorar coluna'], ['nome', 'Nome'], ['first_name', 'Primeiro nome'], ['last_name', 'Sobrenome'],
  ['whatsapp', 'WhatsApp / telefone'], ['email', 'E-mail'], ['instagram', 'Instagram'], ['faturamento', 'Faturamento'], ['created_at', 'Data do envio'],
  ['estado', 'Estado (UF)'], ['cidade', 'Cidade'], ['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'], ['utm_campaign', 'utm_campaign / campanha'],
  ['utm_content', 'utm_content / anúncio'], ['utm_term', 'utm_term / conjunto'], ['external_id', 'ID da resposta']
];
// adivinha o campo pelo título da coluna
const GUESS = [
  [/^(id|response.?id|id da resposta|lead.?id|token)$/i, 'external_id'],
  [/first.?name|primeiro nome/i, 'first_name'], [/last.?name|sobrenome/i, 'last_name'],
  [/whats|telefone|celular|phone|fone/i, 'whatsapp'], [/e-?mail/i, 'email'], [/insta|@/i, 'instagram'], [/fatura/i, 'faturamento'],
  [/utm.?source/i, 'utm_source'], [/utm.?medium/i, 'utm_medium'], [/utm.?campaign|^campa(nha|ign)/i, 'utm_campaign'],
  [/utm.?content|^an[uú]ncio|^ad.?name/i, 'utm_content'], [/utm.?term|conjunto|adset/i, 'utm_term'],
  [/^(estado|uf|state)$/i, 'estado'], [/^(cidade|city)$/i, 'cidade'],
  [/data|date|enviado|submitted|created|criado|hor[aá]rio|timestamp/i, 'created_at'],
  [/^(ip|user.?agent|navegador|device|dispositivo|browser|referrer|platform|plataforma|is_organic|org[aâ]nico|form.?(id|name)|formul[aá]rio|ad.?id|adset.?id|campaign.?id|lead.?status|status)$/i, 'skip'],
  [/nome|name/i, 'nome']
];
const guess = (h) => (GUESS.find(([re]) => re.test(String(h).trim())) || [null, ''])[1];

// ---------- leitura dos arquivos ----------
function parseCSV(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}
let xlsxLib = null;
const loadXlsx = () => xlsxLib || (xlsxLib = new Promise((ok, bad) => {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  s.onload = () => ok(window.XLSX); s.onerror = () => { xlsxLib = null; bad(new Error('Não consegui abrir o leitor de Excel. Exporte em CSV e tente de novo.')); };
  document.head.appendChild(s);
}));
async function readFile(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd hh:mm', defval: '' });
  }
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // planilhas salvas no Excel
  return parseCSV(text.replace(/^﻿/, ''));
}
// "10/08/2026 14:03", "2026-08-10 14:03:00", "2026-08-10T14:03:00Z" → ISO (horário de Brasília quando sem fuso)
function toIso(v) {
  const s = String(v || '').trim(); if (!s) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '12').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}-03:00`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(.*)$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '12'}:${m[5] || '00'}:${m[6] || '00'}${/[zZ]|[+-]\d{2}/.test(m[7]) ? m[7].trim() : '-03:00'}`;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function importModal(done) {
  let data = null; let map = [];
  modal(`<h3>Importar leads</h3>
    <p class="help" style="margin-top:-4px">Traga os leads de outros formulários. Leads repetidos (mesmo WhatsApp ou e-mail) são ignorados, a data original é mantida e nenhuma conversão é enviada pra Meta.</p>
    <div class="grid2">
      <div class="row"><label class="lbl">De onde vêm</label><select class="inp" data-origin>${ORIGINS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
      <div class="row"><label class="lbl">Nome do formulário</label><input class="inp" data-fname maxlength="100" placeholder="Ex: Respondi · Tráfego pago"></div>
    </div>
    <label class="imp-drop" data-drop>
      <input type="file" accept=".csv,.xlsx,.xls,.tsv,.txt" hidden data-file>
      <span class="imp-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg></span>
      <b data-drop-t>Escolha ou arraste a planilha</b><small>CSV ou Excel exportado do formulário</small>
    </label>
    <div data-map></div>
    <details class="docs"><summary>Como exportar do Respondi e da Meta</summary>
      <p class="help"><b>Respondi:</b> abra o formulário &gt; Respostas &gt; Exportar (CSV ou Excel). Faça isso em cada formulário.</p>
      <p class="help"><b>Meta:</b> os formulários de cadastro já são puxados sozinhos (Financeiro &gt; Contas de anúncio). Se quiser pela planilha: Meta Business Suite &gt; Todas as ferramentas &gt; Central de leads (ou na página &gt; Ferramentas de publicação &gt; Formulários de cadastro) &gt; Baixar.</p>
    </details>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok disabled>Importar</button></div>`, (c, close) => {
    const $c = (s) => c.querySelector(s);
    const drop = $c('[data-drop]');
    const load = async (file) => {
      if (!file) return;
      $c('[data-drop-t]').textContent = 'Lendo ' + file.name + '…';
      try {
        const rows = await readFile(file);
        if (rows.length < 2) throw new Error('A planilha está vazia.');
        const head = rows[0].map((h, i) => String(h || '').trim() || 'Coluna ' + (i + 1));
        data = { head, body: rows.slice(1) };
        map = head.map(guess);
        if (!$c('[data-fname]').value) $c('[data-fname]').value = file.name.replace(/\.(csv|xlsx|xls|tsv|txt)$/i, '').replace(/[_-]+/g, ' ').slice(0, 100);
        const lower = file.name.toLowerCase();
        if (/respondi/.test(lower)) $c('[data-origin]').value = 'respondi';
        drop.classList.add('has-file'); $c('[data-drop-t]').textContent = `${file.name} · ${num(data.body.length)} linhas`;
        renderMap();
      } catch (e) { drop.classList.remove('has-file'); $c('[data-drop-t]').textContent = 'Escolha ou arraste a planilha'; toast(e.message, true); }
    };
    const renderMap = () => {
      const ex = (i) => data.body.map((r) => r[i]).find((v) => String(v || '').trim()) || '';
      $c('[data-map]').innerHTML = `<h4 class="px-h" style="margin:14px 0 6px">Colunas</h4><p class="help" style="margin:0 0 8px">Confira o que cada coluna significa. As demais ficam guardadas como respostas do formulário.</p>
        <div class="imp-map">${data.head.map((h, i) => `<div class="imp-row"><div class="imp-col"><b title="${esc(h)}">${esc(h)}</b><small title="${esc(ex(i))}">${esc(String(ex(i)).slice(0, 60)) || '—'}</small></div>
          <select class="inp" data-col="${i}">${FIELDS.map(([k, n]) => `<option value="${k}" ${map[i] === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`).join('')}</div>`;
      c.querySelectorAll('[data-col]').forEach((sel) => sel.addEventListener('change', () => { map[+sel.dataset.col] = sel.value; check(); }));
      check();
    };
    const check = () => {
      const has = (k) => map.includes(k);
      const okCols = (has('nome') || has('first_name')) && (has('whatsapp') || has('email'));
      $c('[data-ok]').disabled = !okCols;
      $c('[data-ok]').textContent = okCols ? `Importar ${num(data.body.length)} leads` : 'Indique nome e WhatsApp ou e-mail';
    };
    $c('[data-file]').addEventListener('change', (e) => load(e.target.files[0]));
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => load(e.dataTransfer.files[0]));
    $c('[data-ok]').addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      const origin = $c('[data-origin]').value; const fname = $c('[data-fname]').value.trim() || ORIGINS.find(([k]) => k === origin)[1];
      const rows = data.body.map((r) => {
        const o = { answers: [] }; let first = ''; let last = '';
        data.head.forEach((h, i) => {
          const v = String(r[i] ?? '').trim(); if (!v) return;
          const k = map[i];
          if (k === 'skip') return;
          if (k === 'first_name') first = v; else if (k === 'last_name') last = v;
          else if (k === 'created_at') o.created_at = toIso(v);
          else if (k) o[k] = v;
          else o.answers.push({ label: h, value: v });
        });
        if (!o.nome && (first || last)) o.nome = `${first} ${last}`.trim();
        if (o.external_id) o.external_id = `${origin}:${o.external_id}`;
        return o;
      });
      let ok = 0; let skip = 0;
      try {
        for (let i = 0; i < rows.length; i += 500) {
          btn.textContent = `Importando ${num(Math.min(i + 500, rows.length))} de ${num(rows.length)}…`;
          const r = await DB.importLeads(rows.slice(i, i + 500), origin, fname);
          ok += r.importados || 0; skip += r.ignorados || 0;
        }
        close();
        toast(`${num(ok)} lead${ok === 1 ? '' : 's'} importado${ok === 1 ? '' : 's'}${skip ? ` · ${num(skip)} já existia${skip === 1 ? '' : 'm'} ou sem contato` : ''}`);
        done?.();
      } catch (err) { btn.disabled = false; check(); fail(err); }
    });
  });
}
