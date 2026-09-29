// Autenticação do CRM: entrar, criar conta, recuperar senha, confirmar e-mail, 2FA e aguardar liberação.
// Boas práticas: senha forte + checagem de senhas vazadas (k-anonimato), mensagens genéricas,
// bloqueio temporário após tentativas, 2FA (TOTP), sessão encerrada por inatividade e consentimento LGPD registrado.
import { DB, LIVE } from '@shared/db.js';
import { $, esc, toast, ICON } from './util.js?v=2609291856';

export const PRIVACY_VERSION = '2026-09';
const SITE = window.TRACTO_CONFIG?.siteUrl || 'https://assessoriatracto.com.br';
const IDLE_MS = 8 * 60 * 60 * 1000;      // 8h sem usar o CRM encerra a sessão
const LOCK_KEY = 'tracto_auth_lock';
const COMMON = ['123456', 'senha', 'password', 'qwerty', 'tracto', 'abc123', '111111', 'admin', 'iloveyou', 'mudar'];

const ICON_EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
// no subdomínio do CRM os arquivos compartilhados vêm do domínio principal
const ASSETS = SITE;
const LOGO = `<img src="${ASSETS}/assets/img/tracto-logo.svg?v=3" alt="Tracto" class="auth-logo">`;

// ---------- senha ----------
export function passwordCheck(pw, { email = '', nome = '' } = {}) {
  const issues = [];
  if (pw.length < 10) issues.push('pelo menos 10 caracteres');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) issues.push('misture maiúsculas, minúsculas, números ou símbolos');
  const low = pw.toLowerCase();
  const parts = [email.split('@')[0], ...nome.toLowerCase().split(/\s+/)].filter((x) => x && x.length >= 3);
  if (parts.some((x) => low.includes(x.toLowerCase()))) issues.push('não use seu nome ou e-mail');
  if (COMMON.some((c) => low.includes(c)) || /(.)\1{3,}/.test(pw)) issues.push('evite sequências e senhas comuns');
  let score = Math.min(4, Math.floor(pw.length / 4) + classes - 2 - issues.length);
  if (!pw) score = 0;
  return { ok: !issues.length, issues, score: Math.max(0, score) };
}
// Have I Been Pwned por k-anonimato: só os 5 primeiros caracteres do SHA-1 saem do navegador
async function pwned(pw) {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pw));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const res = await fetch('https://api.pwnedpasswords.com/range/' + hex.slice(0, 5), { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) return false;
    const text = await res.text();
    return text.split('\n').some((line) => line.startsWith(hex.slice(5)) && +line.split(':')[1] > 0);
  } catch (e) { return false; }
}

// ---------- bloqueio por tentativas ----------
const lockState = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || { fails: 0, until: 0 }; } catch (e) { return { fails: 0, until: 0 }; } };
const saveLock = (s) => { try { localStorage.setItem(LOCK_KEY, JSON.stringify(s)); } catch (e) {} };
function registerFail() {
  const s = lockState(); s.fails += 1;
  if (s.fails >= 5) { s.until = Date.now() + Math.min(15, 2 ** (s.fails - 5)) * 60000; }
  saveLock(s);
}
const lockedFor = () => Math.max(0, Math.ceil((lockState().until - Date.now()) / 1000));

// ---------- telas ----------
const root = () => $('#login');
function screen(html, bind) {
  const el = root();
  el.innerHTML = `<div class="auth-wrap"><div class="auth-card">${LOGO}${html}</div>
    <p class="auth-foot">Protegido com criptografia. Seus dados são tratados conforme a <a href="${SITE}/privacidade/" target="_blank" rel="noopener">Política de Privacidade</a> (LGPD).</p></div>`;
  el.hidden = false;
  $('#app').hidden = true;
  bind?.(el);
  setTimeout(() => el.querySelector('input:not([type=checkbox])')?.focus(), 60);
}
const field = (id, label, type = 'text', extra = '') => `
  <div class="row"><label class="lbl" for="${id}">${label}</label>
  ${type === 'password' ? `<div class="pw-field"><input class="inp" id="${id}" type="password" ${extra}><button type="button" class="pw-eye" data-eye="${id}" aria-label="Mostrar senha">${ICON_EYE}</button></div>` : `<input class="inp" id="${id}" type="${type}" ${extra}>`}</div>`;
