// Marketplace review generation utilities.
// Source: server.js lines 470-550 (REVIEW_PHOTOS, REVIEW_NAMES, REVIEW_TEXTS, generateReviews).
// No database access. No network calls. No side effects.
// generateReviews(listing) accepts a listing object with .reviews_json, .locale, .reviews fields.

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
  en: ['Sarah M.', 'James T.', 'Emily R.', 'Michael B.', 'Jessica L.', 'David K.', 'Anna W.', 'Robert P.', 'Laura G.', 'Christopher D.'],
  fr: ['Sophie D.', 'Thomas L.', 'Marie C.', 'Pierre M.', 'Camille B.', 'Antoine R.', 'Juliette F.', 'Nicolas V.', 'Chloé G.', 'Lucas P.'],
  es: ['María G.', 'Carlos R.', 'Laura P.', 'Javier M.', 'Ana S.', 'David L.', 'Elena C.', 'Pablo N.', 'Carmen F.', 'Miguel A.'],
  de: ['Anna S.', 'Markus W.', 'Julia K.', 'Thomas H.', 'Lisa M.', 'Andreas B.', 'Katrin D.', 'Stefan R.', 'Nina F.', 'Michael P.'],
  it: ['Chiara R.', 'Marco B.', 'Francesca M.', 'Luca D.', 'Giulia C.', 'Matteo F.', 'Alessia P.', 'Giovanni N.', 'Sofia L.', 'Andrea V.'],
  ro: ['Maria P.', 'Andrei I.', 'Elena D.', 'Alexandru M.', 'Ioana C.', 'Cristian S.', 'Gabriela V.', 'Mihai T.', 'Raluca B.', 'Daniel N.']
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

// Accepts a listing object: { reviews_json, locale, reviews }
// Returns an array of review objects: { name, photo, text, rating, date }
// If listing.reviews_json is a valid JSON array it is returned as-is.
// Otherwise generates synthetic reviews from the locale-specific pools.
function generateReviews(listing) {
  const raw = listing.reviews_json || '';
  let reviews = [];
  try { if (raw) reviews = JSON.parse(raw); } catch (e) {}
  if (reviews.length) return reviews;

  const locale = listing.locale || 'en';
  const count = Math.min(parseInt(listing.reviews) || 8, 100);
  const names = REVIEW_NAMES[locale] || REVIEW_NAMES.en;
  const texts = REVIEW_TEXTS[locale] || REVIEW_TEXTS.en;
  const result = [];
  const usedPhotos = [];
  for (let i = 0; i < count; i++) {
    const photo = REVIEW_PHOTOS[i % REVIEW_PHOTOS.length];
    const name = names[i % names.length];
    const text = texts[i % texts.length];
    let rating = 5;
    if (i % 5 === 0 && count > 3) rating = 4;
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const month = months[Math.floor(Math.random() * 12)];
    const year = 2025 - Math.floor(Math.random() * 3);
    result.push({ name, photo, text, rating, date: `${month} ${year}` });
    usedPhotos.push(photo);
  }
  return result;
}

module.exports = {
  REVIEW_PHOTOS,
  REVIEW_NAMES,
  REVIEW_TEXTS,
  generateReviews
};
