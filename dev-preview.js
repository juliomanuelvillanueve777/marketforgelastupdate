'use strict';

// ── dev-preview.js ────────────────────────────────────────────────────────────
// Development watcher + proxy for preview-listing.js.
//
// • Owns a stable fixed port (DEV_PORT env var or 4321) so the URL never
//   changes across restarts.
// • Spawns preview-listing.js as a child on its own ephemeral port.
// • Watches preview-listing.js for changes; kills and respawns the child
//   automatically using only fs.watch (no extra packages needed).
// • Proxies every HTTP request from the stable port to the live child port.
// • Injects a one-line SSE listener into HTML responses; the browser reloads
//   automatically when the child restarts.
// • Serves GET /~reload as the SSE endpoint; keeps connections alive across
//   child restarts because this process never stops.
// ─────────────────────────────────────────────────────────────────────────────

const http  = require('http');
const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const { spawn } = require('child_process');

function getLanIPs() {
  var ips = [];
  var ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function(name) {
    (ifaces[name] || []).forEach(function(a) {
      if (a.family === 'IPv4' && !a.internal) ips.push({ name: name, address: a.address });
    });
  });
  return ips;
}

const STABLE_PORT = parseInt(process.env.DEV_PORT, 10) || 4321;
const SCRIPT      = path.join(__dirname, 'preview-listing.js');
const SCRIPT_DIR  = __dirname;
const SCRIPT_FILE = 'preview-listing.js';

// ── State ─────────────────────────────────────────────────────────────────────
let childPort  = null;   // port the current child listens on
let child      = null;   // ChildProcess
let sseClients = [];     // active SSE response objects
let watchTimer = null;   // debounce handle for fs.watch

// ── SSE helpers ───────────────────────────────────────────────────────────────
function broadcast(msg) {
  sseClients = sseClients.filter(r => !r.writableEnded);
  sseClients.forEach(r => {
    try { r.write('data: ' + msg + '\n\n'); } catch (_) {}
  });
}

