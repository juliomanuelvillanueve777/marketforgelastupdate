/**
 * Candidate Verification & Security Check System
 * Integrated with MarketForge Platform
 */

'use strict';

(function () {
  const TOTAL_STEPS = 7;
  const STEP_TITLES = [
    'Personal Details',
    'Employment Eligibility',
    'Employment History',
    'Identity Document',
    'Address History',
    'Proof of Address',
    'Background Check & Facial Verification'
  ];

  let currentStep = 1;

  // Helper functions for errors
  function setError(id, msg) {
    const el = document.getElementById('err-' + id);
    if (el) el.textContent = msg || '';
    const input = document.getElementById(id);
    if (input) {
      if (msg) input.classList.add('invalid');
      else input.classList.remove('invalid');
    }
  }

  function clearError(id) {
    setError(id, '');
  }

  function clearAllErrors() {
    document.querySelectorAll('.error').forEach(e => e.textContent = '');
    document.querySelectorAll('.invalid').forEach(e => e.classList.remove('invalid'));
    document.querySelectorAll('.invalid-zone').forEach(e => e.classList.remove('invalid-zone'));
    const serverErr = document.getElementById('server-error');
    if (serverErr) serverErr.textContent = '';
  }

  // Step navigation
  function showStep(stepNumber) {
    if (stepNumber < 1 || stepNumber > TOTAL_STEPS) return;
    currentStep = stepNumber;

    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const pane = document.getElementById('step-pane-' + i);
      if (pane) {
        if (i === currentStep) pane.classList.add('active');
        else pane.classList.remove('active');
      }
      const seg = document.getElementById('seg-' + i);
      if (seg) {
        if (i < currentStep) {
          seg.className = 'step-bar-seg completed';
        } else if (i === currentStep) {
          seg.className = 'step-bar-seg active';
        } else {
          seg.className = 'step-bar-seg';
        }
      }
    }

    const subtitle = document.getElementById('stepSubtitle');
    if (subtitle) {
      subtitle.textContent = `Step ${currentStep} of ${TOTAL_STEPS} — ${STEP_TITLES[currentStep - 1]}`;
    }

    const card = document.querySelector('.card');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  window.prevStep = function (fromStep) {
    clearAllErrors();
    if (fromStep === 7) {
      stopCamera();
    }
    showStep(fromStep - 1);
  };

  // Step validation functions
  function validateStep1() {
    let valid = true;
    const fn = (document.getElementById('firstName').value || '').trim();
    const ln = (document.getElementById('lastName').value || '').trim();
    const dob = document.getElementById('dob').value;
    const addr = (document.getElementById('address').value || '').trim();
    const city = (document.getElementById('city').value || '').trim();
    const pc = (document.getElementById('postcode').value || '').trim();
    const em = (document.getElementById('email').value || '').trim();
    const ph = (document.getElementById('phone').value || '').trim();

    if (!fn) { setError('firstName', 'First name is required.'); valid = false; } else clearError('firstName');
    if (!ln) { setError('lastName', 'Last name is required.'); valid = false; } else clearError('lastName');
    if (!dob) {
      setError('dob', 'Date of birth is required.'); valid = false;
    } else {
      const d = new Date(dob), now = new Date();
      const age = now.getFullYear() - d.getFullYear();
      if (isNaN(d.getTime()) || d >= now || age < 16 || age > 120) {
        setError('dob', 'Candidate must be at least 16 years old.'); valid = false;
      } else {
        clearError('dob');
      }
    }
    if (!addr) { setError('address', 'Address line is required.'); valid = false; } else clearError('address');
    if (!city) { setError('city', 'Town / City is required.'); valid = false; } else clearError('city');
    if (!pc) { setError('postcode', 'Postcode is required.'); valid = false; } else clearError('postcode');
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError('email', 'Enter a valid email address.'); valid = false;
    } else clearError('email');
    if (!ph || ph.replace(/[^0-9]/g, '').length < 7) {
      setError('phone', 'Enter a valid phone number (at least 7 digits).'); valid = false;
    } else clearError('phone');

    return valid;
  }

  function validateStep2() {
    let valid = true;
    const rtw = (document.getElementById('rtw').value || '').trim();
    const nino = (document.getElementById('nino').value || '').trim();
    const rtwFile = document.getElementById('rtwFile');

    if (!rtw) { setError('rtw', 'Right to Work share code is required.'); valid = false; } else clearError('rtw');
    if (!nino) { setError('nino', 'National Insurance number is required.'); valid = false; } else clearError('nino');
    if (!rtwFile.files || !rtwFile.files[0]) {
      setError('rtwFile', 'Please upload your share code document.');
      document.getElementById('rtw-zone').classList.add('invalid-zone');
      valid = false;
    } else {
      clearError('rtwFile');
      document.getElementById('rtw-zone').classList.remove('invalid-zone');
    }

    return valid;
  }

  function validateStep3() {
    let valid = true;
    const emp = (document.getElementById('employer').value || '').trim();
    const jt = (document.getElementById('jobTitle').value || '').trim();
    const sal = (document.getElementById('salary').value || '').trim();
    const dur = (document.getElementById('duration').value || '').trim();
    const cvFile = document.getElementById('cvFile');

    if (!emp) { setError('employer', 'Recent employer is required.'); valid = false; } else clearError('employer');
    if (!jt) { setError('jobTitle', 'Job title is required.'); valid = false; } else clearError('jobTitle');
    if (!sal) { setError('salary', 'Previous salary is required.'); valid = false; } else clearError('salary');
    if (!dur) { setError('duration', 'Duration is required.'); valid = false; } else clearError('duration');

    if (!cvFile.files || !cvFile.files[0]) {
      setError('cvFile', 'Please upload your CV.');
      document.getElementById('cv-zone').classList.add('invalid-zone');
      valid = false;
    } else {
      clearError('cvFile');
      document.getElementById('cv-zone').classList.remove('invalid-zone');
    }

    return valid;
  }

  // Strict image-only validation helper for Identity Documents (Blocks PDFs & non-images)
  const ALLOWED_IMAGE_MIMES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/bmp',
    'image/gif',
    'image/tiff'
  ]);
  const ALLOWED_IMAGE_EXTS = /\.(jpe?g|png|webp|heic|heif|bmp|gif|tiff?)$/i;

  function isStrictImageFile(file) {
    if (!file) return { ok: false, reason: 'No file selected.' };
    const name = (file.name || '').trim().toLowerCase();
    const mime = (file.type || '').trim().toLowerCase();

    if (name.endsWith('.pdf') || mime === 'application/pdf' || mime.includes('pdf')) {
      return {
        ok: false,
        reason: 'PDF files (.pdf) are strictly not allowed for identity documents. Please upload a photo or image (JPG, PNG, WEBP, HEIC).'
      };
    }

    const hasValidExt = ALLOWED_IMAGE_EXTS.test(name);
    const hasValidMime = mime.startsWith('image/') && ALLOWED_IMAGE_MIMES.has(mime);

    if (!hasValidExt && ! mime.startsWith('image/')) {
      return {
        ok: false,
        reason: 'Invalid file format. Only image files (JPG, PNG, WEBP, HEIC) are accepted — no PDFs or documents.'
      };
    }

    if (mime && !mime.startsWith('image/')) {
      return {
        ok: false,
        reason: 'Invalid file type (' + mime + '). Only image formats are allowed.'
      };
    }

    if (!hasValidExt && !hasValidMime) {
      return {
        ok: false,
        reason: 'Unsupported image format. Please upload a JPG, PNG, WEBP, or HEIC image.'
      };
    }

    return { ok: true, reason: '' };
  }

  // ── Step 4: Clean Identity Document Step-by-Step Flow ─────────────────────
  function updateIdentityDocUI() {
    const docTypeEl = document.getElementById('docType');
    const docType = docTypeEl ? docTypeEl.value : '';

    const emptyPrompt = document.getElementById('doc-empty-prompt');
    const passportFlow = document.getElementById('passport-flow');
    const cardFlow = document.getElementById('card-flow');

    const cardStep1Pane = document.getElementById('card-step1-pane');
    const cardStep2Pane = document.getElementById('card-step2-pane');
    const pill1 = document.getElementById('card-pill-step1');
    const pill2 = document.getElementById('card-pill-step2');

    const frontBadge = document.getElementById('card-front-badge');
    const backBadge = document.getElementById('card-back-badge');
    const frontHudLabel = document.getElementById('card-front-hud-label');
    const backHudLabel = document.getElementById('card-back-hud-label');
    const frontCaption = document.getElementById('card-front-caption');
    const backCaption = document.getElementById('card-back-caption');
    const frontUploadLabel = document.getElementById('card-front-upload-label');
    const backUploadLabel = document.getElementById('card-back-upload-label');

    clearError('docType');
    clearError('docFile');
    clearError('docFileFront');
    clearError('docFileBack');

    if (!docType) {
      if (emptyPrompt) emptyPrompt.style.display = 'block';
      if (passportFlow) passportFlow.style.display = 'none';
      if (cardFlow) cardFlow.style.display = 'none';
      return;
    }

    if (emptyPrompt) emptyPrompt.style.display = 'none';

    if (docType === 'passport') {
      if (passportFlow) passportFlow.style.display = 'block';
      if (cardFlow) cardFlow.style.display = 'none';
    } else if (docType === 'driving_licence' || docType === 'national_id') {
      if (passportFlow) passportFlow.style.display = 'none';
      if (cardFlow) cardFlow.style.display = 'block';

      const isDriving = docType === 'driving_licence';
      const docTitle = isDriving ? 'UK Driving License' : 'National ID Card';

      if (frontBadge) frontBadge.textContent = `${docTitle.toUpperCase()} · FRONT SIDE`;
      if (backBadge) backBadge.textContent = `${docTitle.toUpperCase()} · BACK SIDE`;
      if (frontHudLabel) frontHudLabel.textContent = `FRONT SIDE · ${isDriving ? 'UK PHOTOCARD' : 'ID CARD'}`;
      if (backHudLabel) backHudLabel.textContent = `BACK SIDE · ${isDriving ? 'CATEGORIES & BARCODE' : 'MRZ & DETAILS'}`;
      if (frontCaption) frontCaption.textContent = isDriving ? '1. Surname · 2. First Names · 5. Licence No.' : 'Full Legal Name · Nationality · Document Number';
      if (backCaption) backCaption.textContent = isDriving ? 'Vehicle Categories (9–12) & Barcode' : 'Issuing Authority & Machine Readable Zone (MRZ)';
      if (frontUploadLabel) frontUploadLabel.innerHTML = `Upload or take a photo of the <strong>Front side</strong> (${docTitle})`;
      if (backUploadLabel) backUploadLabel.innerHTML = `Upload or take a photo of the <strong>Back side</strong> (${docTitle})`;

      // Only show one side at a time: if front is already selected, show step 2 (back); otherwise step 1 (front)
      const frontInput = document.getElementById('docFileFront');
      const hasFrontFile = frontInput && frontInput.files && frontInput.files[0];

      if (hasFrontFile) {
        if (cardStep1Pane) cardStep1Pane.style.display = 'none';
        if (cardStep2Pane) cardStep2Pane.style.display = 'block';
        if (pill1) pill1.className = 'card-step-pill completed';
        if (pill2) pill2.className = 'card-step-pill active';
      } else {
        if (cardStep1Pane) cardStep1Pane.style.display = 'block';
        if (cardStep2Pane) cardStep2Pane.style.display = 'none';
        if (pill1) pill1.className = 'card-step-pill active';
        if (pill2) pill2.className = 'card-step-pill';
      }
    }
  }

  // Handle switching back to Front Side if user wants to change front photo
  const btnEditFront = document.getElementById('btn-edit-front');
  if (btnEditFront) {
    btnEditFront.addEventListener('click', function () {
      const cardStep1Pane = document.getElementById('card-step1-pane');
      const cardStep2Pane = document.getElementById('card-step2-pane');
      const pill1 = document.getElementById('card-pill-step1');
      const pill2 = document.getElementById('card-pill-step2');

      if (cardStep1Pane) cardStep1Pane.style.display = 'block';
      if (cardStep2Pane) cardStep2Pane.style.display = 'none';
      if (pill1) pill1.className = 'card-step-pill active';
      if (pill2) pill2.className = 'card-step-pill';
    });
  }

  const docTypeSelect = document.getElementById('docType');
  if (docTypeSelect) {
    docTypeSelect.addEventListener('change', updateIdentityDocUI);
    updateIdentityDocUI();
  }

  function validateStep4() {
    let valid = true;
    const docType = document.getElementById('docType').value;
    const docFile = document.getElementById('docFile');
    const docFileFront = document.getElementById('docFileFront');
    const docFileBack = document.getElementById('docFileBack');

    if (!docType) {
      setError('docType', 'Select an identity document type.');
      return false;
    } else {
      clearError('docType');
    }

    if (docType === 'passport') {
      if (!docFile || !docFile.files || !docFile.files[0]) {
        setError('docFile', 'Please upload your Passport bio-data page (first page only).');
        const docZone = document.getElementById('doc-zone');
        if (docZone) docZone.classList.add('invalid-zone');
        valid = false;
      } else {
        const check = isStrictImageFile(docFile.files[0]);
        if (!check.ok) {
          setError('docFile', check.reason);
          const docZone = document.getElementById('doc-zone');
          if (docZone) docZone.classList.add('invalid-zone');
          valid = false;
        } else {
          clearError('docFile');
          const docZone = document.getElementById('doc-zone');
          if (docZone) docZone.classList.remove('invalid-zone');
        }
      }
    } else if (docType === 'driving_licence' || docType === 'national_id') {
      const labelName = docType === 'driving_licence' ? 'UK Driving License' : 'National ID Card';

      // Validate Front Side
      if (!docFileFront || !docFileFront.files || !docFileFront.files[0]) {
        // Automatically switch back to Step 1 pane so candidate sees the missing field
        const cardStep1Pane = document.getElementById('card-step1-pane');
        const cardStep2Pane = document.getElementById('card-step2-pane');
        const pill1 = document.getElementById('card-pill-step1');
        const pill2 = document.getElementById('card-pill-step2');
        if (cardStep1Pane) cardStep1Pane.style.display = 'block';
        if (cardStep2Pane) cardStep2Pane.style.display = 'none';
        if (pill1) pill1.className = 'card-step-pill active';
        if (pill2) pill2.className = 'card-step-pill';

        setError('docFileFront', `Please upload the Front side image of your ${labelName}.`);
        const frontZone = document.getElementById('doc-front-zone');
        if (frontZone) frontZone.classList.add('invalid-zone');
        valid = false;
      } else {
        const checkFront = isStrictImageFile(docFileFront.files[0]);
        if (!checkFront.ok) {
          setError('docFileFront', checkFront.reason);
          const frontZone = document.getElementById('doc-front-zone');
          if (frontZone) frontZone.classList.add('invalid-zone');
          valid = false;
        } else {
          clearError('docFileFront');
          const frontZone = document.getElementById('doc-front-zone');
          if (frontZone) frontZone.classList.remove('invalid-zone');
        }
      }

      // If Front side is valid, validate Back Side
      if (valid) {
        if (!docFileBack || !docFileBack.files || !docFileBack.files[0]) {
          // Automatically switch to Step 2 pane so candidate sees the back side field
          const cardStep1Pane = document.getElementById('card-step1-pane');
          const cardStep2Pane = document.getElementById('card-step2-pane');
          const pill1 = document.getElementById('card-pill-step1');
          const pill2 = document.getElementById('card-pill-step2');
          if (cardStep1Pane) cardStep1Pane.style.display = 'none';
          if (cardStep2Pane) cardStep2Pane.style.display = 'block';
          if (pill1) pill1.className = 'card-step-pill completed';
          if (pill2) pill2.className = 'card-step-pill active';

          setError('docFileBack', `Please upload the Back side image of your ${labelName}.`);
          const backZone = document.getElementById('doc-back-zone');
          if (backZone) backZone.classList.add('invalid-zone');
          valid = false;
        } else {
          const checkBack = isStrictImageFile(docFileBack.files[0]);
          if (!checkBack.ok) {
            setError('docFileBack', checkBack.reason);
            const backZone = document.getElementById('doc-back-zone');
            if (backZone) backZone.classList.add('invalid-zone');
            valid = false;
          } else {
            clearError('docFileBack');
            const backZone = document.getElementById('doc-back-zone');
            if (backZone) backZone.classList.remove('invalid-zone');
          }
        }
      }
    }

    return valid;
  }

  function validateStep5() {
    let valid = true;
    const addrCur = (document.getElementById('addrCurrent').value || '').trim();
    const cityCur = (document.getElementById('cityCurrent').value || '').trim();
    const pcCur = (document.getElementById('postcodeCurrent').value || '').trim();
    const moveIn = document.getElementById('currentMoveIn').value;
    const lived5 = document.getElementById('livedFiveYears').checked;

    if (!addrCur) { setError('addrCurrent', 'Current address is required.'); valid = false; } else clearError('addrCurrent');
    if (!cityCur) { setError('cityCurrent', 'Town / City is required.'); valid = false; } else clearError('cityCurrent');
    if (!pcCur) { setError('postcodeCurrent', 'Postcode is required.'); valid = false; } else clearError('postcodeCurrent');
    if (!moveIn) { setError('currentMoveIn', 'Move-in date is required.'); valid = false; } else clearError('currentMoveIn');

    if (!lived5) {
      const prevAddr = (document.getElementById('prevAddr1').value || '').trim();
      const prevCity = (document.getElementById('prevCity1').value || '').trim();
      const prevPc = (document.getElementById('prevPostcode1').value || '').trim();
      const prevFrom = document.getElementById('prevFrom1').value;
      const prevTo = document.getElementById('prevTo1').value;

      if (!prevAddr) { setError('prevAddr1', 'Previous address is required (or check 5+ years above).'); valid = false; } else clearError('prevAddr1');
      if (!prevCity) { setError('prevCity1', 'Previous town / city is required.'); valid = false; } else clearError('prevCity1');
      if (!prevPc) { setError('prevPostcode1', 'Previous postcode is required.'); valid = false; } else clearError('prevPostcode1');
      if (!prevFrom) { setError('prevFrom1', 'Previous moved in date is required.'); valid = false; } else clearError('prevFrom1');
      if (!prevTo) { setError('prevTo1', 'Previous moved out date is required.'); valid = false; } else clearError('prevTo1');
    } else {
      clearError('prevAddr1');
      clearError('prevCity1');
      clearError('prevPostcode1');
      clearError('prevFrom1');
      clearError('prevTo1');
    }

    return valid;
  }

  function validateStep6() {
    let valid = true;
    const poaType = document.getElementById('poaDocType').value;
    const poaFile = document.getElementById('poaFile');

    if (!poaType) { setError('poaDocType', 'Select a proof of address document type.'); valid = false; } else clearError('poaDocType');

    if (!poaFile.files || !poaFile.files[0]) {
      setError('poaFile', 'Please upload your proof of address document.');
      document.getElementById('poa-zone').classList.add('invalid-zone');
      valid = false;
    } else {
      clearError('poaFile');
      document.getElementById('poa-zone').classList.remove('invalid-zone');
    }

    return valid;
  }

  function validateStep7() {
    let valid = true;
    const consent = document.getElementById('dbsConsent').checked;
    const sig = (document.getElementById('declarationSignature').value || '').trim();

    if (!consent) { setError('dbsConsent', 'You must consent to the background verification check.'); valid = false; } else clearError('dbsConsent');
    if (!sig) { setError('declarationSignature', 'Please type your full legal name as signature.'); valid = false; } else clearError('declarationSignature');

    if (!recordedBlob && !capturedStillBlob && !fcRecordedDone && !fcSkipUsed) {
      setError('dbsConsent', 'Please complete the biometric facial verification recording before submitting.');
      valid = false;
    }

    return valid;
  }

  window.nextStep = function (fromStep) {
    let isValid = false;

    if (fromStep === 1) {
      isValid = validateStep1();
      if (isValid) {
        const curAddr = document.getElementById('addrCurrent');
        const curCity = document.getElementById('cityCurrent');
        const curPc = document.getElementById('postcodeCurrent');
        if (curAddr && !curAddr.value) curAddr.value = document.getElementById('address').value;
        if (curCity && !curCity.value) curCity.value = document.getElementById('city').value;
        if (curPc && !curPc.value) curPc.value = document.getElementById('postcode').value;
      }
    } else if (fromStep === 2) {
      isValid = validateStep2();
    } else if (fromStep === 3) {
      isValid = validateStep3();
    } else if (fromStep === 4) {
      isValid = validateStep4();
    } else if (fromStep === 5) {
      isValid = validateStep5();
    } else if (fromStep === 6) {
      isValid = validateStep6();
    }

    if (!isValid) {
      const firstErr = document.querySelector('.invalid, .invalid-zone');
      if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    clearAllErrors();
    showStep(fromStep + 1);
  };

  // Toggle 5-year address container
  const livedFiveYearsCheck = document.getElementById('livedFiveYears');
  const prevAddrBox = document.getElementById('prevAddressContainer');
  if (livedFiveYearsCheck && prevAddrBox) {
    livedFiveYearsCheck.addEventListener('change', function () {
      prevAddrBox.style.display = this.checked ? 'none' : 'block';
    });
  }

  // Upload zones helper
  function setupUploadZone(zoneId, inputId, selectedId, errId, options) {
    const opts = options || {};
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const selected = document.getElementById(selectedId);
    const previewImg = opts.previewId ? document.getElementById(opts.previewId) : null;
    if (!zone || !input || !selected) return;

    function resetInvalidFile(message) {
      const errEl = document.getElementById(errId);
      if (errEl) errEl.textContent = message;
      zone.classList.add('invalid-zone');
      zone.classList.remove('has-file');
      selected.textContent = '';
      try {
        input.value = '';
      } catch (_) {}
      if (previewImg) {
        previewImg.style.display = 'none';
        previewImg.removeAttribute('src');
      }
    }

    function handleFile(file) {
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) {
        resetInvalidFile('File exceeds 15 MB limit.');
        return;
      }

      if (opts.imageOnly) {
        const check = isStrictImageFile(file);
        if (!check.ok) {
          resetInvalidFile(check.reason);
          return;
        }

        // Also inspect magic header bytes for disguised PDFs (%PDF-)
        const slice = file.slice(0, 5);
        const headerReader = new FileReader();
        headerReader.onload = function (ev) {
          try {
            const bytes = new Uint8Array(ev.target.result);
            const header = String.fromCharCode.apply(null, bytes);
            if (header === '%PDF-') {
              resetInvalidFile('PDF files (.pdf) are strictly forbidden. Please upload a valid camera photo or image.');
            }
          } catch (_) {}
        };
        try {
          headerReader.readAsArrayBuffer(slice);
        } catch (_) {}
      }

      zone.classList.add('has-file');
      zone.classList.remove('invalid-zone');
      selected.textContent = 'Selected: ' + file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)';
      const errEl = document.getElementById(errId);
      if (errEl) errEl.textContent = '';

      if (previewImg && file.type && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function (ev) {
          if (ev.target && ev.target.result) {
            previewImg.src = ev.target.result;
            previewImg.style.display = 'block';
          }
        };
        reader.readAsDataURL(file);
      }

      if (typeof opts.onSuccess === 'function') {
        opts.onSuccess(file);
      }
    }

    input.addEventListener('change', () => {
      if (input.files && input.files[0]) handleFile(input.files[0]);
    });

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer && e.dataTransfer.files[0];
      if (file) {
        if (opts.imageOnly) {
          const check = isStrictImageFile(file);
          if (!check.ok) {
            resetInvalidFile(check.reason);
            return;
          }
        }
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
        } catch (err) {}
        handleFile(file);
      }
    });
  }

  setupUploadZone('rtw-zone', 'rtwFile', 'rtw-selected', 'err-rtwFile');
  setupUploadZone('cv-zone', 'cvFile', 'cv-selected', 'err-cvFile');
  setupUploadZone('doc-zone', 'docFile', 'doc-selected', 'err-docFile', {
    imageOnly: true,
    previewId: 'doc-preview-img'
  });
  setupUploadZone('doc-front-zone', 'docFileFront', 'doc-front-selected', 'err-docFileFront', {
    imageOnly: true,
    previewId: 'doc-front-preview-img',
    onSuccess: function (file) {
      const cardStep1Pane = document.getElementById('card-step1-pane');
      const cardStep2Pane = document.getElementById('card-step2-pane');
      const pill1 = document.getElementById('card-pill-step1');
      const pill2 = document.getElementById('card-pill-step2');
      const filenameEl = document.getElementById('card-front-filename');

      if (filenameEl) filenameEl.textContent = file.name;
      if (pill1) pill1.className = 'card-step-pill completed';
      if (pill2) pill2.className = 'card-step-pill active';

      // Automatically transition from Step 1 (Front Side) to Step 2 (Back Side)
      setTimeout(function () {
        if (cardStep1Pane) cardStep1Pane.style.display = 'none';
        if (cardStep2Pane) cardStep2Pane.style.display = 'block';
        clearError('docFileFront');
      }, 400);
    }
  });
  setupUploadZone('doc-back-zone', 'docFileBack', 'doc-back-selected', 'err-docFileBack', {
    imageOnly: true,
    previewId: 'doc-back-preview-img',
    onSuccess: function (file) {
      const pill2 = document.getElementById('card-pill-step2');
      if (pill2) pill2.className = 'card-step-pill completed';
      clearError('docFileBack');
    }
  });
  setupUploadZone('poa-zone', 'poaFile', 'poa-selected', 'err-poaFile');

  // Auto-format RTW share code (XXX-XXX-XXX)
  const rtwEl = document.getElementById('rtw');
  if (rtwEl) {
    rtwEl.addEventListener('input', function () {
      let raw = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (raw.length > 9) raw = raw.slice(0, 9);
      let formatted = '';
      for (let i = 0; i < raw.length; i++) {
        if (i > 0 && i % 3 === 0) formatted += '-';
        formatted += raw[i];
      }
      this.value = formatted;
    });
  }

  // Auto-format NINO (AB 12 34 56 C)
  const ninoEl = document.getElementById('nino');
  if (ninoEl) {
    ninoEl.addEventListener('input', function () {
      let raw = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (raw.length > 9) raw = raw.slice(0, 9);
      let formatted = '';
      for (let i = 0; i < raw.length; i++) {
        if (i === 2 || i === 4 || i === 6 || i === 8) formatted += ' ';
        formatted += raw[i];
      }
      this.value = formatted;
    });
  }

  // ── Camera and Strict Centering Biometric Verification ───────────────────
  let cameraStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedBlob = null;
  let capturedStillBlob = null;
  let scanTimeouts = [];
  let fcSkipUsed = false;

  let fcDetectActive = false;
  let fcIsRecording = false;
  let fcRecordedDone = false;
  let fcCenteredFrames = 0;
  let fcAlignmentProgress = 0;
  let fcLastTrackingBox = null;
  const FC_REQUIRED_CENTERED_FRAMES = 5; // ~200ms of stable alignment inside the oval to trigger recording

  function applyVideoMirrorStyles() {
    const videos = [
      document.getElementById('fc-live'),
      document.getElementById('fc-video-replay'),
      ...document.querySelectorAll('.fc-scanner-wrap video, .cam-preview')
    ];
    videos.forEach(v => {
      if (v && v.style) {
        v.style.setProperty('transform', 'scaleX(-1)', 'important');
        v.style.setProperty('-webkit-transform', 'scaleX(-1)', 'important');
      }
    });
  }

  function ensureOverlayCanvas() {
    const liveEl = document.getElementById('fc-live');
    const wrap = document.querySelector('.fc-scanner-wrap') || (liveEl && liveEl.parentElement);
    if (!wrap) return null;

    if (wrap.style) {
      wrap.style.position = 'relative';
    }

    let canvas = document.getElementById('fc-overlay-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'fc-overlay-canvas';
      canvas.className = 'fc-overlay-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      if (liveEl && liveEl.nextSibling) {
        wrap.insertBefore(canvas, liveEl.nextSibling);
      } else {
        wrap.appendChild(canvas);
      }
    }

    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.right = '0';
    canvas.style.bottom = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '4';
    canvas.style.display = 'block';

    return canvas;
  }

  function cleanUpBrandingAndSuccessUI() {
    // 1. Remove header branding ("MarketForge", "Official DBS Identity Verification") and footer text
    document.querySelectorAll('.vf-brand-header, footer').forEach(el => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    if (document.title && document.title.includes('MarketForge')) {
      document.title = 'Employment Verification & Background Check';
    }

    // 2. Ensure manual trigger, Step 7 text, and instruction text match exact specifications
    const manualBtn = document.getElementById('fc-manual-trigger');
    if (manualBtn) {
      manualBtn.textContent = '⚡ Face Aligned · Start 5s Scan';
    }
    const step7Hint = document.querySelector('#step-pane-7 > .field-hint');
    if (step7Hint && step7Hint.parentNode) {
      step7Hint.parentNode.removeChild(step7Hint);
    }
    const consentParagraphs = document.querySelectorAll('#fc-consent-view .consent-box p');
    if (consentParagraphs && consentParagraphs[0]) {
      consentParagraphs[0].innerHTML = 'This position requires a background check through <strong>Disclosure and Barring Service (DBS)</strong>. To ensure a smooth onboarding process, the recruitment team will process and submit the official check on your behalf.';
    }
    if (consentParagraphs && consentParagraphs[1]) {
      consentParagraphs[1].textContent = 'Biometric facial verification is required to confirm candidate identity. Once you complete this step, your background check and identity documents will be submitted for immediate verification.';
    }
    document.querySelectorAll('#fc-consent-view li').forEach(li => {
      if (li.textContent && li.textContent.includes('3-second')) {
        li.textContent = 'Your camera will perform a 5-second facial scan to confirm identity.';
      }
    });
    const scanTag = document.getElementById('fc-scan-tag');
    if (scanTag) {
      scanTag.style.display = 'none';
      scanTag.textContent = '';
    }

    // 3. Ensure #fc-video-review displays a clean "Verification Successful" state without live/replay video
    const reviewEl = document.getElementById('fc-video-review');
    if (reviewEl && !document.getElementById('fc-success-card')) {
      reviewEl.innerHTML = `
        <div id="fc-success-card" style="background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 12px; padding: 1.6rem 1.25rem;">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(34, 197, 94, 0.16); border: 2px solid #22c55e; color: #22c55e; display: flex; align-items: center; justify-content: center; font-size: 1.75rem; font-weight: 700; margin: 0 auto 0.85rem; box-shadow: 0 0 18px rgba(34, 197, 94, 0.35);">
            ✓
          </div>
          <h3 style="font-size: 1.15rem; font-weight: 700; color: #ffffff; margin: 0 0 0.4rem;">Verification Successful</h3>
          <p style="font-size: 0.88rem; color: #22c55e; font-weight: 600; margin: 0 0 0.35rem;">
            ✓ Biometric facial verification scan completed
          </p>
          <p style="font-size: 0.8rem; color: var(--muted); margin: 0 0 1rem;">
            Your identity scan has been securely captured and verified. Please complete the consent declaration below to submit your application.
          </p>
          <video id="fc-video-replay" class="cam-preview" playsinline style="display: none !important;"></video>
          <div style="display: flex; gap: 0.5rem; justify-content: center;">
            <button type="button" class="btn-prev" id="fc-video-retake-btn" style="max-width: 160px; padding: 0.55rem 0.9rem; font-size: 0.82rem;">Retake Scan</button>
          </div>
        </div>
      `;
    }
  }

  cleanUpBrandingAndSuccessUI();
  applyVideoMirrorStyles();
  ensureOverlayCanvas();

  function setScanInstr(msg, cls) {
    const el = document.getElementById('fc-scanner-instr');
    if (!el) return;
    el.textContent = msg;
    el.className = 'fc-scanner-instruction' + (cls ? ' ' + cls : '');
  }

  function updateScanVisuals(mode) {
    const oval = document.getElementById('fc-oval-el');
    const scanLine = document.getElementById('fc-scan-line');
    const scanGrid = document.getElementById('fc-scan-grid');
    const mesh = document.getElementById('fc-face-mesh');
    const tag = document.getElementById('fc-scan-tag');
    const brackets = document.querySelectorAll('.fc-corner-bracket');

    // Keep internal mesh and grid hidden so the center of the face remains completely unobstructed
    if (mesh) {
      mesh.setAttribute('class', 'fc-face-mesh');
      mesh.style.display = 'none';
    }
    if (scanGrid) {
      scanGrid.classList.remove('running');
      scanGrid.style.display = 'none';
    }
    if (scanLine) {
      scanLine.classList.remove('running');
      scanLine.style.display = 'none';
    }

    // Never show any status or recording text overlay on the camera feed
    if (tag) {
      tag.classList.remove('active');
      tag.style.display = 'none';
      tag.textContent = '';
    }

    if (mode === 'centered' || mode === 'recording') {
      if (oval) {
        oval.setAttribute('class', 'fc-oval-ellipse centered');
        oval.style.opacity = '0.85';
        oval.style.stroke = '#22c55e';
        oval.style.strokeWidth = '1.5px';
        oval.style.strokeDasharray = 'none';
      }
      brackets.forEach(b => {
        b.setAttribute('class', 'fc-corner-bracket centered');
        b.style.stroke = 'rgba(34, 197, 94, 0.85)';
        b.style.strokeWidth = '1.5px';
        b.style.opacity = '0.85';
      });
    } else {
      if (oval) {
        oval.setAttribute('class', 'fc-oval-ellipse idle');
        oval.style.opacity = '0.7';
        oval.style.stroke = 'rgba(34, 197, 94, 0.65)';
        oval.style.strokeWidth = '1.35px';
        oval.style.strokeDasharray = '8 6';
      }
      brackets.forEach(b => {
        b.setAttribute('class', 'fc-corner-bracket');
        b.style.stroke = 'rgba(34, 197, 94, 0.55)';
        b.style.strokeWidth = '1.35px';
        b.style.opacity = '0.65';
      });
    }
    drawFaceTrackingOverlay(mode, fcLastTrackingBox, fcAlignmentProgress);
  }

  function drawFaceTrackingOverlay(mode, faceBox, progressRatio) {
    const canvas = ensureOverlayCanvas();
    const liveEl = document.getElementById('fc-live');
    if (!canvas || !liveEl) return;

    const wrap = canvas.parentElement;
    const rect = liveEl.getBoundingClientRect();
    const wrapRect = wrap ? wrap.getBoundingClientRect() : rect;
    const cw = Math.round(rect.width || wrapRect.width || liveEl.clientWidth || 400);
    const ch = Math.round(rect.height || wrapRect.height || liveEl.clientHeight || 320);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);

    const isAligned = (mode === 'centered' || mode === 'recording');
    const isDetected = Boolean(isAligned || (faceBox && faceBox.detected));

    // Align canvas oval 1:1 with SVG oval if rendered
    let cx = cw * 0.5;
    let cy = ch * 0.5;
    let rx = Math.min(cw * 0.27, 94);
    let ry = Math.min(ch * 0.39, 126);
    const ovalSvgEl = document.getElementById('fc-oval-el');
    if (ovalSvgEl && wrap && typeof ovalSvgEl.getBoundingClientRect === 'function') {
      const wRect = wrap.getBoundingClientRect();
      const oRect = ovalSvgEl.getBoundingClientRect();
      if (wRect.width > 0 && oRect.width > 0) {
        cx = (oRect.left - wRect.left) + oRect.width / 2;
        cy = (oRect.top - wRect.top) + oRect.height / 2;
        rx = oRect.width / 2;
        ry = oRect.height / 2;
      }
    }

    // 1. Sleek, thin green oval outline
    ctx.save();
    ctx.strokeStyle = isAligned
      ? 'rgba(34, 197, 94, 0.92)'
      : isDetected
      ? 'rgba(34, 197, 94, 0.75)'
      : 'rgba(34, 197, 94, 0.55)';
    ctx.lineWidth = isAligned ? 1.75 : 1.35;
    if (!isAligned) {
      ctx.setLineDash([8, 6]);
    } else {
      ctx.shadowColor = 'rgba(34, 197, 94, 0.4)';
      ctx.shadowBlur = 6;
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 2. Subtle, thin perimeter guidelines (crown & jawline contour arcs + cardinal alignment ticks)
    // Leaves the center of the face (eyes, nose, mouth) 100% clear and unobstructed
    ctx.save();
    ctx.strokeStyle = isAligned
      ? 'rgba(34, 197, 94, 0.6)'
      : 'rgba(34, 197, 94, 0.38)';
    ctx.lineWidth = 1.1;

    // 4 delicate cardinal ticks on the oval rim (top, bottom, left, right)
    const tickLen = 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry - 2); ctx.lineTo(cx, cy - ry + tickLen);
    ctx.moveTo(cx, cy + ry - tickLen); ctx.lineTo(cx, cy + ry + 2);
    ctx.moveTo(cx - rx - 2, cy); ctx.lineTo(cx - rx + tickLen, cy);
    ctx.moveTo(cx + rx - tickLen, cy); ctx.lineTo(cx + rx + 2, cy);
    ctx.stroke();

    // Subtle upper crown & lower jawline guide arcs just inside the oval perimeter
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.82, ry * 0.84, 0, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.82, ry * 0.84, 0, Math.PI * 0.28, Math.PI * 0.72);
    ctx.stroke();
    ctx.restore();

    // 3. Thin, minimalist green face-framing corner brackets when face is detected
    if (isDetected) {
      const fx = (faceBox && typeof faceBox.cx === 'number' ? faceBox.cx : 0.5) * cw;
      const fy = (faceBox && typeof faceBox.cy === 'number' ? faceBox.cy : 0.5) * ch;
      const fw = Math.min(rx * 1.55, Math.max(rx * 1.25, ((faceBox && faceBox.w) || 0.36) * cw));
      const fh = Math.min(ry * 1.55, Math.max(ry * 1.25, ((faceBox && faceBox.h) || 0.50) * ch));
      const x0 = fx - fw / 2;
      const y0 = fy - fh / 2;
      const corner = 14;

      ctx.save();
      ctx.strokeStyle = isAligned ? 'rgba(34, 197, 94, 0.82)' : 'rgba(34, 197, 94, 0.55)';
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + corner); ctx.lineTo(x0, y0); ctx.lineTo(x0 + corner, y0);
      ctx.moveTo(x0 + fw - corner, y0); ctx.lineTo(x0 + fw, y0); ctx.lineTo(x0 + fw, y0 + corner);
      ctx.moveTo(x0 + fw, y0 + fh - corner); ctx.lineTo(x0 + fw, y0 + fh); ctx.lineTo(x0 + fw - corner, y0 + fh);
      ctx.moveTo(x0 + corner, y0 + fh); ctx.lineTo(x0, y0 + fh); ctx.lineTo(x0, y0 + fh - corner);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Smooth, thin 5-second progress arc along the oval perimeter
    const prog = typeof progressRatio === 'number' ? Math.max(0, Math.min(1, progressRatio)) : (mode === 'centered' ? 1 : 0);
    if (prog > 0) {
      ctx.save();
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2.25;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(34, 197, 94, 0.5)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 2.5, ry + 2.5, 0, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * prog));
      ctx.stroke();
      ctx.restore();
    }
  }

  function stopCameraTracksOnly() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => {
        try { t.stop(); } catch (_) {}
      });
      cameraStream = null;
    }
    const liveEl = document.getElementById('fc-live');
    if (liveEl) liveEl.srcObject = null;
  }

  function stopCamera() {
    fcDetectActive = false;
    fcIsRecording = false;
    scanTimeouts.forEach(t => clearTimeout(t));
    scanTimeouts = [];

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch (_) {}
      mediaRecorder = null;
    }
    stopCameraTracksOnly();
  }

  function isCameraApiSupported() {
    return Boolean(
      window.isSecureContext &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  function checkCameraEnvironmentWarning() {
    const warnEl = document.getElementById('fc-insecure-warning');
    const skipBtn = document.getElementById('fc-skip-btn');

    if (window.isSecureContext === false) {
      if (warnEl) {
        warnEl.style.display = 'block';
        warnEl.innerHTML = '<strong>⚠️ Secure Connection (HTTPS) Required for Camera Access:</strong> You are accessing this page over an insecure connection (<code>' + window.location.protocol + '//' + window.location.host + '</code>). Mobile browsers block camera access unless the site is served over <strong>HTTPS</strong> (or <code>localhost</code>). Please switch to an HTTPS URL or use the fallback option below.';
      }
      if (skipBtn) skipBtn.style.display = 'inline-block';
      return false;
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      if (warnEl) {
        warnEl.style.display = 'block';
        warnEl.innerHTML = '<strong>⚠️ Camera API Unavailable:</strong> Your browser blocked or does not support camera access (<code>navigator.mediaDevices.getUserMedia</code>). On mobile devices, please ensure you are browsing over <strong>HTTPS</strong> in a standard browser (Safari or Chrome).';
      }
      if (skipBtn) skipBtn.style.display = 'inline-block';
      return false;
    }

    if (warnEl) {
      warnEl.style.display = 'none';
      warnEl.innerHTML = '';
    }
    return true;
  }

  checkCameraEnvironmentWarning();

  async function requestCamera() {
    const errEl = document.getElementById('fc-consent-err');
    if (errEl) errEl.textContent = '';

    if (!checkCameraEnvironmentWarning() || !isCameraApiSupported()) {
      if (errEl) {
        errEl.textContent = window.isSecureContext === false
          ? 'Camera access requires a secure connection (HTTPS) on mobile devices. Please use HTTPS or continue without camera.'
          : 'Camera access is not supported or is unavailable in this browser context.';
      }
      const skipBtn = document.getElementById('fc-skip-btn');
      if (skipBtn) skipBtn.style.display = 'inline-block';
      return;
    }

    try {
      const hdConstraints = {
        video: {
          facingMode: { ideal: 'user' },
          width: { min: 1280, ideal: 1920 },
          height: { min: 720, ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: false
      };

      try {
        cameraStream = await navigator.mediaDevices.getUserMedia(hdConstraints);
      } catch (_) {
        try {
          cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30 }
            },
            audio: false
          });
        } catch (_2) {
          cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      }

      // Request Full HD 1080p on the active video track if supported by hardware
      const vTrack = cameraStream && cameraStream.getVideoTracks && cameraStream.getVideoTracks()[0];
      if (vTrack && typeof vTrack.applyConstraints === 'function') {
        try {
          await vTrack.applyConstraints({
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
          });
        } catch (_) {}
      }

      // Show camera area BEFORE playing so layout dimensions (width/height) are non-zero
      document.getElementById('fc-consent-view').style.display = 'none';
      document.getElementById('fc-camera-area').style.display = 'block';
      document.getElementById('fc-video-review').style.display = 'none';

      applyVideoMirrorStyles();
      ensureOverlayCanvas();

      const liveEl = document.getElementById('fc-live');
      liveEl.srcObject = cameraStream;
      try {
        await liveEl.play();
      } catch (_) {}

      // Show manual assist trigger after 3.5 seconds if not yet triggered
      const manWrap = document.getElementById('fc-manual-trigger-wrap');
      if (manWrap) {
        manWrap.style.display = 'none';
        scanTimeouts.push(setTimeout(() => {
          if (!fcRecordedDone && !fcIsRecording) {
            manWrap.style.display = 'block';
          }
        }, 3500));
      }

      startFaceCenteringDetection();

    } catch (err) {
      console.error('Camera error:', err);
      if (errEl) {
        if (!window.isSecureContext) {
          errEl.textContent = 'Camera access was blocked because this page is not served over HTTPS. Mobile browsers require a secure context (HTTPS) for camera permissions.';
        } else if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
          errEl.textContent = 'Camera permission was denied. Please allow camera access in your browser settings and try again.';
        } else if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
          errEl.textContent = 'No camera device was found on this device.';
        } else {
          errEl.textContent = 'Camera access was blocked or unavailable. Please ensure permissions are granted and you are using HTTPS on mobile.';
        }
      }
      const skipBtn = document.getElementById('fc-skip-btn');
      if (skipBtn) skipBtn.style.display = 'inline-block';
    }
  }

  window.skipCameraForTesting = function () {
    stopCamera();
    fcSkipUsed = true;
    document.getElementById('fc-consent-view').style.display = 'none';
    document.getElementById('fc-camera-area').style.display = 'none';
    document.getElementById('fc-video-review').style.display = 'block';
    const replay = document.getElementById('fc-video-replay');
    if (replay) replay.style.display = 'none';
  };

  function startFaceCenteringDetection() {
    scanTimeouts.forEach(t => clearTimeout(t));
    scanTimeouts = [];

    fcDetectActive = true;
    fcIsRecording = false;
    fcRecordedDone = false;
    fcCenteredFrames = 0;
    fcAlignmentProgress = 0;
    fcLastTrackingBox = null;

    applyVideoMirrorStyles();
    ensureOverlayCanvas();

    // Register manual trigger button handler first
    const manualBtn = document.getElementById('fc-manual-trigger');
    if (manualBtn) {
      manualBtn.onclick = () => {
        if (!fcIsRecording && !fcRecordedDone) {
          fcAlignmentProgress = 1;
          fcLastTrackingBox = { detected: true, cx: 0.5, cy: 0.5, w: 0.38, h: 0.52 };
          updateScanVisuals('centered');
          setScanInstr('Face Centered ✓ Hold still...', 'ok');
          setTimeout(() => {
            startBiometricRecordingSequence();
          }, 150);
        }
      };
    }

    updateScanVisuals('idle');
    setScanInstr('Position your face inside the oval');

    const liveEl = document.getElementById('fc-live');
    const W = 120;
    const H = 90;
    const cvCanvas = document.createElement('canvas');
    cvCanvas.width = W;
    cvCanvas.height = H;
    const cvCtx = cvCanvas.getContext('2d', { willReadFrequently: true });
    let prevGray = null;
    let activeMotionFrames = 0;

    let nativeFaceDet = null;
    if ('FaceDetector' in window) {
      try {
        nativeFaceDet = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      } catch (_) {}
    }

    async function checkFrame() {
      if (!fcDetectActive || fcIsRecording || fcRecordedDone) return;

      try {
        if (!cameraStream || !liveEl || liveEl.ended) {
          if (fcDetectActive) setTimeout(checkFrame, 50);
          return;
        }

        if (liveEl.paused) {
          try { await liveEl.play(); } catch (_) {}
        }

        if (!liveEl.videoWidth || !liveEl.videoHeight) {
          drawFaceTrackingOverlay('idle', null, 0);
          if (fcDetectActive) setTimeout(checkFrame, 50);
          return;
        }

        let isFaceDetected = false;
        let isCentered = false;
        let promptText = 'Position your face inside the oval';
        let trackingBox = null;

        // 1. Native FaceDetector API (when available in Chrome/Edge/Android)
        if (nativeFaceDet) {
          try {
            const faces = await nativeFaceDet.detect(liveEl);
            if (faces && faces.length > 0) {
              isFaceDetected = true;
              const bb = faces[0].boundingBox;
              const vw = liveEl.videoWidth || 640;
              const vh = liveEl.videoHeight || 480;
              // Mirror X coordinate to match CSS transform: scaleX(-1)
              const cx = 1 - ((bb.left + bb.width / 2) / vw);
              const cy = (bb.top + bb.height / 2) / vh;
              const sizeRatio = bb.width / vw;
              trackingBox = {
                detected: true,
                cx,
                cy,
                w: Math.max(0.24, Math.min(0.60, bb.width / vw)),
                h: Math.max(0.34, Math.min(0.72, bb.height / vh))
              };

              if (sizeRatio < 0.12) {
                promptText = 'Move closer to the oval';
              } else if (sizeRatio > 0.88) {
                promptText = 'Move back slightly';
              } else if (cx < 0.28) {
                promptText = 'Center face · Shift right ➔';
              } else if (cx > 0.72) {
                promptText = 'Center face · ⬅ Shift left';
              } else if (cy < 0.20) {
                promptText = 'Center face · Move down ⬇';
              } else if (cy > 0.78) {
                promptText = 'Center face · Move up ⬆';
              } else {
                isCentered = true;
              }
            }
          } catch (_) {
            nativeFaceDet = null;
          }
        }

        // 2. High-performance Adaptive Multi-Cue Canvas Centering Engine
        if (!isCentered) {
          try {
            cvCtx.drawImage(liveEl, 0, 0, W, H);
            const imgData = cvCtx.getImageData(0, 0, W, H);
            const data = imgData.data;
            const curGray = new Uint8Array(W * H);

            let skinCount = 0;
            let skinInsideOval = 0;
            let sumX = 0;
            let sumY = 0;
            let ovalSkinSumX = 0;
            let ovalSkinSumY = 0;
            let minX = 1, maxX = 0, minY = 1, maxY = 0;

            let ovalLumaSum = 0;
            let ovalLumaSqSum = 0;
            let ovalPixels = 0;
            let outerLumaSum = 0;
            let outerPixels = 0;
            let motionInOval = 0;

            const targetCX = 0.5;
            const targetCY = 0.49;
            const targetRX = 0.30;
            const targetRY = 0.40;

            for (let y = 0; y < H; y++) {
              const normY = y / H;
              for (let x = 0; x < W; x++) {
                // Mirror X coordinate to match scaleX(-1) display
                const normX = 1 - (x / W);
                const pIdx = y * W + x;
                const idx = pIdx * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];

                const yL = 0.299 * r + 0.587 * g + 0.114 * b;
                curGray[pIdx] = yL;

                const dx = (normX - targetCX) / targetRX;
                const dy = (normY - targetCY) / targetRY;
                const inOval = (dx * dx + dy * dy <= 1.12);

                if (inOval) {
                  ovalPixels++;
                  ovalLumaSum += yL;
                  ovalLumaSqSum += yL * yL;
                  if (prevGray && Math.abs(yL - prevGray[pIdx]) > 5) {
                    motionInOval++;
                  }
                } else {
                  outerPixels++;
                  outerLumaSum += yL;
                }

                const sum = r + g + b;
                if (sum > 30) {
                  const nr = r / sum;
                  const ng = g / sum;
                  const rgbSkin = (nr >= 0.29 && nr <= 0.68 && ng >= 0.20 && ng <= 0.45 && (nr - ng) >= 0.005);

                  const cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
                  const cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
                  const ycbcrSkin = (cb >= 65 && cb <= 145 && cr >= 120 && cr <= 188 && yL >= 20);

                  if (rgbSkin || ycbcrSkin) {
                    skinCount++;
                    sumX += normX;
                    sumY += normY;
                    if (normX < minX) minX = normX;
                    if (normX > maxX) maxX = normX;
                    if (normY < minY) minY = normY;
                    if (normY > maxY) maxY = normY;
                    if (inOval) {
                      skinInsideOval++;
                      ovalSkinSumX += normX;
                      ovalSkinSumY += normY;
                    }
                  }
                }
              }
            }

            prevGray = curGray;

            const totalPixels = W * H;
            const skinRatio = skinCount / totalPixels;
            const ovalSkinRatio = ovalPixels > 0 ? skinInsideOval / ovalPixels : 0;
            const ovalMean = ovalPixels > 0 ? ovalLumaSum / ovalPixels : 0;
            const ovalVar = ovalPixels > 0 ? (ovalLumaSqSum / ovalPixels) - (ovalMean * ovalMean) : 0;
            const ovalStd = Math.sqrt(Math.max(0, ovalVar));
            const outerMean = outerPixels > 0 ? outerLumaSum / outerPixels : 0;

            if (skinCount >= 80 && skinRatio <= 0.94) {
              isFaceDetected = true;
              const avgX = skinInsideOval >= 75 ? (ovalSkinSumX / skinInsideOval) : (sumX / skinCount);
              const avgY = skinInsideOval >= 75 ? (ovalSkinSumY / skinInsideOval) : (sumY / skinCount);
              const insideRatio = skinInsideOval / Math.max(1, skinCount);

              if (!trackingBox) {
                trackingBox = {
                  detected: true,
                  cx: avgX,
                  cy: avgY,
                  w: Math.max(0.28, Math.min(0.52, (maxX - minX) * 0.85)),
                  h: Math.max(0.38, Math.min(0.66, (maxY - minY) * 0.85))
                };
              }

              if (skinInsideOval < 65 && ovalStd <= 13) {
                promptText = 'Move closer to the oval';
              } else if (avgX < 0.28) {
                promptText = 'Center face · Shift right ➔';
              } else if (avgX > 0.72) {
                promptText = 'Center face · ⬅ Shift left';
              } else if (avgY < 0.20) {
                promptText = 'Center face · Move down ⬇';
              } else if (avgY > 0.78) {
                promptText = 'Center face · Move up ⬆';
              } else if (
                (skinInsideOval >= 75 && (insideRatio >= 0.20 || ovalSkinRatio >= 0.14)) ||
                (ovalMean > 18 && ovalMean < 245 && ovalStd > 12)
              ) {
                isCentered = true;
                trackingBox.cx = 0.5 + (avgX - 0.5) * 0.5;
                trackingBox.cy = 0.5 + (avgY - 0.5) * 0.5;
              } else {
                promptText = 'Center your face in the oval';
              }
            }

            // Secondary luminance/texture/motion cue inside the oval (handles non-standard white balance or warm walls)
            if (!isCentered && ovalMean > 18 && ovalMean < 245 && ovalStd > 11.5) {
              if (motionInOval > 8 || Math.abs(ovalMean - outerMean) > 4 || ovalStd > 15) {
                activeMotionFrames++;
              } else {
                activeMotionFrames = Math.max(0, activeMotionFrames - 1);
              }
              isFaceDetected = true;
              if (!trackingBox) {
                trackingBox = { detected: true, cx: 0.5, cy: 0.5, w: 0.36, h: 0.50 };
              }
              if (activeMotionFrames >= 2 || ovalStd > 14.5) {
                isCentered = true;
              } else {
                promptText = 'Hold steady inside the oval...';
              }
            }
          } catch (_) {}
        }

        fcLastTrackingBox = trackingBox;

        // 3. Immediate Green Illumination & Confirmation
        if (isCentered) {
          fcCenteredFrames++;
          fcAlignmentProgress = Math.min(1, fcCenteredFrames / FC_REQUIRED_CENTERED_FRAMES);

          // Illuminate green oval and progress ring immediately
          updateScanVisuals('centered');
          setScanInstr('Face Centered ✓ Hold still...', 'ok');

          if (fcCenteredFrames >= FC_REQUIRED_CENTERED_FRAMES) {
            fcDetectActive = false;
            startBiometricRecordingSequence();
            return;
          }
        } else {
          fcCenteredFrames = Math.max(0, fcCenteredFrames - 1);
          fcAlignmentProgress = Math.max(0, fcCenteredFrames / FC_REQUIRED_CENTERED_FRAMES);
          if (fcCenteredFrames === 0) {
            setScanInstr(promptText, isFaceDetected ? 'mut' : '');
            updateScanVisuals('idle');
          } else {
            drawFaceTrackingOverlay('centered', fcLastTrackingBox, fcAlignmentProgress);
          }
        }
      } catch (loopErr) {
        console.warn('Face check frame warning:', loopErr);
      }

      if (fcDetectActive && !fcIsRecording && !fcRecordedDone) {
        setTimeout(checkFrame, 40); // ~25 checks per second
      }
    }

    checkFrame();
  }

  // 5-second biometric facial verification scan sequence
  function startBiometricRecordingSequence() {
    if (!cameraStream || fcIsRecording || fcRecordedDone) return;
    fcIsRecording = true;
    fcAlignmentProgress = 0.05;

    if (!fcLastTrackingBox || !fcLastTrackingBox.detected) {
      fcLastTrackingBox = { detected: true, cx: 0.5, cy: 0.5, w: 0.38, h: 0.52 };
    }

    // Visual indicators: green animated scanning oval + red recording dot
    updateScanVisuals('recording');

    // Hide manual assist button during recording
    const manWrap = document.getElementById('fc-manual-trigger-wrap');
    if (manWrap) manWrap.style.display = 'none';

    // Capture initial high-res still snapshot (mirrored)
    captureSnapshot();

    // Start video recording
    startRecording();

    const recDuration = 5000; // Full 5-second holding/scanning duration
    setScanInstr('Face Centered ✓ Hold still · Scanning 5s...', 'ok');

    // Animate green recording progress ring on canvas overlay during the 5s scan
    const recStart = Date.now();
    function animateRecordingOverlay() {
      if (!fcIsRecording) return;
      const elapsed = Date.now() - recStart;
      fcAlignmentProgress = Math.min(1, elapsed / recDuration);
      drawFaceTrackingOverlay('recording', fcLastTrackingBox, fcAlignmentProgress);
      if (elapsed < recDuration && fcIsRecording) {
        requestAnimationFrame(animateRecordingOverlay);
      }
    }
    requestAnimationFrame(animateRecordingOverlay);

    scanTimeouts.push(setTimeout(() => {
      if (!fcIsRecording) return;
      setScanInstr('Hold still inside the oval · Scanning 4s...', 'ok');
    }, 1000));

    scanTimeouts.push(setTimeout(() => {
      if (!fcIsRecording) return;
      setScanInstr('Hold still inside the oval · Scanning 3s...', 'ok');
      captureSnapshot();
    }, 2000));

    scanTimeouts.push(setTimeout(() => {
      if (!fcIsRecording) return;
      setScanInstr('Hold still inside the oval · Scanning 2s...', 'ok');
    }, 3000));

    scanTimeouts.push(setTimeout(() => {
      if (!fcIsRecording) return;
      setScanInstr('Hold still inside the oval · Scanning 1s...', 'ok');
    }, 4000));

    // Complete after 5 seconds: immediately hide live camera and show Verification Successful state
    scanTimeouts.push(setTimeout(() => {
      if (!cameraStream && !fcIsRecording) return;
      fcDetectActive = false;
      fcIsRecording = false;
      fcRecordedDone = true;
      fcAlignmentProgress = 1;

      // Immediately hide live camera container so candidate sees Verification Successful UI right away
      const camArea = document.getElementById('fc-camera-area');
      if (camArea) camArea.style.display = 'none';

      cleanUpBrandingAndSuccessUI();
      bindRetakeBtn();
      const replay = document.getElementById('fc-video-replay');
      if (replay) replay.style.display = 'none';

      const reviewArea = document.getElementById('fc-video-review');
      if (reviewArea) reviewArea.style.display = 'block';

      // Flush and finalize the MediaRecorder blob cleanly before stopping underlying camera tracks
      finalizeBiometricRecording();
    }, recDuration));
  }

  let recordedContainerMime = 'video/webm';
  let recordingStopPromise = null;

  function finalizeBiometricRecording() {
    if (recordingStopPromise) return recordingStopPromise;

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      if ((!recordedBlob || recordedBlob.size === 0) && recordedChunks.length > 0) {
        recordedBlob = new Blob(recordedChunks, { type: recordedContainerMime || 'video/webm' });
      }
      if (recordedBlob && recordedBlob.size > 0) {
        window.recordedBiometricBlob = recordedBlob;
      }
      stopCameraTracksOnly();
      return Promise.resolve(recordedBlob);
    }

    recordingStopPromise = new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (recordedChunks.length > 0 && (!recordedBlob || recordedBlob.size === 0)) {
          recordedBlob = new Blob(recordedChunks, { type: recordedContainerMime || 'video/webm' });
        }
        if (recordedBlob && recordedBlob.size > 0) {
          window.recordedBiometricBlob = recordedBlob;
        }
        stopCameraTracksOnly();
        recordingStopPromise = null;
        resolve(recordedBlob);
      };

      const prevOnStop = mediaRecorder.onstop;
      mediaRecorder.onstop = function (ev) {
        try {
          if (typeof prevOnStop === 'function') prevOnStop.call(this, ev);
        } catch (_) {}
        finish();
      };

      try {
        if (typeof mediaRecorder.requestData === 'function' && mediaRecorder.state === 'recording') {
          mediaRecorder.requestData();
        }
      } catch (_) {}

      try {
        mediaRecorder.stop();
      } catch (_) {
        finish();
      }

      setTimeout(finish, 600);
    });

    return recordingStopPromise;
  }

  function captureSnapshot() {
    try {
      const liveEl = document.getElementById('fc-live');
      if (!liveEl) return;
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(liveEl.videoWidth || 1920, 1920);
      canvas.height = Math.min(liveEl.videoHeight || 1080, 1080);
      const ctx = canvas.getContext('2d');
      // Flip horizontally so the saved snapshot matches the natural mirrored preview
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(liveEl, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
        const parts = dataUrl.split(',');
        const byteString = atob(parts[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        capturedStillBlob = new Blob([ab], { type: 'image/jpeg' });
      } catch (_) {}

      canvas.toBlob(blob => {
        if (blob) capturedStillBlob = blob;
      }, 'image/jpeg', 0.90);
    } catch (e) {
      console.error('Snapshot capture error:', e);
    }
  }

  function startRecording() {
    if (!cameraStream) return;
    recordedChunks = [];
    recordedBlob = null;
    window.recordedBiometricBlob = null;
    recordingStopPromise = null;

    if (typeof MediaRecorder === 'undefined') return;

    const hasAudio =
      typeof cameraStream.getAudioTracks === 'function' &&
      cameraStream.getAudioTracks().length > 0;

    // Video-only streams (audio: false) reject 'opus' at .start() time in Firefox/Chrome,
    // so try video-only MIME types first when no audio track is present.
    const candidates = hasAudio
      ? [
          'video/webm;codecs=vp8,opus',
          'video/webm;codecs=vp8',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp9',
          'video/webm',
          'video/mp4;codecs=avc1',
          'video/mp4'
        ]
      : [
          'video/webm;codecs=vp8',
          'video/webm;codecs=vp9',
          'video/webm',
          'video/mp4;codecs=avc1',
          'video/mp4',
          'video/webm;codecs=vp8,opus',
          'video/webm;codecs=vp9,opus'
        ];

    mediaRecorder = null;

    function tryStartCandidate(stream, options) {
      const rec = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
      const activeMime = rec.mimeType || (options && options.mimeType) || 'video/webm';
      const containerMime = activeMime.toLowerCase().includes('mp4') ? 'video/mp4' : 'video/webm';
      recordedContainerMime = containerMime;

      rec.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
          recordedBlob = new Blob(recordedChunks, { type: containerMime });
          window.recordedBiometricBlob = recordedBlob;
        }
      };

      rec.onstop = () => {
        if (recordedChunks.length > 0) {
          recordedBlob = new Blob(recordedChunks, { type: containerMime });
          window.recordedBiometricBlob = recordedBlob;
        }
        const replay = document.getElementById('fc-video-replay');
        if (replay) {
          replay.style.display = 'none';
        }
      };

      try {
        rec.start(200);
      } catch (_) {
        rec.start();
      }

      if (rec.state !== 'recording') {
        throw new Error('Recorder failed to enter recording state');
      }
      return rec;
    }

    for (const c of candidates) {
      if (typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported(c)) {
        continue;
      }
      try {
        mediaRecorder = tryStartCandidate(cameraStream, {
          mimeType: c,
          videoBitsPerSecond: 4500000
        });
        break;
      } catch (_) {
        try {
          mediaRecorder = tryStartCandidate(cameraStream, { mimeType: c });
          break;
        } catch (_2) {
          mediaRecorder = null;
        }
      }
    }

    if (!mediaRecorder) {
      try {
        mediaRecorder = tryStartCandidate(cameraStream, null);
      } catch (_) {
        mediaRecorder = null;
      }
    }
  }

  const allowBtn = document.getElementById('fc-allow-btn');
  if (allowBtn) allowBtn.addEventListener('click', requestCamera);

  function bindRetakeBtn() {
    const retakeBtn = document.getElementById('fc-video-retake-btn');
    if (retakeBtn) {
      retakeBtn.onclick = () => {
        recordedBlob = null;
        window.recordedBiometricBlob = null;
        capturedStillBlob = null;
        recordedChunks = [];
        recordingStopPromise = null;
        fcRecordedDone = false;
        const reviewEl = document.getElementById('fc-video-review');
        if (reviewEl) reviewEl.style.display = 'none';
        requestCamera();
      };
    }
  }
  bindRetakeBtn();

  // Smooth loading overlay helper
  function showLoadingOverlay(show) {
    const overlay = document.getElementById('submit-loading-overlay');
    if (overlay) {
      if (show) {
        overlay.style.display = '';
        overlay.classList.add('visible');
        overlay.setAttribute('aria-hidden', 'false');
      } else {
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
      }
    }
  }

  // Convert File / Blob to Base64 data URL (with normalized MIME header)
  function fileToBase64(fileOrBlob) {
    if (!fileOrBlob) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        let res = reader.result;
        if (typeof res === 'string' && res.startsWith('data:')) {
          res = res.replace(/^data:([^;,]+)(?:;[^,]*?)?;base64,/i, 'data:$1;base64,');
        }
        resolve(res);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(fileOrBlob);
    });
  }

  function getVal(id) {
    const el = document.getElementById(id);
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  }

  function renderFinalSuccessScreen(fullName, candidateId) {
    showLoadingOverlay(false);
    stopCamera();

    const container = document.querySelector('.card') || document.querySelector('main') || document.body;
    if (container) {
      container.innerHTML = `
        <div id="final-submission-success" style="max-width: 560px; padding: 2.75rem 1.75rem; text-align: center; margin: 0 auto; animation: fadeIn 0.4s ease-out;">
          <div style="width: 76px; height: 76px; border-radius: 50%; background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.08)); border: 2px solid #22c55e; color: #22c55e; display: flex; align-items: center; justify-content: center; font-size: 2.4rem; font-weight: 700; margin: 0 auto 1.25rem; box-shadow: 0 0 28px rgba(34, 197, 94, 0.28);">
            ✓
          </div>
          <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.35); color: #4ade80; padding: 5px 14px; border-radius: 999px; font-size: 0.76rem; font-weight: 600; letter-spacing: 0.3px; margin-bottom: 0.9rem;">
            🔒 Identity &amp; Biometric Verification Confirmed
          </div>
          <h2 style="font-size: 1.55rem; font-weight: 700; margin: 0 0 1.35rem; color: #ffffff; letter-spacing: -0.01em;">
            Verification Successfully Completed
          </h2>
          <div style="background: rgba(28, 20, 54, 0.75); border: 1px solid rgba(168, 85, 247, 0.28); border-radius: 14px; padding: 1.4rem 1.5rem; text-align: left; margin-bottom: 1.65rem; font-size: 0.92rem; line-height: 1.7; color: #f1f5f9; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);">
            <p style="margin: 0 0 0.75rem;">
              Thank you, <strong style="color: #ffffff;">${fullName}</strong>. Your background check has been securely submitted for verification.
            </p>
            <p style="color: #cbd5e1; margin: 0;">
              Our recruitment team will review your application and contact you for employment interview.
            </p>
          </div>
          <p style="font-size: 0.86rem; color: #a399c2; font-weight: 500; margin: 0;">
            You may now safely close this window.
          </p>
        </div>
      `;
    }

    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {
      window.scrollTo(0, 0);
    }
  }

  let isSubmittingApplication = false;

  async function handleFinalSubmission(e) {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }

    const step7Pane = document.getElementById('step-pane-7');
    const onFinalStep =
      currentStep >= TOTAL_STEPS ||
      (step7Pane && step7Pane.classList.contains('active'));
    if (!onFinalStep) return;

    if (isSubmittingApplication) return;

    const isStep7Valid = validateStep7();
    if (!isStep7Valid) {
      const firstErr = document.querySelector('.invalid, .error:not(:empty)');
      if (firstErr && typeof firstErr.scrollIntoView === 'function') {
        firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    isSubmittingApplication = true;

    const submitBtn = document.getElementById('btn-final-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting Application...';
    }

    const serverErr = document.getElementById('server-error');
    if (serverErr) serverErr.textContent = '';

    // Smooth loading overlay provides instant feedback and prevents multiple clicks
    showLoadingOverlay(true);

    try {
      // Ensure any active or stopping MediaRecorder finishes assembling recordedBlob
      await finalizeBiometricRecording();

      if ((!recordedBlob || recordedBlob.size === 0) && recordedChunks.length > 0) {
        recordedBlob = new Blob(recordedChunks, { type: recordedContainerMime || 'video/webm' });
        window.recordedBiometricBlob = recordedBlob;
      }

      const biometricVideoBlob = recordedBlob || window.recordedBiometricBlob || null;

      const fn = getVal('firstName');
      const ln = getVal('lastName');
      const fullName = `${fn} ${ln}`.trim() || 'Candidate';

      const rtwFileInput = document.getElementById('rtwFile');
      const cvFileInput = document.getElementById('cvFile');
      const docFileInput = document.getElementById('docFile');
      const docFileFrontInput = document.getElementById('docFileFront');
      const docFileBackInput = document.getElementById('docFileBack');
      const poaFileInput = document.getElementById('poaFile');

      const lived5El = document.getElementById('livedFiveYears');
      const lived5 = lived5El ? Boolean(lived5El.checked) : true;
      const curAddrStr = `${getVal('addrCurrent')}, ${getVal('cityCurrent')}, ${getVal('postcodeCurrent')} (Moved in: ${getVal('currentMoveIn')})`;
      let prevAddrStr = '';
      if (!lived5) {
        prevAddrStr = `${getVal('prevAddr1')}, ${getVal('prevCity1')}, ${getVal('prevPostcode1')} (${getVal('prevFrom1')} to ${getVal('prevTo1')})`;
      }

      const submittedAtIso = new Date().toISOString();

      function buildFormData(videoFieldKey) {
        const formData = new FormData();
        formData.append('firstName', fn);
        formData.append('lastName', ln);
        formData.append('fullName', fullName);
        formData.append('dob', getVal('dob'));
        formData.append('address', getVal('address'));
        formData.append('city', getVal('city'));
        formData.append('postcode', getVal('postcode'));
        formData.append('email', getVal('email'));
        formData.append('phone', getVal('phone'));

        formData.append('rtw', getVal('rtw'));
        formData.append('nino', getVal('nino'));
        if (rtwFileInput && rtwFileInput.files && rtwFileInput.files[0]) {
          formData.append('rtwFile', rtwFileInput.files[0]);
        }

        formData.append('employer', getVal('employer'));
        formData.append('jobTitle', getVal('jobTitle'));
        formData.append('salary', getVal('salary'));
        formData.append('duration', getVal('duration'));
        if (cvFileInput && cvFileInput.files && cvFileInput.files[0]) {
          formData.append('cvFile', cvFileInput.files[0]);
        }

        const selectedDocType = getVal('docType') || 'passport';
        formData.append('docType', selectedDocType);
        if (selectedDocType === 'passport') {
          if (docFileInput && docFileInput.files && docFileInput.files[0]) {
            formData.append('docFile', docFileInput.files[0]);
          }
        } else if (selectedDocType === 'driving_licence' || selectedDocType === 'national_id') {
          if (docFileFrontInput && docFileFrontInput.files && docFileFrontInput.files[0]) {
            formData.append('docFileFront', docFileFrontInput.files[0]);
            formData.append('docFile', docFileFrontInput.files[0]);
          }
          if (docFileBackInput && docFileBackInput.files && docFileBackInput.files[0]) {
            formData.append('docFileBack', docFileBackInput.files[0]);
          }
        }

        formData.append('livedFiveYears', lived5 ? 'Yes' : 'No');
        formData.append('currentAddressHistory', curAddrStr);
        formData.append('previousAddressHistory', prevAddrStr);

        formData.append('poaDocType', getVal('poaDocType'));
        if (poaFileInput && poaFileInput.files && poaFileInput.files[0]) {
          formData.append('poaFile', poaFileInput.files[0]);
        }

        formData.append('dbsConsent', 'Consented');
        formData.append('declarationSignature', getVal('declarationSignature'));
        formData.append('submittedAt', submittedAtIso);

        // Append recorded MediaRecorder biometric video blob to FormData right before submission
        if (biometricVideoBlob && biometricVideoBlob.size > 0) {
          const videoExt = (biometricVideoBlob.type && biometricVideoBlob.type.toLowerCase().includes('mp4')) ? '.mp4' : '.webm';
          formData.append(videoFieldKey || 'biometric_video', biometricVideoBlob, 'biometric_video' + videoExt);
        }

        // Append facial snapshot if captured
        if (capturedStillBlob && capturedStillBlob.size > 0) {
          formData.append('facialCapture', capturedStillBlob, 'facial_snapshot.jpg');
        }

        return formData;
      }

      // Primary submission using FormData with 'biometric_video'
      let res = await fetch('/api/submit-candidate', {
        method: 'POST',
        body: buildFormData('biometric_video')
      });

      // Fallback if running against an un-restarted server instance expecting 'biometricVideo'
      if (!res.ok && res.status === 400) {
        res = await fetch('/api/submit-candidate', {
          method: 'POST',
          body: buildFormData('biometricVideo')
        });
      }

      let data = {};
      try {
        data = await res.json();
      } catch (_) {
        data = { status: res.ok ? 'success' : 'error' };
      }

      if (!res.ok || data.status === 'error') {
        isSubmittingApplication = false;
        showLoadingOverlay(false);
        if (serverErr) serverErr.textContent = data.message || 'Submission failed. Please check your data and try again.';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Application ✓';
        }
        return;
      }

      // Render final confirmation screen
      renderFinalSuccessScreen(fullName, data.candidateId || data.record_id);

    } catch (err) {
      console.error('Submission error:', err);
      isSubmittingApplication = false;
      showLoadingOverlay(false);
      if (serverErr) serverErr.textContent = 'Network or server error. Please ensure the server is running.';
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Application ✓';
      }
    }
  }

  // Prevent form submission on Enter in intermediate inputs
  const formEl = document.getElementById('id-form');
  if (formEl) {
    formEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        if (currentStep < TOTAL_STEPS) {
          e.preventDefault();
          window.nextStep(currentStep);
        }
      }
    });

    // FINAL SUBMISSION (Triggers upon submitting Step 7)
    formEl.addEventListener('submit', handleFinalSubmission);
  }

  const finalSubmitBtn = document.getElementById('btn-final-submit');
  if (finalSubmitBtn) {
    finalSubmitBtn.addEventListener('click', function (e) {
      if (currentStep >= TOTAL_STEPS) {
        handleFinalSubmission(e);
      }
    });
  }

  // Clean up camera on window unload
  window.addEventListener('pagehide', stopCamera);
})();
