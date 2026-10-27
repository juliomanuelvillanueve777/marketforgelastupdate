# Marketplace Module — Extraction Plan

Extraction boundary for the legitimate Marketplace functionality from the existing `server.js` monolith. This document defines what is in scope, what is excluded, and the order of work.

Source: `server.js` (single-file application, ~547KB)

---

## 1. Marketplace Scope

The clean Marketplace module includes exactly five features:

| Feature | Description |
|---------|-------------|
| **Apartment Library** | Reusable property templates (name, photos, amenities, pricing) saved once and selected when creating listings |
| **Host Library** | Reusable host profiles (name, photo, Superhost badge, stats) saved once and selected when creating listings |
| **Listing Generator** | Creates a new listing from an apartment template + host profile + form input, with uploaded photos/videos |
| **Listing CRUD** | Edit, delete (single/bulk), and update booking status of existing listings |
| **Public Listing** | Read-only public page rendering a single listing's data (Airbnb-style or Booking-style layout) |

Everything outside this boundary is **excluded** and must not be reproduced, referenced, or integrated.

---

## 2. Tables

### 2.1 `apartments`

Created at `server.js:236`. Owned by the Marketplace module.

**Included fields:**

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| id | INTEGER PK AUTO | | Primary key |
| user_id | INTEGER NOT NULL | | Owner (FK → users.id) |
| name | TEXT NOT NULL | | Internal label |
| marketplace | TEXT | `'airbnb'` | Target platform |
| title | TEXT NOT NULL | | Public listing title |
| description | TEXT | | Listing description |
| price | TEXT | | Price per night |
| price_month | TEXT | | Price per month |
| image_url | TEXT | | Primary image URL |
| images | TEXT | | JSON array of image URLs |
| location | TEXT | | Property location |
| guests | INTEGER | 2 | Max guests |
| bedrooms | INTEGER | 1 | Bedroom count |
| beds | INTEGER | 1 | Bed count |
| baths | REAL | 1 | Bathroom count |
| amenities | TEXT | | Comma-separated amenity names |
| host_name | TEXT | | Default host name |
| host_photo | TEXT | | Default host photo path/URL |
| rating | TEXT | `'4.92'` | Display rating |
| reviews | INTEGER | 48 | Display review count |
| property_type | TEXT | `'Entire apartment'` | Property category |
| display_domain | TEXT | | Display domain for URL appearance |
| locale | TEXT | `'gb'` | Locale code |
| currency | TEXT | `'GBP'` | Currency code |
| video_url | TEXT | | Property video URL |
| hide_nightly | INTEGER | 0 | Hide nightly price (show monthly only) |
| created_at | TEXT | `datetime('now')` | |
| updated_at | TEXT | `datetime('now')` | |

**Excluded fields (present in source, must NOT be carried over):**

| Column | Reason |
|--------|--------|
| proxy_target_url | Proxy/clone functionality |
| proxy_mode | Proxy/clone functionality |

---

### 2.2 `hosts`

Created at `server.js:271`. Owned by the Marketplace module.

**Included fields (all — this table is clean):**

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| id | INTEGER PK AUTO | | Primary key |
| user_id | INTEGER NOT NULL | | Owner (FK → users.id) |
| name | TEXT NOT NULL | | Host display name |
| photo | TEXT | | Host photo path/URL |
| is_superhost | INTEGER | 1 | Superhost badge |
| joined_year | TEXT | `'2018'` | Year started hosting |
| response_rate | TEXT | `'100%'` | Response rate label |
| response_time | TEXT | `'within an hour'` | Response time label |
| languages | TEXT | `'English'` | Spoken languages |
| identity_verified | INTEGER | 1 | Identity verified badge |
| about | TEXT | | Host bio |
| location | TEXT | | Host location |
| reviews_count | INTEGER | 48 | Review count |
| rating | TEXT | `'4.92'` | Host rating |
| created_at | TEXT | `datetime('now')` | |
| updated_at | TEXT | `datetime('now')` | |

No excluded fields.

---

### 2.3 `listings`