// ── Child management ──────────────────────────────────────────────────────────
function startChild() {
  child = spawn(process.execPath, [SCRIPT], {
    cwd:   __dirname,
    env:   Object.assign({}, process.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', buf => {
    const str = buf.toString();
    const m = str.match(/REAL_LISTING_PREVIEW port=(\d+)/);
    if (m) {
      childPort = parseInt(m[1], 10);
      process.stdout.write('[dev] Child ready on internal port ' + childPort + '\n');
      // Give the child one extra tick before telling browsers to reload
      setTimeout(() => broadcast('reload'), 300);
    }
  });

  child.stderr.on('data', buf => {
    process.stderr.write('[child] ' + buf.toString());
  });

  child.on('exit', (code, signal) => {
    const intentional = signal === 'SIGTERM' || signal === 'SIGKILL';
    if (!intentional && code !== 0) {
      process.stderr.write('[dev] Child exited unexpectedly (code=' + code + ', signal=' + signal + ')\n');
    }
    if (child) { child = null; childPort = null; }
  });
}

function killChild(cb) {
  if (!child) { cb(); return; }
  const c = child;
  child    = null;
  childPort = null;
  if (c.exitCode !== null) { cb(); return; } // already dead
  c.once('exit', () => cb());
  try { c.kill(); } catch (_) { cb(); }
}

function restartChild() {
  process.stdout.write('[dev] preview-listing.js changed — restarting child…\n');
  killChild(() => setTimeout(startChild, 100));
}

// ── File watcher — watch directory so atomic-save editors (VS Code, vim) work ─
fs.watch(SCRIPT_DIR, (eventType, filename) => {
  if (filename !== SCRIPT_FILE) return;
  clearTimeout(watchTimer);
  watchTimer = setTimeout(restartChild, 250);
});

// ── Reload script injected into every HTML response ───────────────────────────
const RELOAD_SCRIPT =
  '<script>(function(){' +
  'var es=new EventSource("/~reload");' +
  'es.onmessage=function(){location.reload()};' +
  // If SSE errors (e.g. browser cold-start before child is ready), retry
  'es.onerror=function(){setTimeout(function(){location.reload()},2500)};' +
  '}())</script>';

function injectReload(html) {
  var idx = html.lastIndexOf('</body>');
  if (idx === -1) return html + RELOAD_SCRIPT;
  return html.slice(0, idx) + RELOAD_SCRIPT + '\n' + html.slice(idx);
}

// Placeholder served while the child is (re)starting
function waitPage(msg) {
  var body =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="font-family:sans-serif;padding:40px;color:#222">' +
    '<h2 style="margin:0 0 8px">' + msg + '</h2>' +
    '<p style="color:#717171;margin:0">Will reload automatically.</p>' +
    RELOAD_SCRIPT + '</body></html>';
  return Buffer.from(body, 'utf8');
}

// ── Proxy server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // SSE reload endpoint — served directly (never proxied)
  if (req.url === '/~reload') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write(':\n\n'); // opening comment keeps some browsers from closing early
    sseClients.push(res);

    // 30-second heartbeat so the connection isn't dropped by idle timeouts
    var hb = setInterval(function() {
      if (res.writableEnded) { clearInterval(hb); return; }
      try { res.write(':\n\n'); } catch (_) { clearInterval(hb); }
    }, 30000);

    req.on('close', function() {
      clearInterval(hb);
      sseClients = sseClients.filter(function(r) { return r !== res; });
    });
    return;
  }

  // Child not yet ready
  if (!childPort) {
    var buf = waitPage('Preview starting…');
    res.writeHead(503, {
      'Content-Type':   'text/html; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control':  'no-store',
    });
    res.end(buf);
    return;
  }

  // Proxy to child
  var proxyReq = http.request({
    hostname: '127.0.0.1',
    port:     childPort,
    path:     req.url,
    method:   req.method,
    headers:  Object.assign({}, req.headers, { host: '127.0.0.1:' + childPort }),
  }, function(proxyRes) {
    var ct = proxyRes.headers['content-type'] || '';
    var isHtml = ct.indexOf('text/html') !== -1;

    if (!isHtml) {
      // Stream non-HTML (CSS, images, fonts) directly — no buffering
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    // Buffer HTML so we can inject the reload script
    var chunks = [];
    proxyRes.on('data', function(c) { chunks.push(c); });
    proxyRes.on('end', function() {
      var injected = injectReload(Buffer.concat(chunks).toString('utf8'));
      var outBuf   = Buffer.from(injected, 'utf8');
      var headers  = Object.assign({}, proxyRes.headers, {
        'content-length':   outBuf.length,
        'cache-control':    'no-store',
      });
      delete headers['transfer-encoding']; // we're sending a known length
      res.writeHead(proxyRes.statusCode, headers);
      res.end(outBuf);
    });
  });

  proxyReq.on('error', function() {
    // Child is restarting — serve the wait page
    var buf = waitPage('Preview restarting…');
    if (!res.headersSent) {
      res.writeHead(502, {
        'Content-Type':   'text/html; charset=utf-8',
        'Content-Length': buf.length,
        'Cache-Control':  'no-store',
      });
    }
    res.end(buf);
  });

  req.pipe(proxyReq);
});

server.on('error', function(err) {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(
      'ERROR: Port ' + STABLE_PORT + ' is already in use.\n' +
      'Stop the existing dev-preview process, or set DEV_PORT=<other> before running.\n'
    );
  } else {
    process.stderr.write('ERROR: ' + err.message + '\n');
  }
  process.exit(1);
});

server.listen(STABLE_PORT, '0.0.0.0', function() {
  var local = 'http://127.0.0.1:' + STABLE_PORT;
  process.stdout.write('DEV_PREVIEW_READY port=' + STABLE_PORT + '\n');
  process.stdout.write('  Local PC:  ' + local + '/\n');
  process.stdout.write('  Checkout:  ' + local + '/checkout?checkin=2027-01-08&checkout=2027-01-10&adults=1\n');
  var lanIPs = getLanIPs();
  if (lanIPs.length) {
    process.stdout.write('  On Wi-Fi (open on phone):\n');
    lanIPs.forEach(function(iface) {
      process.stdout.write('    http://' + iface.address + ':' + STABLE_PORT + '/  [' + iface.name + ']\n');
    });
  }
  startChild();
});
