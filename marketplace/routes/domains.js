/**
 * Domain Manager Routes & Automated SSL Activation
 * MarketForge Personal & Admin Dashboard
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { domainManagerPage } = require('../views/domain-manager');

module.exports = function createDomainRoutes({ db, requireAdmin, clientPage, adminPage, sslService }) {
  const router = express.Router();

  /**
   * Helper to clean domain input
   */
  function cleanDomainName(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.trim().toLowerCase()
      .replace(/^https?:\/\//i, '')
      .replace(/:\d+$/, '')
      .replace(/\/.*$/, '')
      .trim();
  }

  /**
   * Universal Domain Access Middleware
   * Allows personal/regular accounts alongside administrators to view and manage domains
   * without encountering "Access Denied" (HTTP 403).
   */
  function requireDomainAccess(req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.redirect('/login');
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.redirect('/login');
    }
    if (user.status && user.status !== 'active') {
      return res.status(403).send('Account inactive or suspended');
    }
    req.user = user;
    next();
  }

  /**
   * Helper to determine base path for rendering & redirects
   */
  function getDomainBasePath(req) {
    const url = req.originalUrl || req.baseUrl || req.path || '';
    if (url.includes('/dashboard')) {
      return '/dashboard/domains';
    }
    if (url.startsWith('/domains')) {
      return '/domains';
    }
    if (req.user && !req.user.is_admin) {
      return '/dashboard/domains';
    }
    return '/admin/domains';
  }

  /**
   * Helper to render either adminPage or clientPage based on request URL and user role
   */
  function renderDomainLayout(req, res, title, content) {
    const url = req.originalUrl || req.baseUrl || req.path || '';
    const isDashboard = url.includes('/dashboard');
    const isDirectDomains = url.startsWith('/domains');
    const isPersonalUser = req.user && !req.user.is_admin;

    // Use clientPage for dashboard routes, direct /domains, or personal user accounts
    if ((isDashboard || isDirectDomains || isPersonalUser) && typeof clientPage === 'function' && req.user) {
      return res.send(clientPage(title, content, req.user));
    }
    if (req.user && req.user.is_admin && typeof adminPage === 'function') {
      return res.send(adminPage(title, content));
    }
    if (typeof adminPage === 'function') {
      return res.send(adminPage(title, content));
    }
    if (typeof clientPage === 'function' && req.user) {
      return res.send(clientPage(title, content, req.user));
    }
    return res.send(content);
  }

  // ── ACME Challenge Handler for Automated Let's Encrypt / Certbot Verification ──
  router.get('/.well-known/acme-challenge/:token', (req, res) => {
    const token = req.params.token.replace(/[^a-zA-Z0-9_-]/g, '');
    const challengeFile = path.join(sslService.acmeDir, token);
    if (fs.existsSync(challengeFile)) {
      res.type('text/plain');
      return res.send(fs.readFileSync(challengeFile, 'utf8'));
    }
    return res.status(404).send('ACME challenge not found');
  });

  // ── SSR Domain Manager Dashboard Handler ──────────────────────────────────
  function handleGetDomains(req, res) {
    const domains = db.prepare('SELECT * FROM managed_domains ORDER BY id DESC').all();

    const stats = {
      total: domains.length,
      live: domains.filter(d => (d.status || '').toLowerCase() === 'live').length,
      securityCheck: domains.filter(d => d.target_service === 'security_check').length,
      dnsVerified: domains.filter(d => (d.status || '').toLowerCase() === 'dns verified' || (d.status || '').toLowerCase() === 'live').length
    };

    const candRow = db.prepare(`
      SELECT domain FROM managed_domains 
      WHERE target_service = 'security_check' 
        AND is_active = 1 
        AND status IN ('SSL Active', 'Live')
      ORDER BY updated_at DESC LIMIT 1
    `).get();

    const basePath = getDomainBasePath(req);

    const content = domainManagerPage({
      domains,
      stats,
      serverIp: req.ip,
      candidateDomain: candRow ? candRow.domain : null,
      basePath
    });

    return renderDomainLayout(req, res, 'Domain Manager', content);
  }

  // Register GET routes across all entry points: personal dashboard, root alias, and admin
  const domainGetRoutes = [
    '/dashboard/domains',
    '/domains',
    '/dashboard/domain-manager',
    '/domain-manager',
    '/admin/domains',
    '/admin/domain-manager'
  ];
  domainGetRoutes.forEach(r => {
    router.get(r, requireDomainAccess, handleGetDomains);
  });

  // ── Add New Domain Handler ───────────────────────────────────────────────
  async function handleAddDomain(req, res) {
    const basePath = getDomainBasePath(req);
    try {
      const domain = cleanDomainName(req.body.domain);
      const targetService = req.body.target_service || 'security_check';
      const autoRenew = req.body.auto_renew === '1' || req.body.auto_renew === 1 ? 1 : 0;

      if (!domain) {
        return res.redirect(`${basePath}?error=invalid_domain`);
      }

      // Check if domain already exists
      const existing = db.prepare('SELECT id FROM managed_domains WHERE domain = ?').get(domain);
      if (existing) {
        return res.redirect(`${basePath}?error=domain_exists`);
      }

      // Insert domain into DB as Draft
      const info = db.prepare(`
        INSERT INTO managed_domains (
          domain, target_service, status, is_active, auto_renew, created_at, updated_at
        ) VALUES (
          ?, ?, 'Draft', 1, ?, datetime('now'), datetime('now')
        )
      `).run(domain, targetService, autoRenew);

      // Perform quick asynchronous DNS check
      sslService.verifyDomainDNS(domain).then(dnsRes => {
        if (dnsRes && dnsRes.success) {
          db.prepare(`
            UPDATE managed_domains SET 
              status = 'DNS Verified', 
              dns_ip = ?, 
              dns_verified_at = datetime('now'),
              updated_at = datetime('now')
            WHERE id = ?
          `).run(dnsRes.ip, info.lastInsertRowid);
        }
      }).catch(() => {});

      return res.redirect(`${basePath}?success=domain_added`);
    } catch (err) {
      console.error('[DOMAIN ROUTE ERROR]', err);
      return res.redirect(`${basePath}?error=` + encodeURIComponent(err.message));
    }
  }

  router.post(['/dashboard/domains', '/domains', '/admin/domains'], requireDomainAccess, handleAddDomain);

  // ── Verify DNS A-Record Handler ──────────────────────────────────────────
  async function handleVerifyDns(req, res) {
    const basePath = getDomainBasePath(req);
    try {
      const id = parseInt(req.params.id, 10);
      const row = db.prepare('SELECT * FROM managed_domains WHERE id = ?').get(id);
      if (!row) return res.redirect(basePath);

      const dnsRes = await sslService.verifyDomainDNS(row.domain);
      if (dnsRes.success) {
        const nextStatus = (row.status === 'Live' || row.status === 'SSL Active') ? row.status : 'DNS Verified';
        db.prepare(`
          UPDATE managed_domains SET 
            status = ?, 
            dns_ip = ?, 
            dns_verified_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(nextStatus, dnsRes.ip, id);
      } else {
        db.prepare(`
          UPDATE managed_domains SET 
            status = 'Draft', 
            dns_ip = NULL,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(id);
      }

      return res.redirect(basePath);
    } catch (err) {
      console.error('[VERIFY DNS ERROR]', err);
      return res.redirect(`${basePath}?error=` + encodeURIComponent(err.message));
    }
  }

  router.post(['/dashboard/domains/:id/verify-dns', '/domains/:id/verify-dns', '/admin/domains/:id/verify-dns'], requireDomainAccess, handleVerifyDns);

  // ── "Activate Domain & Issue SSL" Handler ────────────────────────────────
  async function handleIssueSsl(req, res) {
    const basePath = getDomainBasePath(req);
    try {
      const id = parseInt(req.params.id, 10);
      const row = db.prepare('SELECT * FROM managed_domains WHERE id = ?').get(id);
      if (!row) return res.redirect(basePath);

      // 1. Verify DNS A-record first
      const dnsRes = await sslService.verifyDomainDNS(row.domain);
      const dnsIp = dnsRes.success ? dnsRes.ip : (row.dns_ip || '127.0.0.1');

      // 2. Trigger automated SSL certificate provisioning
      const sslRes = await sslService.issueCertificate(row.domain);

      // 3. Mark domain Live and update SSL certificate metadata in SQLite
      db.prepare(`
        UPDATE managed_domains SET
          status = 'Live',
          dns_ip = ?,
          dns_verified_at = datetime('now'),
          ssl_cert_path = ?,
          ssl_key_path = ?,
          ssl_issued_at = ?,
          ssl_expires_at = ?,
          ssl_provider = ?,
          is_active = 1,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(dnsIp, sslRes.certPath, sslRes.keyPath, sslRes.validFrom, sslRes.validTo, sslRes.provider, id);

      console.log(`[+] Domain ${row.domain} is now LIVE with active SSL certificate.`);
      return res.redirect(`${basePath}?success=ssl_activated`);
    } catch (err) {
      console.error('[ISSUE SSL ERROR]', err);
      return res.redirect(`${basePath}?error=` + encodeURIComponent(err.message));
    }
  }

  router.post(['/dashboard/domains/:id/issue-ssl', '/domains/:id/issue-ssl', '/admin/domains/:id/issue-ssl'], requireDomainAccess, handleIssueSsl);

  // ── Update Domain Settings Handler ───────────────────────────────────────
  function handleUpdateDomain(req, res) {
    const basePath = getDomainBasePath(req);
    try {
      const id = parseInt(req.params.id, 10);
      const domain = cleanDomainName(req.body.domain);
      const targetService = req.body.target_service || 'security_check';
      const autoRenew = req.body.auto_renew === '1' || req.body.auto_renew === 1 ? 1 : 0;

      if (!domain) return res.redirect(`${basePath}?error=invalid_domain`);

      db.prepare(`
        UPDATE managed_domains SET
          domain = ?,
          target_service = ?,
          auto_renew = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(domain, targetService, autoRenew, id);

      return res.redirect(`${basePath}?success=updated`);
    } catch (err) {
      console.error('[UPDATE DOMAIN ERROR]', err);
      return res.redirect(`${basePath}?error=` + encodeURIComponent(err.message));
    }
  }

  router.post(['/dashboard/domains/:id/update', '/domains/:id/update', '/admin/domains/:id/update'], requireDomainAccess, handleUpdateDomain);

  // ── Toggle Active / Inactive Handler ─────────────────────────────────────
  function handleToggleDomain(req, res) {
    const basePath = getDomainBasePath(req);
    try {
      const id = parseInt(req.params.id, 10);
      const row = db.prepare('SELECT is_active FROM managed_domains WHERE id = ?').get(id);
      if (row) {
        const nextActive = row.is_active ? 0 : 1;
        db.prepare('UPDATE managed_domains SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?').run(nextActive, id);
        sslService.reloadAllCertificates();
      }
      return res.redirect(basePath);
    } catch (err) {
      return res.redirect(`${basePath}?error=` + encodeURIComponent(err.message));
    }
  }

  router.post(['/dashboard/domains/:id/toggle', '/domains/:id/toggle', '/admin/domains/:id/toggle'], requireDomainAccess, handleToggleDomain);

  // ── Delete Domain Handler ────────────────────────────────────────────────
  function handleDeleteDomain(req, res) {
    const basePath = getDomainBasePath(req);
    try {
      const id = parseInt(req.params.id, 10);
      const row = db.prepare('SELECT * FROM managed_domains WHERE id = ?').get(id);
      if (row) {
        // Remove cert directory if present
        try {
          const domainDir = path.join(sslService.certsDir, row.domain.toLowerCase());
          if (fs.existsSync(domainDir)) {
            fs.rmSync(domainDir, { recursive: true, force: true });
          }
        } catch (_) {}

        // Remove from SNI cache
        sslService.secureContexts.delete(row.domain.toLowerCase());

        // Delete record from DB
        db.prepare('DELETE FROM managed_domains WHERE id = ?').run(id);
      }
      return res.redirect(`${basePath}?success=deleted`);
    } catch (err) {
      return res.redirect(`${basePath}?error=` + encodeURIComponent(err.message));
    }
  }

  router.post(['/dashboard/domains/:id/delete', '/domains/:id/delete', '/admin/domains/:id/delete'], requireDomainAccess, handleDeleteDomain);

  // ── Trigger Manual SSL Renewal Background Check Handler ──────────────────
  async function handleCheckRenewals(req, res) {
    const basePath = getDomainBasePath(req);
    try {
      const result = await sslService.checkAndRenewExpiringCertificates();
      console.log(`[SSLService] Manual renewal check completed: ${result.checked} checked, ${result.renewed} renewed.`);
      return res.redirect(`${basePath}?success=renewals_checked`);
    } catch (err) {
      return res.redirect(`${basePath}?error=` + encodeURIComponent(err.message));
    }
  }

  router.post(['/dashboard/domains/check-renewals', '/domains/check-renewals', '/admin/domains/check-renewals'], requireDomainAccess, handleCheckRenewals);

  // ── JSON API for Domain Status ───────────────────────────────────────────
  router.get('/api/domains/status', (req, res) => {
    const domains = db.prepare('SELECT id, domain, target_service, status, is_active, ssl_provider, ssl_expires_at FROM managed_domains').all();
    return res.json({ domains });
  });

  return router;
};