Created at `server.js:83`, migrated at `server.js:170`. Owned by the Marketplace module.

**Included fields:**

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| id | INTEGER PK AUTO | | Primary key |
| user_id | INTEGER NOT NULL | | Owner (FK → users.id) |
| marketplace | TEXT NOT NULL | | `'airbnb'` or `'booking'` |
| title | TEXT NOT NULL | | Listing title |
| description | TEXT | | Listing description |
| price | TEXT | | Price per night |
| price_month | TEXT | | Price per month |
| image_url | TEXT | | Primary image |
| images | TEXT | | JSON array of image URLs |
| location | TEXT | | Property location |
| guests | INTEGER | 1 | Max guests |
| bedrooms | INTEGER | 1 | Bedroom count |
| beds | INTEGER | 1 | Bed count |
| baths | INTEGER | 1 | Bathroom count |
| amenities | TEXT | | Comma-separated amenity names |
| host_name | TEXT | | Host display name |
| host_photo | TEXT | | Host photo path/URL |
| rating | TEXT | `'4.92'` | Display rating |
| reviews | INTEGER | 48 | Display review count |
| reviews_json | TEXT | | Custom reviews JSON |
| property_type | TEXT | `'Entire apartment'` | Property category |
| display_domain | TEXT | | Display domain |
| public_path | TEXT | | URL path (`/rooms/...`) |
| listing_code | TEXT | | Unique code |
| locale | TEXT | `'en'` | Locale code |
| currency | TEXT | `'EUR'` | Currency code |
| video_url | TEXT | | Video URL |
| hide_nightly | INTEGER | 0 | Show monthly price only |
| apartment_id | INTEGER | | Source apartment template |
| host_id | INTEGER | | Source host profile |
| booking_status | TEXT | `'not_opened'` | Workflow status |
| opened_at | TEXT | | First opened timestamp |
| status_updated_at | TEXT | | Last status change |
| status | TEXT | `'active'` | Active/inactive |
| created_at | TEXT | `datetime('now')` | |
| views | INTEGER | 0 | View counter |

**Excluded fields (present in source, must NOT be carried over):**

| Column | Reason |
|--------|--------|
| proxy_target_url | Proxy/clone functionality |
| proxy_mode | Proxy/clone functionality |
| client_first_name | Victim/target tracking |
| client_last_name | Victim/target tracking |
| client_phone | Victim/target tracking |
| client_email | Victim/target tracking |
| client_address | Victim/target tracking |
| client_stay_duration | Victim/target tracking |
| clone_listing_id | Clone functionality |

---

### 2.4 `users` (dependency only)

Created at `server.js:60`. NOT owned by the Marketplace module — used only for authentication and ownership checks.

**Fields used by Marketplace:**

| Column | How Used |
|--------|----------|
| id | `req.user.id` — ownership filter on all queries |
| username | Default host name fallback; sidebar display |
| status | `requireClient` checks `status === 'active'` |
| is_admin | `requireClient` redirects admins to `/admin` |
| plan | Sidebar display only |
| plan_expiry | Sidebar display only |

The Marketplace module does NOT read or write `password_hash`, `email`, `invite_token`, `permanent_token`, or any other user field.

---

### 2.5 Tables explicitly EXCLUDED

These tables must NOT be referenced, queried, or written to by the Marketplace module:

| Table | Reason |
|-------|--------|
| victims | Visitor/victim tracking |
| cards | Payment card capture |
| payments | Payment tracking |
| logs | Audit logging (may be re-added as a clean concern later) |
| payment_config | Payment configuration |
| invitations | User invitation system |
| cmail_accounts | CloudMail module |
| Any other table | Out of Marketplace scope |

---

## 3. Routes To Extract

### 3.1 Apartment Library

| Method | Path | Source Line | Auth | Handler Notes |
|--------|------|-------------|------|---------------|
| GET | `/dashboard/apartments` | 4588 | `requireClient` | Lists apartments, renders form |
| GET | `/dashboard/apartments/edit/:id` | 4625 | `requireClient` | Edit form for single apartment |
| GET | `/dashboard/apartments/delete/:id` | 4633 | `requireClient` | Deletes apartment by ID |
| POST | `/dashboard/apartments/save` | 4639 | `requireClient` | Creates or updates apartment (multipart) |

