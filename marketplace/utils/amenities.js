const AMENITY_LIST = [
  'Wifi','Kitchen','Washer','Dryer','Free parking','Paid parking','Air conditioning','Heating',
  'TV','Hair dryer','Iron','Dedicated workspace','Self check-in','Pool','Hot tub','Gym',
  'BBQ grill','Breakfast','Indoor fireplace','Smoking allowed','Pets allowed','Elevator',
  'EV charger','Beach access','Lake access','Ski-in/Ski-out','Outdoor dining','Patio or balcony',
  'Backyard','Fire pit','Piano','Exercise equipment','Safe','Crib','High chair','Carbon monoxide alarm',
  'Smoke alarm','First aid kit','Fire extinguisher','Lockbox','Private entrance','Long term stays allowed'
];

function amenityChipsHtml(selected, esc) {
  const sel = (selected || []).map(s => String(s).toLowerCase());
  const defaults = new Set(['wifi','kitchen','washer','dryer','free parking','air conditioning','heating','tv','hair dryer','iron']);
  return AMENITY_LIST.map((a) => {
    const on = sel.length
      ? sel.includes(a.toLowerCase())
      : defaults.has(a.toLowerCase());
    return `<label class="amen-item"><input type="checkbox" name="amenity" value="${esc(a)}"${on ? ' checked' : ''}><span class="amen-label">${esc(a)}</span></label>`;
  }).join('');
}

module.exports = { AMENITY_LIST, amenityChipsHtml };
