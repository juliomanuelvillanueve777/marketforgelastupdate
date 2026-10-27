/**
 * User Account Manager CLI for MarketForge
 * Usage:
 *   node scripts/manage-user.js list
 *   node scripts/manage-user.js create <username> <password> [email] [--admin]
 *   node scripts/manage-user.js reset <username> <password>
 */

'use strict';

const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'marketforge.db');
const db = new Database(dbPath);

const action = process.argv[2] || 'list';

if (action === 'list') {
  const users = db.prepare('SELECT id, username, email, is_admin, status, created_at, last_login FROM users').all();
  console.log('\n=== MarketForge Users in SQLite (' + dbPath + ') ===');
  console.table(users.map(u => ({
    ID: u.id,
    Username: u.username,
    Email: u.email || '—',
    Role: u.is_admin ? 'ADMIN' : 'PERSONAL / REGULAR',
    Status: u.status,
    Created: u.created_at,
    LastLogin: u.last_login || 'Never'
  })));
  console.log('Login URL: http://localhost:3000/login\n');
  process.exit(0);
}

if (action === 'create') {
  const username = process.argv[3];
  const password = process.argv[4];
  const email = (process.argv[5] && !process.argv[5].startsWith('--')) ? process.argv[5] : `${username}@marketforge.local`;
  const isAdmin = process.argv.includes('--admin') ? 1 : 0;

  if (!username || !password) {
    console.error('Usage: node scripts/manage-user.js create <username> <password> [email] [--admin]');
    process.exit(1);
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    console.error(`Error: User "${username}" already exists. Use "reset" to update password.`);
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (username, email, password_hash, is_admin, status, plan, created_at)
    VALUES (?, ?, ?, ?, 'active', 'unlimited', datetime('now'))
  `).run(username, email, hash, isAdmin);

  console.log(`[+] User "${username}" created successfully (ID: ${info.lastInsertRowid})!`);
  console.log(`    Role: ${isAdmin ? 'ADMIN' : 'PERSONAL / REGULAR'}`);
  console.log(`    Password: ${password}`);
  console.log(`    Login at: http://localhost:3000/login\n`);
  process.exit(0);
}

if (action === 'reset') {
  const username = process.argv[3];
  const password = process.argv[4];

  if (!username || !password) {
    console.error('Usage: node scripts/manage-user.js reset <username> <password>');
    process.exit(1);
  }

  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) {
    console.error(`Error: User "${username}" does not exist.`);
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ?, status = \'active\' WHERE id = ?').run(hash, user.id);

  console.log(`[+] Password for "${username}" updated successfully!`);
  console.log(`    New Password: ${password}`);
  console.log(`    Login at: http://localhost:3000/login\n`);
  process.exit(0);
}

console.log('Unknown action. Available: list, create, reset');
