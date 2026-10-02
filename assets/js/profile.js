// "Meu perfil": página própria (/perfil) com dados pessoais, notificações e segurança
import { DB, LIVE } from '@shared/db.js';
import { S, esc, toast, fail, modal, ICON } from './util.js?v=2610021016';
import { passwordCheck } from './auth.js?v=2610021016';

const ROLE = { admin: 'Admin', gestor: 'Gestor', sdr: 'SDR' };
const ROLE_HELP = { admin: 'Acesso total ao CRM, incluindo usuários e integrações.', gestor: 'Gerencia leads, financeiro, formulários e ajustes da equipe.', sdr: 'Atende e move os leads atribuídos no pipeline.' };
const I = {
  shield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.2 8.3 8 9 4.8-.7 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>',
  lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
};
const initials = (n) => (n || '').split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const fmtPhone = (v) => {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const pwField = (k, label, ac) => `<div class="row"><label class="lbl" for="pf-${k}">${label}</label>
  <div class="pw-field"><input class="inp" id="pf-${k}" type="password" data-${k} autocomplete="${ac}"><button type="button" class="pw-eye" data-eye="pf-${k}" aria-label="Mostrar senha">${I.eye}</button></div></div>`;

let tab = 'perfil';

export async function renderProfile(el, onSaved) {
  let factors = [];
  try { factors = (await DB.mfaFactors()).filter((f) => f.status === 'verified'); } catch (e) {}
  if (!el.isConnected) return;
  const me = S.me || {};
  const mfaOn = factors.length > 0;
  const scope = me.pushcut_scope || (['admin', 'gestor'].includes(me.role) ? 'all' : 'mine');
  const nav = [['perfil', 'Perfil', ICON.user], ['notificacoes', 'Notificações', ICON.bell], ['seguranca', 'Segurança', I.shield]];

  el.innerHTML = `
    <div class="topline"><h1>Meu perfil</h1></div>
    <div class="pf">
      <aside class="pf-side">
        <div class="pf-id"><span class="pf-av">${esc(initials(me.nome))}</span>
          <div class="pf-id-t"><b>${esc(me.nome || '')}</b><small>${esc(me.email || '')}</small></div></div>
        <nav class="pf-nav" role="tablist" aria-label="Seções do perfil">${nav.map(([k, t, ic]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}">${ic}<span>${t}</span>${k === 'seguranca' && !mfaOn ? '<i class="pf-dot" title="Verificação em duas etapas desligada"></i>' : ''}</button>`).join('')}</nav>
      </aside>

      <div class="pf-main">
        <section class="panel pf-sec" data-sec="perfil">
          <header><h3>Informações pessoais</h3><p class="help">Seu nome aparece para a equipe nos leads atribuídos a você.</p></header>
          <div class="pf-grid">
            <div class="row"><label class="lbl" for="pf-nome">Nome</label><input class="inp" id="pf-nome" data-f="nome" maxlength="120" autocomplete="name" value="${esc(me.nome || '')}"></div>
            <div class="row"><label class="lbl" for="pf-phone">Telefone</label><input class="inp" id="pf-phone" data-f="phone" inputmode="tel" autocomplete="tel" value="${esc(fmtPhone(me.phone))}" placeholder="(62) 99999-9999"></div>
          </div>
          <div class="pf-ro">
            <div><span class="lbl">E-mail de acesso</span><p>${esc(me.email || '')}</p></div>
            <button type="button" class="b b-sm" data-go="seguranca">Alterar</button>
          </div>
          <div class="pf-ro">
            <div><span class="lbl">Função</span><p><span class="pill">${ROLE[me.role] || ''}</span><span class="pf-muted">${ROLE_HELP[me.role] || ''}</span></p></div>
          </div>
          <footer class="pf-foot"><span class="pf-muted" data-dirty-msg hidden>Alterações não salvas</span><button class="b" data-reset hidden>Descartar</button><button class="b b-primary" data-save disabled>Salvar alterações</button></footer>
        </section>

        <section class="panel pf-sec" data-sec="notificacoes">
          <header><h3>Notificação no celular</h3><p class="help">Receba um push no celular quando chegar lead. Usa o app Pushcut (iPhone).</p></header>
          <div class="row"><label class="lbl" for="pf-push">URL do webhook do Pushcut</label><input class="inp" id="pf-push" data-f="pushcut_url" value="${esc(me.pushcut_url || '')}" placeholder="https://api.pushcut.io/…/notifications/…"></div>
          <div class="row"><label class="lbl" for="pf-scope">Avisar sobre</label><select class="inp" id="pf-scope" data-f="pushcut_scope">
            <option value="all" ${scope === 'all' ? 'selected' : ''}>Todos os leads novos</option>
            <option value="mine" ${scope === 'mine' ? 'selected' : ''}>Só os leads atribuídos a mim</option></select></div>
          <ol class="pf-steps">
            <li>No app Pushcut, abra <b>Notifications</b> e toque em <b>+</b>.</li>
            <li>Crie uma notificação chamada <b>Novo lead</b>.</li>
            <li>Em <b>Webhook</b>, copie a URL e cole no campo acima.</li>
          </ol>
          <div class="pf-test" data-test-box ${me.pushcut_url ? '' : 'hidden'}><button type="button" class="b b-sm" data-push-test>${ICON.bell}Enviar notificação de teste</button><span class="pf-test-msg" data-test-msg role="status"></span></div>
          <footer class="pf-foot"><span class="pf-status ${me.pushcut_url ? 'ok' : ''}">${me.pushcut_url ? `${ICON.check}Ativa` : 'Desligada'}</span><span class="grow"></span><button class="b" data-reset hidden>Descartar</button><button class="b b-primary" data-save disabled>Salvar alterações</button></footer>
        </section>

        <section class="panel pf-sec" data-sec="seguranca">
          <header><h3>Segurança</h3><p class="help">Proteja o acesso aos dados dos leads e clientes.</p></header>
          <div class="pf-item" data-item="mfa">
            <span class="pf-ic ${mfaOn ? 'ok' : ''}">${I.shield}</span>
            <div class="pf-item-t"><b>Verificação em duas etapas <span class="pf-badge ${mfaOn ? 'ok' : 'off'}">${mfaOn ? 'Ativa' : 'Desligada'}</span></b>
              <p class="help">${mfaOn ? 'Pedimos o código do app autenticador a cada login.' : 'Protege sua conta mesmo se a senha vazar. Recomendado.'}</p></div>
            ${mfaOn ? '<button class="b b-sm b-danger" data-mfa-off>Desativar</button>' : '<button class="b b-sm b-primary" data-open="mfa">Ativar</button>'}
            <div class="pf-exp" data-exp="mfa" hidden></div>
          </div>
          <div class="pf-item" data-item="email">
            <span class="pf-ic">${ICON.mail}</span>
            <div class="pf-item-t"><b>E-mail de acesso</b><p class="help">${esc(me.email || '')}</p></div>
            <button class="b b-sm" data-open="email">Alterar e-mail</button>
            <div class="pf-exp" data-exp="email" hidden>
              <div class="pf-grid">
                <div class="row"><label class="lbl" for="pf-e1">Novo e-mail</label><input class="inp" id="pf-e1" type="email" data-e1 autocomplete="email"></div>
                <div class="row"><label class="lbl" for="pf-e2">Confirmar novo e-mail</label><input class="inp" id="pf-e2" type="email" data-e2 autocomplete="off"></div>
              </div>
              <p class="help">Enviamos um link de confirmação para o novo e-mail e para o atual. A troca vale depois que os dois forem confirmados.</p>
              <div class="pf-actions"><button class="b" data-cancel>Cancelar</button><button class="b b-primary" data-email-ok>Enviar confirmação</button></div>
            </div>
          </div>
          <div class="pf-item" data-item="pass">
            <span class="pf-ic">${I.lock}</span>
            <div class="pf-item-t"><b>Senha</b><p class="help">Troque se suspeitar que alguém sabe a sua.</p></div>
            <button class="b b-sm" data-open="pass">Trocar senha</button>
            <div class="pf-exp" data-exp="pass" hidden>
              <div class="pf-grid">${pwField('p1', 'Nova senha', 'new-password')}${pwField('p2', 'Confirmar nova senha', 'new-password')}</div>
              <div class="pw-meter" data-score="0"><i></i><i></i><i></i><i></i></div>
              <p class="help" data-hint>Mínimo de 10 caracteres, misturando letras, números e símbolos.</p>
              <div class="pf-actions"><button class="b" data-cancel>Cancelar</button><button class="b b-primary" data-pass-ok>Salvar senha</button></div>
            </div>
          </div>
        </section>
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const $$ = (s) => [...el.querySelectorAll(s)];

  // seções: no computador ficam lado a lado com o menu; o menu leva até a seção
  const show = (k, scroll = true) => {
    tab = k;
    $$('[data-tab]').forEach((b) => { const on = b.dataset.tab === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $$('[data-sec]').forEach((s) => s.classList.toggle('on', s.dataset.sec === k));
    if (scroll) $(`[data-sec="${k}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => { show(b.dataset.go); openExp('email'); }));
  show(tab, false);

  // dados do perfil: salvar só aparece quando algo muda
  $('#pf-phone').addEventListener('input', (e) => { e.target.value = fmtPhone(e.target.value); });
  const orig = { nome: me.nome || '', phone: fmtPhone(me.phone), pushcut_url: me.pushcut_url || '', pushcut_scope: scope };
  $$('[data-sec="perfil"], [data-sec="notificacoes"]').forEach((sec) => {
    const fields = [...sec.querySelectorAll('[data-f]')];
    const dirty = () => fields.some((i) => i.value.trim() !== orig[i.dataset.f]);
    const sync = () => {
      const d = dirty();
      sec.querySelector('[data-save]').disabled = !d;
      sec.querySelector('[data-reset]').hidden = !d;
      const msg = sec.querySelector('[data-dirty-msg]'); if (msg) msg.hidden = !d;
    };
    fields.forEach((i) => { i.addEventListener('input', sync); i.addEventListener('change', sync); });
    sec.querySelector('[data-reset]').addEventListener('click', () => { fields.forEach((i) => { i.value = orig[i.dataset.f]; }); sync(); });
    sec.querySelector('[data-save]').addEventListener('click', async (e) => {
      const v = Object.fromEntries(fields.map((i) => [i.dataset.f, i.value.trim() || null]));
      if ('nome' in v && (!v.nome || v.nome.length < 2)) return toast('Informe seu nome', true);
      if ('phone' in v && v.phone && v.phone.replace(/\D/g, '').length < 10) return toast('Telefone incompleto', true);
      if (v.pushcut_url) v.pushcut_url = v.pushcut_url.replace(/\s/g, '%20');
      if (v.pushcut_url && !/^https:\/\/api\.pushcut\.io\/\S+\/notifications\/\S+$/.test(v.pushcut_url)) return toast('Cole a URL do webhook do Pushcut (https://api.pushcut.io/…/notifications/…)', true);
      if ('phone' in v && v.phone) v.phone = v.phone.replace(/\D/g, '');
      const btn = e.currentTarget; btn.disabled = true;
      try { S.me = { ...S.me, ...(await DB.updateMyProfile(v)) }; toast('Perfil salvo'); onSaved?.(); renderProfile(el, onSaved); }
      catch (err) { btn.disabled = false; fail(err); }
    });
  });

  // teste do Pushcut: manda e mostra se o Pushcut aceitou
  $('[data-push-test]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; const msg = $('[data-test-msg]');
    btn.disabled = true; msg.className = 'pf-test-msg'; msg.textContent = 'Enviando…';
    try {
      await DB.pushcutTest();
      let st = { done: false };
      for (let k = 0; k < 10 && !st.done; k++) { await new Promise((ok) => setTimeout(ok, 1500)); st = await DB.pushcutTestStatus(); }
      if (!st.done) { msg.textContent = 'Enviado. Confira o celular (o Pushcut ainda não respondeu).'; }
      else if (st.ok) { msg.className = 'pf-test-msg ok'; msg.textContent = 'O Pushcut recebeu. A notificação deve aparecer no celular.'; }
      else { msg.className = 'pf-test-msg bad'; msg.textContent = st.status === 404 ? 'O Pushcut não achou essa notificação. Confira se a URL é do webhook certo e se a notificação existe no app.' : `O Pushcut recusou (${st.status || st.error || 'sem resposta'}). Confira a URL e se o app está logado.`; }
    } catch (err) { msg.className = 'pf-test-msg bad'; msg.textContent = err.message || 'Não foi possível enviar agora.'; }
    btn.disabled = false;
  });

  // segurança: cada ação abre no próprio item, sem janela por cima
  function openExp(k) {
    $$('[data-exp]').forEach((x) => {
      const on = x.dataset.exp === k && x.hidden;
      x.hidden = !on;
      x.closest('.pf-item').classList.toggle('open', on);
      x.closest('.pf-item').querySelector('[data-open]')?.toggleAttribute('hidden', on);
    });
    if (k === 'mfa' && !$('[data-exp="mfa"]').hidden) startMfa();
    setTimeout(() => $(`[data-exp="${k}"]:not([hidden]) input`)?.focus(), 60);
  }
  const closeExp = (k) => { const x = $(`[data-exp="${k}"]`); if (!x.hidden) openExp(k); x.querySelectorAll('input').forEach((i) => { i.value = ''; }); };
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => openExp(b.dataset.open)));
  $$('[data-exp] [data-cancel]').forEach((b) => b.addEventListener('click', () => closeExp(b.closest('[data-exp]').dataset.exp)));
  $$('[data-eye]').forEach((b) => b.addEventListener('click', () => { const i = el.querySelector('#' + b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; }));

  // e-mail
  $('[data-e2]').addEventListener('paste', (e) => e.preventDefault());
  $('[data-email-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const e1 = $('[data-e1]').value.trim().toLowerCase(); const e2 = $('[data-e2]').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e1)) return toast('E-mail inválido', true);
    if (e1 !== e2) return toast('Os e-mails não conferem', true);
    if (e1 === (me.email || '').toLowerCase()) return toast('Esse já é o seu e-mail', true);
    btn.disabled = true;
    try {
      await DB.updateEmail(e1);
      $('[data-exp="email"]').innerHTML = `<div class="pf-note">${ICON.mailOpen}<p>Enviamos os links de confirmação para <b>${esc(e1)}</b> e para <b>${esc(me.email || '')}</b>. Abra os dois e clique no link. Até lá, continue entrando com o e-mail atual.</p></div>`;
    } catch (err) {
      btn.disabled = false;
      toast(/already|registered|exists/i.test(err.message) ? 'Esse e-mail já está em uso' : /rate|many/i.test(err.message) ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Não foi possível alterar o e-mail agora', true);
    }
  });

  // senha, com medidor de força
  const p1 = $('[data-p1]'); const meterEl = $('[data-exp="pass"] .pw-meter'); const hint = $('[data-hint]');
  p1.addEventListener('input', () => {
    const r = passwordCheck(p1.value, { email: me.email, nome: me.nome });
    meterEl.dataset.score = r.score;
    meterEl.querySelectorAll('i').forEach((b, k) => b.classList.toggle('on', !!p1.value && k < Math.max(1, r.score)));
    hint.textContent = !p1.value ? 'Mínimo de 10 caracteres, misturando letras, números e símbolos.' : r.ok ? 'Senha forte.' : 'Falta: ' + r.issues.join(', ') + '.';
  });
  $('[data-pass-ok]').addEventListener('click', async (e) => {
    const r = passwordCheck(p1.value, { email: me.email, nome: me.nome });
    if (!r.ok) return toast('Senha fraca: ' + r.issues.join(', '), true);
    if (p1.value !== $('[data-p2]').value) return toast('As senhas não conferem', true);
    const btn = e.currentTarget; btn.disabled = true;
    try { await DB.updatePassword(p1.value); toast('Senha alterada'); closeExp('pass'); meterEl.dataset.score = 0; meterEl.querySelectorAll('i').forEach((b) => b.classList.remove('on')); }
    catch (err) { fail(err); }
    btn.disabled = false;
  });

  // verificação em duas etapas
  let pending = null;
  async function startMfa() {
    const box = $('[data-exp="mfa"]');
    box.innerHTML = '<div class="pf-load"><span class="spin"></span></div>';
    try { pending = await DB.mfaEnroll(); } catch (err) { box.hidden = true; box.closest('.pf-item').classList.remove('open'); $('[data-open="mfa"]').hidden = false; return fail(err); }
    const f = pending;
    box.innerHTML = `<div class="pf-mfa">
        <div class="qr">${f.totp.qr_code ? `<img src="${esc(f.totp.qr_code)}" alt="QR code">` : '<span class="muted">Modo demo: sem QR code</span>'}</div>
        <ol class="pf-steps">
          <li>Abra um app autenticador (Google Authenticator, 1Password, Authy) e escaneie o QR code.</li>
          <li>Se preferir, digite a chave: <code class="wrap">${esc(f.totp.secret)}</code></li>
          <li>Digite o código de 6 dígitos que aparece no app.</li>
        </ol>
      </div>
      <div class="pf-otp"><input class="inp otp" data-code inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code" aria-label="Código de 6 dígitos"></div>
      <div class="pf-actions"><button class="b" data-mfa-cancel>Cancelar</button><button class="b b-primary" data-mfa-ok>Ativar</button></div>`;
    const i = box.querySelector('[data-code]');
    i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 6); });
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.querySelector('[data-mfa-ok]').click(); });
    setTimeout(() => i.focus(), 60);
    box.querySelector('[data-mfa-cancel]').addEventListener('click', () => { if (LIVE) DB.mfaUnenroll(f.id).catch(() => {}); pending = null; openExp('mfa'); });
    box.querySelector('[data-mfa-ok]').addEventListener('click', async () => {
      try { await DB.mfaVerify(f.id, i.value); pending = null; toast('Verificação em duas etapas ativada'); renderProfile(el, onSaved); }
      catch (err) { toast('Código inválido. Confira o horário do celular e tente de novo.', true); }
    });
  }
  $('[data-mfa-off]')?.addEventListener('click', () => {
    modal(`<h3>Desativar verificação em duas etapas?</h3><p class="help">Sua conta passa a pedir só a senha para entrar.</p>
      <div class="modal-foot"><button class="b" data-close>Cancelar</button><button class="b b-danger-solid" data-ok>Desativar</button></div>`, (c, close) => {
      c.querySelector('[data-ok]').addEventListener('click', async () => {
        try { for (const f of factors) await DB.mfaUnenroll(f.id); toast('Verificação em duas etapas desativada'); close(); renderProfile(el, onSaved); } catch (e) { fail(e); }
      });
    });
  });
}

// atalho usado por outras telas
export function openProfile(section) {
  if (section) tab = section;
  history.pushState(null, '', '/perfil');
  window.dispatchEvent(new Event('tracto:nav'));
}
