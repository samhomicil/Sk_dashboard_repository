export const money2 = (n: number | null | undefined) =>
  n == null
    ? '—'
    : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money0 = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-US');

export const pct = (n: number | null | undefined, digits = 1) =>
  n == null ? '—' : (n * 100).toFixed(digits) + '%';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const ymLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MON[m - 1]} ${y}`;
};
export const dayLabel = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${MON[m - 1]} ${d}`;
};
