const express = require('express');
const router = express.Router();
const { getTemplate } = require('../templates/accommodation/index');
const { LOCALES } = require('../utils/constants');

module.exports = function createListingRoutes({ db, requireClient, listingUpload, clientPage, esc, listingService, listingCreateFormHtml, BOOKING_STATUSES, DOMAIN_OPTIONS }) {

  function bookingStatusMeta(id) {
    return BOOKING_STATUSES.find(s => s.id === id) || BOOKING_STATUSES[0];
  }

  function listingTableHtml(listings) {
    if (!listings.length) {
      return `<div style="background:#1a1a2e;padding:40px;border-radius:16px;text-align:center;color:#888;border:1px dashed #333">
        <div style="font-size:40px;margin-bottom:12px">🏠</div>
        <div style="color:#fff;font-size:18px;margin-bottom:8px">No listings yet</div>
        <div>Pick an apartment from your library, select a host, and generate a listing.</div>
      </div>`;
    }
    const rows = listings.map(l => {
      const st = bookingStatusMeta(l.booking_status || 'not_opened');
      const aptLabel = l.apartment_name || l.title || '—';
      const created = l.created_at || '';
      return `<tr style="border-top:1px solid #222" class="lt-row">
        <td style="padding:12px;width:36px"><input type="checkbox" name="ids" value="${l.id}" class="lt-check" style="width:16px;height:16px;cursor:pointer;accent-color:#e74c3c"></td>
        <td style="padding:12px;color:#666;font-size:12px">#${l.id}</td>
        <td style="padding:12px;color:#ccc;max-width:200px">${esc(aptLabel)}
          <div style="margin-top:4px"><span style="background:${l.marketplace==='booking'?'#003580':'#FF385C'};color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">${esc(l.marketplace||'')}</span></div>
        </td>
        <td style="padding:12px;color:#ccc;max-width:160px">${esc(l.host_name||'—')}
          ${l.host_photo ? `<img src="${esc(l.host_photo)}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-left:6px">` : ''}
        </td>
        <td style="padding:12px;color:#aaa;font-size:12px;white-space:nowrap">${esc(created)}
          ${l.opened_at ? '<div style="color:#22c55e;font-size:11px">opened '+esc(l.opened_at)+'</div>' : ''}
        </td>
        <td style="padding:12px">
          <select data-status-listing="${l.id}" onchange="mfSetStatus(${l.id}, this.value, this)"
            style="background:${st.bg};color:${st.color};border:1px solid ${st.color}55;border-radius:8px;padding:8px 10px;font-weight:700;font-size:12px;cursor:pointer">
            ${BOOKING_STATUSES.map(s => `<option value="${s.id}"${(l.booking_status||'not_opened')===s.id?' selected':''} style="background:#12121f;color:${s.color}">${s.label}</option>`).join('')}
          </select>
        </td>
        <td style="padding:12px;color:#ccc">${l.views||0}</td>
        <td style="padding:12px;white-space:nowrap">
          <a href="/dashboard/listings/edit/${l.id}" style="color:#4da3ff;text-decoration:none;font-size:13px;margin-right:10px;font-weight:600">Edit</a>
          <a href="/dashboard/listings/delete/${l.id}" onclick="return confirm('Delete listing?')" style="color:#f44336;text-decoration:none;font-size:13px">Delete</a>
        </td>
      </tr>`;
    }).join('');
    return `<form method="POST" action="/dashboard/listings/delete-bulk" id="ltBulkForm" onsubmit="return ltConfirmBulk()">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <button type="submit" id="ltBulkBtn" disabled style="background:#e74c3c;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;opacity:.45">Delete selected (<span id="ltSelCount">0</span>)</button>
        <label style="color:#aaa;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="ltCheckAll" style="width:16px;height:16px;accent-color:#e74c3c;cursor:pointer"> Select all
        </label>
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
          ${BOOKING_STATUSES.map(s => `<span class="bs-badge" style="background:${s.bg};color:${s.color};border:1px solid ${s.color}44;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600">${s.label}</span>`).join('')}
        </div>
      </div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:12px;overflow:hidden">
      <thead><tr style="background:#12121f;text-align:left">
        <th style="padding:12px;width:36px"></th>
        <th style="padding:12px;color:#888;font-size:12px">ID</th>
        <th style="padding:12px;color:#888;font-size:12px">Apartment</th>
        <th style="padding:12px;color:#888;font-size:12px">Host</th>
        <th style="padding:12px;color:#888;font-size:12px">Created</th>
        <th style="padding:12px;color:#888;font-size:12px">Status</th>
        <th style="padding:12px;color:#888;font-size:12px">Views</th>
        <th style="padding:12px;color:#888;font-size:12px"></th>
      </tr></thead>
      <tbody>${rows}</tbody></table></div>
    </form>
    <script>
    (function(){
      var form=document.getElementById('ltBulkForm');
      if(!form) return;
      var all=document.getElementById('ltCheckAll');
      var btn=document.getElementById('ltBulkBtn');
      var cnt=document.getElementById('ltSelCount');
      function boxes(){return Array.prototype.slice.call(form.querySelectorAll('.lt-check'));}
      function refresh(){
        var b=boxes(), n=b.filter(function(x){return x.checked}).length;
        cnt.textContent=String(n);
        btn.disabled=n===0;
        btn.style.opacity=n? '1':'0.45';
        btn.style.cursor=n? 'pointer':'not-allowed';
        if(all) all.checked=n>0 && n===b.length;
      }
      form.addEventListener('change', function(e){
        if(e.target && e.target.classList && e.target.classList.contains('lt-check')) refresh();
      });
      if(all) all.addEventListener('change', function(){
        boxes().forEach(function(x){ x.checked=all.checked; });
        refresh();
      });
      window.ltConfirmBulk=function(){
        var n=boxes().filter(function(x){return x.checked}).length;
        if(!n) return false;
        return confirm('Delete '+n+' selected listings?');
      };
      window.mfSetStatus = function(id, status, sel){
        fetch('/dashboard/listings/status/'+id, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({status: status})
        }).then(function(r){return r.json()}).then(function(d){
          if(!d || !d.ok){ alert((d&&d.error)||'Status update failed'); return; }
          var map = {not_opened:['#6b7280','#1f2937'], open:['#22c55e','#052e16'], in_review:['#f59e0b','#422006'], invoice_sent:['#3b82f6','#0c1a33'], payment_declined:['#ef4444','#450a0a'], paid:['#a855f7','#2e1065']};
          var c = map[status] || map.not_opened;
          if(sel){ sel.style.color=c[0]; sel.style.background=c[1]; sel.style.borderColor=c[0]+'55'; }
        }).catch(function(){ alert('Status update failed'); });
      };
      refresh();
    })();
    </script>`;
  }

  router.get('/dashboard/listings', requireClient, (req, res) => {
    const listings = db.prepare(`SELECT l.*, a.name as apartment_name FROM listings l
      LEFT JOIN apartments a ON a.id = l.apartment_id
      WHERE l.user_id = ? ORDER BY l.created_at DESC`).all(req.user.id);
    const created = req.query.created ? listingService.getListingById(parseInt(req.query.created, 10), req.user.id) : null;
    const updated = req.query.updated ? listingService.getListingById(parseInt(req.query.updated, 10), req.user.id) : null;
    let banner = '';
    if (created) {
      banner = `<div style="background:#0f2a1a;border:1px solid #2e7d32;padding:16px 18px;border-radius:12px;margin-bottom:18px;color:#c8e6c9">
        <strong style="color:#4CAF50">Listing created (#${created.id})</strong>
        <div style="margin-top:8px;font-size:13px;color:#a5d6a7">${esc(created.title || '')} · ${esc(created.marketplace || '')}
        · <a href="/dashboard/listings/edit/${created.id}" style="color:#81c784">Edit</a></div>
      </div>`;
    } else if (updated) {
      banner = `<div style="background:#0f1a2a;border:1px solid #2196F3;padding:16px 18px;border-radius:12px;margin-bottom:18px;color:#bbdefb">
        <strong style="color:#64B5F6">Listing updated (#${updated.id})</strong>
        <div style="margin-top:8px;font-size:13px;color:#90CAF9">${esc(updated.title || '')}
        · <a href="/dashboard/listings/edit/${updated.id}" style="color:#90CAF9">Edit again</a></div>
      </div>`;
    }
    let content = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <div>
          <h1 style="margin:0">Listings</h1>
          <p style="color:#777;margin:8px 0 0;font-size:14px">All generated listings. Track status, bulk delete, or edit.</p>
        </div>
        <a href="/dashboard/listings/create" style="display:inline-block;padding:12px 20px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border-radius:10px;text-decoration:none;font-weight:700">+ Create listing</a>
      </div>
      ${banner}
      ${(req.query.deleted ? '<div style="background:#1e3a2f;border:1px solid #2ecc71;color:#9fefc0;padding:10px 14px;border-radius:8px;margin-bottom:12px">Deleted ' + esc(String(req.query.deleted)) + ' listing(s).</div>' : '')}
      ${listingTableHtml(listings)}`;
    res.send(clientPage('Listings', content, req.user));
  });

  router.get('/dashboard/listings/create', requireClient, (req, res) => {
    const apartmentsForForm = db.prepare('SELECT id, name, title, location FROM apartments WHERE user_id = ? ORDER BY name').all(req.user.id);
    const hostsForForm = db.prepare('SELECT id, name, photo, is_superhost FROM hosts WHERE user_id = ? ORDER BY name').all(req.user.id);
    let content = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <h1 style="margin:0">Create listing</h1>
          <p style="color:#777;margin:8px 0 0;font-size:14px;max-width:560px">Pick apartment + host from your libraries, choose <strong style="color:#FF385C">Airbnb</strong> or <strong style="color:#4da3ff">Booking</strong>, then generate.</p>
        </div>
      </div>
      ${listingCreateFormHtml(null, null, { apartments: apartmentsForForm, hosts: hostsForForm, selectedApartmentId: req.query.apt, selectedHostId: req.query.host, fixedMarketplace: req.query.mp, esc, DOMAIN_OPTIONS })}`;
    res.send(clientPage('Create', content, req.user));
  });

  router.post('/dashboard/listings/create', requireClient, (req, res, next) => {
    listingUpload(req, res, (err) => {
      if (err) {
        if (err.name === 'MulterError' || (err.code && String(err.code).startsWith('LIMIT_'))) {
          return res.status(400).send('Upload error: check file types and size limits.');
        }
        return next(err);
      }
      try {
        const b = req.body || {};
        const fileBag = req.files || {};
        const photoFiles = Array.isArray(fileBag.photos) ? fileBag.photos : [];
        const hostFiles = Array.isArray(fileBag.host_photo) ? fileBag.host_photo : [];
        const videoFiles = Array.isArray(fileBag.videos) ? fileBag.videos : [];
        const photoPaths = photoFiles.map(f => '/uploads/' + f.filename);
        const hostPhotoPath = hostFiles[0] ? '/uploads/' + hostFiles[0].filename : '';
        const videoPath = videoFiles[0] ? '/uploads/' + videoFiles[0].filename : '';

        const created = listingService.createListing(req.user.id, {
          apartmentId: b.apartment_id,
          hostId: b.host_id,
          body: b,
          photoPaths,
          hostPhotoPath,
          videoPath,
          username: req.user.username
        });
        res.redirect('/dashboard/listings?created=' + created.id);
      } catch (e) {
        console.error('create listing error', e);
        res.status(500).send('Error creating listing: ' + e.message);
      }
    });
  });

  router.get('/dashboard/listings/edit/:id', requireClient, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const listing = listingService.getListingById(id, req.user.id);
    if (!listing) return res.status(404).send('<div style="padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh;text-align:center"><h1>Listing not found</h1><a href="/dashboard/listings" style="color:#4CAF50">Back</a></div>');
    const apartmentsForForm = db.prepare('SELECT id, name, title, location FROM apartments WHERE user_id = ? ORDER BY name').all(req.user.id);
    const hostsForForm = db.prepare('SELECT id, name, photo, is_superhost FROM hosts WHERE user_id = ? ORDER BY name').all(req.user.id);
    const content = `<div style="margin-bottom:8px"><a href="/dashboard/listings" style="color:#8899ff;text-decoration:none;font-size:14px">← Back to Listings</a></div>
      ${listingCreateFormHtml(listing.marketplace, listing, { apartments: apartmentsForForm, hosts: hostsForForm, esc, DOMAIN_OPTIONS })}`;
    res.send(clientPage('Edit #' + listing.id, content, req.user));
  });

  router.post('/dashboard/listings/update/:id', requireClient, (req, res, next) => {
    listingUpload(req, res, (err) => {
      if (err) {
        if (err.name === 'MulterError' || (err.code && String(err.code).startsWith('LIMIT_'))) {
          return res.status(400).send('Upload error: check file types and size limits.');
        }
        return next(err);
      }
      try {
        const id = parseInt(req.params.id, 10);
        const b = req.body || {};
        const fileBag = req.files || {};
        const photoFiles = Array.isArray(fileBag.photos) ? fileBag.photos : [];
        const hostFiles = Array.isArray(fileBag.host_photo) ? fileBag.host_photo : [];
        const videoFiles = Array.isArray(fileBag.videos) ? fileBag.videos : [];
        const photoPaths = photoFiles.map(f => '/uploads/' + f.filename);
        const hostPhotoPath = hostFiles[0] ? '/uploads/' + hostFiles[0].filename : '';
        const videoPath = videoFiles[0] ? '/uploads/' + videoFiles[0].filename : '';

        const updated = listingService.updateListing(req.user.id, id, {
          body: b,
          photoPaths,
          hostPhotoPath,
          videoPath
        });
        if (!updated) return res.status(404).send('Listing not found');
        res.redirect('/dashboard/listings?updated=' + id);
      } catch (e) {
        console.error('update listing error', e);
        res.status(500).send('Error updating listing: ' + e.message);
      }
    });
  });

  router.get('/dashboard/listings/delete/:id', requireClient, (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.redirect('/dashboard/listings');
      listingService.deleteListing(id, req.user.id);
    } catch (e) {
      console.error('delete listing error', e);
      return res.status(500).send('Error deleting listing: ' + e.message);
    }
    res.redirect('/dashboard/listings?deleted=1');
  });

  router.post('/dashboard/listings/delete-bulk', requireClient, (req, res) => {
    try {
      let ids = req.body.ids;
      if (!ids) ids = [];
      if (!Array.isArray(ids)) ids = [ids];
      ids = ids.map(x => parseInt(x, 10)).filter(n => n > 0);
      let deleted = 0;
      for (const id of ids) {
        if (listingService.deleteListing(id, req.user.id)) deleted++;
      }
      res.redirect('/dashboard/listings?deleted=' + deleted);
    } catch (e) {
      console.error('bulk delete error', e);
      res.status(500).send('Error deleting listings: ' + e.message);
    }
  });

  router.post('/dashboard/listings/status/:id', requireClient, (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const status = String((req.body && req.body.status) || '').trim();
      const ok = listingService.updateListingStatus(id, req.user.id, status);
      if (!ok) return res.status(400).json({ ok: false, error: 'Invalid status or listing not found' });
      res.json({ ok: true, status });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /dashboard/listings/preview
  // Assembles listing data in memory (no DB write), renders via template registry,
  // and returns the full HTML page. Ownership-scoped: only the requesting user's
  // apartments and hosts are accessible.
  router.post('/dashboard/listings/preview', requireClient, (req, res, next) => {
    listingUpload(req, res, (err) => {
      if (err) {
        if (err.name === 'MulterError' || (err.code && String(err.code).startsWith('LIMIT_'))) {
          return res.status(400).send('Upload error');
        }
        return next(err);
      }
      try {
        const b = req.body || {};
        const userId = req.user.id;

        // Ownership-scoped apartment lookup
        let apt = null;
        const aptId = parseInt(b.apartment_id, 10) || 0;
        if (aptId) {
          apt = db.prepare('SELECT * FROM apartments WHERE id = ? AND user_id = ?').get(aptId, userId);
        }

        // Ownership-scoped host lookup
        let host = null;
        const hostId = parseInt(b.host_id, 10) || 0;
        if (hostId) {
          host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(hostId, userId);
        }

        // Resolve locale and currency
        const locale = ((apt && apt.locale) || b.locale || 'gb').trim().toLowerCase();
        const localeInfo = LOCALES[locale] || LOCALES.en;
        const mp = (b.marketplace || 'airbnb').toLowerCase() === 'booking' ? 'booking' : 'airbnb';

        // Assemble images (apartment photos first, then any new uploads, then URL inputs)
        let images = [];
        if (apt && apt.images) { try { images = JSON.parse(apt.images) || []; } catch (e) {} }
        if (!images.length && apt && apt.image_url) images = [apt.image_url];
        const fileBag = req.files || {};
        const photoFiles = Array.isArray(fileBag.photos) ? fileBag.photos : [];
        photoFiles.forEach(f => images.push('/uploads/' + f.filename));
        if (b.image_urls) {
          String(b.image_urls).split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(u => images.push(u));
        }
        if (b.image_url && String(b.image_url).trim()) images.push(String(b.image_url).trim());
        images = [...new Set(images.filter(Boolean))];

        // Assemble amenities
        let amenArr = [];
        if (b.amenity) amenArr = Array.isArray(b.amenity) ? b.amenity : [b.amenity];
        if (b.amenities_custom) {
          String(b.amenities_custom).split(',').map(s => s.trim()).filter(Boolean).forEach(a => amenArr.push(a));
        }
        if (!amenArr.length && b.amenities) {
          amenArr = String(b.amenities).split(',').map(s => s.trim()).filter(Boolean);
        }
        if (!amenArr.length && apt && apt.amenities) {
          amenArr = String(apt.amenities).split(',').map(s => s.trim()).filter(Boolean);
        }
        amenArr = [...new Set(amenArr.filter(Boolean))];

        // Build in-memory listing object — no DB write
        const listing = {
          id: null,
          marketplace: mp,
          title: ((apt && apt.title) || b.title || 'Preview').trim(),
          description: apt ? (apt.description || '') : (b.description || ''),
          price: String((apt && apt.price) || b.price || '0'),
          price_month: String((apt && apt.price_month) || b.price_month || ''),
          currency: (apt && apt.currency) || localeInfo.currency || 'GBP',
          image_url: images[0] || '',
          images: JSON.stringify(images),
          location: String((apt && apt.location) || b.location || ''),
          guests: apt ? (apt.guests || 2) : (parseInt(b.guests, 10) || 2),
          bedrooms: apt ? (apt.bedrooms || 1) : (parseInt(b.bedrooms, 10) || 1),
          beds: apt ? (apt.beds || 1) : (parseInt(b.beds, 10) || 1),
          baths: apt ? (apt.baths || 1) : (parseFloat(b.baths) || 1),
          amenities: amenArr.join(', ') || 'Wifi, Kitchen',
          host_name: (host && host.name) || b.host_name || '',
          host_photo: (host && host.photo) || '',
          rating: String((apt && apt.rating) || b.rating || '4.92'),
          reviews: parseInt((apt && apt.reviews) || b.reviews || 48, 10),
          property_type: String((apt && apt.property_type) || b.property_type || 'Entire apartment'),
          display_domain: String(b.display_domain || ''),
          locale,
          hide_nightly: (b.hide_nightly === '1' || b.hide_nightly === 'on') ? 1 : 0,
          reviews_json: '',
          host_id: host ? host.id : null,
          apartment_id: apt ? apt.id : null
        };

        const templateId = String(b.template_id || 'airbnb-style').trim();
        const render = getTemplate(templateId);
        const html = render(listing, host, {});

        res.send(html);
      } catch (e) {
        console.error('preview error', e);
        res.status(500).send(
          `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Preview Error</title></head><body style="font-family:monospace;padding:24px;background:#1a1a2e;color:#ff6b6b">` +
          `<h2>Preview error</h2><pre>${e.message.replace(/</g,'&lt;')}</pre>` +
          `<p><a href="javascript:history.back()" style="color:#8899ff">← Go back</a></p></body></html>`
        );
      }
    });
  });

  return router;
};
