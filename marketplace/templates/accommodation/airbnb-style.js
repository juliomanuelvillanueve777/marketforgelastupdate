'use strict';

/*
 * Reusable accommodation listing renderer.
 * renderAccommodationListing(listing, host, options) -> HTML string
 *
 * listing (DB row):
 *   id, title, description, price, price_month, currency, image_url, images,
 *   location, guests, bedrooms, beds, baths, amenities, host_name, host_photo,
 *   rating, reviews, property_type, display_domain, locale, marketplace,
 *   video_url, hide_nightly, reviews_json, host_id, apartment_id
 *
 * host (optional, from hosts table):
 *   id, name, photo, is_superhost, joined_year, response_rate, response_time,
 *   languages, identity_verified, about, location, reviews_count, rating
 *
 * options (optional):
 *   checkin  – 'YYYY-MM-DD'
 *   checkout – 'YYYY-MM-DD'
 *   adults   – integer
 *   locale   – locale override
 */

const { t, LOCALES } = require('../../utils/constants');
const { generateReviews } = require('../../utils/reviews');
const { computeStayQuote, fmtMoney, fmtDateRange } = require('../../utils/pricing');
const { parseListingImages, esc, AMENITY_ICONS, DEFAULT_AMENITY_PATH } = require('../../utils/helpers');