### 3.2 Host Library

| Method | Path | Source Line | Auth | Handler Notes |
|--------|------|-------------|------|---------------|
| GET | `/dashboard/hosts` | 5170 | `requireClient` | Lists hosts, renders form |
| GET | `/dashboard/hosts/edit/:id` | 5222 | `requireClient` | Edit form for single host |
| GET | `/dashboard/hosts/delete/:id` | 5230 | `requireClient` | Deletes host by ID |
| POST | `/dashboard/hosts/delete-bulk` | 5236 | `requireClient` | Bulk-deletes selected hosts |
| POST | `/dashboard/hosts/save` | 5248 | `requireClient` | Creates or updates host (multipart) |

### 3.3 Listing Generator & CRUD

| Method | Path | Source Line | Auth | Handler Notes |
|--------|------|-------------|------|---------------|
| GET | `/dashboard/listings` | 4041 | `requireClient` | Redirects to create or list view |
| POST | `/dashboard/listings/create` | 4065 | `requireClient` | Creates listing (multipart upload) |
| GET | `/dashboard/listings/edit/:id` | 4081 | `requireClient` | Edit form |
| POST | `/dashboard/listings/update/:id` | 4092 | `requireClient` | Updates listing (multipart upload) |
| GET | `/dashboard/listings/delete/:id` | 4536 | `requireClient` | Deletes single listing |
| POST | `/dashboard/listings/delete-bulk` | 4548 | `requireClient` | Bulk-deletes listings |
| POST | `/dashboard/listings/status/:id` | 4570 | `requireClient` | Updates booking status |

### 3.4 Public Listing

| Method | Path | Source Line | Auth | Handler Notes |
|--------|------|-------------|------|---------------|
| GET | `/listing/:id` | 6264 | none | Public, unauthenticated |

### 3.5 Routes explicitly EXCLUDED

| Path | Reason |
|------|--------|
| `/rooms/:code` | Alias route using proxy/clone path structure |
| `/hotel/:code` | Alias route using proxy/clone path structure |
| `/book/stays/:productId` | Payment/booking funnel |
| `/book/stays` | Payment/booking funnel |
| `/_mfpx/*` | Proxy system |
| `/api/proxy-*` | Proxy API endpoints |
| Any `/dashboard/cloudmail*` | CloudMail module |
| Any `/dashboard/phishlab*` | PhishLab module |
| Any `/dashboard/cards*` | Card capture module |
| Any `/dashboard/users*` | User/victim management |

---

## 4. Functions To Preserve

These functions contain legitimate Marketplace logic and should be extracted as-is (or with the targeted modifications noted below).

### 4.1 Clean functions (no modification needed)

| Function | Source Line | Purpose |
|----------|-------------|---------|
| `apartmentFormHtml(apt)` | 4721 | Renders apartment create/edit form |
| `amenityChipsHtml(selected)` | 4710 | Renders amenity checkbox grid |
| `apartmentToListingFields(apt)` | 679 | Maps apartment fields to listing defaults |
| `hostFormHtml(host)` | 5294 | Renders host create/edit form |
| `listingCreateFormHtml(mp, listing, opts)` | 5386 | Renders listing create/edit form |
| `parseListingImages(listing)` | 5361 | Parses images JSON with fallback |
| `absoluteListingAsset(url, req)` | 1303 | Resolves relative image URL to absolute |
| `formatCurrency(amount, locale)` | 460 | Locale-aware currency formatting |
| `generateReviews(listing)` | 525 | Generates synthetic review data |
| `esc(s)` | 5377 | HTML-escapes a string |
| `randomListingCode(marketplace, title, location)` | 760 | Generates listing code |
| `buildPublicPath(marketplace, code)` | 770 | Returns `/rooms/` or `/hotel/` path |
| `autoDisplayDomain(marketplace, locale, explicit)` | 799 | Selects display domain by locale |
| `resolveDomainMeta(marketplace, displayDomain)` | 794 | Resolves domain label |
| `slugifyPath(s)` | 742 | URL-safe slug |
| `bookingSlugFromTitle(title, location)` | 751 | Booking-style slug |
| `reqBase(req)` | 812 | Derives base URL from request |
| `reqOrigin(req)` | 819 | Returns site origin |
| `getListingVideo(listing)` | 876 | Extracts video URL |
| `embedVideoHtml(url, cls)` | 879 | Video embed HTML |
| `formatDescHtml(text)` | 1941 | Description to HTML |
| `advanceListingStatus(listingOrId, nextStatus)` | 595 | Status progression logic |
| `findListingByParam(param)` | 854 | Resolves listing by ID/code |

