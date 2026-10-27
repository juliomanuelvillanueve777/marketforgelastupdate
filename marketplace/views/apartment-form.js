const { AMENITY_LIST, amenityChipsHtml } = require('../utils/amenities');

function apartmentFormHtml(apt, esc) {
  const A = apt || {};
  const isEdit = !!(A && A.id);
  let existingAmens = [];
  if (isEdit && A.amenities) existingAmens = String(A.amenities).split(',').map(s => s.trim()).filter(Boolean);
  const amenChecks = amenityChipsHtml(existingAmens, esc);
  let gal = '';
  if (isEdit) {
    let imgs = [];
    try { imgs = A.images ? JSON.parse(A.images) : []; } catch (e) { imgs = []; }
    if (!imgs.length && A.image_url) imgs = [A.image_url];
    if (imgs.length) {
      gal = `<div class="mf-media-grid">${imgs.map(u => `<label class="mf-thumb"><img src="${esc(u)}"><span><input type="checkbox" name="remove_image" value="${esc(u)}"> Remove</span></label>`).join('')}</div>`;
    }
  }
  return `
<style>
.mf-card{background:linear-gradient(165deg,#16162a 0%,#0f0f1c 100%);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:28px 28px 24px;margin-bottom:24px;box-shadow:0 16px 48px rgba(0,0,0,.35)}
.mf-card h2{margin:0 0 4px;font-size:20px;font-weight:700;color:#fff;letter-spacing:-.02em}
.mf-card .mf-sub{color:#6b7280;font-size:13px;margin:0 0 22px;line-height:1.45}
.mf-steps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}
.mf-step-pill{font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:#9ca3af;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);padding:6px 12px;border-radius:999px}
.mf-step-pill.on{color:#fff;border-color:rgba(255,56,92,.45);background:rgba(255,56,92,.12)}
.mf-sec{font-size:13px;font-weight:700;color:#e5e7eb;margin:22px 0 12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px}
.mf-sec span{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,#FF385C,#E61E4D);color:#fff;font-size:11px;font-weight:800}
.mf-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.mf-grid .full{grid-column:1/-1}
.mf-field label{display:block;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;margin-bottom:6px}
.mf-field input,.mf-field select,.mf-field textarea{width:100%;padding:11px 13px;background:#0a0a14;border:1px solid rgba(255,255,255,.08);color:#f3f4f6;border-radius:11px;font-size:14px;transition:border-color .15s,box-shadow .15s}
.mf-field input:focus,.mf-field select:focus,.mf-field textarea:focus{outline:none;border-color:rgba(255,56,92,.55);box-shadow:0 0 0 3px rgba(255,56,92,.12)}
.mf-field input::placeholder,.mf-field textarea::placeholder{color:#4b5563}
.amen-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px;padding:14px;background:#0a0a14;border:1px solid rgba(255,255,255,.06);border-radius:14px;max-height:260px;overflow:auto}
.amen-item{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid transparent;cursor:pointer;user-select:none;transition:all .12s}
.amen-item:hover{background:rgba(255,255,255,.05)}
.amen-item:has(input:checked){border-color:rgba(255,56,92,.5);background:rgba(255,56,92,.1)}
.amen-item input{width:15px;height:15px;accent-color:#FF385C;margin:0;flex-shrink:0}
.amen-label{font-size:12.5px;color:#d1d5db;font-weight:500;line-height:1.25;text-transform:none;letter-spacing:0}
.mf-check{display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px}
.mf-check input{width:17px;height:17px;accent-color:#FF385C}
.mf-check label{color:#d1d5db;font-size:13px;margin:0;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:500}
.mf-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 26px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 10px 28px rgba(255,56,92,.28);margin-top:8px}
.mf-btn:hover{filter:brightness(1.05)}
.mf-media-grid{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.mf-thumb{position:relative;width:104px;cursor:pointer}
.mf-thumb img{width:104px;height:76px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.08);display:block}
.mf-thumb span{position:absolute;left:4px;bottom:4px;background:rgba(0,0,0,.78);color:#fff;font-size:10px;padding:2px 6px;border-radius:5px;display:flex;align-items:center;gap:4px}
.mf-hint{color:#6b7280;font-size:12px;margin-top:6px;line-height:1.4}
.mf-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:20px;padding-top:18px;border-top:1px solid rgba(255,255,255,.06)}
@media(max-width:800px){.mf-grid{grid-template-columns:1fr}}
</style>
<form method="POST" action="/dashboard/apartments/save" enctype="multipart/form-data" class="mf-card" id="aptForm">
  ${isEdit ? `<input type="hidden" name="id" value="${A.id}">` : ''}
  <h2>${isEdit ? 'Edit apartment' : 'New apartment'}</h2>
  <p class="mf-sub">Reusable property template — available on both Airbnb and Booking when you create a listing.</p>
  <div class="mf-sec"><span>1</span> Basics</div>
  <div class="mf-grid">
    <div class="mf-field"><label>Internal name *</label><input name="name" required value="${esc(A.name||'')}" placeholder="Onyx Mews 2BR"></div>
    <div class="mf-field"><label>Public title *</label><input name="title" required value="${esc(A.title||'')}" placeholder="Stylish 2-bed near the city centre"></div>
    <div class="mf-field"><label>Location *</label><input name="location" required value="${esc(A.location||'')}" placeholder="London, United Kingdom"></div>
    <div class="mf-field"><label>Property type</label>
      <select name="property_type">${['Entire apartment','Entire home','Private room','Hotel room','Shared room','Boutique hotel'].map(pt => `<option${(A.property_type||'Entire apartment')===pt?' selected':''}>${pt}</option>`).join('')}</select>
    </div>
  </div>
  <div class="mf-sec"><span>2</span> Pricing & capacity</div>
  <div class="mf-grid">
    <div class="mf-field"><label>Price / night *</label><input type="number" step="0.01" name="price" required value="${esc(String(A.price??''))}" placeholder="189"></div>
    <div class="mf-field"><label>Price / month *</label><input type="number" step="0.01" name="price_month" required value="${esc(String(A.price_month??''))}" placeholder="3850"></div>
    <div class="full mf-check"><input type="checkbox" name="hide_nightly" value="1" id="aptHideN"${Number(A.hide_nightly)===1?' checked':''}><label for="aptHideN">Hide nightly price — show monthly only on the public page</label></div>
    <div class="mf-field"><label>Guests</label><input type="number" name="guests" min="1" max="16" value="${A.guests||4}"></div>
    <div class="mf-field"><label>Bedrooms</label><input type="number" name="bedrooms" min="0" value="${A.bedrooms??2}"></div>
    <div class="mf-field"><label>Beds</label><input type="number" name="beds" min="1" value="${A.beds??2}"></div>
    <div class="mf-field"><label>Baths</label><input type="number" step="0.5" name="baths" min="0.5" value="${A.baths??1}"></div>
    <div class="mf-field"><label>Locale defaults</label>
      <select name="locale">${['gb','us','fr','es','de','it','pt','ro','nl','au'].map(c=>`<option value="${c}"${(A.locale||'gb')===c?' selected':''}>${c.toUpperCase()}</option>`).join('')}</select>
    </div>
    <div class="mf-field"><label>Rating</label><input name="rating" value="${esc(String(A.rating||'4.92'))}"></div>
    <div class="mf-field"><label>Reviews count</label><input type="number" name="reviews" min="0" value="${A.reviews||48}"></div>
  </div>
  <div class="mf-sec"><span>3</span> Description</div>
  <div class="mf-grid">
    <div class="mf-field full"><label>Full description</label><textarea name="description" rows="5" placeholder="Space, neighbourhood, house rules…">${esc(A.description||'')}</textarea></div>
  </div>
  <div class="mf-sec"><span>4</span> Amenities</div>
  <div class="amen-grid">${amenChecks}</div>
  <div class="mf-grid" style="margin-top:12px">
    <div class="mf-field full"><label>Extra amenities (comma-separated)</label><input type="text" name="amenities_custom" placeholder="Wine cellar, Concierge, Sauna…" value="${isEdit ? esc((existingAmens.filter(a => !AMENITY_LIST.some(x => x.toLowerCase()===a.toLowerCase()))).join(', ')) : ''}"></div>
  </div>
  <div class="mf-sec"><span>5</span> Photos & video</div>
  ${gal}
  <div class="mf-grid">
    <div class="mf-field full"><label>Upload photos</label><input type="file" name="photos" accept="image/*" multiple><p class="mf-hint">JPG, PNG, WebP, GIF — multiple files allowed.</p></div>
    <div class="mf-field full"><label>Or paste photo URLs (one per line)</label><textarea name="image_urls" rows="3" placeholder="https://…/photo1.jpg"></textarea></div>
    <div class="mf-field"><label>Upload video</label><input type="file" name="videos" accept="video/mp4,video/webm,video/quicktime,video/*"><p class="mf-hint">MP4 / WebM / MOV, max 200MB.</p></div>
    <div class="mf-field"><label>Or video URL</label><input type="text" name="video_url" placeholder="https://…/tour.mp4 or YouTube" value="${isEdit && A.video_url && !String(A.video_url).startsWith('/uploads/') ? esc(A.video_url) : (isEdit && A.video_url ? '' : esc(A.video_url||''))}">
      ${isEdit && A.video_url ? `<p class="mf-hint">Current: <a href="${esc(A.video_url)}" target="_blank" style="color:#4da3ff">${esc(A.video_url)}</a></p>` : ''}
    </div>
  </div>
  <div class="mf-actions">
    <button class="mf-btn" type="submit">${isEdit ? 'Save changes' : 'Save apartment'}</button>
    ${isEdit ? '<a href="/dashboard/apartments" style="color:#8899ff;font-size:13px;text-decoration:none">Cancel</a>' : ''}
  </div>
</form>`;
}

function apartmentToListingFields(apt) {
  if (!apt) return {};
  return {
    marketplace: apt.marketplace || 'airbnb',
    title: apt.title,
    description: apt.description || '',
    price: apt.price || '0',
    price_month: apt.price_month || '',
    image_url: apt.image_url || '',
    images: apt.images || '[]',
    location: apt.location || '',
    guests: apt.guests || 2,
    bedrooms: apt.bedrooms || 1,
    beds: apt.beds || 1,
    baths: apt.baths || 1,
    amenities: apt.amenities || '',
    host_name: apt.host_name || '',
    host_photo: apt.host_photo || '',
    rating: apt.rating || '4.92',
    reviews: apt.reviews || 48,
    property_type: apt.property_type || 'Entire apartment',
    display_domain: apt.display_domain || '',
    locale: apt.locale || 'gb',
    currency: apt.currency || 'GBP',
    video_url: apt.video_url || '',
    hide_nightly: apt.hide_nightly || 0
  };
}

module.exports = { apartmentFormHtml, apartmentToListingFields };
