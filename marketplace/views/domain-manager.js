/**
 * Domain Manager Server-Side Rendered View
 * MarketForge Admin & Client Dashboard
 */

'use strict';

function domainManagerPage({ domains, stats, serverIp, candidateDomain, basePath = '/admin/domains' }) {
  const safeEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const domainRows = domains.map(d => {
    // Status Badge
    let statusBadge = '';
    const st = (d.status || 'Draft').toLowerCase();
    if (st === 'live') {
      statusBadge = `<span style="background:rgba(34,197,94,0.18);color:#22c55e;border:1px solid rgba(34,197,94,0.4);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:5px"><span style="width:6px;height:6px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px #22c55e"></span> LIVE</span>`;
    } else if (st === 'ssl active') {
      statusBadge = `<span style="background:rgba(6,182,212,0.18);color:#22d3ee;border:1px solid rgba(6,182,212,0.4);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700">SSL ACTIVE</span>`;
    } else if (st === 'dns verified') {
      statusBadge = `<span style="background:rgba(245,158,11,0.18);color:#f59e0b;border:1px solid rgba(245,158,11,0.4);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700">DNS VERIFIED</span>`;
    } else {
      statusBadge = `<span style="background:rgba(148,163,184,0.15);color:#94a3b8;border:1px solid rgba(148,163,184,0.3);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700">DRAFT</span>`;
    }

    // Target Service Badge
    let serviceBadge = '';
    if (d.target_service === 'security_check') {
      serviceBadge = `<span style="background:rgba(168,85,247,0.18);color:#c084fc;border:1px solid rgba(168,85,247,0.35);padding:4px 9px;border-radius:6px;font-size:11.5px;font-weight:600">🛡️ Security Check Lab</span>`;
    } else if (d.target_service === 'landing') {
      serviceBadge = `<span style="background:rgba(59,130,246,0.18);color:#60a5fa;border:1px solid rgba(59,130,246,0.35);padding:4px 9px;border-radius:6px;font-size:11.5px;font-weight:600">🏢 Platform Landing</span>`;
    } else {
      serviceBadge = `<span style="background:rgba(16,185,129,0.18);color:#34d399;border:1px solid rgba(16,185,129,0.35);padding:4px 9px;border-radius:6px;font-size:11.5px;font-weight:600">🛍️ Main Marketplace</span>`;
    }

    // Active Toggle Switch
    const activeSwitch = d.is_active
      ? `<form method="POST" action="${basePath}/${d.id}/toggle" style="display:inline"><button type="submit" style="background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);color:#22c55e;padding:4px 9px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">ACTIVE</button></form>`
      : `<form method="POST" action="${basePath}/${d.id}/toggle" style="display:inline"><button type="submit" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#ef4444;padding:4px 9px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">PAUSED</button></form>`;

    // SSL Expiration
    let sslText = '<span style="color:#666;font-size:12px">No SSL Certificate</span>';
    if (d.ssl_expires_at) {
      const expDate = new Date(d.ssl_expires_at);
      const daysLeft = Math.round((expDate - new Date()) / (1000 * 60 * 60 * 24));
      const color = daysLeft <= 15 ? '#ef4444' : daysLeft <= 30 ? '#f59e0b' : '#34d399';
      sslText = `
        <div style="font-size:12px;font-weight:600;color:${color}">🔒 ${d.ssl_provider || 'SSL'}</div>
        <div style="font-size:11px;color:#a399c2">Expires in ${daysLeft} days (${expDate.toLocaleDateString()})</div>
      `;
    }

    // Local Test Domain Indicator
    const isLocal = d.domain.endsWith('.local') || d.domain.endsWith('.test') || d.domain === 'localhost' || d.domain === '127.0.0.1';
    const localNote = isLocal
      ? `<div style="font-size:11px;color:#fbbf24;margin-top:4px;display:flex;align-items:center;gap:5px;flex-wrap:wrap">
           <span>💻 Hosts:</span>
           <code style="background:#090514;padding:1px 6px;border-radius:4px;border:1px solid #3b2866;color:#34d399">127.0.0.1 ${safeEsc(d.domain)}</code>
           <button type="button" onclick="navigator.clipboard.writeText('127.0.0.1 ${safeEsc(d.domain)}');alert('Copied to clipboard: 127.0.0.1 ${safeEsc(d.domain)}');" title="Copy hosts entry" style="background:#201440;border:1px solid #3b2866;color:#c4b5fd;border-radius:4px;font-size:10px;padding:2px 6px;cursor:pointer">📋 Copy</button>
         </div>`
      : '';

    return `
      <tr>
        <td style="font-weight:700;color:#c4b5fd">#${d.id}</td>
        <td>
          <a href="https://${safeEsc(d.domain)}" target="_blank" style="color:#fff;font-weight:600;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:6px">
            🌐 ${safeEsc(d.domain)} <span style="font-size:11px;color:#a855f7">↗</span>
          </a>
          <div style="font-size:11.5px;color:#a399c2;margin-top:2px">
            Added: ${d.created_at || '—'} · ${d.auto_renew ? '🔄 Auto-Renew On' : 'Manual'}
          </div>
          ${localNote}
        </td>
        <td>${serviceBadge}</td>
        <td>${statusBadge}</td>
        <td style="font-size:12.5px;color:#e2e8f0;font-family:monospace">
          ${d.dns_ip ? `<code>${safeEsc(d.dns_ip)}</code>` : '<span style="color:#666">—</span>'}
        </td>
        <td>${sslText}</td>
        <td>${activeSwitch}</td>
        <td style="white-space:nowrap">
          <!-- Action: Test Domain Routing Locally on Localhost -->
          <a href="/?_host=${encodeURIComponent(d.domain)}" target="_blank" title="Test domain routing instantly on localhost:3000 without editing hosts file" style="background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.35);color:#38bdf8;padding:6px 10px;border-radius:6px;font-size:11.5px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-right:4px">
            🧪 Test Local ↗
          </a>

          <!-- Action: Activate Domain & Issue SSL -->
          <form method="POST" action="${basePath}/${d.id}/issue-ssl" style="display:inline;margin-right:4px">
            <button type="submit" title="Verify DNS, Issue SSL certificate, and make domain Live" style="background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;padding:6px 11px;border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
              ⚡ Activate &amp; Issue SSL
            </button>
          </form>

          <!-- Action: Verify DNS -->
          <form method="POST" action="${basePath}/${d.id}/verify-dns" style="display:inline;margin-right:4px">
            <button type="submit" title="Check DNS A-record propagation" style="background:#201440;border:1px solid #3b2866;color:#c4b5fd;padding:6px 9px;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer">
              🔍 DNS
            </button>
          </form>

          <!-- Action: Edit Target Service -->
          <button type="button" onclick="openEditModal(${d.id}, '${safeEsc(d.domain)}', '${safeEsc(d.target_service)}', ${d.auto_renew ? 1 : 0})" style="background:#1f1638;border:1px solid #3b2866;color:#fff;padding:6px 9px;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer;margin-right:4px">
            ✏️
          </button>

          <!-- Action: Delete -->
          <form method="POST" action="${basePath}/${d.id}/delete" onsubmit="return confirm('Delete custom domain ${safeEsc(d.domain)} and remove SSL certificates?')" style="display:inline">
            <button type="submit" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:6px 9px;border-radius:6px;font-size:11px;cursor:pointer">
              🗑️
            </button>
          </form>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="8" style="text-align:center;padding:40px;color:#888">No custom domains added yet. Click "+ Add Custom Domain" to get started.</td></tr>`;

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;margin-bottom:20px">
      <div>
        <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#fff">🌐 Automated Domain Manager &amp; SSL Provisioner</h1>
        <p style="color:#a399c2;font-size:14px;margin:0">Manage custom domains, automated ACME / Let's Encrypt SSL issuance, and zero-restart dynamic HTTPS routing.</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button type="button" onclick="openAddModal()" style="padding:10px 18px;background:linear-gradient(135deg,#7c3aed,#9333ea);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;box-shadow:0 4px 14px rgba(124,58,237,0.35)">
          + Add Custom Domain
        </button>
        <form method="POST" action="${basePath}/check-renewals" style="display:inline">
          <button type="submit" style="padding:10px 16px;background:#1c1436;border:1px solid #2e2055;color:#c4b5fd;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer">
            🔄 Check SSL Renewals
          </button>
        </form>
      </div>
    </div>

    <!-- Active Service Indicator Banner -->
    <div style="background:linear-gradient(135deg,#181033,#130d29);border:1px solid #3b2866;border-radius:12px;padding:16px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:18px">🛡️👤</span>
          <strong style="color:#fff;font-size:14px">Active Security Check Lab Custom Domain</strong>
          ${candidateDomain ? `<span style="background:rgba(34,197,94,0.18);color:#22c55e;border:1px solid rgba(34,197,94,0.4);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">HTTPS ACTIVE</span>` : `<span style="background:rgba(245,158,11,0.18);color:#f59e0b;padding:2px 8px;border-radius:6px;font-size:11px">Default Route</span>`}
        </div>
        <p style="color:#a399c2;font-size:12.5px;margin:0">
          ${candidateDomain ? `All candidate application links &amp; email invitations automatically use: <strong style="color:#22c55e">https://${safeEsc(candidateDomain)}/apply</strong>
          <a href="/?_host=${encodeURIComponent(candidateDomain)}" target="_blank" style="margin-left:8px;color:#38bdf8;font-size:11px;text-decoration:none;background:rgba(56,189,248,0.12);padding:2px 7px;border-radius:4px;border:1px solid rgba(56,189,248,0.3);display:inline-flex;align-items:center;gap:3px">
            🧪 Preview Form on Localhost ↗
          </a>` : 'No custom domain assigned yet to Security Check Lab. Add and assign a domain below to brand candidate verification links.'}
        </p>
      </div>
      <div>
        <a href="/dashboard/security-check/records" style="padding:8px 14px;background:#201440;border:1px solid #3b2866;color:#c4b5fd;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none">
          📁 View Security Check Records →
        </a>
      </div>
    </div>

    <!-- Local Development & Hosts Configuration Helper Box -->
    <div style="background:#130c26;border:1px solid #3b2866;border-radius:12px;padding:16px 20px;margin-bottom:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:18px">💡</span>
          <strong style="color:#fff;font-size:14px">Local Testing &amp; Development Domains Helper</strong>
          <span style="background:rgba(245,158,11,0.18);color:#fbbf24;border:1px solid rgba(245,158,11,0.35);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">DEVELOPMENT TIP</span>
        </div>
        <button type="button" onclick="toggleHostsGuide()" id="btnToggleHosts" style="background:#201440;border:1px solid #3b2866;color:#c4b5fd;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">
          How to configure hosts file ▼
        </button>
      </div>
      <p style="color:#a399c2;font-size:12.5px;margin:0 0 10px 0;line-height:1.5">
        • <strong>Production Domains:</strong> Point your public DNS A-Record to this server's public IP address before issuing Let's Encrypt SSL.<br>
        • <strong>Local Test Domains (e.g. <code>*.local</code> or <code>*.test</code>):</strong> Require an entry in your local OS <code>hosts</code> file so your browser routes the domain to localhost:<br>
        <code style="display:inline-block;background:#090514;border:1px solid #2e2055;padding:4px 10px;border-radius:6px;color:#34d399;font-size:12px;margin:4px 0">127.0.0.1  apply.security-check.local</code>
      </p>
      <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:8px;padding:10px 14px;font-size:12.5px;color:#93c5fd;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span>🚀 <strong>Zero-Config Local Test:</strong> You don't need to modify your hosts file! Click <strong>"🧪 Test Local ↗"</strong> in the table below to test any domain instantly via standard localhost (<code>/?_host=domain</code>).</span>
      </div>

      <!-- Collapsible detailed hosts guide -->
      <div id="hostsGuideDetail" style="display:none;margin-top:14px;padding-top:14px;border-top:1px dashed #2e2055;font-size:12px;color:#cbd5e1">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">
          <div style="background:#0a0614;border:1px solid #2e2055;border-radius:8px;padding:12px">
            <strong style="color:#fff;display:block;margin-bottom:6px">🪟 Windows Setup (Run as Administrator):</strong>
            1. Open Notepad / text editor as <em>Administrator</em>.<br>
            2. Open: <code>C:\\Windows\\System32\\drivers\\etc\\hosts</code><br>
            3. Add: <code style="color:#34d399">127.0.0.1  apply.security-check.local</code><br>
            4. Save and navigate to <code>http://apply.security-check.local:3000</code> in your browser.
          </div>
          <div style="background:#0a0614;border:1px solid #2e2055;border-radius:8px;padding:12px">
            <strong style="color:#fff;display:block;margin-bottom:6px">🍎 macOS / 🐧 Linux Setup:</strong>
            1. Open Terminal and run: <code>sudo nano /etc/hosts</code><br>
            2. Add: <code style="color:#34d399">127.0.0.1  apply.security-check.local</code><br>
            3. Save (<kbd>Ctrl+O</kbd>, <kbd>Enter</kbd>) and exit (<kbd>Ctrl+X</kbd>).<br>
            4. Navigate to <code>http://apply.security-check.local:3000</code> in your browser.
          </div>
        </div>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="stats-grid" style="margin-bottom:24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
      <div class="stat-card" style="background:#150f28;border:1px solid #2e2055;padding:16px 20px;border-radius:12px">
        <div class="stat-num" style="font-size:26px;font-weight:700;color:#fff">${stats.total}</div>
        <div style="color:#a399c2;font-size:13px">Total Managed Domains</div>
      </div>
      <div class="stat-card" style="background:#150f28;border:1px solid #2e2055;padding:16px 20px;border-radius:12px">
        <div class="stat-num" style="font-size:26px;font-weight:700;color:#22c55e">${stats.live}</div>
        <div style="color:#a399c2;font-size:13px">Live HTTPS Domains</div>
      </div>
      <div class="stat-card" style="background:#150f28;border:1px solid #2e2055;padding:16px 20px;border-radius:12px">
        <div class="stat-num" style="font-size:26px;font-weight:700;color:#c084fc">${stats.securityCheck}</div>
        <div style="color:#a399c2;font-size:13px">Security Check Domains</div>
      </div>
      <div class="stat-card" style="background:#150f28;border:1px solid #2e2055;padding:16px 20px;border-radius:12px">
        <div class="stat-num" style="font-size:26px;font-weight:700;color:#38bdf8">${stats.dnsVerified}</div>
        <div style="color:#a399c2;font-size:13px">DNS Verified</div>
      </div>
    </div>

    <!-- Domains Table Panel -->
    <div class="panel" style="background:#150f28;border:1px solid #2e2055;border-radius:14px;padding:20px;overflow-x:auto">
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:1px solid #2e2055;color:#a399c2;text-align:left">
            <th style="padding:12px 14px">ID</th>
            <th style="padding:12px 14px">Domain Name</th>
            <th style="padding:12px 14px">Target Service</th>
            <th style="padding:12px 14px">Status</th>
            <th style="padding:12px 14px">DNS Resolved IP</th>
            <th style="padding:12px 14px">SSL Certificate</th>
            <th style="padding:12px 14px">Traffic</th>
            <th style="padding:12px 14px">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${domainRows}
        </tbody>
      </table>
    </div>

    <!-- Add Custom Domain Modal -->
    <div id="addDomainModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px)">
      <div style="background:#150f28;border:1px solid #3b2866;border-radius:14px;max-width:540px;width:100%;padding:24px;box-shadow:0 25px 60px rgba(0,0,0,0.8)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="color:#fff;font-size:17px;margin:0">🌐 Add New Custom Domain</h3>
          <button type="button" onclick="closeAddModal()" style="background:none;border:none;color:#a399c2;font-size:22px;cursor:pointer">&times;</button>
        </div>
        <form method="POST" action="${basePath}">
          <div style="margin-bottom:14px">
            <label style="color:#a399c2;font-size:12px;display:block;margin-bottom:4px">Domain / Subdomain Name *</label>
            <input type="text" name="domain" placeholder="e.g. verify.yourdomain.com or apply.security-check.local" required style="width:100%;background:#0a0614;border:1px solid #3b2866;color:#fff;border-radius:6px;padding:9px 12px;font-size:13px;box-sizing:border-box" />
            <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:6px;padding:8px 12px;margin-top:6px;font-size:11.5px;color:#fbbf24;line-height:1.4">
              💡 <strong>DNS &amp; Hosts Note:</strong><br>
              • <strong>Production:</strong> Point your DNS A-Record to this server's public IP before issuing SSL.<br>
              • <strong>Local Development:</strong> Local domains (<code>*.local</code>, <code>localhost</code>) need an entry in your hosts file (<code>127.0.0.1 domain</code>) or can be tested instantly using standard localhost via <code>/?_host=domain</code>.
            </div>
          </div>

          <div style="margin-bottom:14px">
            <label style="color:#a399c2;font-size:12px;display:block;margin-bottom:4px">Primary Target Service *</label>
            <select name="target_service" style="width:100%;background:#0a0614;border:1px solid #3b2866;color:#fff;border-radius:6px;padding:9px 12px;font-size:13px;box-sizing:border-box">
              <option value="security_check" selected>🛡️ Security Check Lab / Candidate Application Form</option>
              <option value="marketplace">🛍️ Main Marketplace Platform</option>
              <option value="landing">🏢 Custom Platform Landing / Other Services</option>
            </select>
          </div>

          <div style="margin-bottom:18px">
            <label class="checkbox-row" style="color:#e2e8f0;font-size:13px;display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="auto_renew" value="1" checked style="width:16px;height:16px;cursor:pointer" />
              <span>Enable Automated Background SSL Renewals (30 days before expiration)</span>
            </label>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px">
            <button type="button" onclick="closeAddModal()" style="background:#1f1638;border:1px solid #3b2866;color:#fff;padding:8px 16px;border-radius:6px;font-size:12.5px;cursor:pointer">Cancel</button>
            <button type="submit" style="background:linear-gradient(135deg,#7c3aed,#9333ea);color:#fff;border:none;padding:9px 20px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer">Add Domain</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Custom Domain Modal -->
    <div id="editDomainModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px)">
      <div style="background:#150f28;border:1px solid #3b2866;border-radius:14px;max-width:540px;width:100%;padding:24px;box-shadow:0 25px 60px rgba(0,0,0,0.8)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="color:#fff;font-size:17px;margin:0">✏️ Edit Domain Configuration</h3>
          <button type="button" onclick="closeEditModal()" style="background:none;border:none;color:#a399c2;font-size:22px;cursor:pointer">&times;</button>
        </div>
        <form id="editDomainForm" method="POST" action="">
          <div style="margin-bottom:14px">
            <label style="color:#a399c2;font-size:12px;display:block;margin-bottom:4px">Domain Name</label>
            <input type="text" id="editDomainInput" name="domain" required style="width:100%;background:#0a0614;border:1px solid #3b2866;color:#fff;border-radius:6px;padding:9px 12px;font-size:13px;box-sizing:border-box" />
          </div>

          <div style="margin-bottom:14px">
            <label style="color:#a399c2;font-size:12px;display:block;margin-bottom:4px">Primary Target Service</label>
            <select id="editServiceSelect" name="target_service" style="width:100%;background:#0a0614;border:1px solid #3b2866;color:#fff;border-radius:6px;padding:9px 12px;font-size:13px;box-sizing:border-box">
              <option value="security_check">🛡️ Security Check Lab / Candidate Application Form</option>
              <option value="marketplace">🛍️ Main Marketplace Platform</option>
              <option value="landing">🏢 Custom Platform Landing / Other Services</option>
            </select>
          </div>

          <div style="margin-bottom:18px">
            <label class="checkbox-row" style="color:#e2e8f0;font-size:13px;display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="editAutoRenew" name="auto_renew" value="1" style="width:16px;height:16px;cursor:pointer" />
              <span>Enable Automated Background SSL Renewals</span>
            </label>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px">
            <button type="button" onclick="closeEditModal()" style="background:#1f1638;border:1px solid #3b2866;color:#fff;padding:8px 16px;border-radius:6px;font-size:12.5px;cursor:pointer">Cancel</button>
            <button type="submit" style="background:linear-gradient(135deg,#7c3aed,#9333ea);color:#fff;border:none;padding:9px 20px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer">Save Changes</button>
          </div>
        </form>
      </div>
    </div>

    <script>
      function toggleHostsGuide() {
        var el = document.getElementById('hostsGuideDetail');
        var btn = document.getElementById('btnToggleHosts');
        if (!el) return;
        if (el.style.display === 'none' || !el.style.display) {
          el.style.display = 'block';
          if (btn) btn.textContent = 'Hide hosts guide ▲';
        } else {
          el.style.display = 'none';
          if (btn) btn.textContent = 'How to configure hosts file ▼';
        }
      }
      function openAddModal() {
        document.getElementById('addDomainModal').style.display = 'flex';
      }
      function closeAddModal() {
        document.getElementById('addDomainModal').style.display = 'none';
      }
      function openEditModal(id, domain, service, autoRenew) {
        document.getElementById('editDomainForm').action = '${basePath}/' + id + '/update';
        document.getElementById('editDomainInput').value = domain;
        document.getElementById('editServiceSelect').value = service;
        document.getElementById('editAutoRenew').checked = autoRenew === 1;
        document.getElementById('editDomainModal').style.display = 'flex';
      }
      function closeEditModal() {
        document.getElementById('editDomainModal').style.display = 'none';
      }
      window.addEventListener('click', function(e) {
        if (e.target === document.getElementById('addDomainModal')) closeAddModal();
        if (e.target === document.getElementById('editDomainModal')) closeEditModal();
      });
    </script>
  `;
}

module.exports = {
  domainManagerPage
};
