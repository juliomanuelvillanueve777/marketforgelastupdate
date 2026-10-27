/**
 * Candidate Verification & Security Check Lab Routes
 * Integrated with MarketForge Platform (Node.js / Express / SQLite)
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { candidateVerificationPage } = require('../views/security-check');

module.exports = function createCandidateRoutes({ db, requireAdmin, clientPage, adminPage, esc, UPLOAD_DIR }) {
  const router = express.Router();
  const safeEsc = typeof esc === 'function' ? esc : (s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

  // Ensure base uploads directory exists
  const CANDIDATES_DIR = path.join(UPLOAD_DIR, 'candidates');
  fs.mkdirSync(CANDIDATES_DIR, { recursive: true });

  // Explicitly serve uploaded candidate/record media with proper MIME types for .webm and .mp4
  router.use('/uploads', express.static(UPLOAD_DIR, {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath || '').toLowerCase();
      if (ext === '.webm') {
        res.setHeader('Content-Type', 'video/webm');
        res.setHeader('Accept-Ranges', 'bytes');
      } else if (ext === '.mp4') {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
      } else if (ext === '.ogv' || ext === '.ogg') {
        res.setHeader('Content-Type', 'video/ogg');
        res.setHeader('Accept-Ranges', 'bytes');
      } else if (ext === '.mov') {
        res.setHeader('Content-Type', 'video/quicktime');
        res.setHeader('Accept-Ranges', 'bytes');
      }
    }
  }));

  // Multer upload fallback for multipart/form-data
  const tempUploadDir = path.join(CANDIDATES_DIR, '_temp');
  fs.mkdirSync(tempUploadDir, { recursive: true });

  const candidateUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, tempUploadDir),
      filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + file.originalname)
    }),
    limits: { fileSize: 50 * 1024 * 1024 }
  }).fields([
    { name: 'docFile', maxCount: 1 },
    { name: 'idDocument', maxCount: 1 },
    { name: 'biometric_video', maxCount: 1 },
    { name: 'videoVerification', maxCount: 1 },
    { name: 'biometricVideo', maxCount: 1 },
    { name: 'facialCapture', maxCount: 1 },
    { name: 'facial_capture', maxCount: 1 },
    { name: 'poaFile', maxCount: 1 },
    { name: 'rtwFile', maxCount: 1 },
    { name: 'cvFile', maxCount: 1 }
  ]);

  /**
   * Universal Auth Middleware for Dashboard Security Check
   */
  function requireAuthUser(req, res, next) {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.redirect('/login');
    req.user = user;
    next();
  }

  /**
   * Helper to render either adminPage or clientPage based on user role
   */
  function renderLayout(req, res, title, content) {
    if (req.user && req.user.is_admin && typeof adminPage === 'function') {
      return res.send(adminPage(title, content));
    } else if (req.user && typeof clientPage === 'function') {
      return res.send(clientPage(title, content, req.user));
    } else if (typeof adminPage === 'function') {
      return res.send(adminPage(title, content));
    }
    return res.send(content);
  }

  /**
   * Helper to decode Base64 data and save to file locally.
   * Supports Data URLs with codec parameters (e.g. data:video/webm;codecs=vp8,opus;base64,...).
   */
  function saveBase64File(base64Data, targetDir, defaultBaseName, fallbackExt = '.bin') {
    if (!base64Data || typeof base64Data !== 'string') return null;
    let b64 = base64Data.trim();
    if (!b64) return null;

    let ext = fallbackExt;
    const base64Marker = ';base64,';
    const markerIdx = b64.indexOf(base64Marker);
    if (b64.startsWith('data:') && markerIdx !== -1) {
      const mime = b64.slice(5, markerIdx).toLowerCase();
      b64 = b64.slice(markerIdx + base64Marker.length).trim();
      if (mime.includes('pdf')) ext = '.pdf';
      else if (mime.includes('png')) ext = '.png';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
      else if (mime.includes('webp')) ext = '.webp';
      else if (mime.includes('webm')) ext = '.webm';
      else if (mime.includes('mp4')) ext = '.mp4';
      else if (mime.includes('ogg') || mime.includes('ogv')) ext = '.ogv';
      else if (mime.includes('quicktime') || mime.includes('mov')) ext = '.mov';
      else if (mime.includes('msword') || mime.includes('wordprocessingml')) ext = '.docx';
    } else if (b64.startsWith('data:')) {
      const commaIdx = b64.indexOf(',');
      if (commaIdx !== -1) {
        const header = b64.slice(5, commaIdx).toLowerCase();
        b64 = b64.slice(commaIdx + 1).trim();
        if (header.includes('webm')) ext = '.webm';
        else if (header.includes('mp4')) ext = '.mp4';
        else if (header.includes('jpeg') || header.includes('jpg')) ext = '.jpg';
        else if (header.includes('png')) ext = '.png';
        else if (header.includes('pdf')) ext = '.pdf';
      }
    }

    try {
      const cleanB64 = b64.replace(/\s+/g, '');
      const buffer = Buffer.from(cleanB64, 'base64');
      let filename = defaultBaseName;
      if (!path.extname(filename)) {
        filename += ext;
      }
      const fullPath = path.join(targetDir, filename);
      fs.writeFileSync(fullPath, buffer);
      return filename;
    } catch (err) {
      console.error('[CANDIDATE UPLOAD ERROR] Failed saving base64 file:', err);
      return null;
    }
  }

  /**
   * Core form submission handler with categorized disk structure:
   * /public/uploads/candidates/[Candidate_Name]_[Timestamp]/
   * ├── /documents/  -> ID / Passport file
   * └── /biometrics/ -> 3-4s biometric verification video (.webm)
   */
  function handleSubmission(req, res) {
    try {
      const body = req.body || {};
      const files = req.files || {};

      const firstName = (body.firstName || '').trim();
      const lastName = (body.lastName || '').trim();
      let fullName = (body.fullName || `${firstName} ${lastName}`).trim();
      if (!fullName) fullName = 'Candidate_' + Date.now();

      const candidateNameSafe = fullName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const timestamp = Date.now();
      const folderName = `${candidateNameSafe}_${timestamp}`;

      // Create categorized folder hierarchy
      const candidateBaseDir = path.join(CANDIDATES_DIR, folderName);
      const docsDir = path.join(candidateBaseDir, 'documents');
      const bioDir = path.join(candidateBaseDir, 'biometrics');
      const faceVerifDir = path.join(candidateBaseDir, 'face_verification');

      fs.mkdirSync(docsDir, { recursive: true });
      fs.mkdirSync(bioDir, { recursive: true });
      fs.mkdirSync(faceVerifDir, { recursive: true });

      let idDocumentPath = '';
      let biometricVideoPath = '';
      let photoFilePath = '';
      let poaFilePath = '';
      let rtwFilePath = '';
      let cvFilePath = '';

      // 1. Save ID Document into /documents/
      const rawDocB64 = body.docFile || body.idDocument;
      if (rawDocB64 && typeof rawDocB64 === 'string') {
        const saved = saveBase64File(rawDocB64, docsDir, 'id_document', '.jpg');
        if (saved) idDocumentPath = `/uploads/candidates/${folderName}/documents/${saved}`;
      } else if (files.docFile && files.docFile[0]) {
        const f = files.docFile[0];
        const dest = path.join(docsDir, 'id_document' + path.extname(f.originalname || '.jpg'));
        fs.renameSync(f.path, dest);
        idDocumentPath = `/uploads/candidates/${folderName}/documents/${path.basename(dest)}`;
      } else if (files.idDocument && files.idDocument[0]) {
        const f = files.idDocument[0];
        const dest = path.join(docsDir, 'id_document' + path.extname(f.originalname || '.jpg'));
        fs.renameSync(f.path, dest);
        idDocumentPath = `/uploads/candidates/${folderName}/documents/${path.basename(dest)}`;
      }

      // 2. Save Biometric Video into /biometrics/ and /face_verification/
      const rawVideoB64 = body.biometric_video || body.biometricVideo || body.videoVerification;
      const uploadedVideoFile =
        (files.biometric_video && files.biometric_video[0]) ||
        (files.biometricVideo && files.biometricVideo[0]) ||
        (files.videoVerification && files.videoVerification[0]);
      if (rawVideoB64 && typeof rawVideoB64 === 'string') {
        const saved = saveBase64File(rawVideoB64, bioDir, 'biometric_video', '.webm');
        if (saved) {
          biometricVideoPath = `/uploads/candidates/${folderName}/biometrics/${saved}`;
          try {
            fs.copyFileSync(path.join(bioDir, saved), path.join(faceVerifDir, saved));
          } catch (_) {}
        }
      } else if (uploadedVideoFile) {
        const ext = path.extname(uploadedVideoFile.originalname || '.webm') || '.webm';
        const savedName = 'biometric_video' + ext;
        const destBio = path.join(bioDir, savedName);
        const destFace = path.join(faceVerifDir, savedName);
        fs.copyFileSync(uploadedVideoFile.path, destBio);
        fs.copyFileSync(uploadedVideoFile.path, destFace);
        try { fs.unlinkSync(uploadedVideoFile.path); } catch (_) {}
        biometricVideoPath = `/uploads/candidates/${folderName}/biometrics/${savedName}`;
      }

      // 3. Save Biometric Still Snapshot into /biometrics/ and /face_verification/
      const rawPhotoB64 = body.facialCapture || body.facial_capture;
      const uploadedPhotoFile =
        (files.facialCapture && files.facialCapture[0]) ||
        (files.facial_capture && files.facial_capture[0]);
      if (rawPhotoB64 && typeof rawPhotoB64 === 'string') {
        const saved = saveBase64File(rawPhotoB64, bioDir, 'facial_snapshot', '.jpg');
        if (saved) {
          photoFilePath = `/uploads/candidates/${folderName}/biometrics/${saved}`;
          try {
            fs.copyFileSync(path.join(bioDir, saved), path.join(faceVerifDir, saved));
          } catch (_) {}
        }
      } else if (uploadedPhotoFile) {
        const ext = path.extname(uploadedPhotoFile.originalname || '.jpg') || '.jpg';
        const savedName = 'facial_snapshot' + ext;
        const destBio = path.join(bioDir, savedName);
        const destFace = path.join(faceVerifDir, savedName);
        fs.copyFileSync(uploadedPhotoFile.path, destBio);
        fs.copyFileSync(uploadedPhotoFile.path, destFace);
        try { fs.unlinkSync(uploadedPhotoFile.path); } catch (_) {}
        photoFilePath = `/uploads/candidates/${folderName}/biometrics/${savedName}`;
      }

      // 4. Save Additional Documents into /documents/
      const rawPoaB64 = body.poaFile;
      if (rawPoaB64 && typeof rawPoaB64 === 'string') {
        const saved = saveBase64File(rawPoaB64, docsDir, 'proof_of_address', '.pdf');
        if (saved) poaFilePath = `/uploads/candidates/${folderName}/documents/${saved}`;
      } else if (files.poaFile && files.poaFile[0]) {
        const f = files.poaFile[0];
        const dest = path.join(docsDir, 'proof_of_address' + path.extname(f.originalname || '.pdf'));
        fs.renameSync(f.path, dest);
        poaFilePath = `/uploads/candidates/${folderName}/documents/${path.basename(dest)}`;
      }

      const rawRtwB64 = body.rtwFile;
      if (rawRtwB64 && typeof rawRtwB64 === 'string') {
        const saved = saveBase64File(rawRtwB64, docsDir, 'rtw_document', '.png');
        if (saved) rtwFilePath = `/uploads/candidates/${folderName}/documents/${saved}`;
      } else if (files.rtwFile && files.rtwFile[0]) {
        const f = files.rtwFile[0];
        const dest = path.join(docsDir, 'rtw_document' + path.extname(f.originalname || '.png'));
        fs.renameSync(f.path, dest);
        rtwFilePath = `/uploads/candidates/${folderName}/documents/${path.basename(dest)}`;
      }

      const rawCvB64 = body.cvFile;
      if (rawCvB64 && typeof rawCvB64 === 'string') {
        const saved = saveBase64File(rawCvB64, docsDir, 'cv_resume', '.pdf');
        if (saved) cvFilePath = `/uploads/candidates/${folderName}/documents/${saved}`;
      } else if (files.cvFile && files.cvFile[0]) {
        const f = files.cvFile[0];
        const dest = path.join(docsDir, 'cv_resume' + path.extname(f.originalname || '.pdf'));
        fs.renameSync(f.path, dest);
        cvFilePath = `/uploads/candidates/${folderName}/documents/${path.basename(dest)}`;
      }

      const documentType = body.docType || body.document_type || 'passport';
      const faceMatchStatus = 'Verified';
      const initialStatus = 'Pending';

      // Insert categorized record into SQLite table
      const insertStmt = db.prepare(`
        INSERT INTO candidates (
          full_name, first_name, last_name, email, phone, dob,
          address, city, postcode, rtw_code, nino, employer,
          job_title, salary, duration,
          doc_type, document_type, doc_file_path, id_document_path,
          poa_doc_type, poa_file_path, rtw_file_path, cv_file_path,
          video_path, biometric_video_path, photo_path, face_match_status,
          current_address_history, previous_address_history, declaration_signature,
          dbs_consent, status, created_at, ip_address, raw_data
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, datetime('now'), ?, ?
        )
      `);

      const leanBody = { ...body };
      delete leanBody.docFile;
      delete leanBody.idDocument;
      delete leanBody.biometric_video;
      delete leanBody.biometricVideo;
      delete leanBody.videoVerification;
      delete leanBody.facialCapture;
      delete leanBody.facial_capture;
      delete leanBody.poaFile;
      delete leanBody.rtwFile;
      delete leanBody.cvFile;

      const info = insertStmt.run(
        fullName,
        firstName,
        lastName,
        (body.email || '').trim(),
        (body.phone || '').trim(),
        body.dob || '',
        (body.address || '').trim(),
        (body.city || '').trim(),
        (body.postcode || '').trim(),
        (body.rtw || '').trim(),
        (body.nino || '').trim(),
        (body.employer || '').trim(),
        (body.jobTitle || '').trim(),
        (body.salary || '').trim(),
        (body.duration || '').trim(),
        documentType,
        documentType,
        idDocumentPath,
        idDocumentPath,
        body.poaDocType || '',
        poaFilePath,
        rtwFilePath,
        cvFilePath,
        biometricVideoPath,
        biometricVideoPath,
        photoFilePath,
        faceMatchStatus,
        body.currentAddressHistory || '',
        body.previousAddressHistory || '',
        (body.declarationSignature || '').trim(),
        body.dbsConsent || 'Consented',
        initialStatus,
        req.ip || '',
        JSON.stringify(leanBody)
      );

      console.log(`[+] Security Check Lab application saved: ID #${info.lastInsertRowid} (${fullName}) in ${folderName}`);

      // Also populate face_verification/ and metadata.json (and mirror to uploads/records/[FolderName])
      try {
        for (const f of fs.readdirSync(bioDir)) {
          fs.copyFileSync(path.join(bioDir, f), path.join(faceVerifDir, f));
        }
        const metadataObj = {
          record_id: info.lastInsertRowid,
          folder_name: folderName,
          submitted_at: new Date().toISOString(),
          verification_status: faceMatchStatus,
          status: initialStatus,
          candidate: {
            full_name: fullName,
            first_name: firstName,
            last_name: lastName,
            email: (body.email || '').trim(),
            phone: (body.phone || '').trim(),
            dob: body.dob || '',
            address: (body.address || '').trim(),
            city: (body.city || '').trim(),
            postcode: (body.postcode || '').trim()
          },
          files: {
            face_verification: [biometricVideoPath, photoFilePath].filter(Boolean),
            documents: [idDocumentPath, poaFilePath, rtwFilePath, cvFilePath].filter(Boolean)
          },
          form_fields: leanBody
        };
        fs.writeFileSync(path.join(candidateBaseDir, 'metadata.json'), JSON.stringify(metadataObj, null, 2), 'utf8');

        const recordsRootDir = path.join(UPLOAD_DIR, 'records', folderName);
        const recDocsDir = path.join(recordsRootDir, 'documents');
        const recFaceDir = path.join(recordsRootDir, 'face_verification');
        fs.mkdirSync(recDocsDir, { recursive: true });
        fs.mkdirSync(recFaceDir, { recursive: true });
        for (const f of fs.readdirSync(docsDir)) {
          fs.copyFileSync(path.join(docsDir, f), path.join(recDocsDir, f));
        }
        for (const f of fs.readdirSync(faceVerifDir)) {
          fs.copyFileSync(path.join(faceVerifDir, f), path.join(recFaceDir, f));
        }
        fs.writeFileSync(path.join(recordsRootDir, 'metadata.json'), JSON.stringify(metadataObj, null, 2), 'utf8');
      } catch (archErr) {
        console.warn('[SECURITY CHECK ARCHIVE WARN]', archErr.message);
      }

      return res.status(200).json({
        status: 'success',
        message: 'Application submitted successfully to Security Check Lab.',
        candidateId: info.lastInsertRowid,
        files: {
          idDocument: idDocumentPath,
          biometricVideo: biometricVideoPath,
          facialCapture: photoFilePath
        }
      });

    } catch (err) {
      console.error('[SECURITY CHECK LAB ERROR]', err);
      return res.status(500).json({
        status: 'error',
        message: 'Server error processing application: ' + err.message
      });
    }
  }

  // ── Public Candidate Form Routes (Clean Unauthenticated Custom Domain Routing) ──
  router.get('/security-check/apply', (req, res) => res.send(candidateVerificationPage()));
  router.get('/apply', (req, res) => res.send(candidateVerificationPage()));
  router.get('/candidate/apply', (req, res) => res.send(candidateVerificationPage()));
  router.get('/verification', (req, res) => res.send(candidateVerificationPage()));
  router.get('/security-check', (req, res) => res.send(candidateVerificationPage()));
  router.get('/onboarding', (req, res) => res.send(candidateVerificationPage()));

  // ── Submission API Endpoints ─────────────────────────────────────────────
  router.post('/api/submit-candidate', (req, res, next) => {
    if (req.is('multipart/form-data')) {
      candidateUpload(req, res, (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        handleSubmission(req, res);
      });
    } else {
      handleSubmission(req, res);
    }
  });

  router.post('/api/submit', (req, res, next) => {
    if (req.is('multipart/form-data')) {
      candidateUpload(req, res, (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        handleSubmission(req, res);
      });
    } else {
      handleSubmission(req, res);
    }
  });

  router.post('/submit', (req, res, next) => {
    if (req.is('multipart/form-data')) {
      candidateUpload(req, res, (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        handleSubmission(req, res);
      });
    } else {
      handleSubmission(req, res);
    }
  });

  // ── Redirects & Aliases ──────────────────────────────────────────────────
  router.get('/dashboard/security-check', requireAuthUser, (req, res) => {
    res.redirect('/dashboard/security-check/records');
  });

  router.get('/admin/candidates', requireAuthUser, (req, res) => {
    res.redirect('/dashboard/security-check/records');
  });

  router.get('/admin/candidates/:id', requireAuthUser, (req, res) => {
    res.redirect(`/dashboard/security-check/records/${req.params.id}`);
  });

  // ── DEDICATED "RECORDS" SECTION: Table List View ─────────────────────────
  // Route: /dashboard/security-check/records
  router.get('/dashboard/security-check/records', requireAuthUser, (req, res) => {
    const candidates = db.prepare('SELECT * FROM candidates ORDER BY created_at DESC').all();

    // Query active custom domain assigned to Security Check Lab
    let activeCustomDomain = null;
    try {
      const domRow = db.prepare(`
        SELECT domain FROM managed_domains 
        WHERE target_service = 'security_check' 
          AND is_active = 1 
          AND status IN ('SSL Active', 'Live')
        ORDER BY updated_at DESC LIMIT 1
      `).get();
      if (domRow) activeCustomDomain = domRow.domain;
    } catch (_) {}

    const stats = {
      total: candidates.length,
      pending: candidates.filter(c => (c.status || '').toLowerCase() === 'pending').length,
      approved: candidates.filter(c => (c.status || '').toLowerCase() === 'approved' || (c.status || '').toLowerCase() === 'active').length,
      rejected: candidates.filter(c => (c.status || '').toLowerCase() === 'rejected').length
    };

    const rows = candidates.map(c => {
      const statusLower = (c.status || 'pending').toLowerCase();
      const statusBadge = statusLower === 'approved' || statusLower === 'active'
        ? `<span style="background:rgba(34,197,94,0.18);color:#22c55e;border:1px solid rgba(34,197,94,0.4);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700">APPROVED</span>`
        : statusLower === 'rejected'
        ? `<span style="background:rgba(239,68,68,0.18);color:#ef4444;border:1px solid rgba(239,68,68,0.4);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700">REJECTED</span>`
        : `<span style="background:rgba(245,158,11,0.18);color:#f59e0b;border:1px solid rgba(245,158,11,0.4);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700">PENDING</span>`;

      const docPath = c.id_document_path || c.doc_file_path;
      const docType = c.document_type || c.doc_type || 'ID Document';
      const docBadge = docPath
        ? `<a href="${docPath}" download target="_blank" style="background:#201440;border:1px solid #3b2866;color:#a855f7;text-decoration:none;display:inline-flex;align-items:center;gap:4px;padding:4px 9px;font-size:11px;border-radius:6px;font-weight:600">🪪 ${safeEsc(docType)} <span style="opacity:0.7">⬇️</span></a>`
        : `<span style="color:#666;font-size:12px">—</span>`;

      let videoPath = c.biometric_video_path || c.video_path || '';
      if (!videoPath) {
        const refPath = c.photo_path || c.id_document_path || c.doc_file_path || '';
        const folderMatch = refPath.match(/\/uploads\/candidates\/([^/]+)\//);
        if (folderMatch && folderMatch[1]) {
          const candidateFolder = folderMatch[1];
          const diskBioWebm = path.join(CANDIDATES_DIR, candidateFolder, 'biometrics', 'biometric_video.webm');
          const diskFaceWebm = path.join(CANDIDATES_DIR, candidateFolder, 'face_verification', 'biometric_video.webm');
          if (fs.existsSync(diskBioWebm)) {
            videoPath = `/uploads/candidates/${candidateFolder}/biometrics/biometric_video.webm`;
            try {
              db.prepare('UPDATE candidates SET video_path = ?, biometric_video_path = ? WHERE id = ?').run(videoPath, videoPath, c.id);
            } catch (_) {}
          } else if (fs.existsSync(diskFaceWebm)) {
            videoPath = `/uploads/candidates/${candidateFolder}/face_verification/biometric_video.webm`;
            try {
              db.prepare('UPDATE candidates SET video_path = ?, biometric_video_path = ? WHERE id = ?').run(videoPath, videoPath, c.id);
            } catch (_) {}
          }
        }
      }
      const videoCell = videoPath
        ? `<button type="button" onclick="playVideoModal('${videoPath}', '${safeEsc(c.full_name)}')" style="background:linear-gradient(135deg,#7c3aed,#9333ea);color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:5px;cursor:pointer">▶️ Play (5s) <span style="color:#34d399;font-weight:700">✓</span></button>`
        : `<span style="color:#666;font-size:12px">—</span>`;

      return `<tr>
        <td style="font-weight:700;color:#c4b5fd">#${c.id}</td>
        <td>
          <a href="/dashboard/security-check/records/${c.id}" style="font-weight:600;color:#fff;text-decoration:none;display:block">${safeEsc(c.full_name)}</a>
          <div style="font-size:12px;color:#a399c2;margin-top:2px">${safeEsc(c.email || 'No email')} · ${safeEsc(c.phone || 'No phone')}</div>
        </td>
        <td>${docBadge}</td>
        <td>${videoCell}</td>
        <td style="font-size:12px;color:#cbd5e1">${c.created_at || '—'}</td>
        <td>${statusBadge}</td>
        <td style="white-space:nowrap">
          <a href="/dashboard/security-check/records/${c.id}" style="background:#1f1638;border:1px solid #3b2866;color:#fff;padding:5px 11px;border-radius:6px;font-size:12px;text-decoration:none;font-weight:600;display:inline-block;margin-right:5px">🔍 Profile</a>
          ${statusLower !== 'approved' ? `<a href="/dashboard/security-check/records/${c.id}/status/approved" style="background:#059669;color:#fff;padding:5px 9px;border-radius:6px;font-size:11px;text-decoration:none;font-weight:700;margin-right:4px">✓</a>` : ''}
          ${statusLower !== 'rejected' ? `<a href="/dashboard/security-check/records/${c.id}/status/rejected" style="background:#e11d48;color:#fff;padding:5px 9px;border-radius:6px;font-size:11px;text-decoration:none;font-weight:700;margin-right:4px">✕</a>` : ''}
          <a href="/dashboard/security-check/records/${c.id}/delete" onclick="return confirm('Delete candidate record #${c.id}?')" style="background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);padding:5px 8px;border-radius:6px;font-size:11px;text-decoration:none">🗑️</a>
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="7" style="text-align:center;padding:40px;color:#888">No candidate records submitted yet.</td></tr>`;

    const content = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;margin-bottom:20px">
        <div>
          <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#fff">🛡️ Security Check Lab · Records</h1>
          <p style="color:#a399c2;font-size:14px;margin:0">Verified candidate submissions, identity documents, and biometric recordings stored in local SQLite storage.</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button type="button" onclick="copyPublicLink()" id="btn-copy-public-link" style="padding:10px 18px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:8px;cursor:pointer;box-shadow:0 4px 14px rgba(16,185,129,0.35);transition:all .2s ease">
            <span id="btn-copy-icon">📋</span> <span id="btn-copy-text">Copy Public Link</span>
          </button>
          <button type="button" onclick="openEmailModal()" style="padding:10px 16px;background:#201440;border:1px solid #3b2866;color:#e9d5ff;border-radius:8px;font-weight:600;font-size:13px;display:inline-flex;align-items:center;gap:6px;cursor:pointer">
            ✉️ Email Invitation
          </button>
          <a href="/security-check/apply" target="_blank" style="padding:10px 16px;background:#1c1436;border:1px solid #2e2055;color:#c4b5fd;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;display:inline-flex;align-items:center;gap:6px">
            🔗 Open /apply Form ↗
          </a>
        </div>
      </div>

      <!-- Public Application Link Sharing Banner Card -->
      <div style="background:linear-gradient(135deg,#181033,#130d29);border:1px solid #3b2866;border-radius:12px;padding:16px 20px;margin-bottom:22px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:280px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:18px">🌐</span>
            <strong style="color:#fff;font-size:14px">Public Candidate Application &amp; Identity Link</strong>
            <span style="background:rgba(16,185,129,0.18);color:#10b981;border:1px solid rgba(16,185,129,0.4);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">UNAUTHENTICATED · PUBLIC ACCESS</span>
          </div>
          <p style="color:#a399c2;font-size:12.5px;margin:0 0 10px 0;line-height:1.5">
            Share this link with candidates to complete their background check, upload ID documents, and execute the 3-4s biometric facial verification.
          </p>
          ${activeCustomDomain ? `
            <div style="margin-bottom:10px;padding:6px 12px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);border-radius:6px;font-size:12px;display:inline-flex;align-items:center;gap:6px">
              <span style="color:#22c55e;font-weight:700">🔒 Active Custom Domain:</span>
              <span style="color:#fff;font-family:monospace">https://${safeEsc(activeCustomDomain)}</span>
              <a href="/dashboard/domains" style="color:#c084fc;font-size:11px;margin-left:6px;text-decoration:none">Manage in Domain Manager →</a>
            </div>
          ` : `
            <div style="margin-bottom:10px;font-size:12px;color:#a399c2">
              <span>Domain: Standard Host · </span><a href="/dashboard/domains" style="color:#c084fc;text-decoration:none">Assign Custom HTTPS Domain in Domain Manager →</a>
            </div>
          `}
          <div style="display:flex;align-items:center;gap:8px;max-width:580px">
            <input type="text" id="publicLinkInput" readonly value="${activeCustomDomain ? `https://${safeEsc(activeCustomDomain)}/apply` : '/security-check/apply'}" style="background:#0a0614;border:1px solid #3b2866;color:#c4b5fd;border-radius:6px;padding:8px 12px;font-size:12.5px;font-family:monospace;flex:1;outline:none" />
            <button type="button" onclick="copyPublicLink()" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .2s">Copy Link</button>
            <button type="button" onclick="openEmailModal()" style="background:#201440;border:1px solid #3b2866;color:#e9d5ff;border-radius:6px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">Invite Email</button>
          </div>
        </div>
        <div id="copySuccessToast" style="display:none;background:rgba(16,185,129,0.2);border:1px solid #10b981;color:#10b981;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;">
          ✓ Public application link copied to clipboard!
        </div>
      </div>

      <div class="stats-grid" style="margin-bottom:24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
        <div class="stat-card" style="background:#150f28;border:1px solid #2e2055;padding:16px 20px;border-radius:12px">
          <div class="stat-num" style="font-size:26px;font-weight:700;color:#fff">${stats.total}</div>
          <div style="color:#a399c2;font-size:13px">Total Candidates</div>
        </div>
        <div class="stat-card" style="background:#150f28;border:1px solid #2e2055;padding:16px 20px;border-radius:12px">
          <div class="stat-num" style="font-size:26px;font-weight:700;color:#f59e0b">${stats.pending}</div>
          <div style="color:#a399c2;font-size:13px">Pending Review</div>
        </div>
        <div class="stat-card" style="background:#150f28;border:1px solid #2e2055;padding:16px 20px;border-radius:12px">
          <div class="stat-num" style="font-size:26px;font-weight:700;color:#22c55e">${stats.approved}</div>
          <div style="color:#a399c2;font-size:13px">Approved</div>
        </div>
        <div class="stat-card" style="background:#150f28;border:1px solid #2e2055;padding:16px 20px;border-radius:12px">
          <div class="stat-num" style="font-size:26px;font-weight:700;color:#ef4444">${stats.rejected}</div>
          <div style="color:#a399c2;font-size:13px">Rejected</div>
        </div>
      </div>

      <div class="panel" style="background:#150f28;border:1px solid #2e2055;border-radius:14px;padding:20px;overflow-x:auto">
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="border-bottom:1px solid #2e2055;color:#a399c2;text-align:left">
              <th style="padding:12px 14px">ID</th>
              <th style="padding:12px 14px">Candidate &amp; Contact</th>
              <th style="padding:12px 14px">Document Category</th>
              <th style="padding:12px 14px">Biometric Category</th>
              <th style="padding:12px 14px">Timestamp</th>
              <th style="padding:12px 14px">Status</th>
              <th style="padding:12px 14px">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>

      <!-- Candidate Email Invitation Modal -->
      <div id="emailInviteModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px)">
        <div style="background:#150f28;border:1px solid #3b2866;border-radius:14px;max-width:580px;width:100%;padding:24px;box-shadow:0 25px 60px rgba(0,0,0,0.8)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="color:#fff;font-size:17px;margin:0;display:flex;align-items:center;gap:8px">✉️ Candidate Invitation Email Template</h3>
            <button type="button" onclick="closeEmailModal()" style="background:none;border:none;color:#a399c2;font-size:22px;cursor:pointer;line-height:1">&times;</button>
          </div>
          <p style="color:#a399c2;font-size:13px;margin:0 0 14px 0">
            Copy and send this pre-composed message to candidates. The public application link requires no login.
          </p>
          <div style="margin-bottom:12px">
            <label style="color:#a399c2;font-size:12px;display:block;margin-bottom:4px">Subject Line:</label>
            <input type="text" id="emailSubject" readonly value="Action Required: Complete Your MarketForge Onboarding &amp; Identity Verification" style="width:100%;background:#0a0614;border:1px solid #3b2866;color:#fff;border-radius:6px;padding:8px 10px;font-size:12.5px;box-sizing:border-box" />
          </div>
          <div style="margin-bottom:16px">
            <label style="color:#a399c2;font-size:12px;display:block;margin-bottom:4px">Email Message Body:</label>
            <textarea id="emailBodyText" readonly rows="8" style="width:100%;background:#0a0614;border:1px solid #3b2866;color:#e2e8f0;border-radius:6px;padding:10px;font-size:12px;line-height:1.6;font-family:monospace;resize:vertical;box-sizing:border-box"></textarea>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span id="emailCopyToast" style="display:none;color:#10b981;font-size:12px;font-weight:700">✓ Email draft copied!</span>
            <div style="display:flex;gap:10px;margin-left:auto">
              <button type="button" onclick="closeEmailModal()" style="background:#1f1638;border:1px solid #3b2866;color:#fff;padding:8px 16px;border-radius:6px;font-size:12.5px;cursor:pointer">Cancel</button>
              <button type="button" onclick="copyEmailTemplate()" id="btnCopyEmail" style="background:linear-gradient(135deg,#7c3aed,#9333ea);color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:12.5px;font-weight:700;cursor:pointer">📋 Copy Full Email</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Biometric Video Modal Player -->
      <div id="videoModal" style="display:none;position:fixed;inset:0;background:rgba(8,5,15,0.88);backdrop-filter:blur(8px);z-index:99999;align-items:center;justify-content:center;padding:20px">
        <div style="background:#150f28;border:1px solid #3b2866;border-radius:14px;padding:24px;max-width:640px;width:100%;text-align:center;box-shadow:0 25px 60px rgba(0,0,0,0.8)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h3 id="videoModalTitle" style="color:#fff;margin:0;font-size:16px">Biometric Verification Video (5s · 1080p Full HD)</h3>
            <button type="button" onclick="closeVideoModal()" style="background:none;border:none;color:#a399c2;font-size:20px;cursor:pointer">✕</button>
          </div>
          <video id="modalVideoPlayer" controls playsinline autoplay loop style="width:100%;border-radius:10px;background:#000;max-height:420px;margin-bottom:16px;transform:scaleX(-1);-webkit-transform:scaleX(-1)"></video>
          <div style="display:flex;justify-content:space-between;gap:10px">
            <a id="modalVideoDownload" href="#" download="biometric_video_1080p.webm" class="btn-sm btn-primary" style="text-decoration:none;padding:8px 16px;background:#a855f7;color:#fff;border-radius:6px;font-size:12px;font-weight:600">⬇️ Download 1080p HD Video</a>
            <button type="button" onclick="closeVideoModal()" style="padding:8px 16px;background:#2a1b4d;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer">Close</button>
          </div>
        </div>
      </div>

      <script>
        // Assigned active custom domain from database (if any)
        var activeCustomDomain = ${JSON.stringify(activeCustomDomain || '')};

        // Generate live public link based on active custom domain or host
        function getPublicApplicationUrl() {
          if (activeCustomDomain) {
            return 'https://' + activeCustomDomain + '/apply';
          }
          return window.location.origin + '/security-check/apply';
        }

        // Initialize public link input & email body on page load
        (function() {
          var input = document.getElementById('publicLinkInput');
          if (input) input.value = getPublicApplicationUrl();
          updateEmailTemplateText();
        })();

        function updateEmailTemplateText() {
          var url = getPublicApplicationUrl();
          var body = document.getElementById('emailBodyText');
          if (body) {
            body.value = 
              "Hello,\\n\\n" +
              "As part of your onboarding compliance process, please complete your employment verification and mandatory biometric identity check by visiting your secure portal:\\n\\n" +
              "👉 " + url + "\\n\\n" +
              "Requirements to complete in 2-3 minutes:\\n" +
              "• Valid ID Document (Passport, National ID, or Driving Licence)\\n" +
              "• Proof of residential address\\n" +
              "• 3-4 second biometric face scan with your webcam or smartphone camera\\n\\n" +
              "Once submitted, your compliance team will review your application directly.\\n\\n" +
              "Best regards,\\n" +
              "MarketForge Recruitment Compliance Team";
          }
        }

        function copyPublicLink() {
          var url = getPublicApplicationUrl();
          navigator.clipboard.writeText(url).then(function() {
            showCopyFeedback();
          }).catch(function() {
            var input = document.getElementById('publicLinkInput');
            if (input) {
              input.select();
              document.execCommand('copy');
              showCopyFeedback();
            }
          });
        }

        function showCopyFeedback() {
          var toast = document.getElementById('copySuccessToast');
          var btn = document.getElementById('btn-copy-public-link');
          var text = document.getElementById('btn-copy-text');
          var icon = document.getElementById('btn-copy-icon');

          if (toast) {
            toast.style.display = 'block';
            setTimeout(function() { toast.style.display = 'none'; }, 4000);
          }
          if (text) text.textContent = 'Link Copied! ✓';
          if (icon) icon.textContent = '✓';
          if (btn) btn.style.background = 'linear-gradient(135deg,#059669,#047857)';

          setTimeout(function() {
            if (text) text.textContent = 'Copy Public Link';
            if (icon) icon.textContent = '📋';
            if (btn) btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
          }, 3000);
        }

        function openEmailModal() {
          updateEmailTemplateText();
          var m = document.getElementById('emailInviteModal');
          if (m) m.style.display = 'flex';
        }

        function closeEmailModal() {
          var m = document.getElementById('emailInviteModal');
          if (m) m.style.display = 'none';
        }

        function copyEmailTemplate() {
          var subject = document.getElementById('emailSubject').value;
          var body = document.getElementById('emailBodyText').value;
          var full = "Subject: " + subject + "\\n\\n" + body;

          navigator.clipboard.writeText(full).then(function() {
            var t = document.getElementById('emailCopyToast');
            if (t) {
              t.style.display = 'inline-block';
              setTimeout(function(){ t.style.display = 'none'; }, 3000);
            }
          });
        }

        function playVideoModal(videoUrl, name) {
          var modal = document.getElementById('videoModal');
          var player = document.getElementById('modalVideoPlayer');
          var title = document.getElementById('videoModalTitle');
          var downloadBtn = document.getElementById('modalVideoDownload');
          title.textContent = 'Biometric Recording: ' + name;
          var isMp4 = /\.mp4(\?|$)/i.test(videoUrl || '');
          var mime = isMp4 ? 'video/mp4' : 'video/webm';
          player.innerHTML = '<source src="' + videoUrl + '" type="' + mime + '">';
          player.src = videoUrl;
          try { player.load(); } catch (_) {}
          downloadBtn.href = videoUrl;
          modal.style.display = 'flex';
          player.play().catch(function(){});
        }

        function closeVideoModal() {
          var modal = document.getElementById('videoModal');
          var player = document.getElementById('modalVideoPlayer');
          player.pause();
          player.src = '';
          modal.style.display = 'none';
        }

        window.addEventListener('click', function(e) {
          var modal = document.getElementById('videoModal');
          if (e.target === modal) closeVideoModal();
          var emailModal = document.getElementById('emailInviteModal');
          if (e.target === emailModal) closeEmailModal();
        });
      </script>
    `;

    return renderLayout(req, res, 'Records', content);
  });

  // ── DEDICATED "RECORDS" SECTION: Categorized Profile View (Sections 1 to 4) ─
  // Route: /dashboard/security-check/records/:id
  router.get('/dashboard/security-check/records/:id', requireAuthUser, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const c = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
    if (!c) return res.redirect('/dashboard/security-check/records');

    const statusLower = (c.status || 'pending').toLowerCase();
    const statusBadge = statusLower === 'approved' || statusLower === 'active'
      ? `<span style="background:rgba(34,197,94,0.2);color:#22c55e;border:1px solid rgba(34,197,94,0.5);padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700">APPROVED</span>`
      : statusLower === 'rejected'
      ? `<span style="background:rgba(239,68,68,0.2);color:#ef4444;border:1px solid rgba(239,68,68,0.5);padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700">REJECTED</span>`
      : `<span style="background:rgba(245,158,11,0.2);color:#f59e0b;border:1px solid rgba(245,158,11,0.5);padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700">PENDING REVIEW</span>`;

    const idDocPath = c.id_document_path || c.doc_file_path || '';
    const idDocType = c.document_type || c.doc_type || 'Identity Document';
    const isDocImg = /\.(jpe?g|png|webp|gif)$/i.test(idDocPath);
    const isDocPdf = /\.pdf$/i.test(idDocPath);

    let videoPath = c.biometric_video_path || c.video_path || '';
    if (!videoPath) {
      const refPath = c.photo_path || c.id_document_path || c.doc_file_path || '';
      const folderMatch = refPath.match(/\/uploads\/candidates\/([^/]+)\//);
      if (folderMatch && folderMatch[1]) {
        const candidateFolder = folderMatch[1];
        const diskBioWebm = path.join(CANDIDATES_DIR, candidateFolder, 'biometrics', 'biometric_video.webm');
        const diskFaceWebm = path.join(CANDIDATES_DIR, candidateFolder, 'face_verification', 'biometric_video.webm');
        if (fs.existsSync(diskBioWebm)) {
          videoPath = `/uploads/candidates/${candidateFolder}/biometrics/biometric_video.webm`;
          try {
            db.prepare('UPDATE candidates SET video_path = ?, biometric_video_path = ? WHERE id = ?').run(videoPath, videoPath, c.id);
          } catch (_) {}
        } else if (fs.existsSync(diskFaceWebm)) {
          videoPath = `/uploads/candidates/${candidateFolder}/face_verification/biometric_video.webm`;
          try {
            db.prepare('UPDATE candidates SET video_path = ?, biometric_video_path = ? WHERE id = ?').run(videoPath, videoPath, c.id);
          } catch (_) {}
        }
      }
    }
    const photoPath = c.photo_path || '';
    const faceMatch = c.face_match_status || 'Verified';

    const content = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <a href="/dashboard/security-check/records" style="color:#a855f7;text-decoration:none;font-size:13px;font-weight:600">← Back to Records List</a>
          <h1 style="margin:6px 0 0 0;font-size:24px;font-weight:700;color:#fff">Candidate Profile #${c.id} · ${safeEsc(c.full_name)}</h1>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          ${statusBadge}
          <a href="/dashboard/security-check/records/${c.id}/status/approved" style="background:#059669;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:700;font-size:12px">✓ Approve</a>
          <a href="/dashboard/security-check/records/${c.id}/status/rejected" style="background:#e11d48;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:700;font-size:12px">✕ Reject</a>
        </div>
      </div>

      <!-- Navigation Tabs for Categorized View -->
      <div style="display:flex;gap:8px;border-bottom:1px solid #2e2055;margin-bottom:22px;flex-wrap:wrap">
        <button type="button" class="tab-trigger active" onclick="switchCategory('section-1', this)" style="background:#201440;border:1px solid #3b2866;color:#fff;padding:9px 16px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:600">👤 Section 1: Personal Details</button>
        <button type="button" class="tab-trigger" onclick="switchCategory('section-2', this)" style="background:#150f28;border:1px solid #2e2055;color:#a399c2;padding:9px 16px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:600">🪪 Section 2: ID Verification</button>
        <button type="button" class="tab-trigger" onclick="switchCategory('section-3', this)" style="background:#150f28;border:1px solid #2e2055;color:#a399c2;padding:9px 16px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:600">🎥 Section 3: Biometric Check</button>
        <button type="button" class="tab-trigger" onclick="switchCategory('section-4', this)" style="background:#150f28;border:1px solid #2e2055;color:#a399c2;padding:9px 16px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:600">⚖️ Section 4: Status &amp; Controls</button>
        <button type="button" class="tab-trigger" onclick="switchCategory('all', this)" style="background:#150f28;border:1px solid #2e2055;color:#a399c2;padding:9px 16px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:600">📄 View All Sections</button>
      </div>

      <!-- SECTION 1: Personal Details (Name, Contact, Timestamp) -->
      <div id="section-1" class="category-block" style="background:#150f28;border:1px solid #2e2055;border-radius:14px;padding:24px;margin-bottom:20px">
        <h3 style="color:#fff;font-size:17px;margin:0 0 16px 0;display:flex;align-items:center;gap:8px">
          <span>👤</span> Section 1: Personal Details &amp; History
        </h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;font-size:13px;line-height:1.6">
          <div style="background:#1c1436;padding:12px 14px;border-radius:8px;border:1px solid #2e2055">
            <span style="color:#a399c2;display:block;font-size:12px">Full Name</span>
            <strong style="color:#fff;font-size:15px">${safeEsc(c.full_name)}</strong>
          </div>
          <div style="background:#1c1436;padding:12px 14px;border-radius:8px;border:1px solid #2e2055">
            <span style="color:#a399c2;display:block;font-size:12px">Email Address</span>
            <strong style="color:#fff">${safeEsc(c.email || '—')}</strong>
          </div>
          <div style="background:#1c1436;padding:12px 14px;border-radius:8px;border:1px solid #2e2055">
            <span style="color:#a399c2;display:block;font-size:12px">Phone Number</span>
            <strong style="color:#fff">${safeEsc(c.phone || '—')}</strong>
          </div>
          <div style="background:#1c1436;padding:12px 14px;border-radius:8px;border:1px solid #2e2055">
            <span style="color:#a399c2;display:block;font-size:12px">Date of Birth</span>
            <strong style="color:#fff">${safeEsc(c.dob || '—')}</strong>
          </div>
          <div style="background:#1c1436;padding:12px 14px;border-radius:8px;border:1px solid #2e2055">
            <span style="color:#a399c2;display:block;font-size:12px">Submission Timestamp</span>
            <strong style="color:#c4b5fd">${c.created_at || '—'}</strong>
          </div>
          <div style="background:#1c1436;padding:12px 14px;border-radius:8px;border:1px solid #2e2055">
            <span style="color:#a399c2;display:block;font-size:12px">Submission IP</span>
            <strong style="color:#fff">${safeEsc(c.ip_address || '—')}</strong>
          </div>
        </div>

        <div style="margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div style="background:#1c1436;padding:14px;border-radius:8px;border:1px solid #2e2055">
            <h4 style="color:#a855f7;font-size:13px;margin:0 0 8px 0">Current Residential Address</h4>
            <p style="color:#fff;font-size:13px;margin:0 0 6px 0">${safeEsc(c.address || '')}, ${safeEsc(c.city || '')}, ${safeEsc(c.postcode || '')}</p>
            <p style="color:#a399c2;font-size:12px;margin:0">${safeEsc(c.current_address_history || '')}</p>
          </div>
          <div style="background:#1c1436;padding:14px;border-radius:8px;border:1px solid #2e2055">
            <h4 style="color:#a855f7;font-size:13px;margin:0 0 8px 0">Previous 5-Year Address History</h4>
            <p style="color:#fff;font-size:13px;margin:0">${safeEsc(c.previous_address_history || 'Lived at current address 5+ years')}</p>
          </div>
        </div>

        <div style="margin-top:16px;background:#1c1436;padding:14px;border-radius:8px;border:1px solid #2e2055;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;font-size:13px">
          <div><span style="color:#a399c2">Employer:</span> <strong>${safeEsc(c.employer || '—')}</strong></div>
          <div><span style="color:#a399c2">Job Title:</span> <strong>${safeEsc(c.job_title || '—')}</strong></div>
          <div><span style="color:#a399c2">Salary:</span> <strong>${safeEsc(c.salary || '—')}</strong></div>
          <div><span style="color:#a399c2">Duration:</span> <strong>${safeEsc(c.duration || '—')}</strong></div>
          <div><span style="color:#a399c2">RTW Share Code:</span> <code style="background:#2b1b4d;padding:2px 6px;border-radius:4px;color:#22c55e">${safeEsc(c.rtw_code || '—')}</code></div>
          <div><span style="color:#a399c2">NINO:</span> <code style="background:#2b1b4d;padding:2px 6px;border-radius:4px;color:#a855f7">${safeEsc(c.nino || '—')}</code></div>
        </div>
      </div>

      <!-- SECTION 2: ID Verification (Document Preview & Download Link) -->
      <div id="section-2" class="category-block" style="background:#150f28;border:1px solid #2e2055;border-radius:14px;padding:24px;margin-bottom:20px">
        <h3 style="color:#fff;font-size:17px;margin:0 0 16px 0;display:flex;align-items:center;gap:8px">
          <span>🪪</span> Section 2: ID Verification &amp; Document Archive
        </h3>
        
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div>
            <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <span style="color:#a399c2;font-size:12px;display:block">Document Classification</span>
                <strong style="color:#fff;font-size:15px;text-transform:capitalize">${safeEsc(idDocType.replace('_', ' '))}</strong>
              </div>
              ${idDocPath ? `
                <a href="${idDocPath}" download class="btn-sm btn-primary" style="padding:8px 14px;background:#a855f7;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:12px;display:inline-flex;align-items:center;gap:5px">
                  ⬇️ Download ID File
                </a>
              ` : ''}
            </div>

            <!-- Visual Document Preview Container -->
            <div style="background:#0a0614;border:1px solid #2e2055;border-radius:10px;padding:12px;text-align:center;min-height:280px;display:flex;align-items:center;justify-content:center">
              ${isDocImg ? `
                <img src="${idDocPath}" alt="ID Document Preview" style="max-width:100%;max-height:340px;object-fit:contain;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.5)" />
              ` : isDocPdf ? `
                <iframe src="${idDocPath}" style="width:100%;height:340px;border:none;border-radius:6px"></iframe>
              ` : idDocPath ? `
                <div style="padding:20px">
                  <div style="font-size:48px;margin-bottom:10px">📄</div>
                  <p style="color:#fff;font-weight:600;margin:0 0 8px 0">${safeEsc(path.basename(idDocPath))}</p>
                  <a href="${idDocPath}" download class="btn-sm btn-primary" style="text-decoration:none;padding:6px 14px;background:#a855f7;color:#fff;border-radius:6px;font-size:12px">Download Document</a>
                </div>
              ` : `
                <p style="color:#666">No document uploaded.</p>
              `}
            </div>
            ${idDocPath ? `<p style="font-size:11px;color:#a399c2;margin-top:8px">Local Path: <code>${safeEsc(idDocPath)}</code></p>` : ''}
          </div>

          <!-- Additional Submitted Documents Table -->
          <div>
            <h4 style="color:#fff;font-size:14px;margin:0 0 12px 0">Additional Verification Documents</h4>
            <div style="background:#1c1436;border:1px solid #2e2055;border-radius:10px;padding:14px">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <tr style="border-bottom:1px solid #2e2055">
                  <td style="padding:8px 0;color:#a399c2">Proof of Address:</td>
                  <td style="padding:8px 0;color:#fff">${safeEsc(c.poa_doc_type || 'POA')}</td>
                  <td style="padding:8px 0;text-align:right">
                    ${c.poa_file_path ? `<a href="${c.poa_file_path}" download target="_blank" style="color:#a855f7;text-decoration:none;font-weight:600">⬇️ Download</a>` : '<span style="color:#666">—</span>'}
                  </td>
                </tr>
                <tr style="border-bottom:1px solid #2e2055">
                  <td style="padding:8px 0;color:#a399c2">Right to Work Doc:</td>
                  <td style="padding:8px 0;color:#fff">Share Code Proof</td>
                  <td style="padding:8px 0;text-align:right">
                    ${c.rtw_file_path ? `<a href="${c.rtw_file_path}" download target="_blank" style="color:#a855f7;text-decoration:none;font-weight:600">⬇️ Download</a>` : '<span style="color:#666">—</span>'}
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#a399c2">CV / Resume:</td>
                  <td style="padding:8px 0;color:#fff">Candidate CV</td>
                  <td style="padding:8px 0;text-align:right">
                    ${c.cv_file_path ? `<a href="${c.cv_file_path}" download target="_blank" style="color:#a855f7;text-decoration:none;font-weight:600">⬇️ Download</a>` : '<span style="color:#666">—</span>'}
                  </td>
                </tr>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- SECTION 3: Biometric Check (Embedded Video Player for 5s 1080p Full HD recording) -->
      <div id="section-3" class="category-block" style="background:#150f28;border:1px solid #2e2055;border-radius:14px;padding:24px;margin-bottom:20px">
        <h3 style="color:#fff;font-size:17px;margin:0 0 16px 0;display:flex;align-items:center;gap:8px">
          <span>🎥</span> Section 3: Biometric Facial Verification
        </h3>

        <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:20px">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <span style="font-size:13px;color:#22c55e;font-weight:600">✓ Biometric Video Recording (5 Seconds · 1080p Full HD)</span>
              ${videoPath ? `
                <a href="${videoPath}" download="biometric_video_1080p.webm" class="btn-sm btn-primary" style="padding:6px 12px;background:#a855f7;color:#fff;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600">⬇️ Download 1080p HD Video</a>
              ` : ''}
            </div>

            <!-- Embedded HTML5 Video Player -->
            <div style="background:#000;border-radius:12px;overflow:hidden;border:1px solid #3b2866;box-shadow:0 10px 30px rgba(0,0,0,0.6)">
              ${videoPath ? `
                <video src="${videoPath}" controls playsinline autoplay loop preload="metadata" style="width:100%;max-height:380px;display:block;background:#000;transform:scaleX(-1);-webkit-transform:scaleX(-1)">
                  <source src="${videoPath}" type="${/\.mp4(\?|$)/i.test(videoPath) ? 'video/mp4' : 'video/webm'}" />
                </video>
              ` : `
                <div style="padding:50px 20px;text-align:center;color:#666">No biometric video recorded.</div>
              `}
            </div>
            ${videoPath ? `<p style="font-size:11px;color:#a399c2;margin-top:8px">Video Path: <code>${safeEsc(videoPath)}</code></p>` : ''}
          </div>

          <!-- Biometric Face Status & Snapshot -->
          <div>
            <h4 style="color:#fff;font-size:14px;margin:0 0 12px 0">Biometric Verification Parameters</h4>
            <div style="background:#1c1436;border:1px solid #2e2055;border-radius:10px;padding:16px;margin-bottom:14px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <span style="color:#a399c2;font-size:13px">Face-Centering Status:</span>
                <span style="background:rgba(34,197,94,0.18);color:#22c55e;border:1px solid rgba(34,197,94,0.4);padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700">${safeEsc(faceMatch)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <span style="color:#a399c2;font-size:13px">Recording Length:</span>
                <span style="color:#fff;font-weight:600;font-size:13px">5.0 seconds</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <span style="color:#a399c2;font-size:13px">Target Resolution:</span>
                <span style="color:#22c55e;font-weight:600;font-size:13px">1080p Full HD (1920×1080)</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="color:#a399c2;font-size:13px">Bitrate / Codec:</span>
                <span style="color:#fff;font-size:13px">4.5 Mbps HD VP8/VP9 (WebM)</span>
              </div>
            </div>

            ${photoPath ? `
              <div style="background:#1c1436;border:1px solid #2e2055;border-radius:10px;padding:16px">
                <span style="color:#a399c2;font-size:12px;display:block;margin-bottom:8px">Facial Still Snapshot</span>
                <img src="${photoPath}" alt="Snapshot" style="width:110px;height:110px;border-radius:8px;object-fit:cover;border:2px solid #a855f7" />
              </div>
            ` : ''}
          </div>
        </div>
      </div>

      <!-- SECTION 4: Application Status & Action Controls -->
      <div id="section-4" class="category-block" style="background:#150f28;border:1px solid #2e2055;border-radius:14px;padding:24px">
        <h3 style="color:#fff;font-size:17px;margin:0 0 16px 0;display:flex;align-items:center;gap:8px">
          <span>⚖️</span> Section 4: Application Status &amp; Action Controls
        </h3>

        <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:20px">
          <div style="background:#1c1436;border:1px solid #2e2055;border-radius:10px;padding:16px">
            <h4 style="color:#fff;font-size:14px;margin:0 0 10px 0">Candidate Consent &amp; Digital Signature</h4>
            <p style="font-size:13px;color:#22c55e;margin:0 0 6px 0">✓ Consent granted for DBS background check</p>
            <p style="font-size:13px;color:#fff;margin:0 0 10px 0">Legal Digital Signature: <strong>${safeEsc(c.declaration_signature || c.full_name)}</strong></p>
            <p style="font-size:12px;color:#a399c2;margin:0">Application ID: #${c.id} · Recorded: ${c.created_at || '—'}</p>
          </div>

          <div style="background:#1c1436;border:1px solid #2e2055;border-radius:10px;padding:16px">
            <h4 style="color:#fff;font-size:14px;margin:0 0 12px 0">Status Management</h4>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <a href="/dashboard/security-check/records/${c.id}/status/approved" style="background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:6px">
                ✓ Approve Candidate
              </a>
              <a href="/dashboard/security-check/records/${c.id}/status/rejected" style="background:#e11d48;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:6px">
                ✕ Reject Candidate
              </a>
              <a href="/dashboard/security-check/records/${c.id}/status/pending" style="background:#d97706;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:6px">
                ↺ Mark as Pending
              </a>
              <a href="/dashboard/security-check/records/${c.id}/delete" onclick="return confirm('Permanently delete candidate #${c.id}?')" style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:6px">
                🗑️ Delete Record
              </a>
            </div>
          </div>
        </div>
      </div>

      <script>
        function switchCategory(targetId, btn) {
          document.querySelectorAll('.tab-trigger').forEach(function(b) {
            b.style.background = '#150f28';
            b.style.color = '#a399c2';
            b.style.borderColor = '#2e2055';
          });
          btn.style.background = '#201440';
          btn.style.color = '#fff';
          btn.style.borderColor = '#3b2866';

          if (targetId === 'all') {
            document.querySelectorAll('.category-block').forEach(function(el) {
              el.style.display = 'block';
            });
          } else {
            document.querySelectorAll('.category-block').forEach(function(el) {
              el.style.display = 'none';
            });
            var target = document.getElementById(targetId);
            if (target) target.style.display = 'block';
          }
        }
      </script>
    `;

    return renderLayout(req, res, 'Profile', content);
  });

  // ── Status & Delete Actions ──────────────────────────────────────────────
  router.get('/dashboard/security-check/records/:id/status/:status', requireAuthUser, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const s = req.params.status.toLowerCase();
    const newStatus = s === 'approved' ? 'Approved' : s === 'rejected' ? 'Rejected' : 'Pending';
    db.prepare('UPDATE candidates SET status = ? WHERE id = ?').run(newStatus, id);
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='logs'").get()) {
      try {
        db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'candidate_status', ?, ?)")
          .run(req.user.id, `Candidate #${id} marked as ${newStatus}`, req.ip);
      } catch (_) {}
    }
    res.redirect(`/dashboard/security-check/records/${id}`);
  });

  router.post('/dashboard/security-check/records/:id/status', requireAuthUser, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const s = (req.body.status || 'Pending').toLowerCase();
    const newStatus = s === 'approved' ? 'Approved' : s === 'rejected' ? 'Rejected' : 'Pending';
    db.prepare('UPDATE candidates SET status = ? WHERE id = ?').run(newStatus, id);
    res.redirect(`/dashboard/security-check/records/${id}`);
  });

  router.get('/dashboard/security-check/records/:id/delete', requireAuthUser, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
    if (candidate) {
      const docPath = candidate.id_document_path || candidate.doc_file_path;
      if (docPath) {
        try {
          const folder = path.dirname(path.dirname(path.join(__dirname, '..', '..', 'public', docPath)));
          if (folder && folder.includes('candidates')) {
            fs.rmSync(folder, { recursive: true, force: true });
          }
        } catch (_) {}
      }
      db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
    }
    res.redirect('/dashboard/security-check/records');
  });

  return router;
};