function bindEyes(el) {
  el.querySelectorAll('[data-eye]').forEach((b) => b.addEventListener('click', () => { const i = el.querySelector('#' + b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; }));
}
function meter(el, pwId, ctx) {
  const i = el.querySelector('#' + pwId); const m = el.querySelector('.pw-meter'); const hint = el.querySelector('.pw-hint');
  const upd = () => {
    const r = passwordCheck(i.value, ctx());
    m.dataset.score = r.score; m.querySelectorAll('i').forEach((b, k) => b.classList.toggle('on', k < Math.max(1, r.score) && i.value));
    hint.textContent = !i.value ? 'Mínimo de 10 caracteres, misturando letras, números e símbolos.' : r.ok ? 'Senha forte.' : 'Falta: ' + r.issues.join(', ') + '.';
    hint.classList.toggle('good', r.ok && !!i.value);
  };
  i.addEventListener('input', upd); upd();
}
const setBusy = (btn, on, label) => { btn.disabled = on; if (on) { btn.dataset.l = btn.innerHTML; btn.innerHTML = '<span class="spin"></span>'; } else btn.innerHTML = label || btn.dataset.l; };
const err = (el, msg) => { const e = el.querySelector('.auth-err'); e.textContent = msg; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); };

export function showSignIn(onDone, msg = '') {
  screen(`<h1>Entrar no <em>CRM</em></h1>
    <form class="auth-form" novalidate>
      ${field('aEmail', 'E-mail', 'email', 'autocomplete="username" required')}
      ${field('aPass', 'Senha', 'password', 'autocomplete="current-password" required')}
      <div class="auth-row"><span></span><a href="/esqueci" class="link">Esqueci a senha</a></div>
      <button class="btn btn-pill auth-btn" type="submit">ENTRAR <span class="chev">›</span></button>
      <p class="auth-err" role="alert">${esc(msg)}</p>
    </form>
    <p class="auth-alt">Não tem conta? <a href="/cadastro" class="link">Criar conta</a></p>`, (el) => {
    bindEyes(el);
    if (msg) el.querySelector('.auth-err').classList.add('show');
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const wait = lockedFor();
      if (wait) return err(el, `Muitas tentativas. Tente de novo em ${wait > 60 ? Math.ceil(wait / 60) + ' min' : wait + ' s'}.`);
      const email = el.querySelector('#aEmail').value.trim().toLowerCase(); const pass = el.querySelector('#aPass').value;
      if (!email || !pass) return err(el, 'Preencha e-mail e senha.');
      const btn = el.querySelector('.auth-btn'); setBusy(btn, true);
      try {
        await DB.signIn(email, pass);
        saveLock({ fails: 0, until: 0 });
        await afterPassword(onDone);
      } catch (ex) {
        registerFail();
        const m = /confirm/i.test(ex.message) ? 'Confirme seu e-mail pelo link que enviamos antes de entrar.' : /rate|many/i.test(ex.message) ? 'Muitas tentativas. Aguarde alguns minutos.' : 'E-mail ou senha inválidos.';
        err(el, m); setBusy(btn, false);
      }
    });
  });
}

// depois da senha: pede o código do app autenticador se a pessoa tiver 2FA
async function afterPassword(onDone) {
  let aal = null;
  try { aal = await DB.mfaAal(); } catch (e) { aal = null; }
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return showMfa(onDone);
  onDone();
}

