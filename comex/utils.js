const MONTH_MAP = {JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12};

export function cleanNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v | 0;
  const s = String(v).trim();
  if (s === '' || s === '-') return 0;
  return parseInt(s.replace(/,/g, ''), 10) || 0;
}

export function parseMonthID(monthID) {
  const parts = String(monthID).split('-');
  const m = MONTH_MAP[(parts[0] || '').toUpperCase()] || 0;
  const yRaw = parts[1] || '9999';
  const yNum = /^[0-9]{2}$/.test(yRaw) ? (2000 + parseInt(yRaw, 10)) :
    /^[0-9]{4}$/.test(yRaw) ? parseInt(yRaw, 10) : 9999;
  return [yNum, m, monthID];
}

export function compareContracts(a, b) {
  const pa = parseMonthID(a), pb = parseMonthID(b);
  if (pa[0] !== pb[0]) return pa[0] - pb[0];
  if (pa[1] !== pb[1]) return pa[1] - pb[1];
  return String(pa[2]).localeCompare(String(pb[2]));
}

export function fmtMMDD(yyyymmdd) {
  const s = String(yyyymmdd);
  return `${s.slice(4, 6)}/${s.slice(6, 8)}`;
}

export function fmtContract(monthID) {
  return String(monthID).replace('-Calls', '').replace('-', ' ');
}

export function getDayName(yyyymmdd) {
  const dateObj = new Date(yyyymmdd.slice(0,4), parseInt(yyyymmdd.slice(4,6))-1, yyyymmdd.slice(6,8));
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dateObj.getDay()];
}

export function getContractValue(dayData, contract, metric) {
  for (const item of dayData.monthData || []) {
    if (item.monthID === contract) {
      return cleanNumber(item[metric]);
    }
  }
  return 0;
}
