/**
 * GET /
 * Events page.
 */

// useful info:
//  - categories: https://developer.foursquare.com/categorytree
//  - venue returns: https://developer.foursquare.com/docs/responses/venue

var secrets = require("../config/secrets");
var Cache = require("../models/EventCache");
var async = require("async");
var _ = require("underscore");
var foursquare = require('node-foursquare-venues')(secrets.foursquare.clientId, secrets.foursquare.clientSecret);
var wildcardDiscounts = require("../wildcardChicagoList.js");

// Hardcoded Constants: may or may not be temporary
var location = "The Loop, Chicago IL"

function getVenues(req, callback) {

	async.parallel([
		function(cback) {
			getFoodVenues(req, cback);
		},
		function(cback) {
			getEventVenues(req, cback);
		}
	],
	function(err, results) {
		var foodVenues = results[0];
		var eventVenues = results[1];

		Cache.findOne({}, function(err, theCache) {
			if (theCache) {
				console.log(theCache);
			}
			else {
				theCache = new Cache();
			}
			
			for(var i=0; i < theCache.foodCache.length; i++) {
				var index = foodVenues.indexOf(theCache.foodCache[i].id);
				if (index > -1) {
					foodVenues.splice(index, 1);
				}
			}

			for(var i=0; i < theCache.eventCache.length; i++) {
				var index = eventVenues.indexOf(theCache.eventCache[i].id);
				if (index > -1) {
					eventVenues.splice(index, 1);
				}
			}

			cacheItems(foodVenues, theCache, "foodCache");
			cacheItems(eventVenues, theCache, "eventCache");

			console.log("done?");
			callback(null, theCache);
		})
	});
}

function cacheItems(items, cache, space) {
	for(var i = 0; i < items.length; i++) {
		foursquare.venues.venue(items[i], {}, function(err, venueInfo) {
			cache[space].push(getVenueData(venueInfo.response.venue));
			cache.save(); // ??
		});
	}
}

function getFoodVenues(req, callback) {
	var food = ["4d4b7105d754a06374d81259", ""]; // general food
	if (req.user) { // check that preferences have bene filled
		food = req.user.foodPreference.query;
	} 
	foursquare.venues.search({near: location, limit: "5", categoryId: food[0], query: food[1]}, function(err, foodVenues) {
		var venues = [];

		for(var i=0; i < foodVenues.response.venues.length; i++) {
			venues.push(foodVenues.response.venues[i].id);
		}

		callback(null, venues);
	});
};

function getEventVenues(req, callback) {
	// arts & entertainment, events, shopping
	var events = ["4d4b7104d754a06370d81259", "4d4b7105d754a06373d81259", "4bf58dd8d48988d1fd941735"] ; 
	if (req.user) { 
		events = req.user.eventPreference.query;
	}

	var venues1 = [], venues2 = [], venues3 = [];

	async.parallel([
		function(cback) {
			foursquare.venues.search({near: location, limit: "5", categoryId: events[0]}, function(err, eventVenues) {
				for(var i=0; i < eventVenues.response.venues.length; i++) {
					venues1.push(eventVenues.response.venues[i].id);
				}

				cback(null, 1);
			});
		},
		function(cback) {
			foursquare.venues.search({near: location, limit: "5", categoryId: events[1]}, function(err, eventVenues) {
				for(var i=0; i < eventVenues.response.venues.length; i++) {
					venues2.push(eventVenues.response.venues[i].id);
				}

				cback(null, 2);
			});
		},
		function(cback) {
			foursquare.venues.search({near: location, limit: "5", categoryId: events[2]}, function(err, eventVenues) {
				for(var i=0; i < eventVenues.response.venues.length; i++) {
					venues3.push(eventVenues.response.venues[i].id);
				}

				cback(null, 3);
			});
		}
	],
	function(err, results) {
		callback(null, venues1.concat(venues2).concat(venues3));
	});

};

function getVenueData(venue) {
	var info = {};
	info.id = venue.id;
	info.name = venue.name;
	info.location = venue.location; // attrib: address, crossStreet, lat, long, postal, city, state, country, cc
	info.url = venue.canonicalUrl;
	info.price = venue.price; // tier (1,2,3,4), message (cheap, moderate, etc.), currency ($, $$, etc.)
	info.rating = Number(venue.rating) / 2;

	// status (closed until x), isOpen, timeframes
	// timeframes: days (Mon-Fri):, open (array of renderedTimes's), includesToday (boolean, today or not)
	info.hours = venue.hours;
	info.popular_hours = venue.popular;

	// deals, count should return the #
	info.deals = venue.specials;

	// count for #, groups.items -> array of dictionaries of photos
	// https://developer.foursquare.com/docs/responses/photo.html
	info.photos = venue.photos;
	info.hasWildcardDiscount = false;
	// menu.url, menu.mobileURL
	info.menu = venue.menu;

	info.tags = venue.tags;

	return info;
};

function sortVenues(venueList, user) {
	var venueList = filterVenues(venueList, user);
	venueList.sort(function(x, y) {
		return scoreVenue(y) - scoreVenue(x);
	});

	return venueList;
};

// add additional filters if necessary
	// mall filter (!!!)
// visitedVenues should be an array of IDs
function filterVenues(venueList, user) {
	var visitedVenues = [];
	if (user) {
		visitedVenues = user.visitedVenues;
	}

	return _.filter(venueList, function(venue) {
		return visitedVenues.indexOf(venue.id) == -1;
	});
};

// we can update this scoring algorithm as needed!
function scoreVenue(venue) {
	venue.hasWildcardDiscount = (wildcardDiscounts.wildcardDiscountList.indexOf(venue.name) != -1);
	var wildcardFactor = venue.hasWildcardDiscount * 3;
	return venue.rating + wildcardFactor;
};

exports.getEvents = function(req, res) {
	async.parallel([
		function(callback) {
			getVenues(req, callback);
		}
	],
	function(err, results) {
		res.render('events/events', {
			title: 'Events',
			food: results[0],
			events: results[1],
		});
		console.log("Let's see how this goes.");

	});
}

// exports.getEvents = function(req, res) {
//   res.render("events/events", {
//     title: 'Events'
//   });
// };

