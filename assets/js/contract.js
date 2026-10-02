// Campos de contrato usados em todo lugar que lança venda: serviço (marketing/marketplace),
// tipo (mensal, semestral, anual, pagamento único), duração e valores.
import { esc, brl } from './util.js?v=2610020948';

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

// quanto cada formato cobra por vez: mensal 1 mês, semestral 6, anual 12, único 1
export const planFactor = (k) => ({ semestral: 6, anual: 12 })[k] || 1;
export const VALUE_LABEL = { mensal: 'Mensalidade (R$)', semestral: 'Valor do semestre (R$)', anual: 'Valor anual (R$)', unico: 'Valor do pagamento (R$)' };

// v = { service, plan, months, monthly, total }
export function contractFields(v = {}, { defaultMonths = 12 } = {}) {
  const plan = v.plan || 'mensal';
  const months = plan === 'mensal' ? v.months || defaultMonths : planMonths(plan, defaultMonths);
  // o campo mostra o valor do formato (semestre, ano, pagamento); por trás guardamos o equivalente mensal
  const val = plan === 'unico' ? v.total || v.monthly : plan === 'mensal' ? v.monthly : (v.total || (v.monthly ? v.monthly * planFactor(plan) : null));
  return `<div class="ctr" data-ctr data-default-months="${defaultMonths}">
    <div class="grid2">
      <div class="row"><span class="lbl">Serviço</span><div class="seg ctr-seg" role="radiogroup" aria-label="Serviço">${SERVICES.map(([k, n]) => `<button type="button" class="b ${(v.service || 'marketing') === k ? 'on' : ''}" role="radio" aria-checked="${(v.service || 'marketing') === k}" data-svc="${k}">${n}</button>`).join('')}</div></div>
      <div class="row"><label class="lbl" for="ctrPlan">Tipo de contrato</label><select class="inp" id="ctrPlan" data-plan>${PLANS.map(([k, n]) => `<option value="${k}" ${plan === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    <div class="grid2" data-vals>
      <div class="row"><label class="lbl" for="ctrVal" data-val-l>${VALUE_LABEL[plan]}</label><input class="inp" id="ctrVal" data-val inputmode="decimal" placeholder="R$ 0,00" value="${fmtN(val)}"></div>
      <div class="row" data-mo-row><label class="lbl" for="ctrMo">Previsão (meses)</label><input class="inp" id="ctrMo" data-mo inputmode="numeric" value="${months}"></div>
    </div>
    <p class="help ctr-help" data-ctr-help></p>
  </div>`;
}

// liga o bloco e devolve read(): { service, plan, months, monthly_amount, amount } ou { error }
export function bindContract(root) {
  const $ = (s) => root.querySelector(s);
  const def = Number($('[data-ctr]').dataset.defaultMonths) || 12;
  let service = root.querySelector('[data-svc].on')?.dataset.svc || 'marketing';
  let prev = $('[data-plan]').value;
  const plan = () => $('[data-plan]').value;
  const monthsOf = (p) => (p === 'mensal' ? Math.round(parse($('[data-mo]').value)) : planMonths(p, def));
  const help = () => {
    const p = plan(); const v = parse($('[data-val]').value); const m = monthsOf(p);
    const base = {
      mensal: 'Renova todo mês até ser cancelado. A previsão em meses só estima o valor do contrato.',
      semestral: 'Contrato de 6 meses, pago por semestre.',
      anual: 'Contrato de 12 meses, pago por ano.',
      unico: 'Entra no faturamento do dia da venda. Não conta na receita recorrente nem no churn.'
    }[p];
    const calc = !(v > 0) ? '' : p === 'unico' ? '' : p === 'mensal' ? ` Contrato estimado: ${brl(v * (m || 0))}.` : ` Equivale a ${(v / planFactor(p)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })} por mês.`;
    $('[data-ctr-help]').textContent = base + calc;
  };
  const layout = (fromChange) => {
    const p = plan();
    $('[data-val-l]').textContent = VALUE_LABEL[p];
    $('[data-mo-row]').hidden = p !== 'mensal';
    $('[data-vals]').classList.toggle('one', p !== 'mensal');
    // troca de formato: converte pelo equivalente mensal (ex.: R$ 1.000/mês vira R$ 6.000 no semestral)
    if (fromChange) {
      const v = parse($('[data-val]').value);
      if (v > 0 && p !== 'unico' && prev !== 'unico') $('[data-val]').value = fmtN((v / planFactor(prev)) * planFactor(p));
      prev = p;
    }
    help();
  };
  root.querySelectorAll('[data-svc]').forEach((b) => b.addEventListener('click', () => {
    service = b.dataset.svc;
    root.querySelectorAll('[data-svc]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
  }));
  $('[data-plan]').addEventListener('change', () => layout(true));
  $('[data-val]').addEventListener('input', help);
  $('[data-mo]').addEventListener('input', help);
  $('[data-val]').addEventListener('blur', (e) => { const v = parse(e.target.value); if (v > 0) e.target.value = fmtN(v); });
  layout(false);
  return {
    read() {
      const p = plan(); const v = parse($('[data-val]').value); const months = monthsOf(p);
      if (!(v > 0)) return { error: `Informe o ${VALUE_LABEL[p].replace(' (R$)', '').toLowerCase()}` };
      if (p === 'unico') return { service, plan: p, months: 1, monthly_amount: v, amount: v };
      if (!(months >= 1 && months <= 120)) return { error: 'Previsão entre 1 e 120 meses' };
      const monthly = v / planFactor(p);
      return { service, plan: p, months, monthly_amount: Math.round(monthly * 100) / 100, amount: p === 'mensal' ? v * months : v };
    }
  };
}