export function showMfa(onDone) {
  screen(`<h1>Verificação em <em>duas etapas</em></h1>
    <p class="auth-sub">Digite o código de 6 dígitos do seu app autenticador (Google Authenticator, 1Password, Authy…).</p>
    <form class="auth-form" novalidate>
      <div class="row"><input class="inp otp" id="aCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" placeholder="000000"></div>
      <button class="btn btn-pill auth-btn" type="submit">VERIFICAR <span class="chev">›</span></button>
      <p class="auth-err" role="alert"></p>
    </form>
    <p class="auth-alt"><a href="#" class="link" data-out>Entrar com outra conta</a></p>`, (el) => {
    const inp = el.querySelector('#aCode');
    inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); if (inp.value.length === 6) el.querySelector('form').requestSubmit(); });
    el.querySelector('[data-out]').addEventListener('click', async (e) => { e.preventDefault(); await DB.signOut(); showSignIn(onDone); });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = el.querySelector('.auth-btn'); setBusy(btn, true);
      try {
        const f = (await DB.mfaFactors()).find((x) => x.status === 'verified');
        await DB.mfaVerify(f.id, inp.value);
        onDone();
      } catch (ex) { registerFail(); err(el, 'Código inválido ou expirado.'); inp.value = ''; setBusy(btn, false); }
    });
  });
}

const CARGOS = ['Sócio ou diretor', 'Gestor comercial', 'SDR / pré-vendas', 'Closer / vendas', 'Gestor de tráfego', 'Atendimento / CS', 'Financeiro', 'Outro'];
const maskPhone = (v) => {
  const d = v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export function showSignUp() {
  screen(`<h1>Criar <em>conta</em></h1>
    <p class="auth-sub">Preencha seus dados. Depois de confirmar o e-mail, um administrador libera seu acesso.</p>
    <form class="auth-form" novalidate>
      <div class="auth-grid">
        ${field('sNome', 'Nome', 'text', 'autocomplete="given-name" maxlength="60" required')}
        ${field('sSobrenome', 'Sobrenome', 'text', 'autocomplete="family-name" maxlength="60" required')}
      </div>
      ${field('sEmail', 'E-mail de trabalho', 'email', 'autocomplete="email" required')}
      ${field('sEmail2', 'Confirmar e-mail', 'email', 'autocomplete="off" required')}
      <div class="auth-grid">
        ${field('sPhone', 'WhatsApp', 'tel', 'inputmode="tel" autocomplete="tel-national" placeholder="(62) 99999-9999" required')}
        <div class="row"><label class="lbl" for="sCargo">Cargo</label><select class="inp" id="sCargo" required><option value="">Selecione</option>${CARGOS.map((c) => `<option>${c}</option>`).join('')}</select></div>
      </div>
      ${field('sPass', 'Senha', 'password', 'autocomplete="new-password" required')}
      <div class="pw-meter" data-score="0"><i></i><i></i><i></i><i></i></div><p class="pw-hint"></p>
      ${field('sPass2', 'Confirmar senha', 'password', 'autocomplete="new-password" required')}
      <label class="consent"><input type="checkbox" id="sConsent"><span>Li e aceito a <a href="${SITE}/privacidade/" target="_blank" rel="noopener" class="link">Política de Privacidade</a> e os termos de uso do CRM. Entendo que vou acessar dados pessoais de leads e me comprometo a usá-los só para fins comerciais da Tracto, conforme a LGPD.</span></label>
      <button class="btn btn-pill auth-btn" type="submit">CRIAR CONTA <span class="chev">›</span></button>
      <p class="auth-err" role="alert"></p>
    </form>
    <p class="auth-alt">Já tem conta? <a href="/entrar" class="link">Entrar</a></p>`, (el) => {
    el.querySelector('.auth-card').classList.add('wide');
    bindEyes(el);
    const $f = (id) => el.querySelector('#' + id);
    $f('sPhone').addEventListener('input', (e) => { e.target.value = maskPhone(e.target.value); });
    // não deixa colar no "confirmar" (confirmação de verdade)
    ['sEmail2', 'sPass2'].forEach((id) => $f(id).addEventListener('paste', (e) => e.preventDefault()));
    meter(el, 'sPass', () => ({ email: $f('sEmail').value, nome: $f('sNome').value + ' ' + $f('sSobrenome').value }));
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nome = $f('sNome').value.trim(); const sobrenome = $f('sSobrenome').value.trim();
      const email = $f('sEmail').value.trim().toLowerCase(); const email2 = $f('sEmail2').value.trim().toLowerCase();
      const phone = $f('sPhone').value.replace(/\D/g, ''); const cargo = $f('sCargo').value;
      const pass = $f('sPass').value; const pass2 = $f('sPass2').value;
      if (nome.length < 2 || sobrenome.length < 2) return err(el, 'Informe nome e sobrenome.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err(el, 'E-mail inválido.');
      if (email !== email2) return err(el, 'Os e-mails não conferem.');
      if (phone.length < 10 || phone.length > 11) return err(el, 'Informe o WhatsApp com DDD.');
      if (!cargo) return err(el, 'Selecione seu cargo.');
      const chk = passwordCheck(pass, { email, nome: nome + ' ' + sobrenome });
      if (!chk.ok) return err(el, 'Senha fraca: ' + chk.issues.join(', ') + '.');
      if (pass !== pass2) return err(el, 'As senhas não conferem.');
      if (!$f('sConsent').checked) return err(el, 'É preciso aceitar a Política de Privacidade.');
      const btn = el.querySelector('.auth-btn'); setBusy(btn, true);
      if (await pwned(pass)) { setBusy(btn, false); return err(el, 'Essa senha já apareceu em vazamentos de dados na internet. Escolha outra.'); }
      try {
        await DB.signUp({ email, password: pass, nome: `${nome} ${sobrenome}`, phone: '55' + phone, cargo, consentVersion: PRIVACY_VERSION });
        showCheckEmail(email);
      } catch (ex) {
        setBusy(btn, false);
        err(el, /rate|many/i.test(ex.message) ? 'Muitas tentativas. Aguarde alguns minutos.' : /password/i.test(ex.message) ? 'Senha não aceita. Escolha uma mais forte.' : 'Não foi possível criar a conta. Confira os dados e tente de novo.');
      }
    });
  });
}

