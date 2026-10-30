// Ponte entre o CRM da Tracto e a Evolution API (WhatsApp).
// - O navegador nunca vê a chave da Evolution: toda chamada passa por aqui com o login do CRM (token do Supabase).
// - Recebe os eventos da Evolution (mensagens, conexão), repassa ao vivo pro CRM (SSE) e avisa o banco
//   quando um lead responde (o Follow-up marca "Respondeu" sozinho).
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8080);
const EVO = (process.env.EVOLUTION_URL || '').replace(/\/$/, '');
const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_ANON = process.env.SUPABASE_ANON_KEY || '';
const SECRET = process.env.WEBHOOK_SECRET || '';
const SELF = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const INSTANCE = process.env.INSTANCE_NAME || 'tracto';
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://crm.assessoriatracto.com.br').split(',').map((s) => s.trim());
const MAX_BODY = 30 * 1024 * 1024;
const EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'CHATS_UPSERT', 'CHATS_UPDATE', 'PRESENCE_UPDATE'];

const log = (...a) => console.log(new Date().toISOString(), ...a);
const json = (res, code, body, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(body)); };

// ---------- Evolution ----------
async function evo(method, path, body) {
  const r = await fetch(EVO + path, { method, headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  if (!r.ok) { const e = new Error(data?.response?.message?.toString?.() || data?.message || `Evolution ${r.status}`); e.status = r.status; e.data = data; throw e; }
  return data;
}
const webhookConfig = () => ({ enabled: true, url: `${SELF}/webhook/${SECRET}`, byEvents: false, base64: false, events: EVENTS });
async function ensureInstance() {
  const list = await evo('GET', `/instance/fetchInstances?instanceName=${INSTANCE}`).catch(() => []);
  if (!Array.isArray(list) || !list.length) {
    await evo('POST', '/instance/create', { instanceName: INSTANCE, integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: true, alwaysOnline: false, readMessages: false, syncFullHistory: false, webhook: webhookConfig() });
    log('instância criada');
  } else {
    await evo('POST', `/webhook/set/${INSTANCE}`, { webhook: webhookConfig() }).catch((e) => log('webhook set', e.message));
  }
}

// ---------- login do CRM ----------
const authCache = new Map(); // token -> { user, exp }
async function authUser(token) {
  if (!token) return null;
  const hit = authCache.get(token); if (hit && hit.exp > Date.now()) return hit.user;
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
  if (!u.ok) return null;
  const user = await u.json();
  // só quem está ativo na equipe (as regras do banco decidem o que o perfil enxerga)
  const p = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${user.id}&select=id,nome,role,ativo`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
  const prof = p.ok ? (await p.json())[0] : null;
  if (!prof?.ativo) return null;
  authCache.set(token, { user: prof, exp: Date.now() + 5 * 60000 });
  if (authCache.size > 500) authCache.delete(authCache.keys().next().value);
  return prof;
}

// ---------- eventos ao vivo (SSE) ----------
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch {} }
}
setInterval(() => { for (const c of clients) { try { c.write(': ping\n\n'); } catch {} } }, 25000);

// ---------- banco: lead respondeu / contato feito ----------
const digits = (s) => String(s || '').replace(/\D/g, '');
const textOf = (m = {}) => m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption
  || (m.audioMessage ? '[áudio]' : m.imageMessage ? '[imagem]' : m.videoMessage ? '[vídeo]' : m.documentMessage ? '[documento]' : m.stickerMessage ? '[figurinha]' : m.contactMessage ? '[contato]' : m.locationMessage ? '[localização]' : '');
async function notifyDb(d) {
  try {
    const jid = d.key?.remoteJid || '';
    if (!jid.endsWith('@s.whatsapp.net')) return; // ignora grupos, status e listas
    await fetch(`${SB_URL}/rest/v1/rpc/wa_event`, {
      method: 'POST', headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: SECRET, p_phone: digits(jid.split('@')[0]), p_from_me: !!d.key?.fromMe, p_text: textOf(d.message).slice(0, 300), p_name: d.pushName || null })
    });
  } catch (e) { log('wa_event', e.message); }
}

// ---------- rotas ----------
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error('Arquivo grande demais (máx. 30 MB)'), { status: 413 }); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
const jidOf = (n) => (String(n).includes('@') ? n : `${digits(n)}@s.whatsapp.net`);

const routes = {
  'GET /api/status': async () => {
    const s = await evo('GET', `/instance/connectionState/${INSTANCE}`).catch(() => null);
    const info = s ? (await evo('GET', `/instance/fetchInstances?instanceName=${INSTANCE}`).catch(() => []))[0] : null;
    return { state: s?.instance?.state || 'close', number: info?.ownerJid ? digits(info.ownerJid.split('@')[0]) : null, name: info?.profileName || null, picture: info?.profilePicUrl || null };
  },
  'POST /api/connect': async () => { await ensureInstance(); const r = await evo('GET', `/instance/connect/${INSTANCE}`); return { qr: r.base64 || null, code: r.pairingCode || null, state: r.instance?.state || null }; },
  'POST /api/logout': async () => { await evo('DELETE', `/instance/logout/${INSTANCE}`).catch(() => {}); return { ok: true }; },
  'POST /api/chats': async () => {
    const list = await evo('POST', `/chat/findChats/${INSTANCE}`, {});
    return (Array.isArray(list) ? list : []).filter((c) => (c.remoteJid || '').endsWith('@s.whatsapp.net')).map((c) => ({
      jid: c.remoteJid, phone: digits(c.remoteJid.split('@')[0]), name: c.pushName || c.name || null, picture: c.profilePicUrl || null, unread: c.unreadCount || 0,
      at: c.lastMessage?.messageTimestamp ? Number(c.lastMessage.messageTimestamp) * 1000 : c.updatedAt ? new Date(c.updatedAt).getTime() : 0,
      last: c.lastMessage ? { text: textOf(c.lastMessage.message), fromMe: !!c.lastMessage.key?.fromMe } : null
    })).sort((a, b) => b.at - a.at);
  },
  'POST /api/messages': async (b) => {
    const r = await evo('POST', `/chat/findMessages/${INSTANCE}`, { where: { key: { remoteJid: jidOf(b.jid) } }, page: b.page || 1, offset: 50 });
    return r.messages || r;
  },
  'POST /api/send/text': async (b) => evo('POST', `/message/sendText/${INSTANCE}`, { number: digits(b.number), text: b.text, ...(b.quoted ? { quoted: b.quoted } : {}) }),
  'POST /api/send/media': async (b) => evo('POST', `/message/sendMedia/${INSTANCE}`, { number: digits(b.number), mediatype: b.mediatype, mimetype: b.mimetype, caption: b.caption || '', media: b.media, fileName: b.fileName }),
  'POST /api/send/audio': async (b) => evo('POST', `/message/sendWhatsAppAudio/${INSTANCE}`, { number: digits(b.number), audio: b.audio, encoding: true }),
  'POST /api/media': async (b) => evo('POST', `/chat/getBase64FromMediaMessage/${INSTANCE}`, { message: { key: { id: b.id } }, convertToMp4: !!b.mp4 }),
  'POST /api/read': async (b) => evo('POST', `/chat/markMessageAsRead/${INSTANCE}`, { readMessages: (b.ids || []).map((id) => ({ remoteJid: jidOf(b.jid), fromMe: false, id })) }),
  'POST /api/picture': async (b) => evo('POST', `/chat/fetchProfilePictureUrl/${INSTANCE}`, { number: digits(b.number) }).catch(() => ({}))
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const origin = req.headers.origin || '';
  const okOrigin = ORIGINS.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin);
  const cors = okOrigin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' } : {};
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (url.pathname === '/' || url.pathname === '/health') return json(res, 200, { ok: true });

    // eventos da Evolution
    if (req.method === 'POST' && url.pathname.startsWith('/webhook/')) {
      const given = url.pathname.split('/')[2] || '';
      if (!SECRET || given.length !== SECRET.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(SECRET))) return json(res, 403, { error: 'forbidden' });
      const ev = await readBody(req).catch(() => ({}));
      json(res, 200, { ok: true });
      const name = String(ev.event || '').toLowerCase().replace(/_/g, '.');
      const d = ev.data || {};
      if (name === 'messages.upsert' || name === 'send.message') {
        const list = Array.isArray(d) ? d : d.messages || [d];
        for (const m of list) {
          if (!(m.key?.remoteJid || '').endsWith('@s.whatsapp.net')) continue;
          broadcast('message', { jid: m.key.remoteJid, msg: m });
          notifyDb(m);
        }
      } else if (name === 'messages.update') broadcast('status', d);
      else if (name === 'connection.update') broadcast('connection', { state: d.state, number: d.wuid ? digits(d.wuid.split('@')[0]) : null });
      else if (name === 'qrcode.updated') broadcast('qr', { qr: d.qrcode?.base64 || null });
      else if (name === 'presence.update') broadcast('presence', d);
      else if (name.startsWith('chats.')) broadcast('chats', {});
      return;
    }

    // daqui pra baixo: só a equipe logada no CRM
    if (!okOrigin && origin) return json(res, 403, { error: 'origem não permitida' });
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token');
    const me = await authUser(token);
    if (!me) return json(res, 401, { error: 'Faça login no CRM de novo' }, cors);

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n'); clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const fn = routes[`${req.method} ${url.pathname}`];
    if (!fn) return json(res, 404, { error: 'não encontrado' }, cors);
    if (['POST /api/connect', 'POST /api/logout'].includes(`${req.method} ${url.pathname}`) && !['admin', 'gestor'].includes(me.role)) return json(res, 403, { error: 'Só gestores conectam ou desconectam o WhatsApp' }, cors);
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await fn(body, me);
    if (url.pathname.startsWith('/api/send/')) log(`envio por ${me.nome}`);
    return json(res, 200, out ?? {}, cors);
  } catch (e) {
    log('erro', req.method, url.pathname, e.message);
    return json(res, e.status && e.status < 500 ? e.status : 502, { error: e.message || 'falhou' }, cors);
  }
});

server.listen(PORT, async () => {
  log(`gateway na porta ${PORT}`);
  if (!EVO || !EVO_KEY || !SECRET || !SB_URL) return log('faltam variáveis de ambiente');
  try { await ensureInstance(); } catch (e) { log('ensureInstance', e.message); }
});
