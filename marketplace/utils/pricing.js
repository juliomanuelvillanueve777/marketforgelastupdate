// Marketplace pricing and date formatting utilities.
// Source: server.js lines 5827-5879 (computeStayQuote, fmtMoney, fmtDateRange).
// No database access. No network calls. No reservation or payment logic.

const { LOCALES } = require('./constants');

// Computes a stay price breakdown from listing fields plus optional date/guest inputs.
// Arguments:
//   listing  — object with .locale, .currency, .hide_nightly, .price, .price_month
//   checkin  — ISO date string 'YYYY-MM-DD' or null/undefined
//   checkout — ISO date string 'YYYY-MM-DD' or null/undefined
//   adults   — integer number of guests or null/undefined
// Returns:
//   { locale, currency, sym, hideNightly, nights, adults, base, discount, total, perNight, priceNight, priceMonth }
function computeStayQuote(listing, checkin, checkout, adults) {
  const locale = listing.locale || 'en';
  const info = LOCALES[locale] || LOCALES.en;
  const currency = listing.currency || info.currency || 'GBP';
  const sym = info.currencySymbol || '£';
  const hideNightly = Number(listing.hide_nightly) === 1;
  const priceNight = parseFloat(listing.price) || 0;
  const priceMonth = parseFloat(listing.price_month) || (priceNight ? Math.round(priceNight * 28) : 0);
  let nights = 2;
  try {
    if (checkin && checkout) {
      const a = new Date(checkin + 'T12:00:00');
      const b = new Date(checkout + 'T12:00:00');
      const d = Math.round((b - a) / 86400000);
      if (d > 0 && d < 370) nights = d;
    }
  } catch (e) {}
  adults = Math.max(1, parseInt(adults, 10) || 1);
  let base = hideNightly ? (priceMonth || priceNight * nights) : (priceNight * nights);
  if (!base || base <= 0) base = hideNightly ? 2100 : 70 * nights;
  base = Math.round(base * 100) / 100;
  const discount = hideNightly ? 0 : Math.round(base * 0.06 * 100) / 100;
  const total = Math.max(0, Math.round((base - discount) * 100) / 100);
  const perNight = nights ? Math.round((base / nights) * 100) / 100 : priceNight;
  return { locale, currency, sym, hideNightly, nights, adults, base, discount, total, perNight, priceNight, priceMonth };
}

// Formats a monetary amount using Intl.NumberFormat with currency style.
// Returns a string such as "£180.00" or "EUR 150.00" on error.
function fmtMoney(amount, currency, locale) {
  try {
    return new Intl.NumberFormat(locale === 'en' || locale === 'gb' || locale === 'us' ? 'en-GB' : undefined, {
      style: 'currency', currency: currency || 'GBP', maximumFractionDigits: 2
    }).format(Number(amount) || 0);
  } catch (e) {
    return (currency || 'GBP') + ' ' + (Number(amount) || 0).toFixed(2);
  }
}

// Formats a check-in/checkout pair as a human-readable date range.
// Example: "5–10 Mar 2025" or "28 Feb 2025 – 3 Mar 2025"
// Falls back gracefully to raw strings if dates are invalid.
function fmtDateRange(checkin, checkout, locale) {
  try {
    const opts = { day: 'numeric', month: 'short', year: 'numeric' };
    const a = checkin ? new Date(checkin + 'T12:00:00') : null;
    const b = checkout ? new Date(checkout + 'T12:00:00') : null;
    if (a && b) {
      const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
      if (sameMonth) {
        return a.getDate() + '–' + b.toLocaleDateString('en-GB', opts);
      }
      return a.toLocaleDateString('en-GB', opts) + ' – ' + b.toLocaleDateString('en-GB', opts);
    }
    if (a) return a.toLocaleDateString('en-GB', opts);
  } catch (e) {}
  return (checkin || '') + (checkout ? ' – ' + checkout : '');
}

module.exports = {
  computeStayQuote,
  fmtMoney,
  fmtDateRange
};