function showCheckEmail(email) {
  screen(`<div class="auth-icon">${ICON.mailOpen}</div><h1>Confirme seu <em>e-mail</em></h1>
    <p class="auth-sub">Se o endereço <b>${esc(email)}</b> puder ser usado, enviamos um link de confirmação. Abra o e-mail e clique no link pra ativar a conta. Depois disso, um administrador libera seu acesso.</p>
    <button class="btn btn-pill auth-btn" data-resend type="button">REENVIAR E-MAIL</button>
    <p class="auth-alt"><a href="/entrar" class="link">Voltar pro login</a></p>`, (el) => {
    const b = el.querySelector('[data-resend]');
    b.addEventListener('click', async () => {
      b.disabled = true; try { await DB.resendConfirmation(email); } catch (e) {} toast('Se a conta existir, reenviamos o e-mail');
      let t = 60; const iv = setInterval(() => { b.textContent = `REENVIAR EM ${--t}s`; if (t <= 0) { clearInterval(iv); b.disabled = false; b.textContent = 'REENVIAR E-MAIL'; } }, 1000);
    });
  });
}

export function showForgot() {
  screen(`<h1>Recuperar <em>senha</em></h1>
    <p class="auth-sub">Enviamos um link pra você criar uma senha nova.</p>
    <form class="auth-form" novalidate>
      ${field('fEmail', 'E-mail', 'email', 'autocomplete="email" required')}
      <button class="btn btn-pill auth-btn" type="submit">ENVIAR LINK <span class="chev">›</span></button>
      <p class="auth-err" role="alert"></p>
    </form>
    <p class="auth-alt"><a href="/entrar" class="link">Voltar pro login</a></p>`, (el) => {
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = el.querySelector('#fEmail').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err(el, 'E-mail inválido.');
      const btn = el.querySelector('.auth-btn'); setBusy(btn, true);
      try { await DB.resetPassword(email); } catch (ex) { /* resposta igual pra não revelar contas */ }
      screen(`<div class="auth-icon">${ICON.mailOpen}</div><h1>Confira seu <em>e-mail</em></h1><p class="auth-sub">Se existir uma conta com <b>${esc(email)}</b>, você vai receber um link pra redefinir a senha. O link vale por 1 hora.</p><p class="auth-alt"><a href="/entrar" class="link">Voltar pro login</a></p>`);
    });
  });
}

