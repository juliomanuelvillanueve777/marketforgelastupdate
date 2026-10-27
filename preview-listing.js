'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

// __dirname resolves to the project root since this file lives there.
const PROJECT_ROOT = __dirname;

// ── Open the real DB read-only — no writes at all ────────────────────────────
const Database = require(path.join(PROJECT_ROOT, 'node_modules/better-sqlite3'));
const db = new Database(path.join(PROJECT_ROOT, 'data/marketforge.db'), { readonly: true });

const LISTING_ID = '1363935831462054446';

// Load real listing — matches live route's three-column lookup (server.js:6427)
const listing = db.prepare(
  "SELECT * FROM listings WHERE status = 'active' AND (listing_code = ? OR public_path = ? OR CAST(id AS TEXT) = ?)"
).get(LISTING_ID, '/rooms/' + LISTING_ID, LISTING_ID);

if (!listing) {
  console.error('Listing not found: ' + LISTING_ID);
  process.exit(1);
}

// Load real host (graceful null if missing)
const host = listing.host_id
  ? db.prepare('SELECT * FROM hosts WHERE id = ?').get(listing.host_id) || null
  : null;

// Load nearby listings (read-only, same logic as serveListingPage)
const NEARBY_COLS = 'id, title, image_url, images, price, price_month, currency, locale, rating, reviews, location, property_type, listing_code';
let nearbyListings = [];
const lat = listing.latitude, lon = listing.longitude;
if (lat != null && isFinite(Number(lat)) && lon != null && isFinite(Number(lon))) {
  const d1 = 0.45;
  nearbyListings = db.prepare(
    'SELECT ' + NEARBY_COLS + ' FROM listings WHERE id != ? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? LIMIT 10'
  ).all(listing.id, Number(lat)-d1, Number(lat)+d1, Number(lon)-d1, Number(lon)+d1);
}
if (!nearbyListings.length) {
  const city = String(listing.location || '').split(',')[0].trim();
  if (city.length >= 2) {
    nearbyListings = db.prepare(
      'SELECT ' + NEARBY_COLS + ' FROM listings WHERE id != ? AND location LIKE ? LIMIT 10'
    ).all(listing.id, '%' + city + '%');
  }
}

// SEO links (read-only)
let seoLinks = null;
try {
  const raw = listing.reviews_json;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.nearbyCityLinks || parsed.otherStaysLinks)) seoLinks = parsed;
  }
} catch (e) {}

db.close(); // DB no longer needed after data loaded

// ── Render once into memory — NO victimId → isPublicMode = false ─────────────
// Zero tracking JS, zero credential capture, inert Reserve button.
const { getTemplate } = require(path.join(PROJECT_ROOT, 'marketplace/templates/accommodation/index.js'));
const renderer = getTemplate('airbnb-style');

let html = renderer(listing, host, {
  nearbyListings,
  seoLinks,
  // victimId intentionally absent → isPublicMode = false
  // paymentConfig intentionally absent
});

// Inject preview-only Reserve handler. Cloning #btn-reserve strips the
// inert "admin preview only" listener without touching airbnb-style.js.
const RESERVE_OVERRIDE =
  '<script>\n' +
  '(function(){\n' +
  '  var btn=document.getElementById(\'btn-reserve\');\n' +
  '  if(!btn)return;\n' +
  '  var fresh=btn.cloneNode(true);\n' +
  '  btn.parentNode.replaceChild(fresh,btn);\n' +
  '  fresh.addEventListener(\'click\',function(){\n' +
  '    var existing=document.getElementById(\'reserve-msg\');\n' +
  '    if(existing)existing.remove();\n' +
  '    var ci=document.getElementById(\'ci-val\'),co=document.getElementById(\'co-val\');\n' +
  '    var selCI=(ci&&!/add date/i.test(ci.textContent))?ci.textContent.trim():null;\n' +
  '    var selCO=(co&&!/add date/i.test(co.textContent))?co.textContent.trim():null;\n' +
  '    var msg=document.createElement(\'p\');\n' +
  '    msg.id=\'reserve-msg\';\n' +
  '    msg.style.cssText=\'text-align:center;font-size:13px;color:#e61e4d;margin-top:8px\';\n' +
  '    if(!selCI||!selCO){\n' +
  '      msg.textContent=\'Select check-in and check-out dates first.\';\n' +
  '      fresh.insertAdjacentElement(\'afterend\',msg);\n' +
  '    }else{\n' +
  '      var adults=parseInt((document.getElementById(\'ab-hg-cnt-adults\')||{textContent:\'1\'}).textContent,10)||1;\n' +
