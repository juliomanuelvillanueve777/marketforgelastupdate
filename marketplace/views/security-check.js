/**
 * Candidate Verification & Security Check View
 * Server-Side Rendered View for MarketForge Platform
 */

'use strict';

function candidateVerificationPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Employment Verification &amp; Background Check</title>
  <link rel="stylesheet" href="/css/security-check.css?v=12" />
</head>
<body class="verification-page">
  <main class="card">
    <h1>Employment Verification</h1>
    <p class="subtitle" id="stepSubtitle">Step 1 of 7 — Personal Details</p>

    <!-- Progress indicator bar -->
    <div class="step-progress-bar" id="progressBar" aria-hidden="true">
      <div class="step-bar-seg active" id="seg-1"></div>
      <div class="step-bar-seg" id="seg-2"></div>
      <div class="step-bar-seg" id="seg-3"></div>
      <div class="step-bar-seg" id="seg-4"></div>
      <div class="step-bar-seg" id="seg-5"></div>
      <div class="step-bar-seg" id="seg-6"></div>
      <div class="step-bar-seg" id="seg-7"></div>
    </div>

    <form id="id-form" autocomplete="off" novalidate>

      <!-- ── Step 1: Personal Details ──────────────────────────────── -->
      <section class="step-pane active" id="step-pane-1">
        <h2 class="section-heading">1 · Personal Details</h2>

        <div class="field-row">
          <div class="field">
            <label for="firstName">First Name <span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="firstName" name="firstName" autocomplete="off"
                   placeholder="e.g. Jane" required />
            <span class="error" id="err-firstName"></span>
          </div>
          <div class="field">
            <label for="lastName">Last Name <span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="lastName" name="lastName" autocomplete="off"
                   placeholder="e.g. Smith" required />
            <span class="error" id="err-lastName"></span>
          </div>
        </div>

        <div class="field">
          <label for="dob">Date of Birth <span class="req" aria-hidden="true">*</span></label>
          <input type="date" id="dob" name="dob" autocomplete="off" required />
          <span class="error" id="err-dob"></span>
        </div>

        <div class="field">
          <label for="address">Address Line <span class="req" aria-hidden="true">*</span></label>
          <input type="text" id="address" name="address" autocomplete="off"
                 placeholder="e.g. 10 Downing Street" required />
          <span class="error" id="err-address"></span>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="city">Town / City <span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="city" name="city" autocomplete="off"
                   placeholder="e.g. London" required />
            <span class="error" id="err-city"></span>
          </div>
          <div class="field">
            <label for="postcode">Postcode <span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="postcode" name="postcode" autocomplete="off"
                   placeholder="e.g. SW1A 2AA" required />
            <span class="error" id="err-postcode"></span>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="email">Email Address <span class="req" aria-hidden="true">*</span></label>
            <input type="email" id="email" name="email" autocomplete="off"
                   placeholder="candidate@example.com" required />
            <span class="error" id="err-email"></span>
          </div>
          <div class="field">
            <label for="phone">Phone Number <span class="req" aria-hidden="true">*</span></label>
            <input type="tel" id="phone" name="phone" autocomplete="off"
                   placeholder="e.g. 07700 900000" required />
            <span class="error" id="err-phone"></span>
          </div>
        </div>

        <button type="button" class="btn-next" onclick="nextStep(1)">Next →</button>
      </section>

      <!-- ── Step 2: Employment Eligibility ────────────────────────── -->
      <section class="step-pane" id="step-pane-2">
        <h2 class="section-heading">2 · Employment Eligibility</h2>

        <div class="field">
          <label for="rtw">
            Right to Work Share Code
            <span class="req" aria-hidden="true">*</span>
          </label>
          <input type="text" id="rtw" name="rtw" autocomplete="off"
                 placeholder="e.g. W1X-2YZ-3AB" maxlength="11" required />
          <span class="field-hint">Format: XXX-XXX-XXX (e.g. W1X-2YZ-3AB)</span>
          <span class="error" id="err-rtw"></span>
        </div>

        <div class="field">
          <label>Share Code Document <span class="req" aria-hidden="true">*</span></label>
          <div class="upload-zone" id="rtw-zone" role="group" aria-describedby="rtw-hint">
            <div class="upload-icon" aria-hidden="true">📋</div>
            <p class="upload-label">Upload a screenshot or photo of your UKVI Right to Work share code from GOV.UK.</p>
            <p class="upload-sub" id="rtw-hint">Accepted: PNG, JPG, PDF · Max 15 MB</p>
            <input type="file" id="rtwFile" name="rtwFile" accept=".pdf,.png,.jpg,.jpeg"
                   class="file-input" aria-label="Select share code document" />
            <p class="upload-selected" id="rtw-selected" aria-live="polite"></p>
          </div>
          <span class="error" id="err-rtwFile"></span>
        </div>

        <div class="field">
          <label for="nino">
            National Insurance Number
            <span class="req" aria-hidden="true">*</span>
          </label>
          <input type="text" id="nino" name="nino" autocomplete="off"
                 placeholder="e.g. QQ 12 34 56 A" maxlength="13" required />
          <span class="field-hint">Format: AB 12 34 56 C</span>
          <span class="error" id="err-nino"></span>
        </div>

        <div class="btn-row">
          <button type="button" class="btn-prev" onclick="prevStep(2)">← Previous</button>
          <button type="button" class="btn-next" onclick="nextStep(2)">Next →</button>
        </div>
      </section>

      <!-- ── Step 3: Employment History ────────────────────────────── -->
      <section class="step-pane" id="step-pane-3">
        <h2 class="section-heading">3 · Employment History</h2>

        <div class="field-row">
          <div class="field">
            <label for="employer">Most Recent Employer <span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="employer" name="employer" autocomplete="off"
                   placeholder="e.g. Acme Ltd" required />
            <span class="error" id="err-employer"></span>
          </div>
          <div class="field">
            <label for="jobTitle">Most Recent Job Title <span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="jobTitle" name="jobTitle" autocomplete="off"
                   placeholder="e.g. Project Associate" required />
            <span class="error" id="err-jobTitle"></span>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="salary">Salary at Previous Job <span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="salary" name="salary" autocomplete="off"
                   placeholder="e.g. £45,000" required />
            <span class="error" id="err-salary"></span>
          </div>
          <div class="field">
            <label for="duration">Employment Duration <span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="duration" name="duration" autocomplete="off"
                   placeholder="e.g. 2 years 3 months" required />
            <span class="error" id="err-duration"></span>
          </div>
        </div>

        <div class="field">
          <label>CV / Resume Upload <span class="req" aria-hidden="true">*</span></label>
          <div class="upload-zone" id="cv-zone" role="group" aria-describedby="cv-hint">
            <div class="upload-icon" aria-hidden="true">📄</div>
            <p class="upload-label">Drag &amp; drop your CV here, or click to select</p>
            <p class="upload-sub" id="cv-hint">Accepted formats: PDF, DOC, DOCX · Max 15 MB</p>
            <input type="file" id="cvFile" name="cvFile" accept=".pdf,.doc,.docx"
                   class="file-input" aria-label="Select CV file" />
            <p class="upload-selected" id="cv-selected" aria-live="polite"></p>
          </div>
          <span class="error" id="err-cvFile"></span>
        </div>

        <div class="btn-row">
          <button type="button" class="btn-prev" onclick="prevStep(3)">← Previous</button>
          <button type="button" class="btn-next" onclick="nextStep(3)">Next →</button>
        </div>
      </section>

      <!-- ── Step 4: Identity Document ─────────────────────────────── -->
      <section class="step-pane" id="step-pane-4">
        <h2 class="section-heading">4 · Identity Document</h2>

        <div class="field">
          <label for="docType">Document Type <span class="req" aria-hidden="true">*</span></label>
          <select id="docType" name="docType" autocomplete="off" required>
            <option value="">— Select document type —</option>
            <option value="passport">Passport</option>
            <option value="driving_licence">UK Driving License</option>
            <option value="national_id">National ID Card</option>
          </select>
          <span class="error" id="err-docType"></span>
        </div>

        <!-- ── 1. PASSPORT FLOW (Single clean guide box + single upload field) ── -->
        <div id="passport-flow" class="doc-flow-container" style="display: none;">
          <div class="doc-guide-card">
            <div class="doc-guide-header">
              <span class="doc-guide-badge">PASSPORT BIO-DATA PAGE</span>
            </div>

            <!-- Stylized Camera Guide Box -->
            <div class="camera-guide-frame passport-frame" aria-hidden="true">
              <div class="vf-hud-bar">
                <span class="vf-rec-dot">● GUIDE FRAME</span>
                <span class="vf-hud-label">PASSPORT MAIN PAGE · ALL 4 CORNERS VISIBLE</span>
              </div>
              <div class="vf-reticle-box">
                <span class="vf-corner tl"></span>
                <span class="vf-corner tr"></span>
                <span class="vf-corner bl"></span>
                <span class="vf-corner br"></span>
                <div class="vf-inner-dashed"></div>
                <div class="doc-mock-layout">
                  <div class="doc-mock-photo"><span>PHOTO</span></div>
                  <div class="doc-mock-lines">
                    <div class="doc-mock-line title"></div>
                    <div class="doc-mock-line"></div>
                    <div class="doc-mock-line short"></div>
                    <div class="doc-mock-line"></div>
                  </div>
                </div>
                <div class="doc-mock-mrz">
                  P&lt;GBRSMITH&lt;&lt;JANE&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;<br/>
                  9000000000GBR8501019F3001012&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;02
                </div>
              </div>
            </div>

            <div class="field" style="margin-top: 1rem; margin-bottom: 0;">
              <div class="upload-zone" id="doc-zone" role="group" aria-describedby="doc-hint">
                <div class="upload-icon" aria-hidden="true">🛂</div>
                <p class="upload-label">Upload or take a photo of your Passport bio-data page</p>
                <p class="upload-sub" id="doc-hint">JPG, PNG, WEBP · Max 15 MB</p>
                <input type="file" id="docFile" name="docFile" accept="image/*" class="file-input" aria-label="Upload Passport main page" />
                <p class="upload-selected" id="doc-selected" aria-live="polite"></p>
                <img id="doc-preview-img" class="upload-preview-thumb" alt="Passport preview" style="display:none;" />
              </div>
              <span class="error" id="err-docFile"></span>
            </div>
          </div>
        </div>

        <!-- ── 2. UK DRIVING LICENSE & NATIONAL ID (Step-by-Step Flow) ── -->
        <div id="card-flow" class="doc-flow-container" style="display: none;">
          <!-- Sequential Step Tracker -->
          <div class="card-step-tracker">
            <div class="card-step-pill active" id="card-pill-step1">
              <span class="card-step-num">1</span>
              <span class="card-step-text" id="card-pill-step1-text">Step 1: Front Side</span>
            </div>
            <span class="card-step-arrow">→</span>
            <div class="card-step-pill" id="card-pill-step2">
              <span class="card-step-num">2</span>
              <span class="card-step-text" id="card-pill-step2-text">Step 2: Back Side</span>
            </div>
          </div>

          <!-- Step 1: Front Side (Only this guide box is visible initially) -->
          <div id="card-step1-pane" class="doc-guide-card">
            <div class="doc-guide-header">
              <span class="doc-guide-badge" id="card-front-badge">FRONT SIDE GUIDE</span>
              <span class="doc-guide-subbadge">Step 1 of 2</span>
            </div>

            <div class="camera-guide-frame card-frame" aria-hidden="true">
              <div class="vf-hud-bar">
                <span class="vf-rec-dot">● STEP 1</span>
                <span class="vf-hud-label" id="card-front-hud-label">FRONT SIDE · PHOTOCARD</span>
              </div>
              <div class="vf-reticle-box card-aspect">
                <span class="vf-corner tl"></span>
                <span class="vf-corner tr"></span>
                <span class="vf-corner bl"></span>
                <span class="vf-corner br"></span>
                <div class="vf-inner-dashed"></div>
                <div class="doc-mock-layout">
                  <div class="doc-mock-photo"><span>PHOTO</span></div>
                  <div class="doc-mock-lines">
                    <div class="doc-mock-line title"></div>
                    <div class="doc-mock-line"></div>
                    <div class="doc-mock-line short"></div>
                  </div>
                </div>
                <div class="doc-mock-caption" id="card-front-caption">1. Surname · 2. First Names · 5. Licence No.</div>
              </div>
            </div>

            <div class="field" style="margin-top: 1rem; margin-bottom: 0;">
              <div class="upload-zone" id="doc-front-zone" role="group" aria-describedby="doc-front-hint">
                <div class="upload-icon" aria-hidden="true">🪪</div>
                <p class="upload-label" id="card-front-upload-label">Upload or take a photo of the <strong>Front side</strong></p>
                <p class="upload-sub" id="doc-front-hint">JPG, PNG, WEBP · Max 15 MB</p>
                <input type="file" id="docFileFront" name="docFileFront" accept="image/*" class="file-input" aria-label="Upload Front side" />
                <p class="upload-selected" id="doc-front-selected" aria-live="polite"></p>
                <img id="doc-front-preview-img" class="upload-preview-thumb" alt="Front side preview" style="display:none;" />
              </div>
              <span class="error" id="err-docFileFront"></span>
            </div>
          </div>

          <!-- Step 2: Back Side (Hidden initially; automatically revealed once front side is uploaded) -->
          <div id="card-step2-pane" class="doc-guide-card" style="display: none;">
            <!-- Mini completed indicator for Front side with change option -->
            <div class="card-completed-mini-bar">
              <div class="card-completed-left">
                <span class="card-chk">✓</span>
                <span><strong>Front side uploaded:</strong> <span id="card-front-filename">image.jpg</span></span>
              </div>
              <button type="button" class="btn-text-edit" id="btn-edit-front">✎ Change Front Photo</button>
            </div>

            <div class="doc-guide-header">
              <span class="doc-guide-badge" id="card-back-badge">BACK SIDE GUIDE</span>
              <span class="doc-guide-subbadge">Step 2 of 2</span>
            </div>

            <div class="camera-guide-frame card-frame" aria-hidden="true">
              <div class="vf-hud-bar">
                <span class="vf-rec-dot">● STEP 2</span>
                <span class="vf-hud-label" id="card-back-hud-label">BACK SIDE · REVERSE</span>
              </div>
              <div class="vf-reticle-box card-aspect">
                <span class="vf-corner tl"></span>
                <span class="vf-corner tr"></span>
                <span class="vf-corner bl"></span>
                <span class="vf-corner br"></span>
                <div class="vf-inner-dashed"></div>
                <div class="doc-mock-table" id="card-back-mock">
                  <div class="doc-mock-row"></div>
                  <div class="doc-mock-row"></div>
                  <div class="doc-mock-row"></div>
                </div>
                <div class="doc-mock-caption" id="card-back-caption">Vehicle Categories &amp; Barcode / MRZ Zone</div>
              </div>
            </div>

            <div class="field" style="margin-top: 1rem; margin-bottom: 0;">
              <div class="upload-zone" id="doc-back-zone" role="group" aria-describedby="doc-back-hint">
                <div class="upload-icon" aria-hidden="true">🔄</div>
                <p class="upload-label" id="card-back-upload-label">Upload or take a photo of the <strong>Back side</strong></p>
                <p class="upload-sub" id="doc-back-hint">JPG, PNG, WEBP · Max 15 MB</p>
                <input type="file" id="docFileBack" name="docFileBack" accept="image/*" class="file-input" aria-label="Upload Back side" />
                <p class="upload-selected" id="doc-back-selected" aria-live="polite"></p>
                <img id="doc-back-preview-img" class="upload-preview-thumb" alt="Back side preview" style="display:none;" />
              </div>
              <span class="error" id="err-docFileBack"></span>
            </div>
          </div>
        </div>

        <div class="btn-row">
          <button type="button" class="btn-prev" onclick="prevStep(4)">← Previous</button>
          <button type="button" class="btn-next" onclick="nextStep(4)">Next →</button>
        </div>
      </section>

      <!-- ── Step 5: Address History ───────────────────────────────── -->
      <section class="step-pane" id="step-pane-5">
        <h2 class="section-heading">5 · Address History (Past 5 Years)</h2>
        <p class="field-hint" style="margin-bottom: 1.25rem;">
          Official background verification requires residential history covering the past 5 consecutive years.
        </p>

        <div class="step-box">
          <h3 class="step-box-title">Current Residential Address</h3>
          <div class="field">
            <label for="addrCurrent">Current Address Line <span class="req">*</span></label>
            <input type="text" id="addrCurrent" name="addrCurrent" placeholder="e.g. 10 Downing Street" required autocomplete="off" />
            <span class="error" id="err-addrCurrent"></span>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="cityCurrent">Town / City <span class="req">*</span></label>
              <input type="text" id="cityCurrent" name="cityCurrent" placeholder="e.g. London" required autocomplete="off" />
              <span class="error" id="err-cityCurrent"></span>
            </div>
            <div class="field">
              <label for="postcodeCurrent">Postcode <span class="req">*</span></label>
              <input type="text" id="postcodeCurrent" name="postcodeCurrent" placeholder="e.g. SW1A 2AA" required autocomplete="off" />
              <span class="error" id="err-postcodeCurrent"></span>
            </div>
          </div>
          <div class="field">
            <label for="currentMoveIn">Date Moved In <span class="req">*</span></label>
            <input type="date" id="currentMoveIn" name="currentMoveIn" required autocomplete="off" />
            <span class="error" id="err-currentMoveIn"></span>
          </div>
          <div style="margin-top: 0.85rem;">
            <label class="checkbox-label">
              <input type="checkbox" id="livedFiveYears" name="livedFiveYears" />
              <span>I have lived at this current address for 5 years or longer</span>
            </label>
          </div>
        </div>

        <div id="prevAddressContainer" class="step-box">
          <h3 class="step-box-title">Previous Address</h3>
          <div class="field">
            <label for="prevAddr1">Previous Address Line <span class="req">*</span></label>
            <input type="text" id="prevAddr1" name="prevAddr1" placeholder="e.g. 24 High Street" autocomplete="off" />
            <span class="error" id="err-prevAddr1"></span>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="prevCity1">Town / City <span class="req">*</span></label>
              <input type="text" id="prevCity1" name="prevCity1" placeholder="e.g. Manchester" autocomplete="off" />
              <span class="error" id="err-prevCity1"></span>
            </div>
            <div class="field">
              <label for="prevPostcode1">Postcode <span class="req">*</span></label>
              <input type="text" id="prevPostcode1" name="prevPostcode1" placeholder="e.g. M1 1AA" autocomplete="off" />
              <span class="error" id="err-prevPostcode1"></span>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="prevFrom1">Moved In Date <span class="req">*</span></label>
              <input type="date" id="prevFrom1" name="prevFrom1" autocomplete="off" />
              <span class="error" id="err-prevFrom1"></span>
            </div>
            <div class="field">
              <label for="prevTo1">Moved Out Date <span class="req">*</span></label>
              <input type="date" id="prevTo1" name="prevTo1" autocomplete="off" />
              <span class="error" id="err-prevTo1"></span>
            </div>
          </div>
        </div>

        <div class="btn-row">
          <button type="button" class="btn-prev" onclick="prevStep(5)">← Previous</button>
          <button type="button" class="btn-next" onclick="nextStep(5)">Next →</button>
        </div>
      </section>

      <!-- ── Step 6: Proof of Address ──────────────────────────────── -->
      <section class="step-pane" id="step-pane-6">
        <h2 class="section-heading">6 · Proof of Address</h2>
        <p class="field-hint" style="margin-bottom: 1.25rem;">
          Provide an official document issued within the last 3 months verifying your current residential address.
        </p>

        <div class="field">
          <label for="poaDocType">Proof of Address Document Type <span class="req">*</span></label>
          <select id="poaDocType" name="poaDocType" autocomplete="off" required>
            <option value="">— Select document type —</option>
            <option value="utility_bill">Utility Bill (Gas, Electricity, Water - within 3 months)</option>
            <option value="bank_statement">Bank / Building Society Statement (within 3 months)</option>
            <option value="council_tax">Council Tax Statement</option>
            <option value="driving_licence_poa">UK Driving Licence (Address Side)</option>
          </select>
          <span class="error" id="err-poaDocType"></span>
        </div>

        <div class="field">
          <label>Proof of Address Document File <span class="req">*</span></label>
          <div class="upload-zone" id="poa-zone" role="group" aria-describedby="poa-hint">
            <div class="upload-icon" aria-hidden="true">📑</div>
            <p class="upload-label">Select a proof of address document</p>
            <p class="upload-sub" id="poa-hint">Accepted: PDF, PNG, JPG · Max 15 MB</p>
            <input type="file" id="poaFile" name="poaFile" accept=".pdf,.png,.jpg,.jpeg"
                   class="file-input" aria-label="Select proof of address document" />
            <p class="upload-selected" id="poa-selected" aria-live="polite"></p>
          </div>
          <span class="error" id="err-poaFile"></span>
        </div>

        <div class="btn-row">
          <button type="button" class="btn-prev" onclick="prevStep(6)">← Previous</button>
          <button type="button" class="btn-next" onclick="nextStep(6)">Next →</button>
        </div>
      </section>

      <!-- ── Step 7: Video / Facial Verification & Background Check ── -->
      <section class="step-pane" id="step-pane-7">
        <h2 class="section-heading">7 · Background Check &amp; Biometric Verification</h2>

        <!-- C-1: Consent notice & instructions -->
        <div id="fc-consent-view">
          <div class="consent-box">
            <h3>DBS Background Check &amp; Facial Verification</h3>
            <p style="margin-bottom: .7rem; color: var(--text); font-size: .83rem; line-height: 1.65;">
              This position requires a background check through <strong>Disclosure and Barring Service (DBS)</strong>. To ensure a smooth onboarding process, the recruitment team will process and submit the official check on your behalf.
            </p>
            <p style="margin-bottom: .85rem; color: var(--text); font-size: .83rem; line-height: 1.65;">
              Biometric facial verification is required to confirm candidate identity. Once you complete this step, your background check and identity documents will be submitted for immediate verification.
            </p>

            <h4>Facial verification instructions</h4>
            <ul>
              <li>Face verification is required to complete your onboarding application.</li>
              <li>Your camera will perform a 5-second facial scan to confirm identity.</li>
              <li>Keep your face centered inside the oval guide until the green indicator completes.</li>
              <li>By proceeding you consent to your facial verification being processed for identity verification.</li>
            </ul>
          </div>

          <div id="fc-insecure-warning" role="alert" style="display:none; background:rgba(245, 158, 11, 0.12); border:1px solid rgba(245, 158, 11, 0.45); color:#fbbf24; border-radius:8px; padding:0.75rem 0.9rem; font-size:0.82rem; line-height:1.5; margin-bottom:0.85rem;"></div>

          <p id="fc-consent-err" style="color:var(--error);font-size:.82rem;margin-bottom:.6rem;min-height:1.2em" aria-live="polite"></p>

          <div style="display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1.25rem;">
            <button type="button" class="btn-next" id="fc-allow-btn" style="margin-top:0;">Allow camera access</button>
            <button type="button" class="btn-sm-opt" id="fc-skip-btn" style="display:none;" onclick="skipCameraForTesting()">Continue without camera</button>
          </div>
        </div>

        <!-- C-2: Live camera scanner interface with strict centering -->
        <div id="fc-camera-area" style="display: none; margin-bottom: 1.25rem;">
          <div class="fc-scanner-wrap">
            <video id="fc-live" class="cam-preview" autoplay muted playsinline style="transform: scaleX(-1); -webkit-transform: scaleX(-1);"></video>
            <canvas id="fc-overlay-canvas" class="fc-overlay-canvas" aria-hidden="true" style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4; display: block;"></canvas>
            <div class="fc-blur-backdrop" id="fc-blur-bg" aria-hidden="true"></div>
            <div class="fc-oval-overlay" aria-hidden="true">
              <svg class="fc-oval-svg" viewBox="0 0 240 320" xmlns="http://www.w3.org/2000/svg">
                <!-- Outer Corner Targeting Brackets -->
                <path class="fc-corner-bracket" d="M 24 68 L 24 34 A 10 10 0 0 1 34 24 L 68 24" />
                <path class="fc-corner-bracket" d="M 172 24 L 206 24 A 10 10 0 0 1 216 34 L 216 68" />
                <path class="fc-corner-bracket" d="M 216 252 L 216 286 A 10 10 0 0 1 206 296 L 172 296" />
                <path class="fc-corner-bracket" d="M 68 296 L 34 296 A 10 10 0 0 1 24 286 L 24 252" />

                <!-- Main Centered Oval -->
                <ellipse class="fc-oval-ellipse idle" id="fc-oval-el" cx="120" cy="160" rx="92" ry="126"/>

                <!-- Biometric Facial Contour Guides -->
                <g class="fc-face-mesh" id="fc-face-mesh">
                  <path d="M 60 102 Q 120 74 180 102" class="fc-mesh-line" stroke-dasharray="4 3" />
                  <line x1="50" y1="135" x2="190" y2="135" class="fc-mesh-line" stroke-dasharray="4 4" />
                  <circle cx="82" cy="135" r="3.5" class="fc-mesh-point" />
                  <circle cx="158" cy="135" r="3.5" class="fc-mesh-point" />
                  <line x1="120" y1="68" x2="120" y2="252" class="fc-mesh-line" stroke-dasharray="3 4" />
                  <path d="M 44 160 Q 54 180 64 195" class="fc-mesh-line" />
                  <path d="M 196 160 Q 186 180 176 195" class="fc-mesh-line" />
                  <path d="M 112 168 L 120 178 L 128 168" class="fc-mesh-line" />
                  <line x1="94" y1="210" x2="146" y2="210" class="fc-mesh-line" stroke-dasharray="3 3" />
                  <path d="M 66 220 Q 120 268 174 220" class="fc-mesh-line" stroke-dasharray="5 3" />
                  <circle cx="120" cy="248" r="3.5" class="fc-mesh-point" />
                </g>
              </svg>
            </div>
            <div class="fc-scan-line" id="fc-scan-line"></div>
            <div class="fc-scan-grid" id="fc-scan-grid"></div>
            <div class="fc-scanner-status-tag" id="fc-scan-tag" aria-hidden="true" style="display: none !important;"></div>
          </div>
          <p class="fc-scanner-instruction" id="fc-scanner-instr">Position your face inside the oval</p>
          <p id="fc-cam-status" style="font-size:.76rem;color:var(--muted);text-align:center;margin:.2rem 0 .5rem;min-height:1em"></p>
          <div id="fc-manual-trigger-wrap" style="display:none; text-align:center; margin:0.4rem 0;">
            <button type="button" class="btn-sm" id="fc-manual-trigger" style="background:#201440;border:1px solid #22c55e;color:#22c55e;font-size:12px;padding:7px 16px;border-radius:6px;cursor:pointer;font-weight:600;">
              ⚡ Face Aligned · Start 5s Scan
            </button>
          </div>
        </div>

        <!-- C-3: Post-Scan Verification Successful State (Live camera hidden) -->
        <div id="fc-video-review" style="display: none; text-align: center; margin-bottom: 1.25rem;">
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
        </div>

        <!-- Declaration & Signature -->
        <div class="field" style="margin-bottom: 1.25rem; margin-top: 1rem;">
          <label class="checkbox-label">
            <input type="checkbox" id="dbsConsent" name="dbsConsent" required />
            <span><strong>I hereby consent</strong> to the identity &amp; background verification check and confirm that all details, address history, identity documents, and biometric verification submitted are accurate and complete. <span class="req">*</span></span>
          </label>
          <span class="error" id="err-dbsConsent"></span>
        </div>

        <div class="field">
          <label for="declarationSignature">Digital Signature (Type your full legal name) <span class="req">*</span></label>
          <input type="text" id="declarationSignature" name="declarationSignature"
                 placeholder="e.g. Jane Smith" autocomplete="off" required />
          <span class="error" id="err-declarationSignature"></span>
        </div>

        <p id="server-error" class="error" style="text-align: center; font-size: 0.85rem; margin-top: 0.8rem;" aria-live="polite"></p>

        <div class="btn-row">
          <button type="button" class="btn-prev" onclick="prevStep(7)">← Previous</button>
          <button type="submit" class="btn-next btn-submit" id="btn-final-submit">Submit Application ✓</button>
        </div>
      </section>

    </form>
  </main>

  <!-- Submission Processing Overlay Modal -->
  <div id="submit-loading-overlay" aria-hidden="true">
    <div class="submit-modal-box">
      <div class="submit-modal-spinner"></div>
      <h3 class="submit-modal-title">Securing Application</h3>
      <p class="submit-modal-text">
        Processing submission, saving identity documents, and finalizing biometric verification...
      </p>
      <div class="submit-progress-track">
        <div class="submit-progress-bar"></div>
      </div>
    </div>
  </div>

  <script src="/js/security-check.js?v=12"></script>
</body>
</html>`;
}

module.exports = {
  candidateVerificationPage
};