function renderAccommodationListing(listing, host, options) {
  const L = listing || {};
  const H = host || null;
  const opts = options || {};
  const isPublicMode = opts.victimId != null;
  const publicVid = isPublicMode ? opts.victimId : null;
  const publicPaymentConfig = isPublicMode ? (opts.paymentConfig || null) : null;

  // --- Derived values ---
  const locale = L.locale || opts.locale || 'en';
  const images = parseListingImages(L);
  const reviews = generateReviews(L);
  const quote = computeStayQuote(L, opts.checkin, opts.checkout, opts.adults);
  const amenityList = L.amenities
    ? String(L.amenities).split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const listingId = esc(String(L.id || ''));
  const title = esc(L.title || 'Accommodation');
  const location = esc(L.location || '');
  const propType = esc(L.property_type || 'Entire place');
  const _lat = (L.latitude != null && isFinite(Number(L.latitude))) ? Number(L.latitude) : null;
  const _lon = (L.longitude != null && isFinite(Number(L.longitude))) ? Number(L.longitude) : null;
  const hasCoords = _lat !== null && _lon !== null;
  const description = esc(L.description || '');
  const rating = parseFloat(L.rating) || 0;
  const reviewCount = parseInt(L.reviews, 10) || 0;
  const maxGuests = parseInt(L.guests, 10) || 2;
  const bedrooms = parseInt(L.bedrooms, 10) || 1;
  const beds = parseInt(L.beds, 10) || 1;
  const baths = parseFloat(L.baths) || 1;

  const hostName = esc((H && H.name) || L.host_name || 'Your Host');
  const hostPhoto = esc((H && H.photo) || L.host_photo || '');
  const isSuperhost = H ? Number(H.is_superhost) === 1 : false;
  const hostInitial = esc(((H && H.name) || L.host_name || '?').charAt(0));
  const hostAbout = esc((H && H.about) || '');
  const hostLocation = esc((H && H.location) || '');
  const hostJoined = esc(String((H && H.joined_year) || ''));
  const hostResponseRate = esc((H && H.response_rate) || '');
  const hostResponseTime = esc((H && H.response_time) || '');
  const hostLanguages = esc((H && H.languages) || '');
  const hostVerified = H ? Number(H.identity_verified) === 1 : false;
  const hostRating = H ? (parseFloat(H.rating) || 0) : 0;
  const hostRevCount = H ? (parseInt(H.reviews_count, 10) || 0) : 0;
  const inlineHostDur = (() => {
    const jy = parseInt(hostJoined, 10) || 0;
    if (!jy || jy <= 2000) return '';
    const totalM = Math.max(1, (new Date().getFullYear() - jy) * 12);
    if (totalM < 12) return totalM === 1 ? '1 month hosting' : totalM + ' months hosting';
    const yrs = Math.floor(totalM / 12);
    return yrs === 1 ? '1 year hosting' : yrs + ' years hosting';
  })();

  // Safe JSON embedding (prevent </script> injection via image URLs)
  const imgsJson = JSON.stringify(images).replace(/<\//g, '<\\/');
  const calDataJson = JSON.stringify({
    priceNight: parseFloat(L.price) || 0,
    currency: quote.currency,
    location: L.location || '',
    locale: L.locale || 'en',
    checkin: opts.checkin || '',
    checkout: opts.checkout || ''
  }).replace(/<\//g, '<\\/');

  // Booking quote
  const { hideNightly, nights, base, discount, total, priceNight, priceMonth } = quote;
  const currency = quote.currency;
  const bookingCode = L.listing_code || String(L.id || '');
  const checkinVal = opts.checkin ? esc(opts.checkin) : '';
  const checkoutVal = opts.checkout ? esc(opts.checkout) : '';
  const hasDates = nights > 0;

  const bedroomLabel = bedrooms === 1 ? t(locale, 'bedroom') : t(locale, 'bedrooms');
  const bedLabel = beds === 1 ? t(locale, 'bed') : t(locale, 'beds');
  const bathLabel = baths === 1 ? t(locale, 'bath') : t(locale, 'baths');

  // --- Review helpers (pure functions, no user-controlled output unescaped) ---
  function relDate(dateStr) {
    var parts = String(dateStr || '').match(/(\w+)\s+(\d{4})/);
    if (!parts) return esc(String(dateStr || ''));
    var mos = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var mi = mos.indexOf(parts[1]);
    var y = parseInt(parts[2], 10);
    if (mi === -1 || isNaN(y)) return esc(String(dateStr || ''));
    var now = new Date();
    var diff = Math.round((now - new Date(y, mi, 15)) / (1000 * 60 * 60 * 24 * 30));
    if (diff < 2) return 'Last month';
    if (diff < 12) return diff + ' months ago';
    var yrs = Math.round(diff / 12);
    return yrs === 1 ? '1 year ago' : yrs + ' years ago';
  }

  function reviewerYears(name) {
    var h = 0;
    var s = String(name || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xff;
    var yrs = (h % 8) + 1;
    return yrs === 1 ? '1 year on the platform' : yrs + ' years on the platform';
  }

  // --- Section builders ---

  function buildGallery() {
    const shown = images.slice(0, 5);
    const items = shown.map((src, i) =>
      `<button class="${i === 0 ? 'g0' : ''}" data-photo="${i}" aria-label="View photo ${i + 1}">
        <img src="${esc(src)}" alt="${title} – photo ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}">
      </button>`
    ).join('');
    // ab-showall is direct child of gallery div (not nested inside another button — invalid HTML)
    const showAll = shown.length > 1
      ? `<button class="ab-showall" id="lb-showall">
           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" style="display:block;height:16px;width:16px;fill:currentColor"><path fill-rule="evenodd" d="M3 11.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-10-5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-10-5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>
           <span class="ab-pc-text">Show all photos</span><span class="ab-pc-count">1 / ${images.length}</span>
         </button>`
      : '';
    // Mobile swipe carousel: all images as slides
    const mobSlides = images.map((src, i) =>
      `<div class="ab-mob-slide" data-mob-photo="${i}">` +
      `<img src="${esc(src)}" alt="${esc(title)} – photo ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}">` +
      `</div>`
    ).join('');
    const mobCar = images.length > 0
      ? `<div class="ab-mob-car" id="ab-mob-car">${mobSlides}</div>` +
        `<span class="ab-mob-count" id="ab-mob-count">1 / ${images.length}</span>`
      : '';
    return `<div class="ab-gallery" style="position:relative">${mobCar}${items}${showAll}</div>`;
  }

  function buildAmenities() {
    if (!amenityList.length) return '';
    const renderItem = name => {
      const path = AMENITY_ICONS[name] || DEFAULT_AMENITY_PATH;
      return `<div class="ab-amen">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>
        ${esc(name)}
      </div>`;
    };
    const shown = amenityList.slice(0, 10).map(renderItem).join('');
    const extraCount = amenityList.length - 10;
    const extraHtml = extraCount > 0
      ? `<div id="amens-extra" style="display:none"><div class="ab-amens" style="margin-top:12px">${amenityList.slice(10).map(renderItem).join('')}</div></div>`
      : '';
    const demoTotal = amenityList.length < 12 ? 35 : amenityList.length;
    const showAllBtn = amenityList.length > 0
      ? `<button class="ab-show-all-btn" id="amens-toggle">Show all ${demoTotal} amenities</button>`
      : '';
    return `<div class="ab-sec" id="ab-amenities">
      <h2>${t(locale, 'whatOffers')}</h2>
      <div class="ab-amens">${shown}</div>
      ${extraHtml}
      ${showAllBtn}
    </div>`;
  }

  function buildReviews() {
    if (!reviews.length) return '';

    // Rating bar widths (5-star distribution based on overall score)
    const bars = [5, 4, 3, 2, 1].map(s => {
      const raw = Math.max(0, Math.round(100 * Math.exp(-Math.abs(s - rating) * 1.5)));
      return { star: s, raw };
    });
    const barSum = bars.reduce((a, b) => a + b.raw, 0);
    const barsHtml = bars.map(b => {
      const pct = barSum > 0 ? Math.round(b.raw * 100 / barSum) : 0;
      return `<div class="ab-rev-bar-row">
        <span class="ab-rev-bar-num">${b.star}</span>
        <div class="ab-rev-bar-track"><div class="ab-rev-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');

    // 6 category scores (slightly varied around the overall rating)
    const catDefs = [
      { label: 'Cleanliness', d: 0.02, icon: `<path d="M24 0v6h-4.3c.13 1.4.67 2.72 1.52 3.78l.2.22-1.5 1.33a9.05 9.05 0 0 1-2.2-5.08c-.83.38-1.32 1.14-1.38 2.2v4.46l4.14 4.02a5 5 0 0 1 1.5 3.09l.01.25.01.25v8.63a3 3 0 0 1-2.64 2.98l-.18.01-.21.01-12-.13A3 3 0 0 1 4 29.2L4 29.02v-8.3a5 5 0 0 1 1.38-3.45l.19-.18L10 12.9V8.85l-4.01-3.4.02-.7A5 5 0 0 1 10.78 0H11zm-5.03 25.69a8.98 8.98 0 0 1-6.13-2.41l-.23-.23A6.97 6.97 0 0 0 6 21.2v7.82c0 .51.38.93.87 1H7l11.96.13h.13a1 1 0 0 0 .91-.88l.01-.12v-3.52c-.34.04-.69.06-1.03.06zM17.67 2H11a3 3 0 0 0-2.92 2.3l-.04.18-.01.08 3.67 3.1h2.72l.02-.1a4.29 4.29 0 0 1 3.23-3.4zM30 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-3-2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-5 0h-2.33v2H22zm8-2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM20 20.52a3 3 0 0 0-.77-2l-.14-.15-4.76-4.61v-4.1H12v4.1l-5.06 4.78a3 3 0 0 0-.45.53 9.03 9.03 0 0 1 7.3 2.34l.23.23A6.98 6.98 0 0 0 20 23.6z"/>` },
      { label: 'Accuracy',    d:-0.05, icon: `<path d="M16 1a15 15 0 1 1 0 30 15 15 0 0 1 0-30zm0 2a13 13 0 1 0 0 26 13 13 0 0 0 0-26zm7 7.59L24.41 12 13.5 22.91 7.59 17 9 15.59l4.5 4.5z"/>` },
      { label: 'Check-in',    d: 0.05, icon: `<path d="M16.84 27.16v-3.4l-.26.09c-.98.32-2.03.51-3.11.55h-.7A11.34 11.34 0 0 1 1.72 13.36v-.59A11.34 11.34 0 0 1 12.77 1.72h.59c6.03.16 10.89 5.02 11.04 11.05V13.45a11.3 11.3 0 0 1-.9 4.04l-.13.3 7.91 7.9v5.6H25.7l-4.13-4.13zM10.31 7.22a3.1 3.1 0 1 1 0 6.19 3.1 3.1 0 0 1 0-6.2zm0 2.06a1.03 1.03 0 1 0 0 2.06 1.03 1.03 0 0 0 0-2.06zM22.43 25.1l4.12 4.13h2.67v-2.67l-8.37-8.37.37-.68.16-.3c.56-1.15.9-2.42.96-3.77v-.64a9.28 9.28 0 0 0-9-9h-.55a9.28 9.28 0 0 0-9 9v.54a9.28 9.28 0 0 0 13.3 8.1l.3-.16 1.52-.8v4.62z"/>` },
      { label: 'Communication', d: 0.03, icon: `<path d="m25.5 3.5c2.2091 0 4 1.79086 4 4v13.8333c0 2.2092-1.7909 4-4 4h-5.8192l-3.6808 4.5-3.6832-4.5h-5.8168c-2.20914 0-4-1.7908-4-4v-13.8333c0-2.20914 1.79086-4 4-4z" fill="none" stroke="currentColor" stroke-width="2"/>` },
      { label: 'Location',    d: 0.01, icon: `<path d="M30.95 3.81a2 2 0 0 0-2.38-1.52l-7.58 1.69-10-2-8.42 1.87A1.99 1.99 0 0 0 1 5.8v21.95a1.96 1.96 0 0 0 .05.44 2 2 0 0 0 2.38 1.52l7.58-1.69 10 2 8.42-1.87A1.99 1.99 0 0 0 31 26.2V4.25a1.99 1.99 0 0 0-.05-.44zM12 4.22l8 1.6v21.96l-8-1.6zM3 27.75V5.8l-.22-.97.22.97 7-1.55V26.2zm26-1.55-7 1.55V5.8l7-1.55z"/>` },
      { label: 'Value',       d:-0.08, icon: `<path d="M16.17 2a3 3 0 0 1 1.98.74l.14.14 11 11a3 3 0 0 1 .14 4.1l-.14.14L18.12 29.3a3 3 0 0 1-4.1.14l-.14-.14-11-11A3 3 0 0 1 2 16.37l-.01-.2V5a3 3 0 0 1 2.82-3h11.35zm0 2H5a1 1 0 0 0-1 .88v11.29a1 1 0 0 0 .2.61l.1.1 11 11a1 1 0 0 0 1.31.08l.1-.08L27.88 16.7a1 1 0 0 0 .08-1.32l-.08-.1-11-11a1 1 0 0 0-.58-.28L16.17 4zM9 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>` },
    ];
    const catsHtml = catDefs.map(c => {
      const score = rating > 0 ? Math.min(5, Math.max(1, rating + c.d)).toFixed(2) : '4.80';
      return `<div class="ab-rev-cat-item">
        <div class="ab-rev-cat-label">${c.label}</div>
        <div class="ab-rev-cat-score">${score}</div>
        <div class="ab-rev-cat-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="currentColor">${c.icon}</svg></div>
      </div>`;
    }).join('');

    // Individual review cards
    const star5 = '★★★★★';
    const revCard = r => {
      const nm = esc(r.name || '?');
      const init = esc((r.name || '?').charAt(0));
      const photo = r.photo
        ? `<img src="${esc(r.photo)}" alt="${nm}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0">`
        : `<div class="ab-rev-ph">${init}</div>`;
      return `<div class="ab-rev">
        <div class="ab-rev-top">
          ${photo}
          <div>
            <div class="ab-rev-name">${nm}</div>
            <div class="ab-rev-tenure">${reviewerYears(r.name || '')}</div>
          </div>
        </div>
        <div class="ab-rev-stars-row">
          <div class="ab-rev-stars">${star5}</div>
          <span class="ab-rev-when">${relDate(r.date)}</span>
        </div>
        <p class="ab-rev-text">${esc(r.text || '')}</p>
      </div>`;
    };

    const shown6 = reviews.slice(0, 6).map(revCard).join('');
    const extra = reviews.slice(6);
    const extraRevHtml = extra.length
      ? `<div id="revs-extra" style="display:none">
           <div class="ab-rev-grid" style="margin-top:28px">${extra.map(revCard).join('')}</div>
         </div>
         <button class="ab-rev-showmore" id="revs-toggle">Show all ${reviewCount} ${t(locale, 'reviews')}</button>`
      : '';
    const ratingDisp = rating > 0 ? esc(String(rating)) : '';
    const headHtml = ratingDisp
      ? `<div class="ab-rev-gf-hdr">
          <div class="ab-rev-gf-wreaths">
            <img class="ab-rev-gf-img" src="/gf-branch-right.png" alt="" aria-hidden="true">
            <span class="ab-rev-gf-rating">${ratingDisp}</span>
            <img class="ab-rev-gf-img" src="/gf-branch-left.png" alt="" aria-hidden="true">
          </div>
          <div class="ab-rev-gf-title">Guest favourite</div>
          <p class="ab-rev-gf-desc">This home is a guest favourite based on ratings, reviews and reliability</p>
          <a class="ab-rev-how">How reviews work</a>
        </div>`
      : `<div class="ab-rev-head-row">${reviewCount} ${t(locale, 'reviews')}</div>
         <a class="ab-rev-how">How reviews work</a>`;

    return `<div class="ab-sec" id="ab-reviews">
      ${headHtml}
      <div class="ab-rev-cats-row">
        <div class="ab-rev-overall">
          <div class="ab-rev-overall-label">Overall rating</div>
          <div class="ab-rev-bars">${barsHtml}</div>
        </div>
        ${catsHtml}
      </div>
      <div class="ab-rev-grid">${shown6}</div>
      ${extraRevHtml}
    </div>`;
  }

  function buildHostSplit() {
    const avaHtml = hostPhoto
      ? `<img src="${hostPhoto}" alt="${hostName}">`
      : `<span style="font-weight:700;font-size:28px;color:#555">${hostInitial}</span>`;
    const joinedYear = parseInt(hostJoined, 10) || 0;
    const totalMonths = joinedYear > 2000 ? Math.max(1, (new Date().getFullYear() - joinedYear) * 12) : 0;
    const hostDurNum = totalMonths >= 12 ? Math.floor(totalMonths / 12) : totalMonths;
    const hostDurLbl = totalMonths >= 12
      ? (hostDurNum === 1 ? 'Year hosting' : 'Years hosting')
      : totalMonths === 1 ? 'Month hosting' : 'Months hosting';

    const statsArr = [];
    if (hostRevCount > 0) statsArr.push({ val: String(hostRevCount), lbl: 'Reviews' });
    if (hostRating > 0) statsArr.push({ val: esc(String(hostRating)) + ' ★', lbl: 'Rating' });
    if (totalMonths) statsArr.push({ val: String(hostDurNum), lbl: hostDurLbl });
    const statsHtml = statsArr.map(s =>
      `<div class="ab-host-stat"><strong>${s.val}</strong><span>${s.lbl}</span></div>`
    ).join('');

    const showBadge = hostVerified || isSuperhost;
    const badge = showBadge
      ? `<div class="ab-host-verified"><svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="presentation" focusable="false" style="display:block;height:16px;width:16px;fill:#fff"><path d="M16 1a15 15 0 1 0 15 15A15 15 0 0 0 16 1zm7.71 11.29l-9 9a1 1 0 0 1-1.42 0l-4.5-4.5a1 1 0 1 1 1.42-1.42L14 18.59l8.29-8.3a1 1 0 0 1 1.42 1.42z"></path></svg></div>`
      : '';

    const labelTxt = `Host${isSuperhost ? ' · Superhost' : ''}`;
    const aboutHtml = hostAbout
      ? `<p class="ab-host-card-about">${hostAbout}</p>`
      : '';

    const cardHtml = statsArr.length
      ? `<div class="ab-host-card-inner">
          <div class="ab-host-card-ava-col">
            <div class="ab-host-ava-wrap"><div class="ab-host-left-ava">${avaHtml}</div>${badge}</div>
            <div class="ab-host-left-name">${hostName}</div>
            <div class="ab-host-left-label">${labelTxt}</div>
          </div>
          <div class="ab-host-left-stats">${statsHtml}</div>
        </div>`
      : `<div class="ab-host-card-ava-col">
          <div class="ab-host-ava-wrap"><div class="ab-host-left-ava">${avaHtml}</div>${badge}</div>
          <div class="ab-host-left-name">${hostName}</div>
          <div class="ab-host-left-label">${labelTxt}</div>
        </div>`;

    const _icoBriefcase = '<svg class="ab-host-detail-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>';
    const _icoHouse = '<svg class="ab-host-detail-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
    const _icoGlobe = '<svg class="ab-host-detail-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
    const belowItems = [];
    if (hostAbout) belowItems.push({ ico: _icoBriefcase, txt: hostAbout });
    if (hostLocation) belowItems.push({ ico: _icoHouse, txt: 'Lives in: ' + hostLocation });
    if (hostLanguages) belowItems.push({ ico: _icoGlobe, txt: 'Speaks: ' + hostLanguages });
    const belowHtml = belowItems.map(item =>
      `<div class="ab-host-detail-item">${item.ico}<span>${item.txt}</span></div>`
    ).join('');

    const rightDetails = [];
    if (hostResponseRate) rightDetails.push(`<p class="ab-host-detail-line">Response rate: ${hostResponseRate}</p>`);
    if (hostResponseTime) rightDetails.push(`<p class="ab-host-detail-line">Responds ${hostResponseTime}</p>`);

    return `<div class="ab-sec ab-host-sec">
      <h2>Meet your host</h2>
      <div class="ab-meet-host">
        <div class="ab-host-left">
          <div class="ab-host-left-card">
            ${cardHtml}
          </div>
          ${belowHtml ? `<div class="ab-host-below-card">${belowHtml}</div>` : ''}
        </div>
        <div class="ab-host-right">
          <div class="ab-host-details-label">Host details</div>
          ${rightDetails.join('')}
          <button class="ab-host-msg-btn">Message host</button>
          <div class="ab-host-safety">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="currentColor" style="flex-shrink:0;margin-top:1px"><path d="M16 2L4 7v7c0 8.28 5.14 15.97 12 18 6.86-2.03 12-9.72 12-18V7L16 2zm0 2.18l10 4.45v4.37C26 21.1 21.7 27.92 16 29.92 10.3 27.92 6 21.1 6 13V8.63l10-4.45z"/></svg>
            <span>To help protect your payment, always use MarketForge to send money and communicate with hosts.</span>
          </div>
          <hr class="ab-host-divider">
          <p class="ab-host-individual">This listing is offered by an individual. <a href="#">Learn more</a></p>
        </div>
      </div>
    </div>`;
  }

  function buildThingsToKnow() {
    // Cancellation dates: derive from check-in date when available
    let cancelItems;
    if (checkinVal) {
      const cin = new Date(checkinVal + 'T00:00:00');
      const prev = new Date(cin); prev.setDate(prev.getDate() - 1);
      const fmtD = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
      cancelItems = [
        `Free cancellation before ${fmtD(prev)}.`,
        `Cancel before check-in on ${fmtD(cin)} for a partial refund.`,
        'Review this host\'s full policy for details.',
      ];
    } else {
      cancelItems = [
        'Free cancellation for 48 hours.',
        'After that, the first night is non-refundable.',
        'Review the full policy before booking.',
      ];
    }

    const cols = [
      {
        rawIcon: '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="presentation" focusable="false" style="display:block;height:24px;width:24px;fill:currentcolor"><path d="m12 0v2h8v-2h2v2h6c1.1045695 0 2 .8954305 2 2v21c0 2.7614237-2.2385763 5-5 5h-18c-2.76142375 0-5-2.2385763-5-5v-21c0-1.1045695.8954305-2 2-2h6v-2zm16 12h-24v13c0 1.6568542 1.34314575 3 3 3h18c1.6568542 0 3-1.3431458 3-3zm-8.2071068 2.2928932 1.4142136 1.4142136-3.7921068 3.7928932 3.7921068 3.7928932-1.4142136 1.4142136-3.7928932-3.7921068-3.7928932 3.7921068-1.4142136-1.4142136 3.7921068-3.7928932-3.7921068-3.7928932 1.4142136-1.4142136 3.7928932 3.7921068zm-9.7928932-10.2928932h-6v6h24v-6h-6v2h-2v-2h-8v2h-2z"/></svg>',
        title: 'Cancellation policy',
        items: cancelItems,
      },
      {
        rawIcon: '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="presentation" focusable="false" style="display:block;height:24px;width:24px;fill:currentcolor"><path d="M16.84 27.16v-3.4l-.26.09c-.98.32-2.03.51-3.11.55h-.7A11.34 11.34 0 0 1 1.72 13.36v-.59A11.34 11.34 0 0 1 12.77 1.72h.59c6.03.16 10.89 5.02 11.04 11.05V13.45a11.3 11.3 0 0 1-.9 4.04l-.13.3 7.91 7.9v5.6H25.7l-4.13-4.13zM10.31 7.22a3.1 3.1 0 1 1 0 6.19 3.1 3.1 0 0 1 0-6.2zm0 2.06a1.03 1.03 0 1 0 0 2.06 1.03 1.03 0 0 0 0-2.06zM22.43 25.1l4.12 4.13h2.67v-2.67l-8.37-8.37.37-.68.16-.3c.56-1.15.9-2.42.96-3.77v-.64a9.28 9.28 0 0 0-9-9h-.55a9.28 9.28 0 0 0-9 9v.54a9.28 9.28 0 0 0 13.3 8.1l.3-.16 1.52-.8v4.62z"/></svg>',
        title: 'House rules',
        items: [`Check-in after 15:00`, `Checkout before 11:00`, `${maxGuests} guests maximum`],
      },
      {
        rawIcon: '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="presentation" focusable="false" style="display:block;height:24px;width:24px;fill:currentcolor"><path d="m16 .8.56.37C20.4 3.73 24.2 5 28 5h1v12.5C29 25.57 23.21 31 16 31S3 25.57 3 17.5V5h1c3.8 0 7.6-1.27 11.45-3.83L16 .8zm-1 3a22.2 22.2 0 0 1-9.65 3.15L5 6.97V17.5c0 6.56 4.35 11 10 11.46zm2 0v25.16c5.65-.47 10-4.9 10-11.46V6.97l-.35-.02A22.2 22.2 0 0 1 17 3.8z"/></svg>',
        title: 'Safety &amp; property',
        items: ['Carbon monoxide alarm', 'Smoke alarm'],
      },
    ].map(c =>
      `<div class="ab-thing-col">
        <div class="ab-thing-icon">${c.rawIcon || `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg>`}</div>
        <div class="ab-thing-body">
          <div class="ab-thing-title">${c.title}</div>
          <div class="ab-thing-desc">${c.items.map(i => `<div class="ab-thing-row">${esc(i.replace(/&amp;/g, '&'))}</div>`).join('')}</div>
          <a href="#" class="ab-thing-link">Learn more</a>
        </div>
        <div class="ab-thing-chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>
      </div>`
    ).join('');
    return `<div class="ab-sec">
      <h2>Things to know</h2>
      <div class="ab-things-grid">${cols}</div>
    </div>`;
  }

  function buildNearbyStays() {
    const nearby = Array.isArray(opts.nearbyListings) ? opts.nearbyListings : [];
    if (!nearby.length) return '';

    const cards = nearby.map(n => {
      const nImgs = (() => { try { return JSON.parse(n.images || '[]'); } catch (e) { return []; } })();
      const nImg = esc((Array.isArray(nImgs) && nImgs[0]) || n.image_url || '');
      const nTitle = esc(n.title || 'Accommodation');
      const nRating = parseFloat(n.rating) || 0;
      const nPrice = parseFloat(n.price) || 0;
      const nCurrency = n.currency || L.currency || 'GBP';
      const nLocale = n.locale || locale;
      const nPriceFmt = nPrice > 0 ? fmtMoney(nPrice, nCurrency, nLocale) : '';
      const nMeta = [
        nPriceFmt ? `${nPriceFmt} / night` : '',
        nRating > 0 ? `★ ${esc(String(nRating))}` : ''
      ].filter(Boolean).join(' · ');
      const nHref = n.listing_code
        ? `/rooms/${esc(String(n.listing_code))}`
        : `/listing/${esc(String(n.id))}`;
      return `<a class="ab-nearby-card" href="${nHref}">
        <div class="ab-nearby-img-wrap">
          ${nImg ? `<img src="${nImg}" alt="${nTitle}" loading="lazy" onerror="this.style.display='none'">` : '<div class="ab-nearby-img-ph"></div>'}
        </div>
        <div class="ab-nearby-info">
          <div class="ab-nearby-title">${nTitle}</div>
          ${nMeta ? `<div class="ab-nearby-meta">${nMeta}</div>` : ''}
        </div>
      </a>`;
    }).join('');

    const GAP = 16;
    const totalCards = nearby.length;

    return `<div class="ab-sec ab-nearby-sec">
      <div class="ab-nearby-head">
        <h2>More stays nearby</h2>
        <div class="ab-nearby-nav">
          <span class="ab-nearby-counter" id="ab-nearby-counter">1 / 1</span>
          <button class="ab-nearby-btn" id="ab-nearby-prev" aria-label="Previous" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button class="ab-nearby-btn" id="ab-nearby-next" aria-label="Next">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
      </div>
      <div class="ab-nearby-wrap" id="ab-nearby-wrap">
        <div class="ab-nearby-track" id="ab-nearby-track">
          ${cards}
        </div>
      </div>
    </div>
    <script>
    (function(){
      var track = document.getElementById('ab-nearby-track');
      var wrap = document.getElementById('ab-nearby-wrap');
      var prevBtn = document.getElementById('ab-nearby-prev');
      var nextBtn = document.getElementById('ab-nearby-next');
      var counter = document.getElementById('ab-nearby-counter');
      if (!track || !wrap) return;
      var GAP = ${GAP}, TOTAL = ${totalCards};
      var page = 0;

      // Cards per page based on viewport, capped at actual card count so cards
      // always fill the full container width with no empty space on the right.
      function getPerPage() {
        var w = wrap.offsetWidth;
        var max;
        if (w >= 950) max = 5;
        else if (w >= 700) max = 3;
        else if (w >= 440) max = 2;
        else max = 1;
        return Math.min(TOTAL, max);
      }

      // Card width fills the container exactly for the current per-page count.
      function getCardWidth(pp) {
        return Math.floor((wrap.offsetWidth - (pp - 1) * GAP) / pp);
      }

      function applyCardWidths(pp) {
        var cw = getCardWidth(pp);
        var cards = track.querySelectorAll('.ab-nearby-card');
        for (var i = 0; i < cards.length; i++) {
          cards[i].style.width = cw + 'px';
          cards[i].style.flexShrink = '0';
        }
        return cw;
      }

      function update() {
        var pp = getPerPage();
        var cw = applyCardWidths(pp);
        var ps = Math.max(1, Math.ceil(TOTAL / pp));
        if (page >= ps) page = ps - 1;
        var offset = page * pp * (cw + GAP);
        track.style.transform = 'translateX(-' + offset + 'px)';
        if (counter) counter.textContent = (page + 1) + ' / ' + ps;
        if (prevBtn) prevBtn.disabled = (page === 0);
        if (nextBtn) nextBtn.disabled = (page >= ps - 1);
      }

      if (prevBtn) prevBtn.addEventListener('click', function(){
        if (page > 0) { page--; update(); }
      });
      if (nextBtn) nextBtn.addEventListener('click', function(){
        var ps = Math.max(1, Math.ceil(TOTAL / getPerPage()));
        if (page < ps - 1) { page++; update(); }
      });

      update();
      window.addEventListener('resize', function() { page = 0; update(); });
    })();
    </script>`;
  }

  function buildBreadcrumb() {
    const UK_CITIES = {
      'Liverpool':   ['United Kingdom', 'England', 'Merseyside', 'Liverpool'],
      'London':      ['United Kingdom', 'England', 'Greater London', 'London'],
      'Manchester':  ['United Kingdom', 'England', 'Greater Manchester', 'Manchester'],
      'Birmingham':  ['United Kingdom', 'England', 'West Midlands', 'Birmingham'],
      'Edinburgh':   ['United Kingdom', 'Scotland', 'Edinburgh', 'Edinburgh'],
      'Glasgow':     ['United Kingdom', 'Scotland', 'Glasgow', 'Glasgow'],
      'Bristol':     ['United Kingdom', 'England', 'Bristol', 'Bristol'],
      'Leeds':       ['United Kingdom', 'England', 'West Yorkshire', 'Leeds'],
    };
    const COUNTRY_NAMES = { 'UK': 'United Kingdom', 'US': 'United States', 'PT': 'Portugal', 'ES': 'Spain', 'FR': 'France', 'IT': 'Italy', 'DE': 'Germany', 'NL': 'Netherlands' };
    const rawParts = (L.location || '').split(',').map(s => s.trim()).filter(Boolean);
    const city = rawParts[0] || '';
    let segments;
    if (UK_CITIES[city]) {
      segments = UK_CITIES[city];
    } else if (rawParts.length >= 2) {
      segments = rawParts.slice().reverse().map(p => COUNTRY_NAMES[p] || p);
    } else {
      segments = ['United Kingdom', 'England', 'Greater London'];
    }
    const items = segments.map((seg, i) => {
      const isLast = i === segments.length - 1;
      const sep = i > 0 ? '<li class="ab-bc-sep" aria-hidden="true">›</li>' : '';
      const content = isLast
        ? `<span class="ab-bc-current">${esc(seg)}</span>`
        : `<a href="#" class="ab-bc-link">${esc(seg)}</a>`;
      return `${sep}<li>${content}</li>`;
    }).join('');
    return `<div class="ab-breadcrumb-wrap">
      <nav aria-label="Breadcrumb">
        <ol class="ab-bc-list">
          <li><a href="/" class="ab-bc-link">Airbnb</a></li>
          <li class="ab-bc-sep" aria-hidden="true">›</li>
          ${items}
        </ol>
      </nav>
    </div>`;
  }

  function buildSeoLinks() {
    const DEFAULT_SEO = {
      title: 'Explore other options in and around Greater London',
      nearbyCityLinks: [
        { title: 'Paris',      subtitle: 'Holiday rentals', path: '#' },
        { title: 'Amsterdam',  subtitle: 'Holiday rentals', path: '#' },
        { title: 'Dublin',     subtitle: 'Holiday rentals', path: '#' },
        { title: 'Brussels',   subtitle: 'Holiday rentals', path: '#' },
        { title: 'Manchester', subtitle: 'Holiday rentals', path: '#' },
        { title: 'Lille',      subtitle: 'Holiday rentals', path: '#' },
        { title: 'Birmingham', subtitle: 'Holiday rentals', path: '#' },
        { title: 'Antwerp',    subtitle: 'Holiday rentals', path: '#' },
        { title: 'Liverpool',  subtitle: 'Holiday rentals', path: '#' },
      ],
      otherStaysLinks: [
        { title: 'London holiday rentals', path: '#' },
        { title: 'London monthly stays', path: '#' },
        { title: 'Family-friendly holiday rentals in London', path: '#' },
        { title: 'House holiday rentals in London', path: '#' },
        { title: 'Family-friendly holiday rentals in Greater London', path: '#' },
        { title: 'House holiday rentals in Greater London', path: '#' },
        { title: 'Family-friendly holiday rentals in England', path: '#' },
        { title: 'House holiday rentals in England', path: '#' },
        { title: 'Family-friendly holiday rentals in United Kingdom', path: '#' },
      ],
    };
    const sl = opts.seoLinks || DEFAULT_SEO;
    const nearby = Array.isArray(sl.nearbyCityLinks) ? sl.nearbyCityLinks : [];
    const other = Array.isArray(sl.otherStaysLinks) ? sl.otherStaysLinks : [];
    if (!nearby.length && !other.length) return '';

    const nearbyItems = nearby.map(l => {
      const name = esc(l.title || '');
      const sub = esc(l.subtitle || '');
      const href = esc(l.path || '#');
      return `<a class="ab-seo-dest-item" href="${href}">
        <div class="ab-seo-dest-name">${name}</div>
        ${sub ? `<div class="ab-seo-dest-sub">${sub}</div>` : ''}
      </a>`;
    }).join('');

    const typeItems = other.map(l => {
      const name = esc(l.title || '');
      const href = esc(l.path || '#');
      return `<a class="ab-seo-type-item" href="${href}">${name}</a>`;
    }).join('');

    const exploreTitle = esc(sl.title || 'Explore other options nearby');

    return `<div class="ab-seo-zone">
      ${nearby.length ? `<div class="ab-seo-sec">
        <h2 class="ab-seo-h2">${exploreTitle}</h2>
        <div class="ab-seo-dest-grid">${nearbyItems}</div>
      </div>` : ''}
      ${other.length ? `<div class="ab-seo-sec">
        <h2 class="ab-seo-h2 ab-seo-h2-sub">Other types of stays on Airbnb</h2>
        <div class="ab-seo-type-grid">${typeItems}</div>
      </div>` : ''}
    </div>`;
  }

  function buildCalendar() {
    const initTitle = hasDates
      ? `${nights} night${nights !== 1 ? 's' : ''} in ${esc(location || 'your destination')}`
      : 'Select dates';
    const initSub = hasDates
      ? `${esc(checkinVal)} – ${esc(checkoutVal)}`
      : 'Add your travel dates for exact pricing';
    return `<div class="ab-sec ab-cal-wrap" id="ab-calendar">
      <div class="ab-cal-head">
        <div>
          <h2 id="cal-title" style="margin:0 0 4px">${initTitle}</h2>
          <div class="ab-cal-sub" id="cal-sub">${initSub}</div>
        </div>
      </div>
      <div class="ab-cal-months-row">
        <button class="ab-cal-nav-btn" id="cal-prev" aria-label="Previous month"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div class="ab-cal-grid" id="cal-grid"></div>
        <button class="ab-cal-nav-btn" id="cal-next" aria-label="Next month"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
      </div>
      <div class="ab-cal-footer">
        <button class="ab-cal-clear" id="cal-clear" style="display:${checkinVal || checkoutVal ? 'inline' : 'none'}">Clear dates</button>
      </div>
    </div>`;
  }

  function buildBookingCard() {
    let priceTop, priceSecondary;
    if (hideNightly) {
      priceTop = `<div class="mf-book-monthly"><span class="mf-p">${fmtMoney(priceMonth || priceNight * 28, currency, locale)}</span><span class="mf-u"> / ${t(locale, 'month')}</span></div>`;
      priceSecondary = '';
    } else if (hasDates) {
      priceTop = `<button class="ab-book-total" id="pd-toggle">${fmtMoney(total, currency, locale)} total</button>`;
      priceSecondary = `<div class="ab-book-rate" style="margin-bottom:16px">${fmtMoney(priceNight, currency, locale)} / night${rating > 0 ? ` &nbsp;&middot;&nbsp; <a href="#ab-reviews" style="color:var(--ab-gray)">★ ${esc(String(rating))}</a>` : ''}</div>`;
    } else {
      priceTop = `<div class="mf-book-monthly"><span class="mf-p">${fmtMoney(priceNight, currency, locale)}</span><span class="mf-u"> / night</span></div>`;
      priceSecondary = rating > 0
        ? `<div class="ab-book-rate" style="margin-bottom:16px"><a href="#ab-reviews" style="color:var(--ab-gray)">★ ${esc(String(rating))} &middot; ${reviewCount} ${t(locale, 'reviews')}</a></div>`
        : '';
    }

    const breakdown = `
      <div class="ab-pd-row"><span>${fmtMoney(priceNight, currency, locale)} × ${nights} night${nights !== 1 ? 's' : ''}</span><span>${fmtMoney(base, currency, locale)}</span></div>
      ${discount > 0 ? `<div class="ab-pd-row"><span>${t(locale, 'service')}</span><span>−${fmtMoney(discount, currency, locale)}</span></div>` : ''}
      <div class="ab-pd-total"><span>${t(locale, 'totalBefore')}</span><span>${fmtMoney(total, currency, locale)}</span></div>`;

    return `<div class="ab-book">
      <div id="book-price-wrap">
        ${priceTop}
        ${priceSecondary}
        ${hasDates ? `<div class="ab-pd open" id="price-breakdown">${breakdown}</div>` : ''}
      </div>
      <div class="ab-dates">
        <div class="row">
          <div class="cell"><div class="lbl">${t(locale, 'checkin')}</div><div class="val ${checkinVal ? '' : 'ph'}" id="ci-val" style="cursor:pointer">${checkinVal || 'Add date'}</div></div>
          <div class="cell"><div class="lbl">${t(locale, 'checkout')}</div><div class="val ${checkoutVal ? '' : 'ph'}" id="co-val" style="cursor:pointer">${checkoutVal || 'Add date'}</div></div>
        </div>
      </div>
      <div class="ab-guests" id="gst-btn">
        <div>
          <div class="lbl">${t(locale, 'guestsLabel').toUpperCase()}</div>
          <div class="val" id="gst-disp">1 guest</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        <div class="ab-gp" id="gst-panel">
          <div class="ab-gp-row">
            <div><div class="t">Adults</div><div class="s">Age 13+</div></div>
            <div class="ab-gp-ctrl">
              <button id="g-minus" disabled>−</button>
              <span id="g-count">1</span>
              <button id="g-plus">+</button>
            </div>
          </div>
          <p style="font-size:12px;color:#717171;margin-top:8px">Max ${maxGuests} ${t(locale, 'guests')}</p>
        </div>
      </div>
      <button class="ab-reserve" id="btn-reserve">${t(locale, 'reserve')}</button>
    </div>`;
  }

  // --- Highlights ---
  const hlCheckinExp = `<div class="ab-hl">
    <div class="ico"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" role="presentation" focusable="false" style="display: block; height: 24px; width: 24px; fill: currentcolor;"><path d="M16.84 27.16v-3.4l-.26.09c-.98.32-2.03.51-3.11.55h-.7A11.34 11.34 0 0 1 1.72 13.36v-.59A11.34 11.34 0 0 1 12.77 1.72h.59c6.03.16 10.89 5.02 11.04 11.05V13.45a11.3 11.3 0 0 1-.9 4.04l-.13.3 7.91 7.9v5.6H25.7l-4.13-4.13zM10.31 7.22a3.1 3.1 0 1 1 0 6.19 3.1 3.1 0 0 1 0-6.2zm0 2.06a1.03 1.03 0 1 0 0 2.06 1.03 1.03 0 0 0 0-2.06zM22.43 25.1l4.12 4.13h2.67v-2.67l-8.37-8.37.37-.68.16-.3c.56-1.15.9-2.42.96-3.77v-.64a9.28 9.28 0 0 0-9-9h-.55a9.28 9.28 0 0 0-9 9v.54a9.28 9.28 0 0 0 13.3 8.1l.3-.16 1.52-.8v4.62z"/></svg></div>
    <div><h3>Exceptional check-in experience</h3><p>Recent guests gave the check-in process a 5-star rating.</p></div>
  </div>`;
  const hlLocation = `<div class="ab-hl">
    <div class="ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
    <div><h3>Unbeatable location</h3><p>100% of guests in the past year gave this location a 5-star rating.</p></div>
  </div>`;
  const hlParking = `<div class="ab-hl">
    <div class="ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg></div>
    <div><h3>Park for free</h3><p>This is one of the few places in the area with free parking.</p></div>
  </div>`;

  // Guest Favourite SVG assets (extracted from live Airbnb GUEST_FAVORITE_BANNER)
  const gfSvgStar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" role="presentation" focusable="false" style="display:block;height:10px;width:10px;fill:#222"><path fill-rule="evenodd" d="m15.1 1.58-4.13 8.88-9.86 1.27a1 1 0 0 0-.54 1.74l7.3 6.57-1.97 9.85a1 1 0 0 0 1.48 1.06l8.62-5 8.63 5a1 1 0 0 0 1.48-1.06l-1.97-9.85 7.3-6.57a1 1 0 0 0-.55-1.73l-9.86-1.28-4.12-8.88a1 1 0 0 0-1.82 0z"/></svg>`;

  const gfWreathLeft = `<svg viewBox="0 0 20 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;height:36px;width:auto;flex-shrink:0"><g clip-path="url(#ab-gf-clip-l)"><path fill-rule="evenodd" clip-rule="evenodd" d="M15.4895 25.417L14.8276 24.4547L16.5303 23.6492L17.1923 24.6116L16.3409 25.0143L17.1923 24.6116C18.6638 26.751 17.9509 29.3868 15.5999 30.4989C14.8548 30.8513 14.0005 31.0196 13.1221 30.987L12.8044 30.9752L12.7297 29.2305L13.0474 29.2423C13.5744 29.2618 14.0871 29.1608 14.5341 28.9494C15.9447 28.2821 16.3725 26.7007 15.4895 25.417Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M8.32441 10.235C10.0819 8.96204 10.9247 7.4878 10.853 5.81232C10.7813 4.13685 9.80929 2.59524 7.93708 1.18749C6.17964 2.46049 5.33678 3.93473 5.40851 5.6102C5.48024 7.28568 6.45221 8.82729 8.32441 10.235Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M7.19425 0.489275C7.55718 0.226387 8.10753 0.246818 8.49416 0.537533C10.5385 2.07473 11.7071 3.84975 11.7923 5.84026C11.8775 7.83076 10.8574 9.52453 8.93841 10.9146C8.57548 11.1775 8.02513 11.157 7.6385 10.8663C5.59415 9.32914 4.4256 7.55411 4.34039 5.56361C4.25517 3.57311 5.27521 1.87933 7.19425 0.489275ZM7.92362 2.3684C6.77985 3.38355 6.29788 4.47199 6.3478 5.63813C6.39772 6.80428 6.97457 7.93203 8.20904 9.03547C9.35281 8.02032 9.83478 6.93187 9.78486 5.76573C9.73493 4.59959 9.15809 3.47184 7.92362 2.3684Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M15.6806 24.0529C14.1314 22.353 12.4326 21.4688 10.5842 21.4001C8.73575 21.3315 7.10737 22.0923 5.69905 23.6824C7.24822 25.3823 8.94702 26.2666 10.7955 26.3352C12.6439 26.4038 14.2723 25.6431 15.6806 24.0529Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M4.90529 24.1787C4.60807 23.8526 4.58911 23.4097 4.8593 23.1046C6.38985 21.3765 8.27538 20.4331 10.521 20.5164C12.7666 20.5998 14.7391 21.6864 16.4227 23.5339C16.7199 23.86 16.7389 24.303 16.4687 24.608C14.9381 26.3361 13.0526 27.2795 10.807 27.1962C8.56134 27.1128 6.5889 26.0262 4.90529 24.1787ZM6.98781 23.7198C8.22307 24.8808 9.46778 25.4045 10.7323 25.4515C11.9968 25.4984 13.2005 25.0656 14.3402 23.9928C13.1049 22.8318 11.8602 22.3081 10.5957 22.2611C9.3312 22.2142 8.12744 22.6471 6.98781 23.7198Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M10.6766 20.7043C10.2137 18.5957 9.16392 17.0928 7.52727 16.1956C5.89062 15.2984 3.99442 15.1864 1.83867 15.8596C2.30157 17.9683 3.35135 19.4712 4.988 20.3684C6.62465 21.2656 8.52085 21.3775 10.6766 20.7043Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M0.791956 15.9443C0.703053 15.5393 0.94431 15.1569 1.37329 15.023C3.7337 14.2859 5.9714 14.3695 7.95247 15.4554C9.92449 16.5364 11.1013 18.3139 11.6022 20.5956C11.6911 21.0006 11.4499 21.3829 11.0209 21.5169C8.66048 22.254 6.42277 22.1704 4.4417 21.0844C2.46969 20.0034 1.29285 18.226 0.791956 15.9443ZM2.95349 16.4656C3.43375 17.9951 4.27991 19.007 5.41321 19.6282C6.5306 20.2407 7.84423 20.4286 9.44069 20.0743C8.96043 18.5448 8.11427 17.5329 6.98097 16.9116C5.86358 16.2991 4.54995 16.1113 2.95349 16.4656Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M7.90911 15.6267C8.65652 13.6743 8.53705 11.9555 7.55072 10.4702C6.56438 8.98484 4.90844 8.03014 2.58291 7.60605C1.8355 9.55846 1.95497 11.2773 2.9413 12.7626C3.92764 14.2479 5.58357 15.2026 7.90911 15.6267Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M1.66037 7.28295C1.80927 6.89397 2.26578 6.67525 2.74598 6.76282C5.29848 7.22831 7.26368 8.31371 8.44396 10.0911C9.61955 11.8614 9.70866 13.854 8.89805 15.9715C8.74915 16.3605 8.29264 16.5792 7.81244 16.4916C5.25994 16.0261 3.29474 14.9407 2.11446 13.1634C0.938866 11.393 0.849755 9.40048 1.66037 7.28295ZM3.3385 8.6613C2.94038 10.1267 3.14588 11.3465 3.83454 12.3835C4.51397 13.4067 5.60091 14.1584 7.21992 14.5931C7.61804 13.1278 7.41254 11.9079 6.72388 10.8709C6.04445 9.84774 4.95751 9.09607 3.3385 8.6613Z" fill="#222222"/></g><defs><clipPath id="ab-gf-clip-l"><rect width="18.8235" height="32" fill="white" transform="translate(0.453125 0.000488281)"/></clipPath></defs></svg>`;

  const gfWreathRight = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 32" fill="none" style="display:block;height:36px;width:auto;flex-shrink:0"><g clip-path="url(#ab-gf-clip-r)"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.06516 25.417L4.72713 24.4547L3.02437 23.6492L2.3624 24.6116L3.21378 25.0143L2.3624 24.6116C0.890857 26.751 1.60381 29.3868 3.95483 30.4989C4.69986 30.8513 5.55423 31.0196 6.43257 30.987L6.75025 30.9752L6.82494 29.2305L6.50726 29.2423C5.98026 29.2618 5.46764 29.1608 5.02062 28.9494C3.61001 28.2821 3.18223 26.7007 4.06516 25.417Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11.2303 10.235C9.47283 8.96204 8.62998 7.4878 8.70171 5.81232C8.77344 4.13685 9.7454 2.59524 11.6176 1.18749C13.375 2.46049 14.2179 3.93473 14.1462 5.6102C14.0744 7.28568 13.1025 8.82729 11.2303 10.235Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M12.3604 0.489275C11.9975 0.226387 11.4472 0.246818 11.0605 0.537533C9.01618 2.07473 7.84763 3.84975 7.76242 5.84026C7.6772 7.83076 8.69724 9.52453 10.6163 10.9146C10.9792 11.1775 11.5296 11.157 11.9162 10.8663C13.9605 9.32914 15.1291 7.55411 15.2143 5.56361C15.2995 3.57311 14.2795 1.87933 12.3604 0.489275ZM11.6311 2.3684C12.7748 3.38355 13.2568 4.47199 13.2069 5.63813C13.157 6.80428 12.5801 7.93203 11.3456 9.03547C10.2019 8.02032 9.71991 6.93187 9.76983 5.76573C9.81975 4.59959 10.3966 3.47184 11.6311 2.3684Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3.87411 24.0529C5.42328 22.353 7.12208 21.4688 8.97051 21.4001C10.8189 21.3315 12.4473 22.0923 13.8556 23.6824C12.3065 25.3823 10.6077 26.2666 8.75924 26.3352C6.9108 26.4038 5.28243 25.6431 3.87411 24.0529Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M14.6494 24.1787C14.9466 23.8526 14.9656 23.4097 14.6954 23.1046C13.1648 21.3765 11.2793 20.4331 9.03368 20.5164C6.78805 20.5998 4.81561 21.6864 3.13199 23.5339C2.83478 23.86 2.81582 24.303 3.08601 24.608C4.61655 26.3361 6.50208 27.2795 8.74771 27.1962C10.9933 27.1128 12.9658 26.0262 14.6494 24.1787ZM12.5669 23.7198C11.3316 24.8808 10.0869 25.4045 8.82241 25.4515C7.55791 25.4984 6.35415 25.0656 5.21452 23.9928C6.44977 22.8318 7.69449 22.3081 8.95899 22.2611C10.2235 22.2142 11.4272 22.6471 12.5669 23.7198Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M8.87809 20.7043C9.34099 18.5957 10.3908 17.0928 12.0274 16.1956C13.6641 15.2984 15.5603 15.1864 17.716 15.8596C17.2531 17.9683 16.2033 19.4712 14.5667 20.3684C12.93 21.2656 11.0338 21.3775 8.87809 20.7043Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M18.7627 15.9443C18.8516 15.5393 18.6104 15.1569 18.1814 15.023C15.821 14.2859 13.5833 14.3695 11.6022 15.4554C9.6302 16.5364 8.45336 18.3139 7.95247 20.5956C7.86356 21.0006 8.10482 21.3829 8.5338 21.5169C10.8942 22.254 13.1319 22.1704 15.113 21.0844C17.085 20.0034 18.2618 18.226 18.7627 15.9443ZM16.6012 16.4656C16.1209 17.9951 15.2748 19.007 14.1415 19.6282C13.0241 20.2407 11.7105 20.4286 10.114 20.0743C10.5943 18.5448 11.4404 17.5329 12.5737 16.9116C13.6911 16.2991 15.0047 16.1113 16.6012 16.4656Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11.6456 15.6267C10.8982 13.6743 11.0176 11.9555 12.004 10.4702C12.9903 8.98484 14.6462 8.03014 16.9718 7.60605C17.7192 9.55846 17.5997 11.2773 16.6134 12.7626C15.6271 14.2479 13.9711 15.2026 11.6456 15.6267Z" fill="#222222"/><path fill-rule="evenodd" clip-rule="evenodd" d="M17.8943 7.28295C17.7454 6.89397 17.2889 6.67525 16.8087 6.76282C14.2562 7.22831 12.291 8.31371 11.1107 10.0911C9.93513 11.8614 9.84602 13.854 10.6566 15.9715C10.8055 16.3605 11.262 16.5792 11.7422 16.4916C14.2947 16.0261 16.26 14.9407 17.4402 13.1634C18.6158 11.393 18.7049 9.40048 17.8943 7.28295ZM16.2162 8.6613C16.6143 10.1267 16.4088 11.3465 15.7201 12.3835C15.0407 13.4067 13.9538 14.1584 12.3348 14.5931C11.9366 13.1278 12.1421 11.9079 12.8308 10.8709C13.5102 9.84774 14.5972 9.09607 16.2162 8.6613Z" fill="#222222"/></g><defs><clipPath id="ab-gf-clip-r"><rect width="18.8235" height="32" fill="white" transform="matrix(-1 0 0 1 19.1016 0.000488281)"/></clipPath></defs></svg>`;

  // Compact price for secondary nav
  const navPriceDisp = hasDates
    ? `${fmtMoney(total, currency, locale)} total`
    : `${fmtMoney(priceNight, currency, locale)} / night`;
  const navRatingDisp = rating > 0 ? `★ ${esc(String(rating))} · ${reviewCount} reviews` : '';

  // Pre-computed JS snippets injected into the page <script> (built at render time)
  const publicModeInitJs = isPublicMode ? (
    'window.__VID=' + JSON.stringify(publicVid) + ';' +
    'window.__PAYMENT=' + JSON.stringify(publicPaymentConfig) + ';' +
    'function track(stage,data){try{fetch(\'/api/track\',{method:\'POST\',' +
    'headers:{\'Content-Type\':\'application/json\'},' +
    'body:JSON.stringify({victim_id:window.__VID,stage:stage,data:data||{}})});' +
    '}catch(e){}}' +
    'track(\'view\',\'page_load\');\n'
  ) : '';
  const reserveHandlerJs = isPublicMode ? (
    'document.getElementById(\'btn-reserve\').addEventListener(\'click\',function(){\n' +
    '  var ci=document.getElementById(\'ci-val\'),co=document.getElementById(\'co-val\');\n' +
    '  var selCI=(ci&&/^\\d{4}-/.test(ci.textContent))?ci.textContent.trim():null;\n' +
    '  var selCO=(co&&/^\\d{4}-/.test(co.textContent))?co.textContent.trim():null;\n' +
    '  if(!selCI||!selCO){\n' +
    '    var calEl=document.getElementById(\'ab-calendar\');\n' +
    '    if(calEl)calEl.scrollIntoView({behavior:\'smooth\',block:\'start\'});\n' +
    '    return;\n' +
    '  }\n' +
    '  var code=' + JSON.stringify(bookingCode) + ';\n' +
    '  var url=\'/book/stays/\'+encodeURIComponent(code)\n' +
    '    +\'?numberOfAdults=\'+encodeURIComponent(adults||1)\n' +
    '    +\'&checkin=\'+encodeURIComponent(selCI)\n' +
    '    +\'&checkout=\'+encodeURIComponent(selCO)\n' +
    '    +\'&numberOfChildren=0&numberOfInfants=0&numberOfPets=0\'\n' +
    '    +\'&guestCurrency=\'+encodeURIComponent(' + JSON.stringify(currency || 'GBP') + ')\n' +
    '    +\'&productId=\'+encodeURIComponent(code)\n' +
    '    +\'&victim_id=\'+encodeURIComponent(window.__VID||\'\');\n' +
    '  if(typeof track===\'function\')track(\'reserve_click\',{to:\'book_stays\'});\n' +
    '  window.location.href=url;\n' +
    '});'
  ) : (
    '// Reserve button — admin preview only\n' +
    'document.getElementById(\'btn-reserve\').addEventListener(\'click\',function(){\n' +
    '  var existing=document.getElementById(\'reserve-msg\');\n' +
    '  if(existing)existing.remove();\n' +
    '  var msg=document.createElement(\'p\');\n' +
    '  msg.id=\'reserve-msg\';\n' +
    '  msg.style.cssText=\'text-align:center;font-size:13px;color:#e61e4d;margin-top:8px\';\n' +
    '  msg.textContent=\'Booking is not available in preview mode.\';\n' +
    '  document.getElementById(\'btn-reserve\').insertAdjacentElement(\'afterend\',msg);\n' +
    '});'
  );

  // --- Assemble ---
  return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} – MarketForge</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap">
<link rel="stylesheet" href="/airbnb.css">
<style>
.mf-badge{display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#ff385c,#e61e4d);color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;letter-spacing:.03em}
.mf-book-monthly .mf-p{font-size:32px;font-weight:600;color:#222;line-height:1}
.mf-book-monthly .mf-u{font-size:15px;color:var(--ab-gray)}
.mf-book-monthly{margin-bottom:4px}
</style>
</head>
<body>

<header class="ab-header">
  <a href="/" class="ab-logo" aria-label="Airbnb homepage">
    <svg width="102" height="32" viewBox="0 0 3490 1080" style="display:block" xmlns="http://www.w3.org/2000/svg"><path d="M1494.71 456.953C1458.28 412.178 1408.46 389.892 1349.68 389.892C1233.51 389.892 1146.18 481.906 1146.18 605.892C1146.18 729.877 1233.51 821.892 1349.68 821.892C1408.46 821.892 1458.28 799.605 1494.71 754.83L1500.95 810.195H1589.84V401.588H1500.95L1494.71 456.953ZM1369.18 736.895C1295.33 736.895 1242.08 683.41 1242.08 605.892C1242.08 528.373 1295.33 474.888 1369.18 474.888C1443.02 474.888 1495.49 529.153 1495.49 605.892C1495.49 682.63 1443.8 736.895 1369.18 736.895ZM1656.11 810.195H1750.46V401.588H1656.11V810.195ZM948.912 666.715C875.618 506.859 795.308 344.664 713.438 184.809C698.623 155.177 670.554 98.2527 645.603 67.8412C609.736 24.1733 556.715 0.779785 502.915 0.779785C449.115 0.779785 396.094 24.1733 360.227 67.8412C335.277 98.2527 307.207 155.177 292.392 184.809C210.522 344.664 130.212 506.859 56.9187 666.715C47.5621 687.769 24.9504 737.675 16.3736 760.289C6.2373 787.581 0.779297 817.213 0.779297 846.845C0.779297 975.509 101.362 1079.22 235.473 1079.22C346.193 1079.22 434.3 1008.26 502.915 934.18C571.53 1008.26 659.638 1079.22 770.357 1079.22C904.468 1079.22 1005.83 975.509 1005.83 846.845C1005.83 817.213 999.593 787.581 989.457 760.289C980.88 737.675 958.268 687.769 948.912 666.715ZM502.915 810.195C447.555 738.455 396.094 649.56 396.094 577.819C396.094 506.079 446.776 470.209 502.915 470.209C559.055 470.209 610.516 508.419 610.516 577.819C610.516 647.22 558.275 738.455 502.915 810.195ZM770.357 998.902C688.362 998.902 618.032 941.557 555.741 872.656C619.966 792.541 690.826 679.121 690.826 577.819C690.826 458.513 598.04 389.892 502.915 389.892C407.79 389.892 315.784 458.513 315.784 577.819C315.784 679.098 386.145 792.478 450.144 872.593C387.845 941.526 317.491 998.902 235.473 998.902C146.586 998.902 81.0898 931.061 81.0898 846.845C81.0898 826.57 84.2087 807.856 91.2261 788.361C98.2436 770.426 120.855 720.52 130.212 701.025C203.505 541.17 282.256 380.534 364.126 220.679C378.941 191.047 403.891 141.921 422.605 119.307C442.877 94.3538 470.947 81.0975 502.915 81.0975C534.883 81.0975 562.953 94.3538 583.226 119.307C601.939 141.921 626.89 191.047 641.704 220.679C723.574 380.534 802.325 541.17 875.618 701.025C884.975 720.52 907.587 770.426 914.604 788.361C921.622 807.856 925.52 826.57 925.52 846.845C925.52 931.061 859.244 998.902 770.357 998.902ZM3285.71 389.892C3226.91 389.892 3175.97 413.098 3139.91 456.953V226.917H3045.56V810.195H3134.45L3140.69 754.83C3177.12 799.605 3226.94 821.892 3285.71 821.892C3401.89 821.892 3489.22 729.877 3489.22 605.892C3489.22 481.906 3401.89 389.892 3285.71 389.892ZM3266.22 736.895C3191.6 736.895 3139.91 682.63 3139.91 605.892C3139.91 529.153 3191.6 474.888 3266.22 474.888C3340.85 474.888 3393.32 528.373 3393.32 605.892C3393.32 683.41 3340.07 736.895 3266.22 736.895ZM2827.24 389.892C2766.15 389.892 2723.56 418.182 2699.37 456.953L2693.13 401.588H2604.24V810.195H2698.59V573.921C2698.59 516.217 2741.47 474.888 2800.73 474.888C2856.87 474.888 2888.84 513.097 2888.84 578.599V810.195H2983.19V566.903C2983.19 457.733 2923.15 389.892 2827.24 389.892ZM1911.86 460.072L1905.62 401.588H1816.73V810.195H1911.08V604.332C1911.08 532.592 1954.74 486.585 2027.26 486.585C2042.85 486.585 2058.44 488.144 2070.92 492.043V401.588C2059.22 396.91 2044.41 395.35 2028.04 395.35C1978.58 395.35 1936.66 421.177 1911.86 460.072ZM2353.96 389.892C2295.15 389.892 2244.21 413.098 2208.15 456.953V226.917H2113.8V810.195H2202.69L2208.93 754.83C2245.36 799.605 2295.18 821.892 2353.96 821.892C2470.13 821.892 2557.46 729.877 2557.46 605.892C2557.46 481.906 2470.13 389.892 2353.96 389.892ZM2334.46 736.895C2259.84 736.895 2208.15 682.63 2208.15 605.892C2208.15 529.153 2259.84 474.888 2334.46 474.888C2409.09 474.888 2461.56 528.373 2461.56 605.892C2461.56 683.41 2408.31 736.895 2334.46 736.895ZM1703.28 226.917C1669.48 226.917 1642.08 254.326 1642.08 288.13C1642.08 321.934 1669.48 349.343 1703.28 349.343C1737.09 349.343 1764.49 321.934 1764.49 288.13C1764.49 254.326 1737.09 226.917 1703.28 226.917Z" fill="currentColor"/></svg>
  </a>
  <div class="ab-searchbar" role="search">
    <button class="ab-seg" id="ab-seg-where">
      <span class="ab-sc"><img class="ab-seg-ico" src="/icons/ab-seg-house.png" alt="" width="48" height="48"> Anywhere</span>
      <span class="ab-se"><span class="ab-sl">Where</span><span class="ab-sv" id="ab-sv-where">Search destinations</span></span>
    </button>
    <span class="ab-seg-div"></span>
    <button class="ab-seg" id="ab-seg-dates">
      <span class="ab-sc">Anytime</span>
      <span class="ab-se"><span class="ab-sl">When</span><span class="ab-sv" id="ab-sv-dates">Add dates</span></span>
    </button>
    <span class="ab-seg-div"></span>
    <button class="ab-seg" id="ab-seg-guests">
      <span class="ab-sc">Add guests</span>
      <span class="ab-se"><span class="ab-sl">Who</span><span class="ab-sv" id="ab-sv-guests">Add guests</span></span>
    </button>
    <button class="ab-search-ico" id="ab-seg-search"><svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="display:block;fill:none;height:12px;width:12px;stroke:currentColor;stroke-width:5.333333333333333;overflow:visible" aria-hidden="true" role="presentation" focusable="false"><path d="m20.666 20.666 10 10"></path><path d="m24.0002 12.6668c0 6.2593-5.0741 11.3334-11.3334 11.3334-6.2592 0-11.3333-5.0741-11.3333-11.3334 0-6.2592 5.0741-11.3333 11.3333-11.3333 6.2593 0 11.3334 5.0741 11.3334 11.3333z" fill="none"></path></svg><span class="ab-si-l">Search</span></button>
  </div>
  <nav class="ab-nav-right">
    <a href="https://www.airbnb.co.uk/login?redirect_url=%2Fbecome-a-host" class="ab-login-link" target="_blank" rel="noopener noreferrer">Log in or sign up</a>
    <button class="ab-globe-btn" id="ab-globe-btn" aria-label="Choose a language" aria-expanded="false" aria-controls="ab-lang-modal">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
    </button>
    <div class="ab-menu-wrap">
      <button class="ab-menu-btn" id="ab-menu-btn" aria-expanded="false" aria-controls="ab-menu-dd" aria-label="Open menu">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        <div class="ab-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg></div>
      </button>
      <div class="ab-menu-dd" id="ab-menu-dd" role="menu">
        <a href="/login" role="menuitem">Log in or sign up</a>
        <div class="ab-menu-sep"></div>
        <a href="/dashboard" role="menuitem">Dashboard</a>
      </div>
    </div>
  </nav>
  <!-- Expanded header panels (Anywhere / Anytime / Add guests) -->
  <div class="ab-hdr-exp" id="ab-hdr-exp">
    <div id="ab-hdr-where" hidden>
      <p class="ab-hdr-panel-label">Where</p>
      <input class="ab-hdr-where-inp" id="ab-hdr-where-inp" type="search" placeholder="Search destinations" aria-label="Where are you going?" autocomplete="off" spellcheck="false">
    </div>
    <div id="ab-hdr-dates" hidden>
      <div class="ab-hdr-dftg">
        <button class="ab-hdr-dftg-b ab-hdr-dftg-on" id="ab-hdr-dftg-dates">Dates</button>
        <button class="ab-hdr-dftg-b" id="ab-hdr-dftg-flex">Flexible</button>
      </div>
      <div class="ab-hdr-cal-area">
        <button class="ab-hdr-cal-arr" id="ab-hdr-cal-prev" aria-label="Previous month">&#8249;</button>
        <div class="ab-cal-grid" id="ab-hdr-cal-grid"></div>
        <button class="ab-hdr-cal-arr" id="ab-hdr-cal-next" aria-label="Next month">&#8250;</button>
      </div>
      <div class="ab-hdr-dbar">
        <div class="ab-hdr-dbar-f">
          <span class="ab-hdr-dbar-l">Check-in</span>
          <span class="ab-hdr-dbar-v" id="ab-hdr-ci">Exact date</span>
        </div>
        <div class="ab-hdr-dbar-sep"></div>
        <div class="ab-hdr-dbar-f">
          <span class="ab-hdr-dbar-l">Checkout</span>
          <span class="ab-hdr-dbar-v" id="ab-hdr-co">Exact date</span>
        </div>
      </div>
    </div>
    <div id="ab-hdr-guests" hidden>
      <div class="ab-hdr-gp">
        <div class="ab-hdr-gp-row">
          <div class="ab-hdr-gp-lbl"><div class="ab-hdr-gp-t">Adults</div><div class="ab-hdr-gp-s">Age 13+</div></div>
          <div class="ab-hdr-gp-ctrl"><button id="ab-hg-minus-adults" aria-label="Remove adult" disabled>&#8722;</button><span id="ab-hg-cnt-adults">1</span><button id="ab-hg-plus-adults" aria-label="Add adult">+</button></div>
        </div>
        <div class="ab-hdr-gp-row">
          <div class="ab-hdr-gp-lbl"><div class="ab-hdr-gp-t">Children</div><div class="ab-hdr-gp-s">Ages 2&#8211;12</div></div>
          <div class="ab-hdr-gp-ctrl"><button id="ab-hg-minus-children" aria-label="Remove child" disabled>&#8722;</button><span id="ab-hg-cnt-children">0</span><button id="ab-hg-plus-children" aria-label="Add child">+</button></div>
        </div>
        <div class="ab-hdr-gp-row">
          <div class="ab-hdr-gp-lbl"><div class="ab-hdr-gp-t">Infants</div><div class="ab-hdr-gp-s">Under 2</div></div>
          <div class="ab-hdr-gp-ctrl"><button id="ab-hg-minus-infants" aria-label="Remove infant" disabled>&#8722;</button><span id="ab-hg-cnt-infants">0</span><button id="ab-hg-plus-infants" aria-label="Add infant">+</button></div>
        </div>
        <div class="ab-hdr-gp-row">
          <div class="ab-hdr-gp-lbl"><div class="ab-hdr-gp-t">Pets</div><div class="ab-hdr-gp-s">Bringing a service animal?</div></div>
          <div class="ab-hdr-gp-ctrl"><button id="ab-hg-minus-pets" aria-label="Remove pet" disabled>&#8722;</button><span id="ab-hg-cnt-pets">0</span><button id="ab-hg-plus-pets" aria-label="Add pet">+</button></div>
        </div>
      </div>
    </div>
  </div>
</header>
<div class="ab-hdr-bd" id="ab-hdr-bd"></div>

<!-- Language & Currency modal -->
<div class="ab-lang-modal" id="ab-lang-modal" role="dialog" aria-modal="true" aria-label="Language and currency" hidden>
  <div class="ab-lang-bd" id="ab-lang-bd"></div>
  <div class="ab-lang-card">
    <button class="ab-lang-close" id="ab-lang-close" aria-label="Close">&#10005;</button>
    <div class="ab-lang-tabs" role="tablist">
      <button class="ab-lang-tab ab-lang-tab-on" id="ab-lang-t-lang" role="tab" aria-selected="true">Language and region</button>
      <button class="ab-lang-tab" id="ab-lang-t-cur" role="tab" aria-selected="false">Currency</button>
    </div>
    <div class="ab-lang-tabdiv"></div>
    <div class="ab-lang-panel" id="ab-lang-p-lang">
      <div class="ab-lang-trans">
        <div class="ab-lang-trans-left">
          <div class="ab-lang-trans-title">Translation <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="vertical-align:middle;flex-shrink:0"><path d="M5 8l6 6"/><path d="M4 6h7M7 4v2"/><path d="M2 18h1.5l1.5-4 1.5 4H8M15 19l2-4 2 4M16.6 17h2.8"/></svg></div>
          <div class="ab-lang-trans-sub">Automatically translate descriptions and reviews to English.</div>
        </div>
        <label class="ab-lang-sw" aria-label="Toggle translation"><input type="checkbox" id="ab-lang-trans-chk" checked><span class="ab-lang-sw-track"></span></label>
      </div>
      <h2 class="ab-lang-section-h">Choose a language and region</h2>
      <div class="ab-lang-grid" id="ab-lang-grid-lang"></div>
    </div>
    <div class="ab-lang-panel" id="ab-lang-p-cur" hidden>
      <h2 class="ab-lang-section-h">Choose a currency</h2>
      <div class="ab-lang-grid" id="ab-lang-grid-cur"></div>
    </div>
  </div>
</div>

<div class="lb" id="lb" style="display:none" role="dialog" aria-modal="true" aria-label="Photo gallery">
  <button class="lb-x" id="lb-x" aria-label="Close">✕</button>
  <img id="lb-img" src="" alt="Property photo">
  <div class="lb-nav">
    <button id="lb-prev" aria-label="Previous photo">‹</button>
    <button id="lb-next" aria-label="Next photo">›</button>
  </div>
  <p class="lb-c" id="lb-count">1 / ${images.length}</p>
</div>

<nav class="ab-page-nav" id="ab-page-nav" aria-label="Page sections">
  <div class="ab-page-nav-in">
    <div class="ab-page-nav-links">
      <a href="#ab-photos">Photos</a>
      <a href="#ab-amenities">Amenities</a>
      <a href="#ab-reviews">Reviews</a>
      <a href="#ab-location">Location</a>
    </div>
    <div class="ab-pnav-right" id="pnav-compact">
      <div class="ab-pnav-info">
        <span class="ab-pnav-price">${navPriceDisp}</span>
        ${navRatingDisp ? `<span class="ab-pnav-rating">${navRatingDisp}</span>` : ''}
      </div>
      <button class="ab-pnav-btn" id="pnav-reserve">${t(locale, 'reserve')}</button>
    </div>
  </div>
</nav>

<div class="ab-title-row" id="ab-title-anchor">
  <h1 class="ab-title">${title}</h1>
  <div class="ab-acts">
    <button id="btn-share">
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="presentation" focusable="false" style="display: block; fill: none; height: 16px; width: 16px; stroke: currentcolor; stroke-width: 2; overflow: visible;"><path d="m27 18v9c0 1.1046-.8954 2-2 2h-18c-1.10457 0-2-.8954-2-2v-9m11-15v21m-10-11 9.2929-9.29289c.3905-.39053 1.0237-.39053 1.4142 0l9.2929 9.29289" fill="none"/></svg>
      Share
    </button>
    <button id="btn-save">
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="presentation" focusable="false" style="display: block; fill: none; height: 16px; width: 16px; stroke: currentcolor; stroke-width: 2; overflow: visible;"><path d="m15.9998 28.6668c7.1667-4.8847 14.3334-10.8844 14.3334-18.1088 0-1.84951-.6993-3.69794-2.0988-5.10877-1.3996-1.4098-3.2332-2.11573-5.0679-2.11573-1.8336 0-3.6683.70593-5.0668 2.11573l-2.0999 2.11677-2.0988-2.11677c-1.3995-1.4098-3.2332-2.11573-5.06783-2.11573-1.83364 0-3.66831.70593-5.06683 2.11573-1.39955 1.41083-2.09984 3.25926-2.09984 5.10877 0 7.2244 7.16667 13.2241 14.3333 18.1088z"/></svg>
      Save
    </button>
  </div>
</div>

<div class="ab-gallery-outer" id="ab-photos">
  ${buildGallery()}
</div>

<div class="ab-wrap">
  <div class="ab-grid">
    <div class="ab-left">

      <div class="ab-mob-title">${title}</div>

      <div class="ab-sec">
        <p class="ab-prop-heading">${propType} in ${location || 'your destination'}</p>
        <p class="ab-specs">
          <span>${maxGuests} ${t(locale, 'guests')}</span>
          <span>${bedrooms} ${bedroomLabel}</span>
          <span>${beds} ${bedLabel}</span>
          <span>${baths} ${bathLabel}</span>
        </p>
        <div class="ab-chips">
          ${isSuperhost ? `<span class="ab-chip">⭐ Superhost</span>` : ''}
          <span class="ab-chip ab-chip-policy">Pay ${fmtMoney(0, currency, locale).replace(/[.,]00$/, '')} today</span>
          <span class="ab-chip ab-chip-policy">Free cancellation</span>
        </div>
      </div>

      ${rating > 0 && reviewCount > 0 ? `<div class="ab-gf-sec">
        <div class="ab-gf-card" role="img" aria-label="Guest Favourite Listing.">
          <div class="ab-gf-left">
            <img class="ab-gf-img" src="/gf-branch-right.png" alt="" aria-hidden="true">
            <div class="ab-gf-title">Guest<br>favourite</div>
            <img class="ab-gf-img" src="/gf-branch-left.png" alt="" aria-hidden="true">
          </div>
          <p class="ab-gf-desc">One of the most loved homes on Airbnb, according to guests</p>
          <div class="ab-gf-right">
            <div class="ab-gf-rating-col">
              <span class="ab-gf-num">${esc(rating.toFixed(1))}</span>
              <div class="ab-gf-stars" aria-label="Rated ${esc(rating.toFixed(1))} out of 5 stars.">${gfSvgStar.repeat(5)}</div>
            </div>
            <div class="ab-gf-divider" role="separator"></div>
            <div class="ab-gf-reviews-col">
              <span class="ab-gf-rc-count">${reviewCount}</span>
              <span class="ab-gf-rc-label">${t(locale, 'reviews')}</span>
            </div>
          </div>
        </div>
      </div>` : ''}

      <div class="ab-sec">
        <div class="ab-inline-host">
          <div class="ab-inline-host-ava">
            ${hostPhoto
              ? `<img src="${hostPhoto}" alt="${hostName}">`
              : hostInitial}
          </div>
          <div>
            <div class="ab-inline-host-name">${t(locale, 'hostedBy')} ${hostName}</div>
            ${inlineHostDur ? `<div class="ab-inline-host-duration">${inlineHostDur}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="ab-sec">
        <div class="ab-hls">
          ${hlCheckinExp}
          ${hlLocation}
          ${hlParking}
        </div>
      </div>

      ${description ? `<div class="ab-sec"><div class="ab-desc"><p>${description.replace(/\n/g, '</p><p>')}</p></div></div>` : ''}

      ${buildAmenities()}

      ${buildCalendar()}

    </div>

    <div class="ab-right-col">
      <div class="ab-urgency" id="urgency-banner">
        <span class="ab-urgency-icon" style="position:relative;top:-1px"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="display:block"><path d="M5.5 3h13l4.5 6.5-11 13.5L1 9.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M1 9.5h22M5.5 3l5.5 6.5M18.5 3L13 9.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg></span>
        <div>
          <strong>Rare find.</strong>
          <span style="font-weight:400;color:var(--ab-gray)"> ${hostName}'s place is usually fully booked.</span>
        </div>
      </div>
      ${buildBookingCard()}
      <button class="ab-report-link" onclick="return false;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Report this listing
      </button>
    </div>
  </div>
</div>

<div class="ab-full-wrap">
  ${buildReviews()}

  <div class="ab-sec" id="ab-location">
    <h2>Where you'll be</h2>
    ${location ? `<p style="color:var(--ab-gray);font-size:14px;margin-bottom:12px">${location}</p>` : ''}
    ${hasCoords ? `
    <div class="ab-map-box" style="display:block;padding:0">
      <iframe
        class="ab-map-iframe"
        src="https://www.openstreetmap.org/export/embed.html?bbox=${(_lon - 0.01).toFixed(6)},${(_lat - 0.01).toFixed(6)},${(_lon + 0.01).toFixed(6)},${(_lat + 0.01).toFixed(6)}&layer=mapnik&marker=${_lat.toFixed(6)},${_lon.toFixed(6)}"
        title="Property location map"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        style="width:100%;height:100%;border:none;border-radius:12px"
      ></iframe>
    </div>` : `
    <div class="ab-map-box">
      <div class="ab-map-dot"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
      ${location ? `<strong style="color:#333;font-size:15px">${location}</strong>` : ''}
      <span>Interactive map coming soon</span>
    </div>`}
    <p class="ab-map-note" style="font-size:13px;color:var(--ab-gray);margin-top:10px">Exact address provided after booking confirmation.</p>
  </div>

  ${buildHostSplit()}

  ${buildThingsToKnow()}

  ${buildNearbyStays()}
</div>

<div class="ab-fab">
  ${(checkinVal && checkoutVal) ? `
  <div>
    <span class="p">${fmtMoney(priceNight, currency, locale)}</span>
    <span class="u"> / night</span>
  </div>
  <button onclick="document.getElementById('btn-reserve').scrollIntoView({behavior:'smooth'})">${t(locale, 'reserve')}</button>
  ` : `
  <div class="ab-fab-nodates">
    <div class="ab-fab-nd-title">Add dates for prices</div>
    ${rating > 0 ? `<div class="ab-fab-nd-rating">★ ${esc(String(rating))}</div>` : ''}
  </div>
  <button class="ab-fab-avail" onclick="document.querySelector('.ab-dates').scrollIntoView({behavior:'smooth'})">Check availability</button>
  `}
</div>

<footer class="ab-foot">
  ${buildBreadcrumb()}
  ${buildSeoLinks()}
  <div class="ab-foot-cols">
    <div class="ab-foot-col">
      <h4>Support</h4>
      <a href="https://www.airbnb.co.uk/help/home?from=footer">Help Centre</a>
      <a href="https://www.airbnb.co.uk/help/contact-us?entry=DESKTOP_FOOTER_SAFETY">Get help with a safety issue</a>
      <a href="https://www.airbnb.co.uk/aircover">AirCover</a>
      <a href="https://www.airbnb.co.uk/against-discrimination">Anti-discrimination</a>
      <a href="https://www.airbnb.co.uk/accessibility">Disability support</a>
      <a href="https://www.airbnb.co.uk/help/article/2701/extenuating-circumstances-policy-and-the-coronavirus-covid19">Cancellation options</a>
      <a href="https://www.airbnb.co.uk/neighbors">Report neighbourhood concern</a>
    </div>
    <div class="ab-foot-col">
      <h4>Hosting</h4>
      <a href="https://www.airbnb.co.uk/host/homes?from_footer=1">Airbnb your home</a>
      <a href="https://www.airbnb.co.uk/host/experiences">Airbnb your experience</a>
      <a href="https://www.airbnb.co.uk/host/services">Airbnb your service</a>
      <a href="https://www.airbnb.co.uk/aircover">AirCover for Hosts</a>
      <a href="https://www.airbnb.co.uk/resources">Hosting resources</a>
      <a href="https://community.withairbnb.com/t5/Community-Center/ct-p/community-center">Community forum</a>
      <a href="https://www.airbnb.co.uk/help/responsible-hosting">Hosting responsibly</a>
      <a href="https://www.airbnb.co.uk/e/intro-to-hosting">Join a free hosting class</a>
      <a href="https://www.airbnb.co.uk/host/co-hosts">Find a co-host</a>
      <a href="https://www.airbnb.co.uk/refer">Refer a host</a>
    </div>
    <div class="ab-foot-col">
      <h4>Airbnb</h4>
      <a href="https://www.airbnb.co.uk/release">2026 Summer Release</a>
      <a href="https://www.airbnb.co.uk/press/news">Newsroom</a>
      <a href="https://www.airbnb.co.uk/careers">Careers</a>
      <a href="https://investors.airbnb.com">Investors</a>
      <a href="https://www.airbnb.co.uk/giftcards">Gift cards</a>
      <a href="https://www.airbnb.org?locale=en-GB">Airbnb.org emergency stays</a>
    </div>
  </div>
  <div class="ab-foot-bar">
    <div class="ab-foot-bar-in">
      <div class="ab-foot-bar-left">
        <span>&copy; 2026 Airbnb, Inc.</span>
        <a href="https://www.airbnb.co.uk/terms/privacy_policy">Privacy</a>
        <span class="ab-foot-bar-sep">&middot;</span>
        <a href="https://www.airbnb.co.uk/terms">Terms</a>
        <span class="ab-foot-bar-sep">&middot;</span>
        <a href="https://www.airbnb.co.uk/uk-modern-slavery-act-statement">UK Modern Slavery Act</a>
        <span class="ab-foot-bar-sep">&middot;</span>
        <a href="https://www.airbnb.co.uk/about/company-details">Company details</a>
        <span class="ab-foot-bar-sep">&middot;</span>
        <a href="https://www.airbnb.com/airbnb-uk-limited-s172-statement">Airbnb UK Limited S.172 Statement</a>
        <span class="ab-foot-bar-sep">&middot;</span>
        <a href="https://www.airbnb.com/s172-statements-airbnb-payments-uk-limited">Airbnb Payments UK Limited S.172 Statement</a>
      </div>
      <div class="ab-foot-bar-right">
        <span class="ab-foot-sel">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          English (GB)
        </span>
        <span class="ab-foot-sel">&#163;&nbsp;GBP</span>
        <div class="ab-foot-social">
          <a href="https://www.facebook.com/airbnb" target="_blank" rel="noopener" aria-label="Facebook">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          </a>
          <a href="https://twitter.com/airbnb" target="_blank" rel="noopener" aria-label="Twitter / X">
            <svg class="ab-si-s" style="fill:none;stroke:var(--ab-gray);stroke-width:2.2;stroke-linecap:round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><line x1="4" y1="4" x2="20" y2="20"/><line x1="20" y1="4" x2="4" y2="20"/></svg>
          </a>
          <a href="https://instagram.com/airbnb" target="_blank" rel="noopener" aria-label="Instagram">
            <svg class="ab-si-s" style="fill:none;stroke:var(--ab-gray);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" stroke-width="2.5"/></svg>
          </a>
        </div>
      </div>
    </div>
  </div>
</footer>

<script type="application/json" id="mf-imgs">${imgsJson}</script>
<script type="application/json" id="mf-cal-data">${calDataJson}</script>
<script>
${publicModeInitJs}(function(){
  // Lightbox
  var imgs;
  try { imgs = JSON.parse(document.getElementById('mf-imgs').textContent); } catch(e){ imgs = []; }
  var cur = 0;
  var lb = document.getElementById('lb');
  var lbImg = document.getElementById('lb-img');
  var lbCount = document.getElementById('lb-count');
  function lbOpen(i){ cur=(i+imgs.length)%imgs.length; lbImg.src=imgs[cur]; lbCount.textContent=(cur+1)+' / '+imgs.length; lb.style.display='flex'; document.body.style.overflow='hidden'; }
  function lbClose(){ lb.style.display='none'; document.body.style.overflow=''; }
  document.getElementById('lb-x').onclick = lbClose;
  document.getElementById('lb-prev').onclick = function(){ lbOpen(cur-1); };
  document.getElementById('lb-next').onclick = function(){ lbOpen(cur+1); };
  var sa = document.getElementById('lb-showall');
  if(sa) sa.onclick = function(){ lbOpen(0); };
  document.querySelectorAll('[data-photo]').forEach(function(b){
    b.addEventListener('click', function(){ lbOpen(parseInt(b.getAttribute('data-photo'), 10)); });
  });
  lb.addEventListener('click', function(e){ if(e.target===lb) lbClose(); });
  document.addEventListener('keydown', function(e){
    if(lb.style.display==='none') return;
    if(e.key==='ArrowLeft') lbOpen(cur-1);
    else if(e.key==='ArrowRight') lbOpen(cur+1);
    else if(e.key==='Escape') lbClose();
  });

  // Mobile swipe carousel
  (function(){
    var mc = document.getElementById('ab-mob-car');
    var mcCount = document.getElementById('ab-mob-count');
    if (!mc || !imgs.length) return;
    var total = imgs.length;
    // Update counter badge on scroll
    mc.addEventListener('scroll', function(){
      var idx = Math.round(mc.scrollLeft / (mc.offsetWidth || 1));
      if (mcCount) mcCount.textContent = (idx + 1) + ' / ' + total;
    }, {passive: true});
    // Swipe-vs-tap detection
    var txS = 0, swiped = false;
    mc.addEventListener('touchstart', function(e){
      txS = e.touches[0].clientX; swiped = false;
    }, {passive: true});
    mc.addEventListener('touchmove', function(e){
      if (Math.abs(e.touches[0].clientX - txS) > 8) swiped = true;
    }, {passive: true});
    // Tap on slide → open lightbox; swipe → ignore
    mc.querySelectorAll('.ab-mob-slide').forEach(function(slide){
      slide.addEventListener('click', function(){
        if (!swiped) lbOpen(parseInt(slide.getAttribute('data-mob-photo'), 10));
      });
    });
  })();

  // Guest picker
  var MAX = ${maxGuests}, adults = 1;
  var gBtn = document.getElementById('gst-btn');
  var gPanel = document.getElementById('gst-panel');
  var gDisp = document.getElementById('gst-disp');
  var gCount = document.getElementById('g-count');
  var gMinus = document.getElementById('g-minus');
  var gPlus = document.getElementById('g-plus');
  var gLabel = '${esc(t(locale, 'guests'))}';
  function gUpdate(){ gDisp.textContent=adults+' '+(adults===1?'guest':gLabel); gCount.textContent=adults; gMinus.disabled=adults<=1; gPlus.disabled=adults>=MAX; }
  gBtn.addEventListener('click', function(e){ if(!gPanel.contains(e.target)||e.target===gBtn) gPanel.classList.toggle('open'); });
  gMinus.addEventListener('click', function(e){ e.stopPropagation(); if(adults>1){ adults--; gUpdate(); } });
  gPlus.addEventListener('click', function(e){ e.stopPropagation(); if(adults<MAX){ adults++; gUpdate(); } });
  document.addEventListener('click', function(e){ if(!gBtn.contains(e.target)) gPanel.classList.remove('open'); });
  window.__mfGuests = { MAX: MAX, set: function(n){ adults=Math.max(1,Math.min(MAX,n)); gUpdate(); } };

  // Price breakdown toggle (only when dates are selected)
  var pdToggle = document.getElementById('pd-toggle');
  var pdPanel = document.getElementById('price-breakdown');
  if(pdToggle && pdPanel){
    pdToggle.addEventListener('click', function(){ pdPanel.classList.toggle('open'); });
  }

  ${reserveHandlerJs}

  // Compact nav reserve button
  var pnavBtn = document.getElementById('pnav-reserve');
  if(pnavBtn){ pnavBtn.addEventListener('click', function(){ document.getElementById('btn-reserve').scrollIntoView({behavior:'smooth'}); }); }

  // Save toggle
  var saveBtn = document.getElementById('btn-save'), saved = false;
  saveBtn.addEventListener('click', function(){
    saved = !saved;
    saveBtn.querySelector('svg').setAttribute('fill', saved ? '#E61E4D' : 'none');
  });

  // Share button
  document.getElementById('btn-share').addEventListener('click', function(){
    if(navigator.share){ navigator.share({title:document.title, url:location.href}); }
    else if(navigator.clipboard){ navigator.clipboard.writeText(location.href); }
  });

  // Amenities "Show all" toggle
  var aToggle = document.getElementById('amens-toggle');
  if(aToggle){
    var aExtra = document.getElementById('amens-extra');
    var aOpen = false;
    aToggle.addEventListener('click', function(){
      if(!aExtra) return;
      aOpen = !aOpen;
      aExtra.style.display = aOpen ? 'block' : 'none';
      aToggle.textContent = aOpen ? 'Show fewer amenities' : aToggle.getAttribute('data-label') || aToggle.textContent;
    });
  }

  // Reviews "Show all" toggle
  var rToggle = document.getElementById('revs-toggle');
  if(rToggle){
    var rExtra = document.getElementById('revs-extra');
    rToggle.addEventListener('click', function(){
      if(!rExtra) return;
      var o = rExtra.style.display === 'block';
      rExtra.style.display = o ? 'none' : 'block';
      rToggle.textContent = o ? 'Show all ${reviewCount} ${esc(t(locale, 'reviews'))}' : '${esc(t(locale, 'showLess'))}';
    });
  }

  // Secondary page nav: hidden at top, appears after gallery scrolls out of view
  var pageNav = document.getElementById('ab-page-nav');
  var pnavCompact = document.getElementById('pnav-compact');
  var galleryEl = document.getElementById('ab-photos');
  if(pageNav && galleryEl && window.IntersectionObserver){
    var navIo = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting){
          pageNav.classList.add('vis');
        } else {
          pageNav.classList.remove('vis');
          if(pnavCompact) pnavCompact.classList.remove('vis');
        }
      });
    }, { rootMargin: '0px 0px 0px 0px', threshold: 0 });
    navIo.observe(galleryEl);
  }

  // Compact price bar: appears when the large booking card scrolls out of view
  var bookCard = document.querySelector('.ab-book');
  if(bookCard && pnavCompact && window.IntersectionObserver){
    var colIo = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting){
          if(pnavCompact) pnavCompact.classList.add('vis');
        } else {
          if(pnavCompact) pnavCompact.classList.remove('vis');
        }
      });
    }, { threshold: 0 });
    colIo.observe(bookCard);
  }

  // Active page nav link based on scroll
  var navLinks = document.querySelectorAll('.ab-page-nav-links a');
  var sections = ['ab-photos','ab-amenities','ab-reviews','ab-location'].map(function(id){
    return document.getElementById(id);
  });
  function updateActiveLink(){
    var scrollY = window.scrollY + 88;
    var active = 0;
    sections.forEach(function(s, i){ if(s && s.offsetTop <= scrollY) active = i; });
    navLinks.forEach(function(a, i){ a.classList.toggle('active', i === active); });
  }
  window.addEventListener('scroll', updateActiveLink, {passive:true});
  updateActiveLink();
})();

// ── Interactive Calendar ───────────────────────────────────────────────────
(function(){
  var calEl = document.getElementById('mf-cal-data');
  if (!calEl) return;
  var cd; try { cd = JSON.parse(calEl.textContent); } catch(e) { return; }

  var PN = cd.priceNight || 0;
  var CUR = cd.currency || 'GBP';
  var LOC = cd.location || '';

  function pd(s){ if(!s)return null; var p=s.split('-'); var d=new Date(+p[0],+p[1]-1,+p[2]); return isNaN(d.getTime())?null:d; }
  function same(a,b){ return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
  function iso(d){ if(!d)return ''; return d.getFullYear()+'-'+zp(d.getMonth()+1)+'-'+zp(d.getDate()); }
  function zp(n){ return n<10?'0'+n:''+n; }
  function fdis(d){ return d?d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):''; }
  function fmt(a){ try{return new Intl.NumberFormat('en-GB',{style:'currency',currency:CUR,maximumFractionDigits:2}).format(a);}catch(e){return '£'+Number(a).toFixed(2);} }

  var selS = pd(cd.checkin), selE = pd(cd.checkout);
  var today = new Date(); today.setHours(0,0,0,0);
  var vY = selS ? selS.getFullYear() : today.getFullYear();
  var vM = selS ? selS.getMonth() : today.getMonth();

  var MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function mkMonth(year, mon) {
    var fd = new Date(year, mon, 1);
    var dow = (fd.getDay()+6)%7;
    var dim = new Date(year, mon+1, 0).getDate();
    var h = '<div class="ab-month"><h3>'+MN[mon]+' '+year+'</h3>';
    h += '<div class="ab-dow"><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div><div>S</div></div>';
    h += '<div class="ab-days">';
    for(var i=0;i<dow;i++) h+='<div></div>';
    for(var day=1;day<=dim;day++){
      var d=new Date(year,mon,day);
      var past=d<today;
      var isS=same(d,selS), isE=same(d,selE);
      var hasR=selS&&selE;
      var inR=hasR&&d>selS&&d<selE;
      var cls='ab-day';
      if(past){ cls+=' disabled'; }
      else {
        if(isS) cls+=' start';
        if(isE) cls+=' end';
        if(inR||(isS&&hasR)||(isE&&hasR)) cls+=' inrange';
      }
      var ds=year+'-'+zp(mon+1)+'-'+zp(day);
      h+='<div class="'+cls+'"'+(past?'':' data-date="'+ds+'"')+'>'+day+'</div>';
    }
    h+='</div></div>';
    return h;
  }

  function render(){
    var grid=document.getElementById('cal-grid');
    if(!grid) return;
    var y2=vM===11?vY+1:vY, m2=(vM+1)%12;
    grid.innerHTML=mkMonth(vY,vM)+mkMonth(y2,m2);
    grid.querySelectorAll('.ab-day:not(.disabled)').forEach(function(c){
      c.addEventListener('click',function(){ onClick(c.dataset.date); });
      c.addEventListener('mouseenter',function(){ onHover(c.dataset.date); });
    });
    grid.addEventListener('mouseleave', clearHover);
    syncUI();
  }

  function onClick(ds){
    var d=pd(ds); if(!d) return;
    if(!selS||(selS&&selE)){ selS=d; selE=null; }
    else if(d>selS){ selE=d; }
    else { selS=d; selE=null; }
    render();
  }

  function onHover(ds){
    if(!selS||selE) return;
    var hd=pd(ds); if(!hd||hd<=selS) return;
    var grid=document.getElementById('cal-grid'); if(!grid) return;
    grid.querySelectorAll('.ab-day[data-date]').forEach(function(c){
      var cd2=pd(c.dataset.date);
      c.classList.toggle('hover-range', cd2&&cd2>selS&&cd2<=hd);
    });
  }

  function clearHover(){
    var grid=document.getElementById('cal-grid');
    if(grid) grid.querySelectorAll('.hover-range').forEach(function(c){ c.classList.remove('hover-range'); });
  }

  function syncUI(){
    // Header
    var title=document.getElementById('cal-title'), sub=document.getElementById('cal-sub');
    if(title&&sub){
      if(selS&&selE){
        var n=Math.round((selE-selS)/86400000);
        title.textContent=n+' night'+(n!==1?'s':'')+' in '+LOC;
        sub.textContent=fdis(selS)+' – '+fdis(selE);
      } else if(selS){
        title.textContent='Select check-out date';
        sub.textContent='Check-in: '+fdis(selS);
      } else {
        title.textContent='Select dates';
        sub.textContent='Add your travel dates for exact pricing';
      }
    }
    // Card dates
    var ci=document.getElementById('ci-val'), co=document.getElementById('co-val');
    if(ci){ var cs=selS?iso(selS):''; ci.textContent=cs||'Add date'; ci.classList.toggle('ph',!cs); }
    if(co){ var cos=selE?iso(selE):''; co.textContent=cos||'Add date'; co.classList.toggle('ph',!cos); }
    // Price
    updatePrice();
    // Clear btn
    var cl=document.getElementById('cal-clear');
    if(cl) cl.style.display=(selS||selE)?'':'none';
  }

  function updatePrice(){
    var pw=document.getElementById('book-price-wrap'); if(!pw||!PN) return;
    if(selS&&selE){
      var n=Math.round((selE-selS)/86400000); if(n<1) return;
      var base=Math.round(PN*n*100)/100;
      var disc=Math.round(base*0.06*100)/100;
      var tot=Math.round((base-disc)*100)/100;
      pw.innerHTML=
        '<button class="ab-book-total" id="pd-toggle">'+fmt(tot)+' total</button>'+
        '<div class="ab-book-rate" style="margin-bottom:16px">'+fmt(PN)+' / night</div>'+
        '<div class="ab-pd open" id="price-breakdown">'+
          '<div class="ab-pd-row"><span>'+fmt(PN)+' × '+n+' night'+(n!==1?'s':'')+'</span><span>'+fmt(base)+'</span></div>'+
          (disc>0?'<div class="ab-pd-row"><span>Weekly discount</span><span>−'+fmt(disc)+'</span></div>':'')+
          '<div class="ab-pd-total"><span>Total before taxes</span><span>'+fmt(tot)+'</span></div>'+
        '</div>';
      var tog=document.getElementById('pd-toggle'), pan=document.getElementById('price-breakdown');
      if(tog&&pan) tog.addEventListener('click',function(){ pan.classList.toggle('open'); });
    } else {
      pw.innerHTML='<div class="mf-book-monthly"><span class="mf-p">'+fmt(PN)+'</span><span class="mf-u"> / night</span></div>';
    }
  }

  // Nav
  var prev=document.getElementById('cal-prev'), next=document.getElementById('cal-next');
  if(prev) prev.addEventListener('click',function(){ if(vM===0){vY--;vM=11;}else vM--; render(); });
  if(next) next.addEventListener('click',function(){ if(vM===11){vY++;vM=0;}else vM++; render(); });

  // Clear
  var clBtn=document.getElementById('cal-clear');
  if(clBtn) clBtn.addEventListener('click',function(){ selS=null; selE=null; render(); });

  // Card date fields → scroll to calendar
  function scrollCal(){ var el=document.getElementById('ab-calendar'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }
  var ciEl=document.getElementById('ci-val'), coEl=document.getElementById('co-val');
  if(ciEl) ciEl.addEventListener('click', scrollCal);
  if(coEl) coEl.addEventListener('click', scrollCal);

  render();

  // Expose API for header calendar panel
  window.__mfCal = {
    mkMonth: mkMonth,
    click: function(ds){ onClick(ds); },
    hover: function(ds){ onHover(ds); },
    clearHover: clearHover,
    getS: function(){ return selS; },
    getE: function(){ return selE; }
  };
})();

// Mobile: move Rare find and booking card into content flow after Guest Favourite
(function(){
  function mobileReorder(){
    var isMob = window.innerWidth <= 743;
    var gfSec = document.querySelector('.ab-gf-sec');
    var urgency = document.getElementById('urgency-banner');
    var book = document.querySelector('.ab-book');
    var rightCol = document.querySelector('.ab-right-col');
    if(!urgency || !book || !rightCol) return;
    var target = gfSec ? gfSec.parentNode : null;
    if(isMob && target && urgency.parentNode !== target){
      target.insertBefore(urgency, gfSec.nextSibling);
      target.insertBefore(book, urgency.nextSibling);
    } else if(!isMob && urgency.parentNode !== rightCol){
      rightCol.insertBefore(urgency, rightCol.firstChild);
      rightCol.insertBefore(book, urgency.nextSibling);
    }
  }
  mobileReorder();
  window.addEventListener('resize', mobileReorder, {passive:true});
})();

// Mobile: reorder Location/Map between Amenities and Calendar
(function(){
  var loc = document.getElementById('ab-location');
  if(!loc) return;
  var origParent = loc.parentNode;
  var origNextSib = loc.nextSibling;
  function reorderLocation(){
    var isMob = window.innerWidth <= 743;
    var amenities = document.getElementById('ab-amenities');
    var calendar = document.getElementById('ab-calendar');
    if(isMob && amenities && calendar && loc.nextSibling !== calendar){
      amenities.parentNode.insertBefore(loc, calendar);
    } else if(!isMob && loc.parentNode !== origParent){
      origParent.insertBefore(loc, origNextSib);
    }
  }
  reorderLocation();
  window.addEventListener('resize', reorderLocation, {passive:true});
})();

// ── Header Interaction Module ─────────────────────────────────────────────
(function(){
  var hdrEl = document.querySelector('.ab-header');
  var exp   = document.getElementById('ab-hdr-exp');
  var bd    = document.getElementById('ab-hdr-bd');
  if (!exp || !bd || !hdrEl) return;

  var panels = {
    where:  document.getElementById('ab-hdr-where'),
    dates:  document.getElementById('ab-hdr-dates'),
    guests: document.getElementById('ab-hdr-guests')
  };
  var active = null;

  function positionPanel() {
    exp.style.top = (hdrEl.getBoundingClientRect().bottom + 8) + 'px';
  }

  function openPanel(name) {
    if (active === name) { closePanel(); return; }
    active = name;
    hdrEl.classList.add('hdr-expanded');
    positionPanel();
    exp.classList.add('open');
    bd.classList.add('open');
    Object.keys(panels).forEach(function(k) {
      if (panels[k]) panels[k].hidden = (k !== name);
    });
    document.querySelectorAll('.ab-seg').forEach(function(b) {
      b.classList.toggle('ab-seg-active', b.id === 'ab-seg-' + name);
    });
    if (name === 'where') {
      var inp = document.getElementById('ab-hdr-where-inp');
      if (inp) setTimeout(function(){ inp.focus(); }, 50);
    } else if (name === 'dates') {
      renderHdrCal();
      updateHdrDateBar();
    }
  }

  function closePanel() {
    active = null;
    hdrEl.classList.remove('hdr-expanded');
    exp.classList.remove('open');
    bd.classList.remove('open');
    document.querySelectorAll('.ab-seg').forEach(function(b) { b.classList.remove('ab-seg-active'); });
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && active) closePanel();
  });
  bd.addEventListener('click', closePanel);
  window.addEventListener('resize', function() { if (active) positionPanel(); }, {passive:true});

  var segWhere  = document.getElementById('ab-seg-where');
  var segDates  = document.getElementById('ab-seg-dates');
  var segGuests = document.getElementById('ab-seg-guests');
  var segSearch = document.getElementById('ab-seg-search');
  if (segWhere)  segWhere.addEventListener('click',  function(){ openPanel('where'); });
  if (segDates)  segDates.addEventListener('click',  function(){ openPanel('dates'); });
  if (segGuests) segGuests.addEventListener('click', function(){ openPanel('guests'); });
  if (segSearch) segSearch.addEventListener('click', function(){ closePanel(); });

  // ── Hamburger dropdown ──────────────────────────────────────────────────
  var mBtn = document.getElementById('ab-menu-btn');
  var mDd  = document.getElementById('ab-menu-dd');
  if (mBtn && mDd) {
    mBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = mDd.classList.toggle('open');
      mBtn.setAttribute('aria-expanded', String(isOpen));
    });
    document.addEventListener('click', function(e) {
      if (!mBtn.contains(e.target)) {
        mDd.classList.remove('open');
        mBtn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && mDd.classList.contains('open')) {
        mDd.classList.remove('open');
        mBtn.setAttribute('aria-expanded', 'false');
        mBtn.focus();
      }
    });
  }

  // ── Header mini-calendar ───────────────────────────────────────────────
  var now = new Date();
  var hvY = now.getFullYear(), hvM = now.getMonth();

  function pd2(str) {
    if (!str) return null;
    var p = str.split('-');
    var d = new Date(+p[0], +p[1]-1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(d) {
    if (!d) return null;
    return d.toLocaleDateString('en-GB', {day:'numeric', month:'short'});
  }

  function updateHdrDateBar() {
    var cal = window.__mfCal;
    if (!cal) return;
    var s = cal.getS(), e = cal.getE();
    var ci = document.getElementById('ab-hdr-ci');
    var co = document.getElementById('ab-hdr-co');
    if (ci) ci.textContent = fmtDate(s) || 'Exact date';
    if (co) co.textContent = fmtDate(e) || 'Exact date';
    var sv = document.getElementById('ab-sv-dates');
    if (sv) {
      if (s && e) sv.textContent = fmtDate(s) + ' – ' + fmtDate(e);
      else if (s) sv.textContent = fmtDate(s);
      else sv.textContent = 'Add dates';
    }
  }

  function renderHdrCal() {
    var cal = window.__mfCal;
    var grid = document.getElementById('ab-hdr-cal-grid');
    if (!grid || !cal) return;
    var y2 = hvM === 11 ? hvY + 1 : hvY;
    var m2 = (hvM + 1) % 12;
    grid.innerHTML = cal.mkMonth(hvY, hvM) + cal.mkMonth(y2, m2);
    grid.querySelectorAll('.ab-day:not(.disabled)').forEach(function(c) {
      c.addEventListener('click', function() {
        cal.click(c.dataset.date);
        renderHdrCal();
        updateHdrDateBar();
      });
      c.addEventListener('mouseenter', function() {
        var s = cal.getS(), e = cal.getE();
        if (!s || e) return;
        var hd = pd2(c.dataset.date); if (!hd || hd <= s) return;
        grid.querySelectorAll('.ab-day[data-date]').forEach(function(x) {
          var xd = pd2(x.dataset.date);
          x.classList.toggle('hover-range', xd && xd > s && xd <= hd);
        });
      });
    });
    grid.addEventListener('mouseleave', function() {
      grid.querySelectorAll('.hover-range').forEach(function(c) { c.classList.remove('hover-range'); });
    });
  }

  var hdrPrev = document.getElementById('ab-hdr-cal-prev');
  var hdrNext = document.getElementById('ab-hdr-cal-next');
  if (hdrPrev) hdrPrev.addEventListener('click', function() {
    if (hvM === 0) { hvY--; hvM = 11; } else hvM--;
    renderHdrCal();
  });
  if (hdrNext) hdrNext.addEventListener('click', function() {
    if (hvM === 11) { hvY++; hvM = 0; } else hvM++;
    renderHdrCal();
  });

  // Dates / Flexible toggle (visual only)
  var dftgD = document.getElementById('ab-hdr-dftg-dates');
  var dftgF = document.getElementById('ab-hdr-dftg-flex');
  if (dftgD && dftgF) {
    dftgD.addEventListener('click', function() { dftgD.classList.add('ab-hdr-dftg-on'); dftgF.classList.remove('ab-hdr-dftg-on'); });
    dftgF.addEventListener('click', function() { dftgF.classList.add('ab-hdr-dftg-on'); dftgD.classList.remove('ab-hdr-dftg-on'); });
  }

  // ── Header guest picker ────────────────────────────────────────────────
  var hg    = { adults: 1, children: 0, infants: 0, pets: 0 };
  var hgMax = { adults: 16, children: 16, infants: 5, pets: 16 };
  var hgMin = { adults: 1, children: 0, infants: 0, pets: 0 };

  function updateGuestSV() {
    var sv = document.getElementById('ab-sv-guests');
    if (!sv) return;
    var total = hg.adults + hg.children;
    var parts = [];
    if (total > 0) parts.push(total + ' guest' + (total !== 1 ? 's' : ''));
    if (hg.infants) parts.push(hg.infants + ' infant' + (hg.infants !== 1 ? 's' : ''));
    if (hg.pets)    parts.push(hg.pets + ' pet' + (hg.pets !== 1 ? 's' : ''));
    sv.textContent = parts.length ? parts.join(', ') : 'Add guests';
  }

  function hgUpdate() {
    var g = window.__mfGuests;
    if (g) { hgMax.adults = g.MAX; g.set(hg.adults); }
    ['adults','children','infants','pets'].forEach(function(cat) {
      var cnt   = document.getElementById('ab-hg-cnt-' + cat);
      var minus = document.getElementById('ab-hg-minus-' + cat);
      var plus  = document.getElementById('ab-hg-plus-' + cat);
      if (cnt)   cnt.textContent = hg[cat];
      if (minus) minus.disabled = hg[cat] <= hgMin[cat];
      if (plus)  plus.disabled  = hg[cat] >= hgMax[cat];
    });
    updateGuestSV();
  }

  ['adults','children','infants','pets'].forEach(function(cat) {
    var minus = document.getElementById('ab-hg-minus-' + cat);
    var plus  = document.getElementById('ab-hg-plus-' + cat);
    if (minus) minus.addEventListener('click', function(e) {
      e.stopPropagation();
      if (hg[cat] > hgMin[cat]) { hg[cat]--; hgUpdate(); }
    });
    if (plus) plus.addEventListener('click', function(e) {
      e.stopPropagation();
      if (hg[cat] < hgMax[cat]) { hg[cat]++; hgUpdate(); }
    });
  });

  hgUpdate();
})();

// ── Language / Currency Modal ─────────────────────────────────────────────
(function(){
  var LANGS = [
    ['English','United Kingdom'],['Azərbaycan dili','Azərbaycan'],['Bahasa Indonesia','Indonesia'],
    ['Bosanski','Bosna i Hercegovina'],['Català','Espanya'],['Čeština','Česká republika'],
    ['Crnogorski','Crna Gora'],['Dansk','Danmark'],['Deutsch','Deutschland'],['Deutsch','Österreich'],
    ['Deutsch','Schweiz'],['Deutsch','Luxemburg'],['Eesti','Eesti'],['English','Australia'],
    ['English','Canada'],['English','Guyana'],['English','India'],['English','Ireland'],
    ['English','New Zealand'],['English','Singapore'],['English','South Africa'],
    ['English','United States'],['Español','Argentina'],['Español','Bolivia'],
    ['Español','Chile'],['Español','Colombia'],['Español','Costa Rica'],['Español','Ecuador'],
    ['Español','España'],['Español','Guatemala'],['Español','Honduras'],['Español','México'],
    ['Español','Nicaragua'],['Español','Panamá'],['Español','Paraguay'],['Español','Perú'],
    ['Français','Belgique'],['Français','Canada'],['Français','France'],['Français','Suisse'],
    ['Hrvatski','Hrvatska'],['Italiano','Italia'],['Latviešu','Latvija'],['Lietuvių','Lietuva'],
    ['Magyar','Magyarország'],['Melayu','Malaysia'],['Nederlands','België'],['Nederlands','Nederland'],
    ['Norsk','Norge'],['Polski','Polska'],['Português','Brasil'],['Português','Portugal'],
    ['Română','România'],['Slovenčina','Slovensko'],['Slovenščina','Slovenija'],
    ['Suomi','Suomi'],['Svenska','Sverige'],['Tiếng Việt','Việt Nam'],['Türkçe','Türkiye'],
    ['Ελληνικά','Ελλάδα'],['Български','България'],['Русский','Россия'],['Українська','Україна'],
    ['עברית','ישראל'],['العربية','المملكة العربية السعودية'],
    ['ภาษาไทย','ประเทศไทย'],['한국어','대한민국'],['日本語','日本'],
    ['中文（简体）','中国'],['中文（繁體）','台灣']
  ];
  var CURRS = [
    ['Pound sterling','GBP','£'],['Australian dollar','AUD','$'],['Brazilian real','BRL','R$'],
    ['Bulgarian lev','BGN','лв.'],['Canadian dollar','CAD','$'],['Chilean peso','CLP','$'],
    ['Chinese yuan','CNY','¥'],['Colombian peso','COP','$'],['Costa Rican colon','CRC','₡'],
    ['Czech koruna','CZK','Kč'],['Danish krone','DKK','kr'],['Egyptian pound','EGP','ج.م'],
    ['Emirati dirham','AED','د.إ'],['Euro','EUR','€'],['Ghanaian cedi','GHS','GH₵'],
    ['Hong Kong dollar','HKD','$'],['Hungarian forint','HUF','Ft'],['Indian rupee','INR','₹'],
    ['Indonesian rupiah','IDR','Rp'],['Israeli new shekel','ILS','₪'],['Japanese yen','JPY','¥'],
    ['Kazakhstani tenge','KZT','₸'],['Kenyan shilling','KES','KSh'],
    ['Malaysian ringgit','MYR','RM'],['Mexican peso','MXN','$'],['Moroccan dirham','MAD','MAD'],
    ['New Taiwan dollar','TWD','$'],['New Zealand dollar','NZD','$'],
    ['Nigerian naira','NGN','₦'],['Norwegian krone','NOK','kr'],['Peruvian sol','PEN','S/'],
    ['Philippine peso','PHP','₱'],['Polish zloty','PLN','zł'],['Qatari riyal','QAR','ر.ق'],
    ['Romanian leu','RON','lei'],['Saudi Arabian riyal','SAR','SR'],['Singapore dollar','SGD','$'],
    ['South African rand','ZAR','R'],['South Korean won','KRW','₩'],
    ['Swedish krona','SEK','kr'],['Swiss franc','CHF','CHF'],['Thai baht','THB','฿'],
    ['Turkish lira','TRY','₺'],['Ukrainian hryvnia','UAH','₴'],
    ['US dollar','USD','$']
  ];

  var selLang = 'English||United Kingdom';
  var selCur  = 'Pound sterling';

  var modal   = document.getElementById('ab-lang-modal');
  var bd      = document.getElementById('ab-lang-bd');
  var closeBtn= document.getElementById('ab-lang-close');
  var globeBtn= document.getElementById('ab-globe-btn');
  var tLang   = document.getElementById('ab-lang-t-lang');
  var tCur    = document.getElementById('ab-lang-t-cur');
  var pLang   = document.getElementById('ab-lang-p-lang');
  var pCur    = document.getElementById('ab-lang-p-cur');
  var gLang   = document.getElementById('ab-lang-grid-lang');
  var gCur    = document.getElementById('ab-lang-grid-cur');

  if (!modal || !globeBtn) return;

  function buildGrid(grid, items, keyFn, labelFn, subFn, curSel) {
    grid.innerHTML = '';
    items.forEach(function(it) {
      var key = keyFn(it);
      var btn = document.createElement('button');
      btn.className = 'ab-lang-opt' + (key === curSel ? ' sel' : '');
      btn.setAttribute('type', 'button');
      btn.innerHTML = '<span class="ab-lang-opt-n">' + labelFn(it) + '</span>' +
                      '<span class="ab-lang-opt-s">' + subFn(it) + '</span>';
      btn.addEventListener('click', function() {
        if (grid === gLang) { selLang = key; }
        else                 { selCur  = key; }
        grid.querySelectorAll('.ab-lang-opt').forEach(function(b){ b.classList.remove('sel'); });
        btn.classList.add('sel');
      });
      grid.appendChild(btn);
    });
  }

  function openModal() {
    buildGrid(gLang, LANGS,
      function(it){ return it[0]+'||'+it[1]; },
      function(it){ return it[0]; },
      function(it){ return it[1]; },
      selLang);
    buildGrid(gCur, CURRS,
      function(it){ return it[0]; },
      function(it){ return it[0]; },
      function(it){ return it[1]+' – '+it[2]; },
      selCur);
    modal.hidden = false;
    globeBtn.setAttribute('aria-expanded','true');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.hidden = true;
    globeBtn.setAttribute('aria-expanded','false');
    document.body.style.overflow = '';
  }

  function showTab(tab) {
    if (tab === 'lang') {
      tLang.classList.add('ab-lang-tab-on'); tLang.setAttribute('aria-selected','true');
      tCur.classList.remove('ab-lang-tab-on'); tCur.setAttribute('aria-selected','false');
      pLang.hidden = false; pCur.hidden = true;
    } else {
      tCur.classList.add('ab-lang-tab-on'); tCur.setAttribute('aria-selected','true');
      tLang.classList.remove('ab-lang-tab-on'); tLang.setAttribute('aria-selected','false');
      pCur.hidden = false; pLang.hidden = true;
    }
  }

  globeBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (!modal.hidden) { closeModal(); return; }
    // Close any open search panels
    var hdrExp = document.getElementById('ab-hdr-exp');
    var hdrBd  = document.getElementById('ab-hdr-bd');
    var hdrEl  = document.querySelector('.ab-header');
    if (hdrExp && hdrExp.classList.contains('open')) {
      hdrExp.classList.remove('open');
      if (hdrBd) hdrBd.classList.remove('open');
      if (hdrEl) hdrEl.classList.remove('hdr-expanded');
      document.querySelectorAll('.ab-seg').forEach(function(b){ b.classList.remove('ab-seg-active'); });
    }
    // Close hamburger if open
    var mDd = document.getElementById('ab-menu-dd');
    var mBtn= document.getElementById('ab-menu-btn');
    if (mDd && mDd.classList.contains('open')) {
      mDd.classList.remove('open');
      if (mBtn) mBtn.setAttribute('aria-expanded','false');
    }
    openModal();
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (bd) bd.addEventListener('click', closeModal);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  if (tLang) tLang.addEventListener('click', function(){ showTab('lang'); });
  if (tCur)  tCur.addEventListener('click',  function(){ showTab('cur');  });
})();
</script>
</body>
</html>`;
}

// Helper used inside template literal above (hoisted by function declaration style below)
function hostingMonthsText(joinedYear) {
  var y = parseInt(joinedYear, 10);
  if (!y || y < 2000) return '';
  var months = Math.max(1, (new Date().getFullYear() - y) * 12);
  return months + ' months hosting';
}

module.exports = renderAccommodationListing;