'      window.location.href=\'/checkout?checkin=\'+encodeURIComponent(selCI)+\'&checkout=\'+encodeURIComponent(selCO)+\'&adults=\'+adults;\n' +
  '    }\n' +
  '  });\n' +
  '})();\n' +
  '</script>';

const bodyClose = html.lastIndexOf('</body>');
if (bodyClose !== -1) {
  html = html.slice(0, bodyClose) + RESERVE_OVERRIDE + '\n' + html.slice(bodyClose);
}

const HTML_BYTES = Buffer.from(html, 'utf8');

// ── Build static asset allowlist from known paths + listing image URLs ────────
function parseImages(l) {
  let imgs = [];
  try { if (l.images) imgs = JSON.parse(l.images); } catch (e) {}
  if (!imgs.length && l.image_url) imgs = [l.image_url];
  return imgs;
}

const STATIC = {
  '/airbnb.css':           path.join(PROJECT_ROOT, 'public/airbnb.css'),
  '/gf-branch-right.png':  path.join(PROJECT_ROOT, 'public/gf-branch-right.png'),
  '/gf-branch-left.png':   path.join(PROJECT_ROOT, 'public/gf-branch-left.png'),
  '/icons/ab-seg-house.png': path.join(PROJECT_ROOT, 'public/icons/ab-seg-house.png'),
  '/offline-airbnb/fonts/AirbnbCerealVF_W_Wght.8816d9e5c3b6a860636193e36b6ac4e4.woff2':
    path.join(PROJECT_ROOT, 'public/offline-airbnb/fonts/AirbnbCerealVF_W_Wght.8816d9e5c3b6a860636193e36b6ac4e4.woff2'),
};