export function showReset(onDone) {
  screen(`<h1>Nova <em>senha</em></h1>
    <form class="auth-form" novalidate>
      ${field('rPass', 'Nova senha', 'password', 'autocomplete="new-password" required')}
      <div class="pw-meter" data-score="0"><i></i><i></i><i></i><i></i></div><p class="pw-hint"></p>
      ${field('rPass2', 'Confirmar senha', 'password', 'autocomplete="new-password" required')}
      <button class="btn btn-pill auth-btn" type="submit">SALVAR SENHA <span class="chev">›</span></button>
      <p class="auth-err" role="alert"></p>
    </form>`, (el) => {
    bindEyes(el);
    meter(el, 'rPass', () => ({}));
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pass = el.querySelector('#rPass').value;
      const chk = passwordCheck(pass);
      if (!chk.ok) return err(el, 'Senha fraca: ' + chk.issues.join(', ') + '.');
      if (pass !== el.querySelector('#rPass2').value) return err(el, 'As senhas não conferem.');
      const btn = el.querySelector('.auth-btn'); setBusy(btn, true);
      if (await pwned(pass)) { setBusy(btn, false); return err(el, 'Essa senha já apareceu em vazamentos. Escolha outra.'); }
      try { await DB.updatePassword(pass); toast('Senha alterada'); history.replaceState(null, '', location.pathname); onDone(); }
      catch (ex) { setBusy(btn, false); err(el, 'Link expirado ou inválido. Peça um novo em "Esqueci a senha".'); }
    });
  });
}

export function showPending(profile) {
  screen(`<div class="auth-icon">${ICON.hourglass}</div><h1>Aguardando <em>liberação</em></h1>
    <p class="auth-sub">Olá, ${esc((profile?.nome || '').split(' ')[0] || 'tudo bem')}! Seu e-mail foi confirmado. Agora um administrador precisa liberar seu acesso em Ajustes &gt; Equipe. Assim que for liberado, é só entrar de novo.</p>
    <button class="btn btn-pill auth-btn" data-retry type="button">JÁ FUI LIBERADO</button>
    <p class="auth-alt"><a href="#" class="link" data-out>Sair</a></p>`, (el) => {
    el.querySelector('[data-retry]').addEventListener('click', () => location.reload());
    el.querySelector('[data-out]').addEventListener('click', async (e) => { e.preventDefault(); await DB.signOut(); location.replace('/entrar'); });
  });
}

// sessão encerrada por inatividade
export function watchIdle() {
  if (!LIVE) return;
  const KEY = 'tracto_last_active';
  const touch = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} };
  touch();
  ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach((ev) => addEventListener(ev, () => { clearTimeout(touch._t); touch._t = setTimeout(touch, 1000); }, { passive: true }));
  setInterval(async () => {
    const last = +(localStorage.getItem(KEY) || Date.now());
    if (Date.now() - last > IDLE_MS) { await DB.signOut(); location.replace('/entrar'); }
  }, 60000);
}

export const AUTH_ROUTES = ['entrar', 'cadastro', 'esqueci', 'redefinir', 'confirmado'];
