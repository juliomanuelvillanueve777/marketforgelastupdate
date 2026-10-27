module.exports = function createListingService({ db, LOCALES, DOMAIN_OPTIONS, LOCALE_DOMAIN_MAP, BOOKING_STATUSES }) {

  const STATUS_RANK = {
    not_opened: 0, open: 1, in_review: 2, invoice_sent: 3, payment_declined: 4, paid: 5
  };

  function resolveDomainMeta(marketplace, displayDomain) {
    const list = DOMAIN_OPTIONS[marketplace] || DOMAIN_OPTIONS.airbnb;
    return list.find(d => d.host === displayDomain || d.label === displayDomain) || list[0];
  }

  function autoDisplayDomain(marketplace, locale, explicit) {
    const mp = marketplace === 'booking' ? 'booking' : 'airbnb';
    if (explicit && String(explicit).trim()) {
      return resolveDomainMeta(mp, String(explicit).trim()).host;
    }
    const loc = String(locale || 'en').toLowerCase();
    const map = LOCALE_DOMAIN_MAP[mp] || {};
    const host = map[loc] || (mp === 'booking' ? 'www.booking.com' : 'www.airbnb.com');
    return resolveDomainMeta(mp, host).host;
  }

  function createListing(userId, { apartmentId, hostId, body, photoPaths, hostPhotoPath, videoPath, username }) {
    const b = body || {};
    let apt = null;
    const aptId = parseInt(apartmentId, 10) || 0;
    if (aptId) {
      apt = db.prepare('SELECT * FROM apartments WHERE id = ? AND user_id = ?').get(aptId, userId);
      if (!apt) throw new Error('Apartment template not found');
    }
    const marketplace = (b.marketplace || 'airbnb').toLowerCase() === 'booking' ? 'booking' : 'airbnb';
    const title = ((apt && apt.title) || b.title || '').trim();
    if (!title) throw new Error('Title is required');

    let images = [];
    if (apt && apt.images) {
      try { images = JSON.parse(apt.images) || []; } catch (e) { images = []; }
    }
    if (!images.length && apt && apt.image_url) images = [apt.image_url];
    if (Array.isArray(photoPaths)) photoPaths.forEach(p => images.push(p));
    if (b.image_urls) {
      String(b.image_urls).split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(u => images.push(u));
    }
    if (b.image_url && String(b.image_url).trim()) images.push(String(b.image_url).trim());
    images = [...new Set(images.filter(Boolean))];
    const primary = images[0] || (apt && apt.image_url) || '';

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
    amenArr = [...new Set(amenArr.map(s => String(s).trim()).filter(Boolean))];
    const amenities = amenArr.join(', ') || 'Wifi, Kitchen, Washer, Free parking';

    const locale = ((apt && apt.locale) || b.locale || 'en').trim().toLowerCase();
    const localeInfo = LOCALES[locale] || LOCALES.en;
    const currency = (apt && apt.currency) || localeInfo.currency;
    const hideNightly = apt
      ? (Number(apt.hide_nightly) === 1 ? 1 : 0)
      : ((b.hide_nightly === '1' || b.hide_nightly === 'on' || b.hide_nightly === 'true') ? 1 : 0);

    const domainHost = autoDisplayDomain(marketplace, locale, b.display_domain || (apt && apt.display_domain) || '');

    let hostRow = null;
    const hId = parseInt(hostId, 10) || 0;
    if (hId) {
      hostRow = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(hId, userId);
      if (!hostRow) throw new Error('Host not found');
    }

    let hostPhoto = hostPhotoPath || '';
    if (b.host_photo_url && String(b.host_photo_url).trim()) hostPhoto = String(b.host_photo_url).trim();
    if (!hostPhoto && hostRow && hostRow.photo) hostPhoto = hostRow.photo;
    if (!hostPhoto && apt && apt.host_photo) hostPhoto = apt.host_photo;

    const hostName = (hostRow && hostRow.name)
      || (b.host_name || '').trim()
      || (apt && apt.host_name)
      || username || '';

    let videoUrl = videoPath || '';
    if (b.video_url && String(b.video_url).trim()) videoUrl = String(b.video_url).trim();

    const listingRating = (hostRow && hostRow.rating) || (apt ? (apt.rating || '4.92') : (b.rating || '4.92'));
    const listingReviews = hostRow
      ? (hostRow.reviews_count || 48)
      : (apt ? (apt.reviews || 48) : (parseInt(b.reviews, 10) || 48));

    const result = db.prepare(`INSERT INTO listings
      (user_id, marketplace, title, description, price, price_month, image_url, images, location,
       guests, bedrooms, beds, baths, amenities, host_name, host_photo, rating, reviews,
       property_type, display_domain, locale, currency, video_url, hide_nightly,
       apartment_id, host_id, booking_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_opened')`).run(
      userId,
      marketplace,
      title,
      (apt ? (apt.description || '') : (b.description || '')),
      (apt ? (apt.price || '0') : (b.price || '0')),
      (apt ? (apt.price_month || '') : (b.price_month || '')),
      primary,
      JSON.stringify(images),
      (apt ? (apt.location || '') : (b.location || '')),
      apt ? (apt.guests || 2) : (parseInt(b.guests, 10) || 2),
      apt ? (apt.bedrooms || 1) : (parseInt(b.bedrooms, 10) || 1),
      apt ? (apt.beds || 1) : (parseInt(b.beds, 10) || 1),
      apt ? (apt.baths || 1) : (parseFloat(b.baths) || 1),
      amenities,
      hostName,
      hostPhoto || '',
      listingRating,
      listingReviews,
      (apt ? (apt.property_type || 'Entire apartment') : (b.property_type || 'Entire apartment')),
      domainHost,
      locale,
      currency,
      videoUrl || (apt && apt.video_url) || '',
      hideNightly,
      aptId || null,
      hId || null
    );

    return db.prepare('SELECT * FROM listings WHERE id = ?').get(result.lastInsertRowid);
  }

  function updateListing(userId, listingId, { body, photoPaths, hostPhotoPath, videoPath }) {
    const id = parseInt(listingId, 10);
    const existing = db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?').get(id, userId);
    if (!existing) return null;

    const b = body || {};
    const title = (b.title || '').trim();
    if (!title) throw new Error('Title is required');

    const marketplace = existing.marketplace;

    let images = [];
    try { images = existing.images ? JSON.parse(existing.images) : []; } catch (e) { images = []; }
    if (!Array.isArray(images)) images = [];
    if (!images.length && existing.image_url) images = [existing.image_url];

    let removeSet = b.remove_image;
    if (!removeSet) removeSet = [];
    if (!Array.isArray(removeSet)) removeSet = [removeSet];
    removeSet = new Set(removeSet.map(String));
    images = images.filter(u => !removeSet.has(String(u)));

    if (Array.isArray(photoPaths)) photoPaths.forEach(p => images.push(p));
    if (b.image_urls) {
      String(b.image_urls).split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(u => images.push(u));
    }
    if (b.image_url && String(b.image_url).trim()) images.push(String(b.image_url).trim());
    images = [...new Set(images.filter(Boolean))];
    const primary = images[0] || '';

    let amenArr = [];
    if (b.amenity) amenArr = Array.isArray(b.amenity) ? b.amenity : [b.amenity];
    if (b.amenities_custom) {
      String(b.amenities_custom).split(',').map(s => s.trim()).filter(Boolean).forEach(a => amenArr.push(a));
    }
    amenArr = [...new Set(amenArr.map(s => String(s).trim()).filter(Boolean))];
    const amenities = amenArr.join(', ') || existing.amenities || 'Wifi, Kitchen';

    const locale = (b.locale || existing.locale || 'en').trim().toLowerCase();
    const localeInfo = LOCALES[locale] || LOCALES.en;
    const currency = localeInfo.currency;
    const hideNightly = (b.hide_nightly === '1' || b.hide_nightly === 'on' || b.hide_nightly === 'true') ? 1 : 0;

    const domainHost = autoDisplayDomain(marketplace, locale, b.display_domain || existing.display_domain);

    let hostPhoto = existing.host_photo || '';
    if (b.remove_host_photo === '1' || b.remove_host_photo === 'on') hostPhoto = '';
    if (hostPhotoPath) hostPhoto = hostPhotoPath;
    if (b.host_photo_url && String(b.host_photo_url).trim()) hostPhoto = String(b.host_photo_url).trim();

    let nextHostId = existing.host_id || null;
    let hostName = b.host_name || existing.host_name || '';
    const updHostId = parseInt(b.host_id, 10) || 0;
    if (updHostId) {
      const hr = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(updHostId, userId);
      if (hr) {
        nextHostId = hr.id;
        hostName = hr.name || hostName;
        if (hr.photo) hostPhoto = hr.photo;
      }
    }

    let videoUrl = existing.video_url || '';
    if (b.remove_video === '1' || b.remove_video === 'on') videoUrl = '';
    if (videoPath) videoUrl = videoPath;
    if (b.video_url && String(b.video_url).trim()) videoUrl = String(b.video_url).trim();

    db.prepare(`UPDATE listings SET
      title = ?, description = ?, price = ?, price_month = ?, image_url = ?, images = ?,
      location = ?, guests = ?, bedrooms = ?, beds = ?, baths = ?, amenities = ?,
      host_name = ?, host_photo = ?, rating = ?, reviews = ?, property_type = ?,
      display_domain = ?, locale = ?, currency = ?, video_url = ?, hide_nightly = ?,
      apartment_id = COALESCE(?, apartment_id),
      host_id = ?
      WHERE id = ? AND user_id = ?`).run(
      title,
      b.description || '',
      b.price || '0',
      b.price_month || '',
      primary,
      JSON.stringify(images),
      b.location || '',
      parseInt(b.guests, 10) || 2,
      parseInt(b.bedrooms, 10) || 1,
      parseInt(b.beds, 10) || 1,
      parseFloat(b.baths) || 1,
      amenities,
      hostName,
      hostPhoto,
      b.rating || existing.rating || '4.92',
      parseInt(b.reviews, 10) || 0,
      b.property_type || existing.property_type || 'Entire apartment',
      domainHost,
      locale,
      currency,
      videoUrl,
      hideNightly,
      (parseInt(b.apartment_id, 10) || null),
      nextHostId,
      id,
      userId
    );

    return db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?').get(id, userId);
  }

  function getListingById(listingId, userId) {
    if (userId) {
      return db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?').get(listingId, userId) || null;
    }
    return db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId) || null;
  }

  function getListingsByUser(userId) {
    return db.prepare('SELECT * FROM listings WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(userId);
  }

  function deleteListing(listingId, userId) {
    const listing = db.prepare('SELECT id FROM listings WHERE id = ? AND user_id = ?').get(listingId, userId);
    if (!listing) return false;
    db.prepare('DELETE FROM listings WHERE id = ? AND user_id = ?').run(listingId, userId);
    return true;
  }

  function updateListingStatus(listingId, userId, nextStatus, opts) {
    opts = opts || {};
    const listing = db.prepare('SELECT id, user_id, booking_status FROM listings WHERE id = ? AND user_id = ?').get(listingId, userId);
    if (!listing) return false;
    const allowed = BOOKING_STATUSES.map(s => s.id);
    if (!allowed.includes(nextStatus)) return false;
    const cur = listing.booking_status || 'not_opened';
    if (cur === nextStatus) return false;
    if (cur === 'paid' && nextStatus !== 'paid' && !opts.force) return false;
    const curR = STATUS_RANK[cur] != null ? STATUS_RANK[cur] : 0;
    const nextR = STATUS_RANK[nextStatus] != null ? STATUS_RANK[nextStatus] : 0;
    if (!opts.force && nextR < curR) return false;
    db.prepare(`UPDATE listings SET booking_status = ?, status_updated_at = datetime('now'),
      opened_at = CASE WHEN opened_at IS NULL AND ? IN ('open','in_review','invoice_sent','payment_declined','paid')
      THEN datetime('now') ELSE opened_at END WHERE id = ? AND user_id = ?`)
      .run(nextStatus, nextStatus, listingId, userId);
    return true;
  }

  return {
    createListing,
    updateListing,
    getListingById,
    getListingsByUser,
    deleteListing,
    updateListingStatus,
    resolveDomainMeta,
    autoDisplayDomain
  };
};