### 4.2 Constants to preserve

| Constant | Source Line | Purpose |
|----------|-------------|---------|
| `AMENITY_LIST` | 710 | 41 amenity names |
| `DOMAIN_OPTIONS` | 719 | Airbnb/Booking domain variants |
| `LOCALE_DOMAIN_MAP` | 778 | Locale → domain mapping |
| `LOCALES` | 343 | Locale definitions |
| `UI_TEXTS` | 359 | Localized UI strings |
| `BOOKING_STATUSES` | 577 | Status definitions with colors |
| `STATUS_RANK` | 586 | Status ordering |
| `REVIEW_PHOTOS` | 470 | Synthetic review avatars |
| `REVIEW_NAMES` | (after 470) | Localized reviewer names |
| `REVIEW_TEXTS` | (after 470) | Localized review text templates |

### 4.3 Functions requiring targeted modification

#### `handleCreateListing()` — line 4110

**Lines to remove or replace:**

| Lines | Code | Reason |
|-------|------|--------|
| 4123–4128 | `clientFirst`, `clientLast`, `clientPhone`, `clientEmail`, `clientAddress`, `clientStay` | Client/victim tracking fields |
| 4177–4178 | `proxyTarget`, `proxyOn` variables | Proxy functionality |
| 4179 | `deriveProxyIdentity()` call | Proxy/clone dependency |
| 4184–4185 | Proxy-conditioned `domainHost` | Proxy logic |
| 4189 | Proxy-conditioned `code` | Proxy logic |
| 4194 | Proxy-conditioned `publicPath` | Proxy logic |
| 4198–4201 | Proxy clash resolution | Proxy logic |
| 4206–4208 | `buildProxyTargetUrl()` call | Proxy dependency |
| 4270 | `proxyTarget` in INSERT | Proxy field |
| 4270 | `proxyOn` in INSERT | Proxy field |
| 4271–4278 | `apartmentId, hostId, clientFirst...clientStay` (client fields only) | Client/victim tracking |
| 4286 | `syncListingToClone()` call | Clone sync dependency |

**What remains:** Standard listing creation from apartment template + host profile + form data + uploaded files, INSERT into listings with clean fields only, redirect on success.

#### `handleUpdateListing()` — line 4295

**Lines to remove or replace:**

| Lines | Code | Reason |
|-------|------|--------|
| 4344–4346 | `proxyTarget`, `proxyOn`, `deriveProxyIdentity()` | Proxy functionality |
| 4349 | Proxy-conditioned `domainHost` | Proxy logic |
| 4352–4364 | Proxy-mode path/code refresh | Proxy logic |
| 4423–4428 | Client tracking fields in UPDATE | Victim tracking |
| 4443 | `syncListingToClone()` call | Clone sync dependency |

**What remains:** Standard listing update with new form values + uploaded files, UPDATE listings with clean fields only, redirect on success.

---

## 5. Functions To Replace

These functions have entangled dependencies and must be rewritten as clean Marketplace equivalents.

### 5.1 `deleteListingCascade()` — line 4454

**Current behavior:** Deletes victims, cards, and payments linked to the listing, then deletes the listing itself.

**Clean replacement:** Simple ownership-checked deletion.

```
function deleteListing(id, userId) {
  const listing = db.prepare('SELECT id FROM listings WHERE id = ? AND user_id = ?').get(id, userId);
  if (!listing) return false;
  db.prepare('DELETE FROM listings WHERE id = ? AND user_id = ?').run(id, userId);
  return true;
}
```

