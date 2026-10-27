const express = require('express');
const router = express.Router();
const { apartmentFormHtml } = require('../views/apartment-form');
const { AMENITY_LIST } = require('../utils/amenities');

module.exports = function createApartmentRoutes({ db, requireClient, listingUpload, esc, clientPage, LOCALES, autoDisplayDomain }) {

  // GET /dashboard/apartments — list all + new form
  router.get('/dashboard/apartments', requireClient, (req, res) => {
    const apts = db.prepare('SELECT * FROM apartments WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(req.user.id);
    const rows = apts.map(a => {
      let n = 0;
      try { n = a.images ? JSON.parse(a.images).length : (a.image_url ? 1 : 0); } catch (e) { n = a.image_url ? 1 : 0; }
      const hasVid = a.video_url ? ' · video' : '';
      return `<tr>
        <td style="padding:12px;color:#666;font-size:12px">#${a.id}</td>
        <td style="padding:12px;color:#fff;font-weight:600">${esc(a.name)}</td>
        <td style="padding:12px;color:#bbb;max-width:220px">${esc(a.title)}</td>
        <td style="padding:12px;color:#999">${esc(a.location||'')}</td>
        <td style="padding:12px;color:#4CAF50;font-weight:600">${esc(String(a.price_month||a.price||'—'))}</td>
        <td style="padding:12px;color:#888;font-size:13px">${n} photos${hasVid}</td>
        <td style="padding:12px;white-space:nowrap">
          <a href="/dashboard/apartments/edit/${a.id}" style="color:#4da3ff;margin-right:12px;text-decoration:none">Edit</a>
          <a href="/dashboard/create?apt=${a.id}" style="color:#22c55e;margin-right:12px;text-decoration:none">Use</a>
          <a href="/dashboard/apartments/delete/${a.id}" onclick="return confirm('Delete apartment?')" style="color:#f44336;text-decoration:none">Delete</a>
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="7" style="padding:32px;color:#666;text-align:center">No apartments yet. Add one below — usable on Airbnb and Booking.</td></tr>`;
    let content = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
        <div>
          <h1 style="margin:0 0 6px">Apartment library</h1>
          <p style="color:#777;margin:0;font-size:14px">Shared templates for Airbnb & Booking. Save once, pick when creating a listing.</p>
        </div>
        <a href="#aptForm" style="padding:12px 20px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border-radius:12px;text-decoration:none;font-weight:700;box-shadow:0 8px 24px rgba(255,56,92,.25)">+ New apartment</a>
      </div>
      <div class="panel" style="overflow-x:auto;margin-top:18px;border-radius:14px">
        <table class="data-table" style="width:100%">
          <tr style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.04em"><th style="padding:12px">ID</th><th style="padding:12px">Name</th><th style="padding:12px">Title</th><th style="padding:12px">Location</th><th style="padding:12px">Price</th><th style="padding:12px">Media</th><th style="padding:12px"></th></tr>
          ${rows}
        </table>
      </div>
      <div style="margin-top:28px">${apartmentFormHtml(null, esc)}</div>`;
    res.send(clientPage('Apartments', content, req.user));
  });

  // GET /dashboard/apartments/edit/:id — edit form
  router.get('/dashboard/apartments/edit/:id', requireClient, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const apt = db.prepare('SELECT * FROM apartments WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!apt) return res.redirect('/dashboard/apartments');
    const content = `<div style="margin-bottom:8px"><a href="/dashboard/apartments" style="color:#8899ff">← Back</a></div>${apartmentFormHtml(apt, esc)}`;
    res.send(clientPage('Apartments', content, req.user));
  });

  // GET /dashboard/apartments/delete/:id — delete single
  router.get('/dashboard/apartments/delete/:id', requireClient, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM apartments WHERE id = ? AND user_id = ?').run(id, req.user.id);
    res.redirect('/dashboard/apartments');
  });

  // POST /dashboard/apartments/save — create or update
  router.post('/dashboard/apartments/save', requireClient, (req, res, next) => {
    listingUpload(req, res, (err) => {
      if (err) return res.status(400).send('Upload error: ' + (err.message || err));
      try {
        const b = req.body || {};
        const id = parseInt(b.id, 10) || 0;
        const name = (b.name || b.title || '').trim();
        const title = (b.title || '').trim();
        if (!name || !title) return res.status(400).send('Name and title required');
        const marketplace = 'shared';
        const fileBag = req.files || {};
        const photoFiles = Array.isArray(fileBag.photos) ? fileBag.photos : [];
        const hostFiles = Array.isArray(fileBag.host_photo) ? fileBag.host_photo : [];
        const videoFiles = Array.isArray(fileBag.videos) ? fileBag.videos : [];
        let images = [];
        let existing = id ? db.prepare('SELECT * FROM apartments WHERE id = ? AND user_id = ?').get(id, req.user.id) : null;
        if (existing && existing.images) {
          try { images = JSON.parse(existing.images) || []; } catch (e) { images = []; }
        }
        if (!images.length && existing && existing.image_url) images = [existing.image_url];
        let removeSet = b.remove_image;
        if (!removeSet) removeSet = [];
        if (!Array.isArray(removeSet)) removeSet = [removeSet];
        removeSet = new Set(removeSet.map(String));
        images = images.filter(u => !removeSet.has(String(u)));
        photoFiles.forEach(f => images.push('/uploads/' + f.filename));
        if (b.image_urls) String(b.image_urls).split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(u => images.push(u));
        if (b.image_url && String(b.image_url).trim()) images.push(String(b.image_url).trim());
        images = [...new Set(images.filter(Boolean))];
        const primary = images[0] || '';
        let amenArr = [];
        if (b.amenity) amenArr = Array.isArray(b.amenity) ? b.amenity : [b.amenity];
        if (b.amenities_custom) String(b.amenities_custom).split(',').map(s => s.trim()).filter(Boolean).forEach(a => amenArr.push(a));
        const amenities = [...new Set(amenArr.map(s => String(s).trim()).filter(Boolean))].join(', ') || (existing && existing.amenities) || 'Wifi, Kitchen';
        const locale = (b.locale || 'gb').trim().toLowerCase();
        const currency = (LOCALES[locale] || LOCALES.en).currency;
        const hideNightly = (b.hide_nightly === '1' || b.hide_nightly === 'on') ? 1 : 0;
        let hostPhoto = (existing && existing.host_photo) || '';
        if (hostFiles[0]) hostPhoto = '/uploads/' + hostFiles[0].filename;
        if (b.host_photo_url && String(b.host_photo_url).trim()) hostPhoto = String(b.host_photo_url).trim();
        let videoUrl = (existing && existing.video_url) || '';
        if (videoFiles[0]) videoUrl = '/uploads/' + videoFiles[0].filename;
        if (b.video_url && String(b.video_url).trim()) videoUrl = String(b.video_url).trim();
        const domainHost = autoDisplayDomain(marketplace, locale, b.display_domain || '');
        const fields = [
          name, marketplace, title, b.description || '', b.price || '0', b.price_month || '',
          primary, JSON.stringify(images), b.location || '',
          parseInt(b.guests, 10) || 2, parseInt(b.bedrooms, 10) || 1, parseInt(b.beds, 10) || 1, parseFloat(b.baths) || 1,
          amenities, b.host_name || req.user.username, hostPhoto, b.rating || '4.92', parseInt(b.reviews, 10) || 48,
          b.property_type || 'Entire apartment', domainHost, locale, currency, videoUrl, hideNightly
        ];
        if (existing) {
          db.prepare(`UPDATE apartments SET name=?, marketplace=?, title=?, description=?, price=?, price_month=?, image_url=?, images=?,
            location=?, guests=?, bedrooms=?, beds=?, baths=?, amenities=?, host_name=?, host_photo=?, rating=?, reviews=?,
            property_type=?, display_domain=?, locale=?, currency=?, video_url=?, hide_nightly=?,
            updated_at=datetime('now') WHERE id=? AND user_id=?`).run(...fields, id, req.user.id);
        } else {
          db.prepare(`INSERT INTO apartments (user_id, name, marketplace, title, description, price, price_month, image_url, images,
            location, guests, bedrooms, beds, baths, amenities, host_name, host_photo, rating, reviews, property_type,
            display_domain, locale, currency, video_url, hide_nightly)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, ...fields);
        }
        res.redirect('/dashboard/apartments');
      } catch (e) {
        console.error('apartment save', e);
        res.status(500).send('Error: ' + e.message);
      }
    });
  });

  return router;
};
