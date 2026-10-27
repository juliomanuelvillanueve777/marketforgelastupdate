'use strict';

// Template registry for accommodation listing renderers.
// Add future templates here (booking-style, hotel, villa, luxury) without
// changing any other part of the listing system.
//
// getTemplate(id) -> renderer function
// renderer(listing, host, options) -> HTML string

const airbnbStyle = require('./airbnb-style');

const REGISTRY = {
  'airbnb-style': airbnbStyle
};

const DEFAULT_TEMPLATE = 'airbnb-style';

function getTemplate(id) {
  return REGISTRY[id] || REGISTRY[DEFAULT_TEMPLATE];
}

module.exports = { getTemplate, REGISTRY, DEFAULT_TEMPLATE };
