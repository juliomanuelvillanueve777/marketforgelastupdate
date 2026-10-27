// Marketplace HTML/presentation helpers.
// Source: server.js lines 5361-5384 (parseListingImages, esc).
//         server.js lines 6378-6399 (amenity SVG icon paths, from airbnbPage — pure data, no excluded logic).
// No database access. No network calls. No side effects.

// Parses the images JSON array from a listing record.
// Falls back to image_url, then to five Unsplash placeholder images.
// Accepts: listing object with .images (JSON string) and .image_url
// Returns: string[]
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

// HTML-escapes a value for safe insertion into HTML attributes and text content.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// SVG path data for known amenity names.
// Used by the template to render inline SVG icons alongside amenity labels.
// Source: server.js airbnbPage() lines 6378-6399 — pure SVG path strings, no logic.
// DEFAULT_AMENITY_PATH is used when an amenity name has no dedicated icon.
const AMENITY_ICONS = {
  'Wifi': 'M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.9a5 5 0 0 1 7 0M12 20h.01',
  'Kitchen': 'M3 3v7a4 4 0 0 0 4 4h1v7M21 3v18M16 3v7a4 4 0 0 1-2 3.46',
  'Washer': 'M3 6h18M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6M12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'Air conditioning': 'M12 2v20M4.93 4.93l14.14 14.14M2 12h20M4.93 19.07L19.07 4.93',
  'TV': 'M2 7h20v12H2zM8 21h8M12 19v2',
  'Hair dryer': 'M4 10a6 6 0 0 1 12 0v2H4v-2zM16 10h2a2 2 0 0 1 2 2v0a4 4 0 0 1-4 4h-2',
  'Iron': 'M4 14h16v4H4zM8 10c0-3 3-5 8-5h4v3',
  'Dedicated workspace': 'M3 5h18v12H3zM8 21h8M12 17v4',
  'Self check-in': 'M15 7a4 4 0 1 0-3.2 3.9L4 18.7 5.3 20l2-2H10v2h2v-3.3l.1-.1A4 4 0 0 0 15 7z',
  'Free parking': 'M6 3h9a5 5 0 0 1 0 10H10v8H6V3zm4 3v4h5a2 2 0 0 0 0-4h-5z',
  'Paid parking': 'M6 3h9a5 5 0 0 1 0 10H10v8H6V3zm4 3v4h5a2 2 0 0 0 0-4h-5z',
  'Pool': 'M2 15c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1M2 20c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1M8 4a4 4 0 0 1 8 2c0 3-4 5-4 5',
  'Heating': 'M12 2v8M8 6l4-4 4 4M6 14a6 6 0 0 0 12 0',
  'Elevator': 'M5 3h14v18H5zM12 8l3 3H9l3-3zM12 16l-3-3h6l-3 3z',
  'Gym': 'M6 6v12M18 6v12M6 9h12M6 15h12M3 9h3v6H3zM18 9h3v6h-3z',
  'Breakfast': 'M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3',
  'Indoor fireplace': 'M12 3c4 4 6 7 6 10a6 6 0 1 1-12 0c0-3 2-6 6-10z',
  'Smoke alarm': 'M12 3a6 6 0 0 1 6 6c0 4-3 5-3 8H9c0-3-3-4-3-8a6 6 0 0 1 6-6zM10 21h4',
  'Carbon monoxide alarm': 'M12 3a6 6 0 0 1 6 6c0 4-3 5-3 8H9c0-3-3-4-3-8a6 6 0 0 1 6-6zM10 21h4'
};

const DEFAULT_AMENITY_PATH = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5v6l4 2';

module.exports = {
  parseListingImages,
  esc,
  AMENITY_ICONS,
  DEFAULT_AMENITY_PATH
};
