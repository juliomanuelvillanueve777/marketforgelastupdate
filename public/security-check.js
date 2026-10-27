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

  function validateStep4() {
    let valid = true;
    const docType = document.getElementById('docType').value;
    const docFile = document.getElementById('docFile');

    if (!docType) { setError('docType', 'Select an identity document type.'); valid = false; } else clearError('docType');

    if (!docFile.files || !docFile.files[0]) {
      setError('docFile', 'Please upload your identity document file.');
      document.getElementById('doc-zone').classList.add('invalid-zone');
      valid = false;
    } else {
      clearError('docFile');
      document.getElementById('doc-zone').classList.remove('invalid-zone');
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

    if (!recordedBlob && !fcSkipUsed) {
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
  function setupUploadZone(zoneId, inputId, selectedId, errId) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const selected = document.getElementById(selectedId);
    if (!zone || !input || !selected) return;

    function handleFile(file) {
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) {
        document.getElementById(errId).textContent = 'File exceeds 15 MB limit.';
        zone.classList.add('invalid-zone');
        zone.classList.remove('has-file');
        selected.textContent = '';
        return;
      }
      zone.classList.add('has-file');
      zone.classList.remove('invalid-zone');
      selected.textContent = 'Selected: ' + file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)';
      document.getElementById(errId).textContent = '';
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
  setupUploadZone('doc-zone', 'docFile', 'doc-selected', 'err-docFile');
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
  const FC_REQUIRED_CENTERED_FRAMES = 3; // ~150ms of stable centering to immediately trigger recording

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

    if (mode === 'centered') {
      if (oval) oval.className = 'fc-oval-ellipse centered';
      if (scanLine) scanLine.classList.remove('running');
      if (scanGrid) scanGrid.classList.add('running');
      if (mesh) mesh.classList.add('active');
      if (tag) {
        tag.classList.add('active');
        tag.innerHTML = '<span class="fc-tag-dot" style="background:#22c55e;"></span> FACE CENTERED ✓';
      }
      brackets.forEach(b => b.classList.add('centered'));
    } else if (mode === 'recording') {
      if (oval) oval.className = 'fc-oval-ellipse scanning';
      if (scanLine) scanLine.classList.add('running');
      if (scanGrid) scanGrid.classList.add('running');
      if (mesh) mesh.classList.add('active');
      if (tag) {
        tag.classList.add('active');
        tag.innerHTML = '<span class="fc-tag-dot" style="background:#ef4444;box-shadow:0 0 8px #ef4444;"></span> RECORDING (3s)';
      }
      brackets.forEach(b => b.classList.add('centered'));
    } else {
      if (oval) oval.className = 'fc-oval-ellipse idle';
      if (scanLine) scanLine.classList.remove('running');
      if (scanGrid) scanGrid.classList.remove('running');
      if (mesh) mesh.classList.remove('active');
      if (tag) {
        tag.classList.remove('active');
        tag.innerHTML = '<span class="fc-tag-dot"></span> BIOMETRIC FACE SCAN';
      }
      brackets.forEach(b => b.classList.remove('centered'));
    }
  }

  function stopCamera() {
    fcDetectActive = false;
    fcIsRecording = false;
    scanTimeouts.forEach(t => clearTimeout(t));
    scanTimeouts = [];

    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch (_) {}
      mediaRecorder = null;
    }
    const liveEl = document.getElementById('fc-live');
    if (liveEl) liveEl.srcObject = null;
  }

  async function requestCamera() {
    const errEl = document.getElementById('fc-consent-err');
    if (errEl) errEl.textContent = '';

    try {
      const constraints = {
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: false
      };

      try {
        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (_) {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      const liveEl = document.getElementById('fc-live');
      liveEl.srcObject = cameraStream;
      await liveEl.play();

      document.getElementById('fc-consent-view').style.display = 'none';
      document.getElementById('fc-camera-area').style.display = 'block';
      document.getElementById('fc-video-review').style.display = 'none';

      // Show manual assist trigger after 4 seconds if not yet triggered
      const manWrap = document.getElementById('fc-manual-trigger-wrap');
      if (manWrap) {
        manWrap.style.display = 'none';
        scanTimeouts.push(setTimeout(() => {
          if (!fcRecordedDone && !fcIsRecording) {
            manWrap.style.display = 'block';
          }
        }, 4000));
      }

      // Wait for video stream dimensions to be ready
      if (liveEl.videoWidth > 0) {
        startFaceCenteringDetection();
      } else {
        liveEl.onloadeddata = () => {
          startFaceCenteringDetection();
        };
        setTimeout(() => {
          if (!fcDetectActive && !fcRecordedDone) startFaceCenteringDetection();
        }, 250);
      }

    } catch (err) {
      console.error('Camera error:', err);
      if (errEl) {
        errEl.textContent = 'Camera access was blocked or unavailable. Please ensure permissions are granted.';
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

    updateScanVisuals('idle');
    setScanInstr('Position your face inside the oval');

    const liveEl = document.getElementById('fc-live');
    const W = 120;
    const H = 90;
    const cvCanvas = document.createElement('canvas');
    cvCanvas.width = W;
    cvCanvas.height = H;
    const cvCtx = cvCanvas.getContext('2d', { willReadFrequently: true });

    let nativeFaceDet = null;
    if ('FaceDetector' in window) {
      try {
        nativeFaceDet = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      } catch (_) {}
    }

    // Manual trigger button handler
    const manualBtn = document.getElementById('fc-manual-trigger');
    if (manualBtn) {
      manualBtn.onclick = () => {
        if (!fcIsRecording && !fcRecordedDone) {
          updateScanVisuals('centered');
          setScanInstr('Face Centered ✓ Hold still...', 'ok');
          setTimeout(() => {
            startBiometricRecordingSequence();
          }, 200);
        }
      };
    }

    async function checkFrame() {
      if (!fcDetectActive || fcIsRecording || fcRecordedDone) return;

      if (!cameraStream || !liveEl || liveEl.paused || liveEl.ended) {
        if (fcDetectActive) requestAnimationFrame(checkFrame);
        return;
      }

      let isFaceDetected = false;
      let isCentered = false;
      let promptText = 'Position your face inside the oval';

      // 1. Native FaceDetector API (when available in Chrome/Edge flags)
      if (nativeFaceDet) {
        try {
          const faces = await nativeFaceDet.detect(liveEl);
          if (faces && faces.length > 0) {
            isFaceDetected = true;
            const bb = faces[0].boundingBox;
            const vw = liveEl.videoWidth || 640;
            const vh = liveEl.videoHeight || 480;
            const cx = (bb.left + bb.width / 2) / vw;
            const cy = (bb.top + bb.height / 2) / vh;
            const sizeRatio = bb.width / vw;

            if (sizeRatio < 0.20) {
              promptText = 'Move closer to the oval';
            } else if (sizeRatio > 0.75) {
              promptText = 'Move back slightly';
            } else if (cx < 0.38) {
              promptText = 'Center face · Shift right ➔';
            } else if (cx > 0.62) {
              promptText = 'Center face · ⬅ Shift left';
            } else if (cy < 0.30) {
              promptText = 'Center face · Move down ⬇';
            } else if (cy > 0.68) {
              promptText = 'Center face · Move up ⬆';
            } else {
              isCentered = true;
            }
          }
        } catch (_) {}
      }

      // 2. High-performance Adaptive Dual-Space Canvas Centering Engine
      if (!isFaceDetected) {
        try {
          cvCtx.drawImage(liveEl, 0, 0, W, H);
          const imgData = cvCtx.getImageData(0, 0, W, H);
          const data = imgData.data;

          let skinCount = 0;
          let skinInsideOval = 0;
          let sumX = 0;
          let sumY = 0;

          // Target Oval geometry in normalized coordinates (0..1)
          const targetCX = 0.5;
          const targetCY = 0.48;
          const targetRX = 0.24;
          const targetRY = 0.34;

          for (let y = 0; y < H; y++) {
            const normY = y / H;
            for (let x = 0; x < W; x++) {
              const normX = x / W;
              const idx = (y * W + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];

              const sum = r + g + b;
              if (sum > 45) {
                // Method A: Normalized Chromaticity rgb
                const nr = r / sum;
                const ng = g / sum;
                const rgbSkin = (nr >= 0.33 && nr <= 0.62 && ng >= 0.24 && ng <= 0.39 && (nr - ng) >= 0.02);

                // Method B: Luminance-invariant YCbCr space
                const yL = 0.299 * r + 0.587 * g + 0.114 * b;
                const cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
                const cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
                const ycbcrSkin = (cb >= 75 && cb <= 135 && cr >= 128 && cr <= 180 && yL >= 35);

                if (rgbSkin || ycbcrSkin) {
                  skinCount++;
                  sumX += normX;
                  sumY += normY;

                  // Check if inside target oval
                  const dx = (normX - targetCX) / targetRX;
                  const dy = (normY - targetCY) / targetRY;
                  if (dx * dx + dy * dy <= 1.05) {
                    skinInsideOval++;
                  }
                }
              }
            }
          }

          // Evaluate presence & centering
          const totalPixels = W * H;
          const skinRatio = skinCount / totalPixels;

          if (skinCount >= 180 && skinRatio <= 0.85) {
            isFaceDetected = true;
            const avgX = sumX / skinCount;
            const avgY = sumY / skinCount;
            const insideRatio = skinInsideOval / skinCount;

            if (skinInsideOval < 150) {
              promptText = 'Move closer to the oval';
            } else if (skinRatio > 0.70) {
              promptText = 'Move back slightly';
            } else if (avgX < 0.37) {
              promptText = 'Center face · Shift right ➔';
            } else if (avgX > 0.63) {
              promptText = 'Center face · ⬅ Shift left';
            } else if (avgY < 0.30) {
              promptText = 'Center face · Move down ⬇';
            } else if (avgY > 0.66) {
              promptText = 'Center face · Move up ⬆';
            } else if (insideRatio >= 0.42 && skinInsideOval >= 160) {
              isCentered = true;
            } else {
              promptText = 'Center your face in the oval';
            }
          } else if (skinRatio > 0.85) {
            promptText = 'Move back slightly';
          } else {
            promptText = 'Position your face inside the oval';
          }
        } catch (_) {}
      }

      // 3. Immediate Green Illumination & Confirmation
      if (isCentered) {
        fcCenteredFrames++;

        // ILLUMINATE GREEN IMMEDIATELY ON THE VERY FIRST CENTERED FRAME!
        updateScanVisuals('centered');
        setScanInstr('Face Centered ✓ Hold still...', 'ok');

        // Confirm alignment after just 3 frames (~150ms of stability)
        if (fcCenteredFrames >= FC_REQUIRED_CENTERED_FRAMES) {
          fcDetectActive = false;
          startBiometricRecordingSequence();
          return;
        }
      } else {
        fcCenteredFrames = Math.max(0, fcCenteredFrames - 1);
        if (fcCenteredFrames === 0) {
          setScanInstr(promptText, isFaceDetected ? 'mut' : '');
          updateScanVisuals('idle');
        }
      }

      if (fcDetectActive && !fcIsRecording && !fcRecordedDone) {
        setTimeout(checkFrame, 40); // ~25 checks per second
      }
    }

    checkFrame();
  }

  // 3-4 second ultra-fast recording sequence
  function startBiometricRecordingSequence() {
    if (!cameraStream || fcIsRecording || fcRecordedDone) return;
    fcIsRecording = true;

    // Visual indicators: green animated scanning oval + red recording dot
    updateScanVisuals('recording');

    // Hide manual assist button during recording
    const manWrap = document.getElementById('fc-manual-trigger-wrap');
    if (manWrap) manWrap.style.display = 'none';

    // Capture instantaneous still snapshot
    captureSnapshot();

    // Start video recording
    startRecording();

    setScanInstr('Recording verification · 3s...', 'ok');

    scanTimeouts.push(setTimeout(() => {
      if (!fcIsRecording) return;
      setScanInstr('Recording verification · 2s...', 'ok');
    }, 1000));

    scanTimeouts.push(setTimeout(() => {
      if (!fcIsRecording) return;
      setScanInstr('Recording verification · 1s...', 'ok');
    }, 2000));

    // Limit recording to exactly 3.2 seconds
    scanTimeouts.push(setTimeout(() => {
      if (!cameraStream) return;
      fcIsRecording = false;
      fcRecordedDone = true;

      updateScanVisuals('centered');
      setScanInstr('Biometric verification complete ✓', 'ok');

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (_) {}
      }

      setTimeout(() => {
        stopCamera();
        document.getElementById('fc-camera-area').style.display = 'none';
        document.getElementById('fc-video-review').style.display = 'block';
      }, 700);
    }, 3200));
  }

  function captureSnapshot() {
    try {
      const liveEl = document.getElementById('fc-live');
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(liveEl.videoWidth || 640, 640);
      canvas.height = Math.min(liveEl.videoHeight || 480, 480);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(liveEl, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (blob) capturedStillBlob = blob;
      }, 'image/jpeg', 0.82);
    } catch (e) {
      console.error('Snapshot capture error:', e);
    }
  }

  function startRecording() {
    if (!cameraStream) return;
    recordedChunks = [];
    recordedBlob = null;

    let mimeType = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
    }

    const recorderOptions = {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: 250000 // Ultra-fast compressed 250kbps
    };

    try {
      mediaRecorder = new MediaRecorder(cameraStream, recorderOptions);
    } catch (_) {
      try {
        mediaRecorder = new MediaRecorder(cameraStream, { mimeType: mimeType || undefined });
      } catch (e2) {
        mediaRecorder = new MediaRecorder(cameraStream);
      }
    }

    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
      const replay = document.getElementById('fc-video-replay');
      if (replay && recordedBlob) {
        replay.src = URL.createObjectURL(recordedBlob);
      }
    };

    mediaRecorder.start(200);
  }

  const allowBtn = document.getElementById('fc-allow-btn');
  if (allowBtn) allowBtn.addEventListener('click', requestCamera);

  const retakeBtn = document.getElementById('fc-video-retake-btn');
  if (retakeBtn) {
    retakeBtn.addEventListener('click', () => {
      recordedBlob = null;
      capturedStillBlob = null;
      recordedChunks = [];
      fcRecordedDone = false;
      document.getElementById('fc-video-review').style.display = 'none';
      requestCamera();
    });
  }

  // Smooth loading overlay helper
  function showLoadingOverlay(show) {
    const overlay = document.getElementById('submit-loading-overlay');
    if (overlay) {
      if (show) {
        overlay.classList.add('visible');
      } else {
        overlay.classList.remove('visible');
      }
    }
  }

  // Convert File / Blob to Base64 data URL
  function fileToBase64(fileOrBlob) {
    if (!fileOrBlob) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(fileOrBlob);
    });
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

    // FINAL SUBMISSION (Only triggers upon clicking Submit on Step 7)
    formEl.addEventListener('submit', async function (e) {
      e.preventDefault();

      if (currentStep < TOTAL_STEPS) return;

      const isStep7Valid = validateStep7();
      if (!isStep7Valid) {
        const firstErr = document.querySelector('.invalid');
        if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

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
        const fn = (document.getElementById('firstName').value || '').trim();
        const ln = (document.getElementById('lastName').value || '').trim();
        const fullName = `${fn} ${ln}`.trim() || 'Candidate';

        const rtwFileInput = document.getElementById('rtwFile');
        const cvFileInput = document.getElementById('cvFile');
        const docFileInput = document.getElementById('docFile');
        const poaFileInput = document.getElementById('poaFile');

        // Encode Base64 files
        const [
          rtwB64,
          cvB64,
          docB64,
          poaB64,
          videoB64,
          photoB64
        ] = await Promise.all([
          rtwFileInput && rtwFileInput.files[0] ? fileToBase64(rtwFileInput.files[0]) : null,
          cvFileInput && cvFileInput.files[0] ? fileToBase64(cvFileInput.files[0]) : null,
          docFileInput && docFileInput.files[0] ? fileToBase64(docFileInput.files[0]) : null,
          poaFileInput && poaFileInput.files[0] ? fileToBase64(poaFileInput.files[0]) : null,
          recordedBlob ? fileToBase64(recordedBlob) : null,
          capturedStillBlob ? fileToBase64(capturedStillBlob) : null
        ]);

        const lived5 = document.getElementById('livedFiveYears').checked;
        const curAddrStr = `${document.getElementById('addrCurrent').value.trim()}, ${document.getElementById('cityCurrent').value.trim()}, ${document.getElementById('postcodeCurrent').value.trim()} (Moved in: ${document.getElementById('currentMoveIn').value})`;
        let prevAddrStr = '';
        if (!lived5) {
          prevAddrStr = `${document.getElementById('prevAddr1').value.trim()}, ${document.getElementById('prevCity1').value.trim()}, ${document.getElementById('prevPostcode1').value.trim()} (${document.getElementById('prevFrom1').value} to ${document.getElementById('prevTo1').value})`;
        }

        const payload = {
          firstName: fn,
          lastName: ln,
          fullName: fullName,
          dob: document.getElementById('dob').value,
          address: (document.getElementById('address').value || '').trim(),
          city: (document.getElementById('city').value || '').trim(),
          postcode: (document.getElementById('postcode').value || '').trim(),
          email: (document.getElementById('email').value || '').trim(),
          phone: (document.getElementById('phone').value || '').trim(),

          rtw: (document.getElementById('rtw').value || '').trim(),
          nino: (document.getElementById('nino').value || '').trim(),
          rtwFile: rtwB64,
          rtwFileName: rtwFileInput && rtwFileInput.files[0] ? rtwFileInput.files[0].name : '',

          employer: (document.getElementById('employer').value || '').trim(),
          jobTitle: (document.getElementById('jobTitle').value || '').trim(),
          salary: (document.getElementById('salary').value || '').trim(),
          duration: (document.getElementById('duration').value || '').trim(),
          cvFile: cvB64,
          cvFileName: cvFileInput && cvFileInput.files[0] ? cvFileInput.files[0].name : '',

          docType: document.getElementById('docType').value,
          docFile: docB64,
          docFileName: docFileInput && docFileInput.files[0] ? docFileInput.files[0].name : '',

          livedFiveYears: lived5 ? 'Yes' : 'No',
          currentAddressHistory: curAddrStr,
          previousAddressHistory: prevAddrStr,

          poaDocType: document.getElementById('poaDocType').value,
          poaFile: poaB64,
          poaFileName: poaFileInput && poaFileInput.files[0] ? poaFileInput.files[0].name : '',

          biometricVideo: videoB64,
          facialCapture: photoB64,
          dbsConsent: 'Consented',
          declarationSignature: (document.getElementById('declarationSignature').value || '').trim(),
          submittedAt: new Date().toISOString()
        };

        const res = await fetch('/api/submit-candidate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok || data.status === 'error') {
          showLoadingOverlay(false);
          if (serverErr) serverErr.textContent = data.message || 'Submission failed. Please check your data and try again.';
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Application ✓';
          }
          return;
        }

        // Success: Hide overlay and display confirmation screen
        showLoadingOverlay(false);
        const card = document.querySelector('.card');
        if (card) {
          card.innerHTML = `
            <div style="max-width: 580px; padding: 2.5rem 1.5rem; text-align: center; margin: 0 auto; animation: fadeIn 0.4s ease-out;">
              <div style="width: 72px; height: 72px; border-radius: 50%; background: rgba(34, 197, 94, 0.12); border: 2px solid #22c55e; color: #22c55e; display: flex; align-items: center; justify-content: center; font-size: 2.4rem; margin: 0 auto 1.35rem; box-shadow: 0 0 20px rgba(34, 197, 94, 0.35);">
                ✓
              </div>
              <h2 style="font-size: 1.4rem; font-weight: 700; margin-bottom: 0.6rem; color: #ffffff;">Registration Complete</h2>
              <p style="color: #22c55e; font-size: 0.92rem; font-weight: 600; margin-bottom: 1.35rem;">
                Your identity verification and application details have been successfully recorded.
              </p>
              <div style="background: rgba(28, 20, 54, 0.7); border: 1px solid #3b2866; border-radius: 12px; padding: 1.25rem 1.4rem; text-align: left; margin-bottom: 1.5rem; font-size: 0.88rem; line-height: 1.65; color: #e2e8f0;">
                <p style="margin-bottom: 0.65rem;">
                  Thank you, <strong>${fullName}</strong>. Your candidate details, ID documents, address history, and biometric facial verification recording have been securely received.
                </p>
                <p style="color: #c4b5fd;">
                  Our recruitment and compliance team will review your background verification file. You will receive an email confirmation with the scheduled interview date and next steps.
                </p>
              </div>
              <p style="font-size: 0.8rem; color: #a399c2;">
                Application ID: <code>#${data.candidateId || 'REC-' + Math.floor(1000 + Math.random() * 9000)}</code> · You may now safely close this window.
              </p>
            </div>
          `;
        }

      } catch (err) {
        console.error('Submission error:', err);
        showLoadingOverlay(false);
        if (serverErr) serverErr.textContent = 'Network or server error. Please ensure the server is running.';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Application ✓';
        }
      }
    });
  }

  // Clean up camera on window unload
  window.addEventListener('pagehide', stopCamera);
})();
