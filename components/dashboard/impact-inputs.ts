/** Fixed Korean wall time in forms; never depend on the browser's locale. */
export function impactKoreanTimeToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('한국 시간의 날짜와 시각을 입력하세요.');
  const iso = new Date(`${value}:00+09:00`).toISOString();
  if (new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) !== value) throw new Error('유효한 날짜와 시각을 입력하세요.');
  return iso;
}
export function impactCurrencyDigits(currency: string) {
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
/** Preserve missing as null; parse decimal money without fractional binary arithmetic. */
export function impactRevenueToMinor(value: string, currency: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = impactCurrencyDigits(currency);
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) throw new Error('매출은 0 이상의 숫자로 입력하세요. 지수 표기는 사용할 수 없어요.');
  const [whole, fractional = ''] = trimmed.split('.');
  if (fractional.length > digits) throw new Error(`${currency} 금액은 소수점 ${digits}자리까지 입력할 수 있어요.`);
  const amount = Number(`${whole}${fractional.padEnd(digits, '0')}`);
  if (!Number.isSafeInteger(amount) || amount > 1_000_000_000_000) throw new Error('입력한 매출이 저장할 수 있는 한도를 넘었어요.');
  return amount;
}
export function impactPeriodError(plan: { beforeStart: string; beforeEnd: string; afterStart: string; afterEnd: string; changedAt: string }) {
  const dayMs = 86_400_000;
  const dates = [plan.beforeStart, plan.beforeEnd, plan.afterStart, plan.afterEnd];
  if (dates.some(value => !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return '시작일과 종료일을 올바른 날짜로 입력하세요.';
  const [a, b, c, d] = dates.map(value => Date.parse(value));
  if (b < a || d < c || b >= c) return '변경 전 기간이 먼저 오고, 변경 후 기간과 겹치지 않도록 정하세요.';
  if (b - a !== d - c) return '변경 전과 후의 기간 길이를 같게 정하세요.';
  if (b - a >= 90 * dayMs) return '각 기간은 시작일과 종료일을 포함해 1~90일로 정하세요.';
  const changedAt = Date.parse(plan.changedAt);
  if (!Number.isFinite(changedAt) || changedAt < b + dayMs || changedAt > c) return '콘텐츠 적용 시각은 변경 전 종료일 다음 날 00:00 UTC 이후, 변경 후 시작일 00:00 UTC 이전이어야 해요. 한국 시간은 UTC보다 9시간 빨라요.';
  return '';
}
