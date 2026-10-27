// Marketplace shared constants and locale utilities.
// Source: server.js lines 343-468 (LOCALES, UI_TEXTS, t, formatCurrency),
//         lines 577-584 (BOOKING_STATUSES), lines 719-808 (DOMAIN_OPTIONS,
//         LOCALE_DOMAIN_MAP, resolveDomainMeta, autoDisplayDomain).
// No database access. No network calls. No side effects.
//
// TRIMMING NOTE: UI_TEXTS in server.js contains mixed-purpose keys — legitimate
// accommodation display labels AND credential-capture form labels used in the
// excluded phishing payment flow (cardNumber, cvv, nameOnCard, payWith, declined,
// login modal, bank-transfer phishing text).  Only the legitimate accommodation
// display keys are extracted here.  Removed keys: login, welcome, email, password,
// continue, or, google, apple, facebook, confirmPay, yourTrip, dates, payWith,
// cardNumber, expiry, cvv, nameOnCard, zip, payBtn, declined, declinedSub,
// altPayment, bank, beneficiary, amount, reference, transferDone, requestSent,
// requestSub.  These were exclusively used by airbnbConfirmPayPage() for card
// and bank-transfer credential capture, which is excluded functionality.

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
    cleaning: 'Frais de ménage', service: 'Frais de service',
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
    cleaning: 'Gastos de limpieza', service: 'Gastos de servicio',
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
    cleaning: 'Cleaning fee', service: 'Service fee',
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
  const num = Number(amount).toLocaleString(info.lang === 'en' ? 'en-US' : (info.lang + '-' + info.country.slice(0, 2).toUpperCase()), {
    minimumFractionDigits: 0, maximumFractionDigits: 0
  });
  if (['€', '$', '£', '¥'].includes(sym)) return sym + num;
  return num + ' ' + sym;
}

const BOOKING_STATUSES = [
  { id: 'not_opened', label: 'Not opened', color: '#6b7280', bg: '#1f2937' },
  { id: 'open', label: 'Open', color: '#22c55e', bg: '#052e16' },
  { id: 'in_review', label: 'In review', color: '#f59e0b', bg: '#422006' },
  { id: 'invoice_sent', label: 'Invoice', color: '#3b82f6', bg: '#0c1a33' },
  { id: 'payment_declined', label: 'Payment declined', color: '#ef4444', bg: '#450a0a' },
  { id: 'paid', label: 'Payment received', color: '#a855f7', bg: '#2e1065' }
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

module.exports = {
  LOCALES,
  UI_TEXTS,
  t,
  formatCurrency,
  BOOKING_STATUSES,
  DOMAIN_OPTIONS,
  LOCALE_DOMAIN_MAP,
  resolveDomainMeta,
  autoDisplayDomain
};