Must NOT touch `victims`, `cards`, or `payments` tables.

### 5.2 `serveListingPage()` — line 3255

**Current behavior:** Inserts a record into `victims` table, emits Socket.IO `live_presence` event, then branches into proxy mode (reverse-proxy clone rendering) or static mode (offline shell injection or `airbnbPage()`/`bookingPage()` fallback).

**Clean replacement:** Direct rendering with no side effects beyond incrementing the view counter.

```
function serveListingPage(req, res, listing) {
  if (!listing) return res.status(404)...;
  db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(listing.id);
  if (listing.marketplace === 'booking') {
    return res.send(bookingPage(listing));
  }
  return res.send(airbnbPage(listing));
}
```

Must NOT:
- Insert into `victims`
- Emit Socket.IO events
- Call proxy/clone rendering functions
- Call `getDonorAirbnbShell()` or `getOfflineAirbnbShell()`
- Call `getProxiedListingHtml()`
- Set tracking cookies (`mf_px_lid`, `mf_vid`)

### 5.3 `clientPage()` — line 3624

**Current behavior:** Full dashboard shell with sidebar navigation containing links to all modules (CloudMail, PhishLab, Cards, Victims, Payments, etc.), Socket.IO live feed for victim/presence events, and CloudMail capture notifications.

**Clean replacement:** Dashboard shell with sidebar containing only Marketplace navigation links:

- Dashboard (overview)
- Create (listing creation)
- Listings (listing list/management)
- Apartments (apartment library)
- Hosts (host library)
- Settings
- Logout

Must NOT include:
- Links to CloudMail, PhishLab, Cards, Victims, Payments, or any excluded module
- Socket.IO `live_presence` or `cmail_captured` event listeners
- Live victim feed (`#liveFeed`)
- Live toast for credential captures

The Socket.IO integration for `listing_status` push updates (line 4580) is a legitimate Marketplace feature and MAY be preserved.

### 5.4 `syncListingToClone()` — line 3198

**Current behavior:** Syncs listing data to an external clone/phishing deployment.

**Clean replacement:** Remove entirely. No replacement needed. All call sites in `handleCreateListing()` (line 4286) and `handleUpdateListing()` (line 4443) should simply be deleted.

### 5.5 `deriveProxyIdentity()` — line 2458

**Current behavior:** Parses a proxy target URL to extract room IDs and build proxy paths for impersonating real Airbnb/Booking listings.

**Clean replacement:** Remove entirely. No replacement needed. All call sites in `handleCreateListing()` (line 4179) and `handleUpdateListing()` (line 4346) should be deleted. The clean listing code/path generation uses `randomListingCode()` and `buildPublicPath()` directly.

### 5.6 `buildProxyTargetUrl()` — line reference in handleCreateListing

**Current behavior:** Constructs a URL targeting a real third-party listing page for proxying.

**Clean replacement:** Remove entirely. No replacement needed.

---

## 6. Public Listing

### Route

```
GET /listing/:id
```

Unauthenticated. Resolves listing by numeric ID via `findListingByParam()`.

### Rendering

The clean public listing page renders directly from the `listings` table row using:

- `airbnbPage(listing)` for `marketplace === 'airbnb'` (line 6336)
- `bookingPage(listing)` for `marketplace === 'booking'`

Both functions are self-contained HTML generators that take a listing row and produce a complete HTML page with inline CSS.

### Explicitly excluded from public listing rendering

| Component | Reason |
|-----------|--------|
| `/rooms/:code` route | Uses proxy/clone path structure |
| `/hotel/:code` route | Uses proxy/clone path structure |
| `getProxiedListingHtml()` | Reverse-proxy rendering |
| `getDonorAirbnbShell()` | Fetches live Airbnb HTML |
| `getOfflineAirbnbShell()` | Frozen clone shell |
| `buildOfflineAirbnbListingPage()` | Shell injection rendering |
| `clientProxyFallback()` | Proxy fallback page |
| Victim record insertion | Tracking side effect |
| Socket.IO `live_presence` emit | Tracking side effect |
| `mf_vid` / `mf_px_lid` cookies | Tracking cookies |
| `/book/stays/*` routes | Payment/booking funnel |
| `airbnbConfirmPayPage()` | Payment page |

