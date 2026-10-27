const { AMENITY_LIST, amenityChipsHtml } = require('../utils/amenities');

function listingCreateFormHtml(fixedMarketplace, listing, opts) {
  opts = opts || {};
  const esc = opts.esc;
  const DOMAIN_OPTIONS = opts.DOMAIN_OPTIONS;
  const L = listing || null;
  const isEdit = !!(L && L.id);
  const mpFixed = fixedMarketplace || opts.fixedMarketplace || '';
  const mp = (isEdit ? (L.marketplace || 'airbnb') : (mpFixed || '')).toLowerCase();
  const apartments = Array.isArray(opts.apartments) ? opts.apartments : [];
  const hosts = Array.isArray(opts.hosts) ? opts.hosts : [];
  const selApt = isEdit ? L.apartment_id : opts.selectedApartmentId;
  const selHost = isEdit ? L.host_id : opts.selectedHostId;
  const aptOptions = ['<option value="">— Select apartment —</option>'].concat(
    apartments.map(a => `<option value="${a.id}"${Number(selApt)===Number(a.id) ? ' selected' : ''}>${esc(a.name || a.title)}${a.location ? ' · ' + esc(a.location) : ''}</option>`)
  ).join('');
  const hostOptions = ['<option value="">— Select host —</option>'].concat(
    hosts.map(h => `<option value="${h.id}"${Number(selHost)===Number(h.id) ? ' selected' : ''}>${esc(h.name)}${Number(h.is_superhost)===1 ? ' · Superhost' : ''}</option>`)
  ).join('');

  let existingAmens = [];
  if (isEdit && L.amenities) existingAmens = String(L.amenities).split(',').map(s => s.trim()).filter(Boolean);
  const amenChecks = amenityChipsHtml(isEdit ? existingAmens : [], esc);

  const selDomain = isEdit ? (L.display_domain || '') : '';
  const abDomains = DOMAIN_OPTIONS.airbnb.map((d, i) => {
    const sel = selDomain ? (d.host === selDomain) : (i === 0 && mp !== 'booking');
    return `<option value="${d.host}"${sel ? ' selected' : ''}>${d.label}</option>`;
  }).join('');
  const bkDomains = DOMAIN_OPTIONS.booking.map((d, i) => {
    const sel = selDomain ? (d.host === selDomain) : (i === 0 && mp === 'booking');
    return `<option value="${d.host}"${sel ? ' selected' : ''}>${d.label}</option>`;
  }).join('');

  const accent = mp === 'booking' ? '#0071c2' : '#FF385C';
  const accent2 = mp === 'booking' ? '#003580' : '#E61E4D';
  const platformLabel = mp === 'booking' ? 'Booking.com' : (mp === 'airbnb' ? 'Airbnb' : 'Listing');

  const platformBlock = mp
    ? `<input type="hidden" name="marketplace" value="${mp}">
       <div class="mf-platform-badge" style="--acc:${accent}">${platformLabel}</div>`
    : `<div class="mf-plat-row">
         <label class="mf-plat"><input type="radio" name="marketplace" value="airbnb" checked onchange="mfOnMp(this.value)"><div><strong>Airbnb</strong><small>Airbnb listing</small></div></label>
         <label class="mf-plat"><input type="radio" name="marketplace" value="booking" onchange="mfOnMp(this.value)"><div><strong>Booking.com</strong><small>Booking listing</small></div></label>
       </div>`;

  const mediaEdit = isEdit ? (() => {
    let imgs = [];
    try { imgs = L.images ? JSON.parse(L.images) : []; } catch (e) { imgs = []; }
    if (!imgs.length && L.image_url) imgs = [L.image_url];
    const gal = imgs.length ? `<div class="mf-media-grid">${imgs.map(u => `<label class="mf-thumb"><img src="${esc(u)}"><span><input type="checkbox" name="remove_image" value="${esc(u)}"> Remove</span></label>`).join('')}</div>` : '';
    const hostPrev = L.host_photo ? `<div style="margin:8px 0 12px;display:flex;align-items:center;gap:12px"><img src="${esc(L.host_photo)}" style="width:56px;height:56px;border-radius:50%;object-fit:cover"><label style="color:#aaa;font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" name="remove_host_photo" value="1"> Remove host photo</label></div>` : '';
    const vidPrev = L.video_url ? `<p class="mf-hint">Video: <a href="${esc(L.video_url)}" target="_blank" style="color:#4da3ff">${esc(L.video_url)}</a>
      <label style="margin-left:10px;color:#ccc"><input type="checkbox" name="remove_video" value="1"> Remove</label></p>` : '';
    return gal + hostPrev + vidPrev;
  })() : '';

  return `
<style>
.mf-card{background:linear-gradient(165deg,#16162a 0%,#0f0f1c 100%);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:28px;margin-bottom:28px;box-shadow:0 16px 48px rgba(0,0,0,.35)}
.mf-card h2{margin:0 0 4px;font-size:20px;font-weight:700;color:#fff;letter-spacing:-.02em}
.mf-card .mf-sub{color:#6b7280;font-size:13px;margin:0 0 20px;line-height:1.45}
.mf-sec{font-size:13px;font-weight:700;color:#e5e7eb;margin:22px 0 12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px}
.mf-sec span{display:inline-flex;width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,${accent},${accent2});color:#fff;font-size:11px;font-weight:800;align-items:center;justify-content:center}
.mf-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.mf-grid .full{grid-column:1/-1}
.mf-field label{display:block;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;margin-bottom:6px}
.mf-field input,.mf-field select,.mf-field textarea{width:100%;padding:11px 13px;background:#0a0a14;border:1px solid rgba(255,255,255,.08);color:#f3f4f6;border-radius:11px;font-size:14px}
.mf-field input:focus,.mf-field select:focus,.mf-field textarea:focus{outline:none;border-color:rgba(255,56,92,.55);box-shadow:0 0 0 3px rgba(255,56,92,.12)}
.mf-field input::placeholder,.mf-field textarea::placeholder{color:#4b5563}
.mf-platform-badge{display:inline-flex;align-items:center;padding:10px 16px;border-radius:12px;font-weight:700;color:#fff;background:linear-gradient(90deg,var(--acc,#FF385C),#111);border:1px solid rgba(255,255,255,.08);margin-bottom:4px}
.mf-plat-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:4px}
.mf-plat{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);cursor:pointer}
.mf-plat:has(input:checked){border-color:rgba(255,56,92,.55);background:rgba(255,56,92,.08)}
.mf-plat input{margin-top:3px;accent-color:#FF385C}
.mf-plat strong{display:block;color:#fff;font-size:14px}
.mf-plat small{color:#6b7280;font-size:12px}
.mf-lib-card{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:16px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);border-radius:14px}
.mf-hint{color:#6b7280;font-size:12px;margin-top:6px;line-height:1.4}
.mf-hint a{color:#8899ff;text-decoration:none}
.mf-check{display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px}
.mf-check input{width:17px;height:17px;accent-color:${accent}}
.mf-check label{color:#d1d5db;font-size:13px;margin:0;cursor:pointer}
.amen-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px;padding:14px;background:#0a0a14;border:1px solid rgba(255,255,255,.06);border-radius:14px;max-height:220px;overflow:auto}
.amen-item{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid transparent;cursor:pointer}
.amen-item:has(input:checked){border-color:rgba(255,56,92,.5);background:rgba(255,56,92,.1)}
.amen-item input{width:15px;height:15px;accent-color:#FF385C;margin:0;flex-shrink:0}
.amen-label{font-size:12.5px;color:#d1d5db;font-weight:500}
.mf-btn{padding:13px 26px;background:linear-gradient(90deg,${accent},${accent2});color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.25);font-size:14px}
.mf-prev-btn{background:linear-gradient(90deg,#2d3748,#1a202c);border:1px solid rgba(255,255,255,.15)}
.mf-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:22px;padding-top:18px;border-top:1px solid rgba(255,255,255,.06)}
.mf-media-grid{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.mf-thumb{position:relative;width:104px;cursor:pointer}
.mf-thumb img{width:104px;height:76px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.08);display:block}
.mf-thumb span{position:absolute;left:4px;bottom:4px;background:rgba(0,0,0,.78);color:#fff;font-size:10px;padding:2px 6px;border-radius:5px;display:flex;align-items:center;gap:4px}
.mf-stat{padding:12px 14px;background:#0a0a14;border:1px solid rgba(255,255,255,.06);border-radius:12px;text-align:center}
.mf-stat .k{font-size:11px;color:#6b7280;margin-bottom:4px}
.mf-stat .v{font-size:16px;font-weight:700;color:#e5e7eb}
.mf-custom{${isEdit ? '' : 'display:none;'}}
@media(max-width:800px){.mf-grid,.mf-lib-card,.mf-plat-row{grid-template-columns:1fr}}
</style>
<form method="POST" action="${isEdit ? '/dashboard/listings/update/' + L.id : '/dashboard/listings/create'}" enctype="multipart/form-data" class="mf-card" id="createListingForm">
  <h2>${isEdit ? ('Edit listing #' + L.id) : ('Create ' + platformLabel + ' listing')}</h2>
  <p class="mf-sub">${isEdit
    ? 'Update property details, host, or media.'
    : 'Select apartment & host from your libraries, then generate the listing.'}</p>

  <div class="mf-sec"><span>1</span> Libraries</div>
  <div class="mf-lib-card">
    <div class="mf-field">
      <label>Apartment *</label>
      <select name="apartment_id" id="mfApartment" ${isEdit ? '' : 'required'} onchange="mfOnApartment(this.value)">
        ${aptOptions}
      </select>
      <p class="mf-hint">Manage in <a href="/dashboard/apartments">Apartments</a>. Photos, price & description come from the template.</p>
    </div>
    <div class="mf-field">
      <label>Host *</label>
      <select name="host_id" id="mfHost" ${isEdit ? '' : 'required'}>
        ${hostOptions}
      </select>
      <p class="mf-hint">Manage in <a href="/dashboard/hosts">Hosts</a>. Name & photo applied automatically.</p>
    </div>
  </div>

  <div class="mf-sec"><span>2</span> Platform & locale</div>
  ${platformBlock}
  <div class="mf-grid" style="margin-top:14px">
    <div class="mf-field"><label>Display domain</label>
      <select name="display_domain" id="mfDomain">
        <optgroup label="Airbnb" id="mfOgAb">${abDomains}</optgroup>
        <optgroup label="Booking" id="mfOgBk"${mp === 'airbnb' ? ' disabled' : ''}>${bkDomains}</optgroup>
      </select>
    </div>
    <div class="mf-field"><label>Country / language</label>
      <select name="locale" id="mfLocale" onchange="mfOnLocale()">
        ${['fr','gb','us','es','de','it','pt','ro','nl','jp','au','br'].map(code => {
          const labels = {fr:'France / Français',gb:'United Kingdom / English',us:'United States / English',es:'España / Español',de:'Deutschland / Deutsch',it:'Italia / Italiano',pt:'Portugal / Português',ro:'România / Română',nl:'Nederland / Nederlands',jp:'日本 / 日本語',au:'Australia / English',br:'Brasil / Português'};
          const cur = isEdit ? (L.locale || 'gb') : 'gb';
          return `<option value="${code}"${cur === code ? ' selected' : ''}>${labels[code]}</option>`;
        }).join('')}
      </select>
    </div>
    <div class="mf-field" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="mf-stat"><div class="k">Currency</div><div class="v" id="mfCurrencyDisplay">£ — GBP</div></div>
      <div class="mf-stat"><div class="k">Page language</div><div class="v" id="mfLangDisplay">English</div></div>
    </div>
  </div>

  <div class="mf-sec">Template</div>
  <div class="mf-grid">
    <div class="mf-field">
      <label>Accommodation template</label>
      <select name="template_id">
        <option value="airbnb-style"${isEdit && L.template_id ? (L.template_id === 'airbnb-style' ? ' selected' : '') : ' selected'}>Airbnb-style Accommodation</option>
      </select>
      <p class="mf-hint">Controls how the public listing page is rendered. More templates coming soon.</p>
    </div>
  </div>

  <div id="mfCustomBlock" class="mf-custom">
    <div class="mf-sec"><span>3</span> Property details ${isEdit ? '' : '(only if no apartment selected)'}</div>
    <div class="mf-grid">
      <div class="mf-field full"><label>Title</label><input type="text" name="title" id="mfTitle" placeholder="Luxury apartment…" value="${isEdit ? esc(L.title || '') : ''}" ${isEdit ? 'required' : ''}></div>
      <div class="mf-field"><label>Location</label><input type="text" name="location" id="mfLocation" placeholder="Paris, France" value="${isEdit ? esc(L.location || '') : ''}" ${isEdit ? 'required' : ''}></div>
      <div class="mf-field"><label>Host name (fallback)</label><input type="text" name="host_name" placeholder="Camille" value="${isEdit ? esc(L.host_name || '') : ''}"></div>
      <div class="mf-field"><label id="mfPriceNightLbl">Price / night</label><input type="number" step="0.01" name="price" id="mfPriceNight" placeholder="189" value="${isEdit ? esc(String(L.price ?? '')) : ''}" ${isEdit ? 'required' : ''}></div>
      <div class="mf-field"><label id="mfPriceMonthLbl">Price / month</label><input type="number" step="0.01" name="price_month" id="mfPriceMonth" placeholder="3850" value="${isEdit ? esc(String(L.price_month ?? '')) : ''}" ${isEdit ? 'required' : ''}></div>
      <div class="full mf-check"><input type="checkbox" name="hide_nightly" value="1" id="mfHideNightly"${isEdit && Number(L.hide_nightly)===1 ? ' checked' : ''}><label for="mfHideNightly">Hide nightly — show monthly only</label></div>
      <div class="mf-field"><label>Property type</label>
        <select name="property_type">${['Entire apartment','Entire home','Private room','Hotel room','Shared room','Boutique hotel'].map(pt => {
          const cur = isEdit ? (L.property_type || 'Entire apartment') : 'Entire apartment';
          return `<option${cur===pt?' selected':''}>${pt}</option>`;
        }).join('')}</select>
      </div>
      <div class="mf-field"><label>Guests</label><input type="number" name="guests" value="${isEdit ? (L.guests || 4) : 4}" min="1" max="16"></div>
      <div class="mf-field"><label>Bedrooms</label><input type="number" name="bedrooms" value="${isEdit ? (L.bedrooms ?? 2) : 2}" min="0"></div>
      <div class="mf-field"><label>Beds</label><input type="number" name="beds" value="${isEdit ? (L.beds ?? 2) : 2}" min="1"></div>
      <div class="mf-field"><label>Baths</label><input type="number" step="0.5" name="baths" value="${isEdit ? (L.baths ?? 1) : 1}" min="0.5"></div>
      <div class="mf-field"><label>Rating</label><input type="text" name="rating" value="${isEdit ? esc(String(L.rating || '4.92')) : '4.92'}"></div>
      <div class="mf-field"><label>Reviews</label><input type="number" name="reviews" value="${isEdit ? (L.reviews ?? 48) : 48}" min="0" max="500"></div>
      <div class="mf-field full"><label>Description</label><textarea name="description" rows="5" placeholder="Describe the space…">${isEdit ? esc(L.description || '') : ''}</textarea></div>
    </div>
    <div class="mf-sec">Amenities</div>
    <div class="amen-grid">${amenChecks}</div>
    <div class="mf-grid" style="margin-top:12px">
      <div class="mf-field full"><label>Extra amenities</label><input type="text" name="amenities_custom" placeholder="Wine cellar, Concierge…" value="${isEdit ? esc((existingAmens.filter(a => !AMENITY_LIST.some(x => x.toLowerCase()===a.toLowerCase()))).join(', ')) : ''}"></div>
    </div>
    <div class="mf-sec">Photos & video</div>
    ${mediaEdit}
    <div class="mf-grid">
      <div class="mf-field full"><label>${isEdit ? 'Add photos' : 'Photos'}</label><input type="file" name="photos" accept="image/*" multiple></div>
      <div class="mf-field"><label>Video file</label><input type="file" name="videos" accept="video/*"></div>
      <div class="mf-field"><label>Video URL</label><input type="text" name="video_url" placeholder="https://…/tour.mp4" value="${isEdit && L.video_url && !String(L.video_url).startsWith('/uploads/') ? esc(L.video_url) : ''}"></div>
      <div class="mf-field full"><label>Host photo upload (fallback)</label><input type="file" name="host_photo" accept="image/*"></div>
      <div class="mf-field full"><label>Photo URLs (one per line)</label><textarea name="image_urls" rows="2" placeholder="https://…/photo1.jpg"></textarea></div>
    </div>
  </div>

  <div class="mf-actions">
    <button type="submit" class="mf-btn">${isEdit ? 'Save listing' : 'Generate listing'}</button>
    <button type="submit" formaction="/dashboard/listings/preview" formtarget="_blank" class="mf-btn mf-prev-btn">Preview</button>
    ${isEdit ? '<a href="/dashboard/listari" style="color:#8899ff;font-size:13px;text-decoration:none">Cancel</a>' : '<span class="mf-hint" style="margin:0">Uses apartment photos, pricing & host profile automatically. Saved to Listings.</span>'}
  </div>
</form>
<script>
(function(){
  var fixed = ${JSON.stringify(mp || '')};
  var isEdit = ${isEdit ? 'true' : 'false'};
  function mpVal(){
    if (fixed) return fixed;
    var r = document.querySelector('input[name=marketplace]:checked');
    return r ? r.value : 'airbnb';
  }
  var LOCALE_MAP = ${JSON.stringify({fr:{cur:'€',lang:'Français'},gb:{cur:'£',lang:'English'},us:{cur:'$',lang:'English'},es:{cur:'€',lang:'Español'},de:{cur:'€',lang:'Deutsch'},it:{cur:'€',lang:'Italiano'},pt:{cur:'€',lang:'Português'},ro:{cur:'RON',lang:'Română'},nl:{cur:'€',lang:'Nederlands'},jp:{cur:'¥',lang:'日本語'},au:{cur:'A$',lang:'English'},br:{cur:'R$',lang:'Português'}})};
  var LOCALE_DOMAIN = {
    airbnb:{gb:'www.airbnb.co.uk',en:'www.airbnb.co.uk',fr:'www.airbnb.fr',de:'www.airbnb.de',es:'www.airbnb.es',it:'www.airbnb.it',us:'www.airbnb.com',au:'www.airbnb.com.au',br:'www.airbnb.com.br',jp:'www.airbnb.co.jp',pt:'www.airbnb.com',ro:'www.airbnb.com',nl:'www.airbnb.com'},
    booking:{gb:'www.booking.co.uk',en:'www.booking.co.uk',fr:'www.booking.fr',de:'www.booking.de',es:'www.booking.es',it:'www.booking.it',us:'www.booking.com',au:'www.booking.com',br:'www.booking.com',jp:'www.booking.com',pt:'www.booking.com',ro:'www.booking.com',nl:'www.booking.com'}
  };
  var CUR_CODES = {fr:'EUR',gb:'GBP',us:'USD',es:'EUR',de:'EUR',it:'EUR',pt:'EUR',ro:'RON',nl:'EUR',jp:'JPY',au:'AUD',br:'BRL'};
  window.mfOnLocale = function(){
    var v = (document.getElementById('mfLocale')||{}).value || 'gb';
    var info = LOCALE_MAP[v] || LOCALE_MAP.gb;
    var curEl = document.getElementById('mfCurrencyDisplay');
    var langEl = document.getElementById('mfLangDisplay');
    if (curEl) curEl.textContent = info.cur + ' — ' + (CUR_CODES[v]||'EUR');
    if (langEl) langEl.textContent = info.lang;
    var nightLbl = document.getElementById('mfPriceNightLbl');
    var monthLbl = document.getElementById('mfPriceMonthLbl');
    if (nightLbl) nightLbl.textContent = 'Price / night (' + info.cur + ')';
    if (monthLbl) monthLbl.textContent = 'Price / month (' + info.cur + ')';
    var mpv = mpVal();
    var map = LOCALE_DOMAIN[mpv==='booking'?'booking':'airbnb'] || {};
    var want = map[v];
    var sel = document.getElementById('mfDomain');
    if (sel && want) {
      var has = Array.prototype.some.call(sel.options, function(o){ return o.value === want; });
      if (has) sel.value = want;
    }
  };
  window.mfOnMp = function(v){
    var ogAb = document.getElementById('mfOgAb');
    var ogBk = document.getElementById('mfOgBk');
    var sel = document.getElementById('mfDomain');
    if (!sel) return;
    if (v === 'booking') {
      if (ogBk) ogBk.disabled = false;
      if (ogAb) ogAb.disabled = true;
      var first = sel.querySelector('#mfOgBk option');
      if (first) sel.value = first.value;
    } else {
      if (ogAb) ogAb.disabled = false;
      if (ogBk) ogBk.disabled = true;
      var first2 = sel.querySelector('#mfOgAb option');
      if (first2) sel.value = first2.value;
    }
  };
  window.mfOnApartment = function(id){
    if (isEdit) return;
    var box = document.getElementById('mfCustomBlock');
    var hide = !!id;
    if (box) box.style.display = hide ? 'none' : 'block';
    ['title','location','price','price_month'].forEach(function(n){
      var inp = document.querySelector('#createListingForm [name="'+n+'"]');
      if (!inp) return;
      if (hide) inp.removeAttribute('required');
      else inp.setAttribute('required','required');
    });
  };
  mfOnLocale();
  var aptSel = document.getElementById('mfApartment');
  if (aptSel && !isEdit) mfOnApartment(aptSel.value);
  if (fixed) mfOnMp(fixed); else mfOnMp(mpVal());
})();
</script>`;
}

module.exports = { listingCreateFormHtml };