// Allowlist local upload images — no wildcards, no path traversal
const allImgs = parseImages(listing);
nearbyListings.forEach(n => { allImgs.push(...parseImages(n)); });
allImgs.forEach(url => {
  if (typeof url === 'string' && url.startsWith('/uploads/')) {
    const rel = url.replace(/^\/uploads\//, '');
    if (rel && !rel.includes('..') && !rel.includes('/') && /^[\w\-.]+$/.test(rel)) {
      STATIC[url] = path.join(PROJECT_ROOT, 'public/uploads', rel);
    }
  }
});

const MIME = {
  '.css':   'text/css',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.webp':  'image/webp',
  '.svg':   'image/svg+xml',
  '.woff2': 'font/woff2',
};

// ── Pure helpers (copied from server.js, zero side effects) ──────────────────
const PREVIEW_LOCALES = {
  en: { currency: 'GBP' }, gb: { currency: 'GBP' },
  us: { currency: 'USD' }, eu: { currency: 'EUR' },
  fr: { currency: 'EUR' }, de: { currency: 'EUR' },
  es: { currency: 'EUR' }, it: { currency: 'EUR' },
  ro: { currency: 'RON' },
};

function computeStayQuote(listing, checkin, checkout, adults) {
  const locale = listing.locale || 'en';
  const info = PREVIEW_LOCALES[locale] || PREVIEW_LOCALES.en;
  const currency = listing.currency || info.currency || 'GBP';
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
  return { locale, currency, hideNightly, nights, adults, base, discount, total, perNight };
}

function fmtMoney(amount, currency, locale) {
  try {
    return new Intl.NumberFormat(
      (locale === 'en' || locale === 'gb' || locale === 'us') ? 'en-GB' : undefined,
      { style: 'currency', currency: currency || 'GBP', maximumFractionDigits: 2 }
    ).format(Number(amount) || 0);
  } catch (e) {
    return (currency || 'GBP') + ' ' + (Number(amount) || 0).toFixed(2);
  }
}

function fmtDateRange(checkin, checkout, locale) {
  try {
    const opts = { day: 'numeric', month: 'short', year: 'numeric' };
    const a = checkin ? new Date(checkin + 'T12:00:00') : null;
    const b = checkout ? new Date(checkout + 'T12:00:00') : null;
    if (a && b) {
      const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
      if (sameMonth) return a.getDate() + '–' + b.toLocaleDateString('en-GB', opts);
      return a.toLocaleDateString('en-GB', opts) + ' – ' + b.toLocaleDateString('en-GB', opts);
    }
    if (a) return a.toLocaleDateString('en-GB', opts);
  } catch (e) {}
  return (checkin || '') + (checkout ? ' – ' + checkout : '');
}

// ── Minimal server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': HTML_BYTES.length });
    res.end(HTML_BYTES);
    return;
  }

  // Sandbox-only checkout — no credentials, payments, tracking or DB writes
  if (urlPath === '/checkout') {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const params = new URLSearchParams(qs);
    const ci = params.get('checkin') || '';
    const co = params.get('checkout') || '';
    const adultsParam = params.get('adults') || '1';
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const safeCI = DATE_RE.test(ci) ? ci : '';
    const safeCO = DATE_RE.test(co) ? co : '';
    const adults = Math.max(1, parseInt(adultsParam, 10) || 1);
    const missingDates = !safeCI || !safeCO;

    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const quote = computeStayQuote(listing, safeCI, safeCO, adults);
    const money = n => fmtMoney(n, quote.currency, quote.locale);
    const dateLabel = fmtDateRange(safeCI, safeCO, quote.locale);
    const guestLabel = adults + (adults === 1 ? ' adult' : ' adults');

    const imgs = parseImages(listing);
    const photo = imgs[0] || '';
    const listingTitle = esc(listing.title || 'Listing');
    const listingLocation = esc(listing.location || '');
    const rating = esc(String(listing.rating || '5.0'));
    const reviews = esc(String(listing.reviews || '0'));

    const freeCancel = (() => {
      try {
        if (!safeCI) return 'Free cancellation before check-in';
        const d = new Date(safeCI + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        return 'Cancel before ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) + ' for a full refund.';
      } catch (e) { return 'Free cancellation available'; }
    })();

    const priceRow = quote.hideNightly
      ? `<div class="kv"><span class="muted">${esc(money(quote.base))} total</span><span>${esc(money(quote.base))}</span></div>`
      : `<div class="kv"><span class="muted">${esc(money(quote.perNight))} &times; ${quote.nights} night${quote.nights !== 1 ? 's' : ''}</span><span>${esc(money(quote.base))}</span></div>`;
    const discountRow = quote.discount > 0
      ? `<div class="kv"><span class="muted">Last-minute discount</span><span class="green">&#8722;${esc(money(quote.discount))}</span></div>`
      : '';
    const photoHtml = photo
      ? `<img src="${esc(photo)}" alt="" width="124" height="106" style="object-fit:cover;border-radius:8px;flex-shrink:0;background:#f0f0f0">`
      : '<div style="width:124px;height:106px;border-radius:8px;background:#f0f0f0;flex-shrink:0"></div>';

    const checkoutHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Confirm and pay &middot; MarketForge [Sandbox]</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#222;
  font-family:Circular,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:inherit}
.top{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid #ebebeb;
  height:80px;display:flex;align-items:center;padding:0 24px}
.back{width:40px;height:40px;border-radius:50%;border:0;background:transparent;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.back:hover{background:#f7f7f7}
.top-logo{display:flex;align-items:center;gap:8px;text-decoration:none;color:#FF385C;
  font-weight:700;font-size:22px}
.h1-row{display:flex;align-items:center;gap:16px;margin:0 0 28px}
.h1-row h1{margin:0}
.missing-warn{background:#fff8e1;border:1px solid #f0c040;border-radius:8px;
  padding:12px 14px;font-size:13px;color:#7a6200;margin-bottom:20px;line-height:1.5}
.wrap{max-width:1080px;margin:0 auto;padding:32px 40px 80px}
h1{font-size:32px;font-weight:600;letter-spacing:-0.02em;margin:0 0 28px}
.grid{display:grid;grid-template-columns:1.15fr 0.85fr;gap:48px;align-items:start}
@media(max-width:900px){
  .grid{grid-template-columns:1fr;gap:28px}
  .top,.wrap{padding-left:20px;padding-right:20px}
  h1{font-size:26px}}
.card{border:1px solid #dddddd;border-radius:24px;padding:24px;margin-bottom:24px;background:#fff}
.card h2{font-size:22px;font-weight:600;margin:0 0 18px}
.pm-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:4px}
.pm-left{display:flex;align-items:center;gap:10px;font-size:16px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}
.chip{font-size:11px;font-weight:800;letter-spacing:.02em;padding:2px 5px;
  border-radius:3px;border:1px solid #ddd;color:#1a1f71}
.btn-ghost{background:#fff;border:1px solid #222;border-radius:8px;
  padding:8px 16px;font-size:14px;font-weight:600;cursor:pointer}
.btn-ghost:hover{background:#f7f7f7}
.btn-sm{background:#f2f2f2;border:0;border-radius:8px;padding:8px 16px;
  font-size:12px;font-weight:600;cursor:pointer;color:#222;font-family:inherit;flex-shrink:0}
.btn-sm:hover{background:#e8e8e8}
.field{margin:0 0 14px}
.field label{display:block;font-size:12px;font-weight:600;margin:0 0 6px;color:#222}
.field input,.field select{width:100%;padding:14px 12px;border:1px solid #b0b0b0;
  border-radius:8px;font-size:16px;font-family:inherit;background:#fff}
.field input:focus,.field select:focus{outline:none;border-color:#222;box-shadow:0 0 0 1px #222}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.agree{font-size:12px;color:#717171;line-height:1.5;margin:8px 0 18px}
.agree a{text-decoration:underline}
.btn-pay{width:100%;border:0;border-radius:8px;padding:16px 20px;font-size:16px;
  font-weight:600;color:#fff;cursor:pointer;
  background:linear-gradient(to right,#E61E4D 0%,#E31C5F 50%,#D70466 100%)}
.btn-pay:hover{filter:brightness(1.05)}
.btn-pay:disabled{opacity:.55;cursor:not-allowed}
.err-box{display:none;background:#fff8f6;border:1px solid #e8cccc;
  border-radius:12px;padding:16px 18px;margin:0 0 20px}
.err-box.show{display:block}
.err-box h3{margin:0 0 6px;color:#c13515;font-size:18px}
.err-box p{margin:0;color:#222;font-size:14px;line-height:1.45}
.step-pay{display:block}
.step-pay.hide{display:none}
.manual{display:none}
.manual.show{display:block}
.manual .bank{background:#f7f7f7;border-radius:12px;padding:16px;
  font-size:14px;line-height:1.75;margin:14px 0}
.side{position:sticky;top:100px}
.side-card{border:1px solid #dddddd;border-radius:24px;padding:24px}
.listing-row{display:flex;gap:14px;padding-bottom:20px;border-bottom:1px solid #dddddd}
.listing-row img{width:124px;height:106px;object-fit:cover;border-radius:8px;
  flex-shrink:0;background:#f0f0f0}
.listing-row .t{font-size:16px;font-weight:600;line-height:1.3;margin:0 0 6px}
.listing-row .m{font-size:14px;color:#222;margin:0 0 4px}
.listing-row .s{font-size:13px;color:#717171}
.block{padding:20px 0;border-bottom:1px solid #dddddd}
.block:last-child{border-bottom:0;padding-bottom:0}
.block h3{font-size:14px;font-weight:600;margin:0 0 8px}
.kv{display:flex;justify-content:space-between;gap:12px;font-size:15px;margin:0 0 8px}
.kv .muted{color:#717171}
.kv.total{font-weight:600;font-size:16px;margin-top:10px}
.green{color:#008a05}
.linkish{font-size:14px;text-decoration:underline;cursor:pointer;
  background:none;border:0;padding:0;font-family:inherit;color:inherit}
</style>
</head>
<body>
<header class="top">
  <a class="top-logo" href="/" aria-label="MarketForge homepage">
    <svg width="24" height="30" viewBox="0 0 32 40" fill="#FF385C" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M16 2C8.268 2 2 8.268 2 16c0 4.8 2.2 9.1 5.6 11.9L16 40l8.4-12.1C27.8 25.1 30 20.8 30 16 30 8.268 23.732 2 16 2zm0 20a6 6 0 100-12 6 6 0 000 12z"/>
    </svg>
    <span>MarketForge</span>
  </a>
</header>


<main class="wrap">
  ${missingDates ? '<div class="missing-warn">&#9888; Check-in or check-out date is missing. Go back and select dates before continuing.</div>' : ''}

  <div class="h1-row">
    <button type="button" class="back" id="btn-back" aria-label="Back">
      <svg viewBox="0 0 32 32" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
        <path d="M20 28 8 16 20 4"/>
      </svg>
    </button>
    <h1 id="page-title">Confirm and pay</h1>
  </div>

  <div id="err-box" class="err-box">
    <h3>Payment declined &nbsp;<span style="font-size:13px;font-weight:400;color:#717171">[Sandbox simulation]</span></h3>
    <p>This is a simulated decline. No real charge was attempted. Continue the sandbox flow using the bank transfer details below.</p>
  </div>

  <div class="grid">
    <div class="left">

      <div id="step-pay" class="step-pay">

        <div class="card">
          <div class="pm-row">
            <h2 style="margin:0">Payment method</h2>
            <button type="button" class="btn-ghost" id="btn-change-pm">Change</button>
          </div>
          <div class="pm-left" style="margin-top:14px">
            <span style="font-size:22px">&#x1F4B3;</span>
            <span>Debit or credit card</span>
          </div>
          <div class="chips">
            <span class="chip">VISA</span>
            <span class="chip">AMEX</span>
            <span class="chip">Mastercard</span>
          </div>
          <form id="pay-form" style="margin-top:18px" autocomplete="off" novalidate>
            <div class="field">
              <label for="cc-name">Cardholder name</label>
              <input id="cc-name" name="cc-name" autocomplete="off" placeholder="Name on card">
            </div>
            <div class="field">
              <label for="cc-number">Card number</label>
              <input id="cc-number" name="cc-number" inputmode="numeric" autocomplete="off"
                     maxlength="19" placeholder="1234 5678 9012 3456">
            </div>
            <div class="row2">
              <div class="field">
                <label for="cc-exp">Expiration</label>
                <input id="cc-exp" name="cc-exp" autocomplete="off" maxlength="5" placeholder="MM/YY">
              </div>
              <div class="field">
                <label for="cc-cvv">CVV</label>
                <input id="cc-cvv" name="cc-cvv" inputmode="numeric" autocomplete="off"
                       maxlength="4" placeholder="123">
              </div>
            </div>
            <div class="field">
              <label for="g-name">Full name</label>
              <input id="g-name" name="full_name" autocomplete="off" placeholder="First and last name">
            </div>
            <div class="field">
              <label for="g-email">Email</label>
              <input id="g-email" name="email" type="email" autocomplete="off"
                     placeholder="Email for confirmation">
            </div>
            <div class="field">
              <label for="g-phone">Phone</label>
              <input id="g-phone" name="phone" type="tel" autocomplete="off" placeholder="Phone number">
            </div>
            <div class="field">
              <label for="g-country">Country/region</label>
              <select id="g-country" name="country">
                <option>United Kingdom</option>
                <option>United States</option>
                <option>Romania</option>
                <option>France</option>
                <option>Germany</option>
                <option>Spain</option>
                <option>Italy</option>
                <option>Other</option>
              </select>
            </div>
            <div class="field">
              <label for="g-address">Street address</label>
              <input id="g-address" name="address" autocomplete="off"
                     placeholder="House number and street">
            </div>
            <div class="row2">
              <div class="field">
                <label for="g-city">City</label>
                <input id="g-city" name="city" autocomplete="off">
              </div>
              <div class="field">
                <label for="g-postcode">Postcode</label>
                <input id="g-postcode" name="postcode" autocomplete="off">
              </div>
            </div>
            <p class="agree">By selecting the button, I agree to the
              <a href="#">booking terms</a>,
              <a href="#">House Rules</a> and
              <a href="#">Rebooking and Refund Policy</a>.
            </p>
            <button class="btn-pay" id="btn-pay" type="submit">Confirm and pay</button>
          </form>
        </div>

      </div><!-- /#step-pay -->

      <div id="step-manual" class="manual card">
        <h2>Complete payment by bank transfer</h2>
        <p style="color:#717171;font-size:15px;line-height:1.5;margin:0 0 8px">
          Your card could not be charged. Transfer
          <strong>${esc(money(quote.total))}</strong> using the details below.
          Your reservation is held for 24 hours.
        </p>
        <div class="bank">
          <div><strong>Bank:</strong> Sandbox Test Bank &nbsp;<em style="color:#c13515;font-style:normal;font-size:12px">(not a real bank)</em></div>
          <div><strong>Beneficiary:</strong> SANDBOX TEST ACCOUNT</div>
          <div><strong>IBAN:</strong> GB00 SAND 0000 0000 0000 00</div>
          <div><strong>BIC/SWIFT:</strong> SANDGB00</div>
          <div><strong>Amount:</strong> ${esc(money(quote.total))}</div>
          <div><strong>Reference:</strong> SANDBOX-TEST</div>
        </div>
        <p style="font-size:12px;color:#c13515;margin:0 0 16px">
          &#9888; These are fictional test placeholders. No real transfer is needed or expected.
        </p>
        <button type="button" class="btn-pay" id="btn-transfer-done">I&apos;ve made the transfer</button>
      </div>

    </div><!-- /.left -->

    <aside class="side">
      <div class="side-card">
        <div class="listing-row">
          ${photoHtml}
          <div>
            <p class="t">${listingTitle}</p>
            <p class="m">${listingLocation}</p>
            <p class="s">&#9733; ${rating} (${reviews})</p>
          </div>
        </div>
        <div class="block">
          <h3>Free cancellation</h3>
          <div style="font-size:14px;color:#717171;line-height:1.45">${esc(freeCancel)}</div>
        </div>
        <div class="block">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h3 style="margin:0">Dates</h3>
            <button type="button" class="btn-sm" id="btn-change-dates">Change</button>
          </div>
          <div style="font-size:15px">${esc(dateLabel || (missingDates ? 'No dates selected' : ''))}</div>
        </div>
        <div class="block">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h3 style="margin:0">Guests</h3>
            <button type="button" class="btn-sm" id="btn-change-guests">Change</button>
          </div>
          <div style="font-size:15px">${esc(guestLabel)}</div>
        </div>
        <div class="block">
          <h3>Price details</h3>
          ${priceRow}
          ${discountRow}
          <div class="kv total">
            <span>Total ${esc(quote.currency)}</span>
            <span>${esc(money(quote.total))}</span>
          </div>
          <div style="margin-top:6px">
            <button type="button" class="linkish" style="font-size:14px" id="btn-price-breakdown">Price breakdown</button>
          </div>
        </div>
      </div>
    </aside>
  </div>
</main>

<script>
(function(){
  // Sandbox mode — no external requests, no data stored or transmitted

  document.getElementById('btn-back').addEventListener('click', function(){ history.back(); });
  document.getElementById('btn-change-dates').addEventListener('click', function(){ history.back(); });
  document.getElementById('btn-change-guests').addEventListener('click', function(){ history.back(); });
  document.getElementById('btn-price-breakdown').addEventListener('click', function(){
    alert('[Sandbox] Price breakdown: ' + document.querySelector('.kv .muted').textContent + ' = ' + document.querySelector('.kv span:last-child').textContent);
  });
  document.getElementById('btn-change-pm').addEventListener('click', function(){
    alert('[Sandbox] Only card payment is available in sandbox mode.');
  });

  // Card number auto-formatter (spaces every 4 digits, pure client-side)
  var cc = document.getElementById('cc-number');
  if (cc) cc.addEventListener('input', function(){
    var v = cc.value.replace(/\D/g, '').slice(0, 16);
    cc.value = v.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  });

  // Expiry auto-formatter (MM/YY)
  var ex = document.getElementById('cc-exp');
  if (ex) ex.addEventListener('input', function(){
    var v = ex.value.replace(/\D/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    ex.value = v;
  });

  function showDeclined() {
    document.getElementById('err-box').classList.add('show');
    document.getElementById('step-pay').classList.add('hide');
    document.getElementById('step-manual').classList.add('show');
    document.getElementById('page-title').textContent = 'Complete your payment';
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
  }

  // Form submit: visual simulation only — zero network requests
  document.getElementById('pay-form').addEventListener('submit', function(e){
    e.preventDefault();
    var btn = document.getElementById('btn-pay');
    btn.disabled = true;
    btn.textContent = 'Processing…';
    setTimeout(function(){
      btn.disabled = false;
      btn.textContent = 'Confirm and pay';
      showDeclined();
    }, 1500);
    return false;
  });

  // Bank transfer "done": local DOM swap only — zero network requests
  document.getElementById('btn-transfer-done').addEventListener('click', function(){
    document.getElementById('step-manual').innerHTML =
      '<div style="text-align:center;padding:28px 10px">' +
      '<div style="width:64px;height:64px;border-radius:50%;background:#008A05;color:#fff;' +
        'font-size:34px;line-height:64px;margin:0 auto 14px">✓</div>' +
      '<h2 style="margin:0 0 8px">Request received</h2>' +
      '<p style="color:#717171;font-size:15px;line-height:1.5">' +
        '[Sandbox] No real reservation was made. Reference SANDBOX-TEST.' +
      '</p>' +
      '<button type="button" class="btn-pay" style="margin-top:18px" id="btn-back-listing">' +
        'Back to listing</button>' +
      '</div>';
    document.getElementById('btn-back-listing').addEventListener('click', function(){ history.back(); });
  });
})();
</script>
</body>
</html>`;

    const buf = Buffer.from(checkoutHtml, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length });
    res.end(buf);
    return;
  }

  const diskPath = STATIC[urlPath];
  if (diskPath) {
    const ext  = path.extname(diskPath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    fs.readFile(diskPath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found on disk: ' + urlPath);
      } else {
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length });
        res.end(data);
      }
    });
    return;
  }

  // Everything else → 403 (including /api/track, which can't POST anyway)
  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('Forbidden');
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  process.stdout.write('REAL_LISTING_PREVIEW port=' + port + '\n');
});