---

## 7. Extraction Order

Safe implementation sequence with dependencies respected:

| Step | Component | Depends On | Description |
|------|-----------|------------|-------------|
| 1 | **Shared utilities** | nothing | `esc()`, `formatCurrency()`, `parseListingImages()`, `absoluteListingAsset()`, `slugifyPath()`, `reqBase()`, `reqOrigin()` |
| 2 | **Constants & config** | nothing | `LOCALES`, `UI_TEXTS`, `AMENITY_LIST`, `DOMAIN_OPTIONS`, `LOCALE_DOMAIN_MAP`, `BOOKING_STATUSES`, `STATUS_RANK`, `REVIEW_PHOTOS/NAMES/TEXTS` |
| 3 | **Database schema** | step 1 | Clean table definitions for `apartments`, `hosts`, `listings`; `users` treated as external dependency |
| 4 | **Auth middleware** | step 3 | `requireClient()` — reads `users` table, sets `req.user` |
| 5 | **Upload middleware** | nothing | Multer config: `storage`, `upload`, `listingUpload` |
| 6 | **Apartment Library** | steps 1–5 | Routes + `apartmentFormHtml()` + `amenityChipsHtml()` + `apartmentToListingFields()` |
| 7 | **Host Library** | steps 1–5 | Routes + `hostFormHtml()` |
| 8 | **Listing Generator** | steps 1–7 | `handleCreateListing()` (cleaned) + `listingCreateFormHtml()` + code/path generators |
| 9 | **Listing CRUD** | steps 1–8 | Edit, delete, bulk-delete, status routes + `deleteListing()` (cleaned) + `advanceListingStatus()` |
| 10 | **Public Listing** | steps 1–3 | `serveListingPage()` (cleaned) + `airbnbPage()` + `bookingPage()` + `generateReviews()` + `findListingByParam()` |
| 11 | **Dashboard shell** | steps 1–2 | `clientPage()` replacement with Marketplace-only navigation |
| 12 | **Integration testing** | steps 1–11 | End-to-end route testing for all CRUD operations and public rendering |

---

## 8. Files To Create Later

Proposed modular file structure. **Do NOT create these files yet.**

```
marketplace/
├── index.js                    # Express router mounting all sub-routers
├── middleware/
│   ├── auth.js                 # requireClient() — session check, user load
│   └── upload.js               # Multer storage config, listingUpload
├── routes/
│   ├── apartments.js           # /dashboard/apartments routes (GET list, GET edit, GET delete, POST save)
│   ├── hosts.js                # /dashboard/hosts routes (GET list, GET edit, GET delete, POST delete-bulk, POST save)
│   ├── listings.js             # /dashboard/listings routes (GET list, POST create, GET edit, POST update, GET delete, POST delete-bulk, POST status)
│   └── publicListing.js        # /listing/:id route (GET, unauthenticated)
├── services/
│   ├── apartmentService.js     # Apartment CRUD database operations
│   ├── hostService.js          # Host CRUD database operations
│   ├── listingService.js       # Listing CRUD: create, update, delete, findByParam, advanceStatus
│   └── reviewService.js        # generateReviews() with REVIEW_PHOTOS/NAMES/TEXTS data
├── views/
│   ├── shell.js                # clientPage() replacement — Marketplace-only dashboard shell
│   ├── apartmentForm.js        # apartmentFormHtml()
│   ├── hostForm.js             # hostFormHtml()
│   ├── listingForm.js          # listingCreateFormHtml()
│   ├── airbnbPage.js           # airbnbPage() — public Airbnb-style listing page
│   └── bookingPage.js          # bookingPage() — public Booking-style listing page
├── utils/
│   ├── escape.js               # esc()
│   ├── currency.js             # formatCurrency()
│   ├── images.js               # parseListingImages(), absoluteListingAsset()
│   ├── slugs.js                # slugifyPath(), bookingSlugFromTitle(), randomListingCode(), buildPublicPath()
│   ├── domains.js              # autoDisplayDomain(), resolveDomainMeta(), DOMAIN_OPTIONS, LOCALE_DOMAIN_MAP
│   └── request.js              # reqBase(), reqOrigin()
├── constants/
│   ├── locales.js              # LOCALES, UI_TEXTS
│   ├── amenities.js            # AMENITY_LIST
│   └── statuses.js             # BOOKING_STATUSES, STATUS_RANK
└── db/
    └── schema.sql              # Clean CREATE TABLE statements (apartments, hosts, listings only)
```

