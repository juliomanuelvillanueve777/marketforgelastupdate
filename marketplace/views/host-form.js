function hostFormHtml(host, esc) {
  const H = host || {};
  const isEdit = !!(H && H.id);
  const photoPrev = H.photo
    ? `<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
        <img src="${esc(H.photo)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.1)">
        <label style="color:#aaa;font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" name="remove_photo" value="1"> Remove photo</label>
      </div>` : '';
  return `
<style>
.mf-card{background:linear-gradient(165deg,#16162a 0%,#0f0f1c 100%);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:28px;margin-bottom:24px;box-shadow:0 16px 48px rgba(0,0,0,.35)}
.mf-card h2{margin:0 0 4px;font-size:20px;font-weight:700;color:#fff}
.mf-card .mf-sub{color:#6b7280;font-size:13px;margin:0 0 22px}
.mf-sec{font-size:13px;font-weight:700;color:#e5e7eb;margin:20px 0 12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px}
.mf-sec span{display:inline-flex;width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,#FF385C,#E61E4D);color:#fff;font-size:11px;font-weight:800;align-items:center;justify-content:center}
.mf-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.mf-grid .full{grid-column:1/-1}
.mf-field label{display:block;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;margin-bottom:6px}
.mf-field input,.mf-field select,.mf-field textarea{width:100%;padding:11px 13px;background:#0a0a14;border:1px solid rgba(255,255,255,.08);color:#f3f4f6;border-radius:11px;font-size:14px}
.mf-field input:focus,.mf-field select:focus,.mf-field textarea:focus{outline:none;border-color:rgba(255,56,92,.55);box-shadow:0 0 0 3px rgba(255,56,92,.12)}
.mf-check{display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px}
.mf-check input{width:17px;height:17px;accent-color:#FF385C}
.mf-check label{color:#d1d5db;font-size:13px;margin:0;cursor:pointer}
.mf-btn{padding:13px 26px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;box-shadow:0 10px 28px rgba(255,56,92,.28)}
.mf-actions{display:flex;align-items:center;gap:14px;margin-top:20px;padding-top:18px;border-top:1px solid rgba(255,255,255,.06)}
.mf-hint{color:#6b7280;font-size:12px;margin-top:6px}
@media(max-width:800px){.mf-grid{grid-template-columns:1fr}}
</style>
<form method="POST" action="/dashboard/hosts/save" enctype="multipart/form-data" class="mf-card" id="hostForm">
  ${isEdit ? `<input type="hidden" name="id" value="${H.id}">` : ''}
  <h2>${isEdit ? 'Edit host' : 'New host'}</h2>
  <p class="mf-sub">Profile shown on the public listing (name, photo, Superhost badge, response stats).</p>
  <div class="mf-sec"><span>1</span> Profile</div>
  ${photoPrev}
  <div class="mf-grid">
    <div class="mf-field"><label>Host name *</label><input name="name" required value="${esc(H.name||'')}" placeholder="Camille"></div>
    <div class="mf-field"><label>Location</label><input name="location" value="${esc(H.location||'')}" placeholder="London, UK"></div>
    <div class="mf-field"><label>Photo upload</label><input type="file" name="host_photo" accept="image/*"></div>
    <div class="mf-field"><label>Or photo URL</label><input name="photo_url" value="${esc((H.photo && !String(H.photo).startsWith('/uploads/')) ? H.photo : '')}" placeholder="https://…/host.jpg"></div>
    <div class="full mf-check"><input type="checkbox" name="is_superhost" value="1" id="hsSuper"${(H.is_superhost===undefined||Number(H.is_superhost)===1)?' checked':''}><label for="hsSuper">Superhost</label></div>
    <div class="full mf-check"><input type="checkbox" name="identity_verified" value="1" id="hsId"${(H.identity_verified===undefined||Number(H.identity_verified)===1)?' checked':''}><label for="hsId">Identity verified</label></div>
  </div>
  <div class="mf-sec"><span>2</span> Stats</div>
  <div class="mf-grid">
    <div class="mf-field"><label>Joined year</label><input name="joined_year" value="${esc(H.joined_year||'2018')}" placeholder="2018"></div>
    <div class="mf-field"><label>Response rate</label><input name="response_rate" value="${esc(H.response_rate||'100%')}" placeholder="100%"></div>
    <div class="mf-field"><label>Response time</label><input name="response_time" value="${esc(H.response_time||'within an hour')}" placeholder="within an hour"></div>
    <div class="mf-field"><label>Languages</label><input name="languages" value="${esc(H.languages||'English')}" placeholder="English, French"></div>
    <div class="mf-field"><label>Reviews count</label><input type="number" name="reviews_count" value="${H.reviews_count??48}" min="0"></div>
    <div class="mf-field"><label>Rating</label><input name="rating" value="${esc(String(H.rating||'4.92'))}"></div>
  </div>
  <div class="mf-sec"><span>3</span> About</div>
  <div class="mf-grid">
    <div class="mf-field full"><label>About the host</label><textarea name="about" rows="4" placeholder="Short bio shown on the listing…">${esc(H.about||'')}</textarea></div>
  </div>
  <div class="mf-actions">
    <button class="mf-btn" type="submit">${isEdit ? 'Save changes' : 'Save host'}</button>
    ${isEdit ? '<a href="/dashboard/hosts" style="color:#8899ff;font-size:13px;text-decoration:none">Cancel</a>' : ''}
  </div>
</form>`;
}

module.exports = { hostFormHtml };
