// Campos de contrato usados em todo lugar que lança venda: serviço (marketing/marketplace),
// tipo (mensal, semestral, anual, pagamento único), duração e valores.
import { esc, brl } from './util.js?v=2609291406';

export const SERVICES = [['marketing', 'Marketing'], ['marketplace', 'Marketplace']];
// meses padrão de cada tipo (mensal renova todo mês até cancelar; usa a previsão só pra estimar o valor do contrato)
export const PLANS = [['mensal', 'Mensal', null], ['semestral', 'Semestral', 6], ['anual', 'Anual', 12], ['unico', 'Pagamento único', 1]];
export const serviceName = (k) => SERVICES.find(([v]) => v === k)?.[1] || '';
export const planName = (k) => PLANS.find(([v]) => v === k)?.[1] || '';
export const planMonths = (k, fallback = 12) => PLANS.find(([v]) => v === k)?.[2] ?? fallback;

const parse = (v) => Number(String(v || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
const fmtN = (n) => (Number(n) > 0 ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

// etiquetas curtas pra listas: "Marketing · Anual"
export function contractTags(service, plan) {
  return [service ? `<span class="pill svc svc-${esc(service)}">${esc(serviceName(service))}</span>` : '', plan ? `<span class="pill">${esc(planName(plan))}</span>` : ''].join('');
}

// v = { service, plan, months, monthly, total }
export function contractFields(v = {}, { defaultMonths = 12 } = {}) {
  const plan = v.plan || 'mensal';
  const months = v.months || planMonths(plan, defaultMonths);
  return `<div class="ctr" data-ctr data-default-months="${defaultMonths}">
    <div class="grid2">
      <div class="row"><span class="lbl">Serviço</span><div class="seg ctr-seg" role="radiogroup" aria-label="Serviço">${SERVICES.map(([k, n]) => `<button type="button" class="b ${(v.service || 'marketing') === k ? 'on' : ''}" role="radio" aria-checked="${(v.service || 'marketing') === k}" data-svc="${k}">${n}</button>`).join('')}</div></div>
      <div class="row"><label class="lbl" for="ctrPlan">Tipo de contrato</label><select class="inp" id="ctrPlan" data-plan>${PLANS.map(([k, n]) => `<option value="${k}" ${plan === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    <div class="grid3" data-rec>
      <div class="row"><label class="lbl" data-mo-l>Meses de contrato</label><input class="inp" data-mo inputmode="numeric" value="${months}"></div>
      <div class="row"><label class="lbl">Valor mensal (R$)</label><input class="inp" data-monthly inputmode="decimal" placeholder="0,00" value="${fmtN(v.monthly)}"></div>
      <div class="row"><label class="lbl">Valor total (R$)</label><input class="inp" data-total inputmode="decimal" placeholder="0,00" value="${fmtN(v.total)}"></div>
    </div>
    <div class="row" data-one hidden><label class="lbl">Valor (R$)</label><input class="inp" data-once inputmode="decimal" placeholder="0,00" value="${plan === 'unico' ? fmtN(v.total || v.monthly) : ''}"></div>
    <p class="help ctr-help" data-ctr-help></p>
  </div>`;
}

// liga o bloco e devolve read(): { service, plan, months, monthly_amount, amount } ou { error }
export function bindContract(root) {
  const $ = (s) => root.querySelector(s);
  const box = $('[data-ctr]');
  const def = Number(box.dataset.defaultMonths) || 12;
  let service = root.querySelector('[data-svc].on')?.dataset.svc || 'marketing';
  const monthly0 = parse($('[data-monthly]').value); const months0 = Math.round(parse($('[data-mo]').value));
  let totalTouched = !!(monthly0 && months0 && parse($('[data-total]').value) && Math.abs(monthly0 * months0 - parse($('[data-total]').value)) > 0.009);
  const plan = () => $('[data-plan]').value;
  const recalc = () => {
    if (totalTouched) return;
    const m = Math.round(parse($('[data-mo]').value)); const v = parse($('[data-monthly]').value);
    $('[data-total]').value = m > 0 && v > 0 ? fmtN(m * v) : '';
  };
  const HELP = {
    mensal: 'Renova todo mês até ser cancelado. Os meses são só uma previsão pra estimar o valor do contrato.',
    semestral: 'Contrato de 6 meses. Entra na receita recorrente até o fim ou até o cancelamento.',
    anual: 'Contrato de 12 meses. Entra na receita recorrente até o fim ou até o cancelamento.',
    unico: 'Entra no faturamento do dia da venda. Não conta na receita recorrente nem no churn.'
  };
  const layout = (fromChange) => {
    const p = plan(); const one = p === 'unico';
    $('[data-rec]').hidden = one; $('[data-one]').hidden = !one;
    $('[data-mo-l]').textContent = p === 'mensal' ? 'Previsão (meses)' : 'Meses de contrato';
    $('[data-ctr-help]').textContent = HELP[p];
    if (fromChange && !one) { $('[data-mo]').value = planMonths(p, def); totalTouched = false; recalc(); }
    if (fromChange && one && !parse($('[data-once]').value)) { const t = parse($('[data-total]').value) || parse($('[data-monthly]').value); if (t) $('[data-once]').value = fmtN(t); }
  };
  root.querySelectorAll('[data-svc]').forEach((b) => b.addEventListener('click', () => {
    service = b.dataset.svc;
    root.querySelectorAll('[data-svc]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
  }));
  $('[data-plan]').addEventListener('change', () => layout(true));
  $('[data-mo]').addEventListener('input', recalc);
  $('[data-monthly]').addEventListener('input', recalc);
  $('[data-total]').addEventListener('input', (e) => { totalTouched = e.target.value.trim() !== ''; if (!totalTouched) recalc(); });
  ['[data-monthly]', '[data-total]', '[data-once]'].forEach((s) => $(s).addEventListener('blur', (e) => { const v = parse(e.target.value); if (v > 0) e.target.value = fmtN(v); }));
  layout(false);
  if (!parse($('[data-total]').value)) recalc();
  return {
    read() {
      const p = plan();
      if (p === 'unico') {
        const v = parse($('[data-once]').value);
        if (!(v > 0)) return { error: 'Informe o valor' };
        return { service, plan: p, months: 1, monthly_amount: v, amount: v };
      }
      const months = Math.round(parse($('[data-mo]').value)); const monthly = parse($('[data-monthly]').value); const total = parse($('[data-total]').value) || monthly * months;
      if (!(months >= 1 && months <= 120)) return { error: 'Meses de contrato entre 1 e 120' };
      if (!(monthly > 0)) return { error: 'Informe o valor mensal' };
      return { service, plan: p, months, monthly_amount: monthly, amount: total };
    },
    summary() { const r = this.read(); return r.error ? '' : r.plan === 'unico' ? `Pagamento único de ${brl(r.amount)}` : `Contrato total: ${brl(r.amount)}`; }
  };
}
