/**
 * Dynamic Host Routing Middleware (vhost)
 * Routes incoming domain requests directly to their assigned service:
 * - Security Check Lab / Candidate Application Form
 * - Main Marketplace
 * - Custom Platform Landing
 */

'use strict';

module.exports = function createHostRouter({ db, candidatePageRenderer }) {

  /**
   * Helper to clean and normalize domain string
   */
  function cleanDomain(str) {
    if (!str || typeof str !== 'string') return '';
    return str.trim().toLowerCase()
      .replace(/^https?:\/\//i, '')
      .replace(/:\d+$/, '')
      .replace(/\/.*$/, '')
      .replace(/\.+$/, '')
      .trim();
  }

  /**
   * Helper to extract the hostname from request headers and testing parameters
   */
  function extractHost(req) {
    // 1. Support local testing overrides via query params or development headers
    const candidate = req.query?._host || req.query?.test_domain || req.query?.domain ||
                      req.headers['x-test-host'] || req.headers['x-forwarded-host'] || req.headers.host || '';

    // If multiple hosts exist in proxy chain (e.g. "domain.com, 10.0.0.1"), take the first
    let host = String(candidate).split(',')[0].trim().toLowerCase();

    // Strip protocol if present
    host = host.replace(/^https?:\/\//i, '');

    // Strip URL path if present
    host = host.split('/')[0].trim();

    // Strip port for both IPv4 and IPv6
    if (host.startsWith('[')) {
      const endBracket = host.indexOf(']');
      if (endBracket !== -1) host = host.substring(1, endBracket);
    } else {
      host = host.split(':')[0].trim();
    }

    // Strip trailing dot (FQDN notation e.g. domain.com.)
    host = host.replace(/\.+$/, '');

    return host;
  }

  /**
   * Multi-strategy matching: Exact, www variants, wildcards, subdomains, and local test bindings
   */
  function findManagedDomain(activeDomains, host, req) {
    if (!host || !activeDomains || activeDomains.length === 0) return null;

    const hostClean = cleanDomain(host);
    const hostNoWww = hostClean.replace(/^www\./, '');

    // ── Strategy 1: Exact Domain Match ──
    let match = activeDomains.find(d => cleanDomain(d.domain) === hostClean);
    if (match) return match;

    // ── Strategy 2: www. Variant Match (root <-> www.) ──
    match = activeDomains.find(d => {
      const dbClean = cleanDomain(d.domain);
      const dbNoWww = dbClean.replace(/^www\./, '');
      return dbNoWww === hostNoWww;
    });
    if (match) return match;

    // ── Strategy 3: Wildcard & Subdomain Matching ──
    match = activeDomains.find(d => {
      const dbClean = cleanDomain(d.domain);
      if (dbClean.startsWith('*.')) {
        const rootDomain = dbClean.slice(2);
        return hostClean === rootDomain || hostClean.endsWith('.' + rootDomain);
      }
      // If domain in DB is root (e.g. "company.com"), match subdomains (e.g. "apply.company.com")
      if (!dbClean.includes('/') && hostClean.endsWith('.' + dbClean)) {
        return true;
      }
      return false;
    });
    if (match) return match;

    // ── Strategy 4: Local & LAN Testing Bindings ──
    const isLocalBinding = (
      hostClean === 'localhost' ||
      hostClean === '127.0.0.1' ||
      hostClean === '::1' ||
      /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostClean)
    );
    if (isLocalBinding) {
      // 4a. If localhost/127.0.0.1 is registered in Domain Manager
      if (hostClean === 'localhost' || hostClean === '127.0.0.1' || hostClean === '::1') {
        match = activeDomains.find(d => {
          const dbClean = cleanDomain(d.domain);
          return dbClean === 'localhost' || dbClean === '127.0.0.1';
        });
        if (match) return match;
      }

      // 4b. Local testing via ?service=security_check or ?sc=1 or ?apply=1
      const reqService = (req.query?.service || req.headers?.['x-test-service'] || '').toLowerCase();
      if (reqService === 'security_check' || req.query?.sc === '1' || req.query?.apply === '1') {
        const secDomain = activeDomains.find(d => d.target_service === 'security_check');
        if (secDomain) return secDomain;
      }
    }

    return null;
  }

  return function hostRouter(req, res, next) {
    const rawHost = extractHost(req);

    if (!rawHost) return next();

    let domainRecord = null;
    try {
      const activeDomains = db.prepare('SELECT * FROM managed_domains WHERE is_active = 1').all();
      domainRecord = findManagedDomain(activeDomains, rawHost, req);
    } catch (err) {
      console.error('[vhost] Error loading active domains:', err.message);
    }

    // ── Diagnostic Console Logging for Development & Troubleshooting ──
    if (domainRecord) {
      console.log(`[vhost] Host: "${rawHost}" (header: "${req.headers.host}") -> MATCHED: "${domainRecord.domain}" [Service: ${domainRecord.target_service}] | Path: ${req.method} "${req.path}"`);
    } else if (rawHost && rawHost !== 'localhost' && rawHost !== '127.0.0.1') {
      console.log(`[vhost] Host: "${rawHost}" (header: "${req.headers.host}") -> No custom domain matched. Serving standard platform routes.`);
    }

    if (domainRecord) {
      req.managedDomain = domainRecord;

      // ═════════════════════════════════════════════════════════════════════════
      // ── Target Service 1: Security Check Lab / Candidate Application Form ──
      // ═════════════════════════════════════════════════════════════════════════
      if (domainRecord.target_service === 'security_check') {
        const p = (req.path || '/').toLowerCase().replace(/\/+$/, '') || '/';

        // Check if path is an application route
        const isApplicationPath = (
          p === '/' ||
          p === '/apply' ||
          p === '/security-check/apply' ||
          p === '/security-check' ||
          p === '/verification' ||
          p === '/candidate/apply' ||
          p === '/candidate' ||
          p === '/onboarding' ||
          p === '/form' ||
          p === '/index.html'
        );

        // Check if path is an internal asset, API, or system route that must pass through
        const isBypassPath = (
          p.startsWith('/api') ||
          p.startsWith('/submit') ||
          p.startsWith('/js') ||
          p.startsWith('/css') ||
          p.startsWith('/models') ||
          p.startsWith('/uploads') ||
          p.startsWith('/assets') ||
          p.startsWith('/.well-known') ||
          p === '/favicon.ico' ||
          p === '/robots.txt'
        );

        // If candidate arrives at root '/' or application routes (or any non-asset page on this domain)
        if (req.method === 'GET' && (isApplicationPath || !isBypassPath)) {
          if (typeof candidatePageRenderer === 'function') {
            res.set('X-Service', 'Security-Check-Lab');
            res.set('X-Robots-Tag', 'noindex, nofollow');
            return res.send(candidatePageRenderer());
          }
        }
      }

      // ═════════════════════════════════════════════════════════════════════════
      // ── Target Service 2: Custom Platform Landing ─────────────────────────
      // ═════════════════════════════════════════════════════════════════════════
      if (domainRecord.target_service === 'landing') {
        // Tagged on req.managedDomain, fall through to landing logic
      }

      // ═════════════════════════════════════════════════════════════════════════
      // ── Target Service 3: Main Marketplace ────────────────────────────────
      // ═════════════════════════════════════════════════════════════════════════
      // Standard marketplace routes
    }

    next();
  };
};