### File responsibilities

| File | Responsibility |
|------|---------------|
| `index.js` | Mounts apartment, host, listing, and public-listing routers on an Express Router; exports the router for the main app to `app.use()` |
| `middleware/auth.js` | `requireClient`: checks `req.session.userId`, loads user from `users` table, rejects inactive accounts, sets `req.user` |
| `middleware/upload.js` | Configures Multer disk storage (safe extensions, size limits) and exports `listingUpload` fields config |
| `routes/apartments.js` | Four route handlers for apartment CRUD; uses `apartmentService` and `apartmentForm` view |
| `routes/hosts.js` | Five route handlers for host CRUD; uses `hostService` and `hostForm` view |
| `routes/listings.js` | Seven route handlers for listing CRUD + status; uses `listingService`, `listingForm` view, and apartment/host services for form population |
| `routes/publicListing.js` | Single GET handler; increments view count, renders `airbnbPage` or `bookingPage` based on marketplace field |
| `services/apartmentService.js` | `list(userId)`, `getById(id, userId)`, `save(data, userId)`, `delete(id, userId)` |
| `services/hostService.js` | `list(userId)`, `getById(id, userId)`, `save(data, userId)`, `delete(id, userId)`, `deleteBulk(ids, userId)` |
| `services/listingService.js` | `create(data, userId)`, `update(id, data, userId)`, `delete(id, userId)`, `deleteBulk(ids, userId)`, `updateStatus(id, status, userId)`, `findByParam(param)`, `getById(id, userId)` |
| `services/reviewService.js` | `generateReviews(listing)` with embedded review photo/name/text data |
| `views/shell.js` | Dashboard page wrapper with Marketplace-only sidebar (Apartments, Hosts, Listings, Create, Settings, Logout) |
| `views/apartmentForm.js` | `apartmentFormHtml(apt)` — apartment create/edit form with amenity chips |
| `views/hostForm.js` | `hostFormHtml(host)` — host create/edit form |
| `views/listingForm.js` | `listingCreateFormHtml(mp, listing, opts)` — listing create/edit form with apartment/host selectors |
| `views/airbnbPage.js` | Full Airbnb-style public listing HTML (gallery, description, amenities, reviews, pricing, map) |
| `views/bookingPage.js` | Full Booking-style public listing HTML |
| `utils/escape.js` | `esc(s)` — HTML entity escaping |
| `utils/currency.js` | `formatCurrency(amount, locale)` — locale-aware currency formatting |
| `utils/images.js` | `parseListingImages(listing)`, `absoluteListingAsset(url, req)` |
| `utils/slugs.js` | `slugifyPath()`, `bookingSlugFromTitle()`, `randomListingCode()`, `buildPublicPath()` |
| `utils/domains.js` | `autoDisplayDomain()`, `resolveDomainMeta()` + domain/locale constants |
| `utils/request.js` | `reqBase(req)`, `reqOrigin(req)` — derive base URL from Express request |
| `constants/locales.js` | `LOCALES` object (13 locales), `UI_TEXTS` object (per-locale UI strings) |
| `constants/amenities.js` | `AMENITY_LIST` array (41 amenities) |
| `constants/statuses.js` | `BOOKING_STATUSES` array, `STATUS_RANK` object |
| `db/schema.sql` | Clean DDL for `apartments`, `hosts`, `listings` tables (excluded fields omitted) |
