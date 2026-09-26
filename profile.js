// "Meu perfil": dados pessoais, Pushcut, senha e verificação em duas etapas
import { DB, LIVE } from '@shared/db.js';
import { S, esc, toast, fail, modal } from './util.js?v=5e3e4be';
import { passwordCheck } from './auth.js?v=5e3e4be';

const ROLE = { admin: 'Admin', gestor: 'Gestor', sdr: 'SDR' };

export async function openProfile() {
  let factors = [];
  try { factors = (await DB.mfaFactors()).filter((f) => f.status === 'verified'); } catch (e) {}
  const me = S.me || {};
  modal(`<h3>Meu perfil</h3>
    <p class="help">${esc(me.email || '')} · ${ROLE[me.role] || ''}</p>
    <div class="row"><label class="lbl">Nome</label><input class="inp" data-f="nome" maxlength="120" value="${esc(me.nome || '')}"></div>
    <div class="row"><label class="lbl">Telefone</label><input class="inp" data-f="phone" inputmode="tel" value="${esc(me.phone || '')}" placeholder="(62) 99999-9999"></div>
    <div class="row"><label class="lbl">Notificação no celular (Pushcut)</label>
      <input class="inp" data-f="pushcut_url" value="${esc(me.pushcut_url || '')}" placeholder="https://api.pushcut.io/…/notifications/…">
      <p class="help" style="margin-top:6px">No app Pushcut: Notifications &gt; + &gt; crie "Novo lead" &gt; Webhook &gt; copie a URL e cole aqui. Você recebe um push sempre que um lead for atribuído a você.</p></div>
    <div class="modal-foot" style="justify-content:space-between;margin-top:6px"><span></span><button class="b b-primary" data-save>Salvar</button></div>
    <hr class="sep">
    <h4 class="px-h">Segurança</h4>
    <div class="sec-row"><div><b>Verificação em duas etapas</b><p class="help" style="margin:2px 0 0">${factors.length ? 'Ativa. Pedimos o código do app autenticador a cada login.' : 'Protege sua conta mesmo se a senha vazar. Recomendado pra quem vê dados de leads.'}</p></div>
      ${factors.length ? '<button class="b b-danger b-sm" data-mfa-off>Desativar</button>' : '<button class="b b-sm" data-mfa-on>Ativar</button>'}</div>
    <div class="sec-row"><div><b>Senha</b><p class="help" style="margin:2px 0 0">Troque se suspeitar que alguém sabe a sua.</p></div><button class="b b-sm" data-pass>Trocar senha</button></div>
    <div class="modal-foot"><button class="b" data-close>Fechar</button></div>`, (c, close) => {
    c.querySelector('[data-save]').addEventListener('click', async () => {
      const v = Object.fromEntries([...c.querySelectorAll('[data-f]')].map((i) => [i.dataset.f, i.value.trim() || null]));
      if (!v.nome || v.nome.length < 2) return toast('Informe seu nome', true);
      if (v.pushcut_url && !/^https:\/\/api\.pushcut\.io\/\S+$/.test(v.pushcut_url)) return toast('A URL do Pushcut começa com https://api.pushcut.io/', true);
      try { S.me = { ...S.me, ...(await DB.updateMyProfile(v)) }; toast('Perfil salvo'); close(); } catch (e) { fail(e); }
    });
    c.querySelector('[data-pass]').addEventListener('click', () => { close(); changePassword(); });
    c.querySelector('[data-mfa-on]')?.addEventListener('click', () => { close(); enrollMfa(); });
    c.querySelector('[data-mfa-off]')?.addEventListener('click', async () => {
      if (!confirm('Desativar a verificação em duas etapas?')) return;
      try { for (const f of factors) await DB.mfaUnenroll(f.id); toast('Verificação em duas etapas desativada'); close(); } catch (e) { fail(e); }
    });
  });
}

function changePassword() {
  modal(`<h3>Trocar senha</h3>
    <div class="row"><label class="lbl">Nova senha</label><input class="inp" type="password" data-p1 autocomplete="new-password"></div>
    <div class="row"><label class="lbl">Confirmar</label><input class="inp" type="password" data-p2 autocomplete="new-password"></div>
    <p class="help" data-hint>Mínimo de 10 caracteres, misturando letras, números e símbolos.</p>
    <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-primary" data-ok>Salvar senha</button></div>`, (c, close) => {
    c.querySelector('[data-ok]').addEventListener('click', async () => {
      const p1 = c.querySelector('[data-p1]').value;
      const r = passwordCheck(p1, { email: S.me?.email, nome: S.me?.nome });
      if (!r.ok) return toast('Senha fraca: ' + r.issues.join(', '), true);
      if (p1 !== c.querySelector('[data-p2]').value) return toast('As senhas não conferem', true);
      try { await DB.updatePassword(p1); toast('Senha alterada'); close(); } catch (e) { fail(e); }
    });
  });
}

async function enrollMfa() {
  let f;
  try { f = await DB.mfaEnroll(); } catch (e) { return fail(e); }
  modal(`<h3>Ativar verificação em duas etapas</h3>
    <p class="help">1. Abra um app autenticador (Google Authenticator, 1Password, Authy) e escaneie o QR code.</p>
    <div class="qr">${f.totp.qr_code ? `<img src="${esc(f.totp.qr_code)}" alt="QR code">` : '<span class="muted">Modo demo: sem QR code</span>'}</div>
    <p class="help">Ou digite a chave: <code class="wrap">${esc(f.totp.secret)}</code></p>
    <p class="help">2. Digite o código de 6 dígitos que aparece no app.</p>
    <div class="row"><input class="inp otp" data-code inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code"></div>
    <div class="modal-foot"><button class="b" data-close data-cancel>Cancelar</button><button class="b b-primary" data-ok>Ativar</button></div>`, (c, close) => {
    const i = c.querySelector('[data-code]');
    i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 6); });
    c.querySelector('[data-cancel]').addEventListener('click', () => { if (LIVE) DB.mfaUnenroll(f.id).catch(() => {}); });
    c.querySelector('[data-ok]').addEventListener('click', async () => {
      try { await DB.mfaVerify(f.id, i.value); toast('Verificação em duas etapas ativada'); close(); }
      catch (e) { toast('Código inválido. Confira o horário do celular e tente de novo.', true); }
    });
  });
}
