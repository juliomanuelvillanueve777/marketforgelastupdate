const express = require('express');
const router = express.Router();
const { hostFormHtml } = require('../views/host-form');

module.exports = function createHostRoutes({ db, requireClient, listingUpload, esc, clientPage }) {

  router.get('/dashboard/hosts', requireClient, (req, res) => {
    const hosts = db.prepare('SELECT * FROM hosts WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(req.user.id);
    const msg = req.query.msg ? `<div style="background:#0f2a1a;border:1px solid #2e7d32;color:#c8e6c9;padding:12px 14px;border-radius:10px;margin-bottom:14px">${esc(String(req.query.msg))}</div>` : '';
    const rows = hosts.map(h => {
      const photo = h.photo
        ? `<img src="${esc(h.photo)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.1);vertical-align:middle;margin-right:10px">`
        : `<span style="display:inline-flex;width:40px;height:40px;border-radius:50%;background:#222;align-items:center;justify-content:center;margin-right:10px;vertical-align:middle;color:#666;font-size:14px">?</span>`;
      return `<tr>
        <td style="padding:12px"><input type="checkbox" name="ids" value="${h.id}" class="hs-check"></td>
        <td style="padding:12px;color:#666;font-size:12px">#${h.id}</td>
        <td style="padding:12px;color:#fff;font-weight:600">${photo}${esc(h.name)}</td>
        <td style="padding:12px;color:#aaa">${Number(h.is_superhost)===1?'Superhost':'Host'}</td>
        <td style="padding:12px;color:#aaa">${esc(h.response_rate||'—')}</td>
        <td style="padding:12px;color:#aaa">${esc(h.joined_year||'—')}</td>
        <td style="padding:12px;color:#aaa">${esc(String(h.reviews_count??'—'))} · ${esc(String(h.rating||''))}</td>
        <td style="padding:12px;white-space:nowrap">
          <a href="/dashboard/hosts/edit/${h.id}" style="color:#4da3ff;margin-right:12px;text-decoration:none">Edit</a>
          <a href="/dashboard/hosts/delete/${h.id}" onclick="return confirm('Delete host?')" style="color:#f44336;text-decoration:none">Delete</a>
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="8" style="padding:32px;color:#666;text-align:center">No hosts yet. Add your first host profile below.</td></tr>`;
    let content = `${msg}<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
        <div>
          <h1 style="margin:0 0 6px">Hosts</h1>
          <p style="color:#777;margin:0;font-size:14px">Save host profiles once, then pick them when creating Airbnb or Booking listings.</p>
        </div>
        <a href="#hostForm" style="padding:12px 20px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border-radius:12px;text-decoration:none;font-weight:700;box-shadow:0 8px 24px rgba(255,56,92,.25)">+ New host</a>
      </div>
      <form method="POST" action="/dashboard/hosts/delete-bulk" id="hsBulkForm" onsubmit="return confirm('Delete selected hosts?')">
      <div style="display:flex;gap:10px;align-items:center;margin:16px 0 10px;flex-wrap:wrap">
        <button type="submit" class="btn btn-danger" id="hsBulkBtn" disabled style="opacity:.45">Delete selected (<span id="hsSelCount">0</span>)</button>
        <label style="color:#aaa;font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="hsCheckAll"> Select all</label>
      </div>
      <div class="panel" style="overflow-x:auto;border-radius:14px">
        <table class="data-table" style="width:100%">
          <tr style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.04em">
            <th style="padding:12px"></th><th style="padding:12px">ID</th><th style="padding:12px">Host</th><th style="padding:12px">Type</th><th style="padding:12px">Response</th><th style="padding:12px">Joined</th><th style="padding:12px">Reviews</th><th style="padding:12px"></th>
          </tr>
          ${rows}
        </table>
      </div></form>
      <div style="margin-top:28px">${hostFormHtml(null, esc)}</div>
      <script>(function(){
        var form=document.getElementById('hsBulkForm'); if(!form) return;
        var all=document.getElementById('hsCheckAll'), btn=document.getElementById('hsBulkBtn'), cnt=document.getElementById('hsSelCount');
        function boxes(){return Array.prototype.slice.call(form.querySelectorAll('.hs-check'));}
        function refresh(){var b=boxes(),n=b.filter(function(x){return x.checked}).length; cnt.textContent=n; btn.disabled=n===0; btn.style.opacity=n?1:.45; if(all) all.checked=n>0&&n===b.length;}
        form.addEventListener('change', refresh); if(all) all.addEventListener('change', function(){boxes().forEach(function(x){x.checked=all.checked}); refresh();}); refresh();
      })();</script>`;
    res.send(clientPage('Hosts', content, req.user));
  });

  router.get('/dashboard/hosts/edit/:id', requireClient, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!host) return res.redirect('/dashboard/hosts');
    const content = `<div style="margin-bottom:8px"><a href="/dashboard/hosts" style="color:#8899ff;text-decoration:none;font-size:14px">← Back to Hosts</a></div>${hostFormHtml(host, esc)}`;
    res.send(clientPage('Hosts', content, req.user));
  });

  router.get('/dashboard/hosts/delete/:id', requireClient, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM hosts WHERE id = ? AND user_id = ?').run(id, req.user.id);
    res.redirect('/dashboard/hosts?msg=Host+deleted');
  });

  router.post('/dashboard/hosts/delete-bulk', requireClient, (req, res) => {
    let ids = req.body.ids || [];
    if (!Array.isArray(ids)) ids = [ids];
    ids = ids.map(x => parseInt(x, 10)).filter(n => n > 0);
    let n = 0;
    for (const id of ids) {
      const r = db.prepare('DELETE FROM hosts WHERE id = ? AND user_id = ?').run(id, req.user.id);
      n += r.changes || 0;
    }
    res.redirect('/dashboard/hosts?msg=Deleted+' + n + '+hosts');
  });

  router.post('/dashboard/hosts/save', requireClient, (req, res, next) => {
    listingUpload(req, res, (err) => {
      if (err) return res.status(400).send('Upload error: ' + (err.message || err));
      try {
        const b = req.body || {};
        const id = parseInt(b.id, 10) || 0;
        const name = (b.name || '').trim();
        if (!name) return res.status(400).send('Host name required');
        let existing = id ? db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(id, req.user.id) : null;
        let photo = (existing && existing.photo) || '';
        const fileBag = req.files || {};
        const hostFiles = Array.isArray(fileBag.host_photo) ? fileBag.host_photo : [];
        if (hostFiles[0]) photo = '/uploads/' + hostFiles[0].filename;
        if (b.photo_url && String(b.photo_url).trim()) photo = String(b.photo_url).trim();
        if (b.remove_photo === '1') photo = '';
        const fields = [
          name,
          photo,
          (b.is_superhost === '1' || b.is_superhost === 'on') ? 1 : 0,
          (b.joined_year || '2018').trim(),
          (b.response_rate || '100%').trim(),
          (b.response_time || 'within an hour').trim(),
          (b.languages || 'English').trim(),
          (b.identity_verified === '1' || b.identity_verified === 'on' || b.identity_verified === undefined) ? 1 : 0,
          b.about || '',
          (b.location || '').trim(),
          parseInt(b.reviews_count, 10) || 48,
          (b.rating || '4.92').trim()
        ];
        if (existing) {
          db.prepare(`UPDATE hosts SET name=?, photo=?, is_superhost=?, joined_year=?, response_rate=?, response_time=?,
            languages=?, identity_verified=?, about=?, location=?, reviews_count=?, rating=?, updated_at=datetime('now')
            WHERE id=? AND user_id=?`).run(...fields, id, req.user.id);
        } else {
          db.prepare(`INSERT INTO hosts (user_id, name, photo, is_superhost, joined_year, response_rate, response_time,
            languages, identity_verified, about, location, reviews_count, rating)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, ...fields);
        }
        res.redirect('/dashboard/hosts?msg=Host+saved');
      } catch (e) {
        console.error('host save', e);
        res.status(500).send('Error: ' + e.message);
      }
    });
  });

  return router;
};
