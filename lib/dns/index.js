/*!
 * Copyright 2014 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*!
 * @module dns
 */

'use strict';

var extend = require('extend');
var is = require('is');

/**
 * @type {module:common/streamrouter}
 * @private
 */
var streamRouter = require('../common/stream-router.js');

/**
 * @type {module:common/util}
 * @private
 */
var util = require('../common/util.js');

/**
 * @type {module:dns/zone}
 * @private
 */
var Zone = require('./zone.js');

/**
 * @const {string} Base URL for DNS API.
 * @private
 */
var DNS_BASE_URL = 'https://www.googleapis.com/dns/v1/projects/';

/**
 * @const {array} Required scopes for the DNS API.
 * @private
 */
var SCOPES = [
  'https://www.googleapis.com/auth/ndev.clouddns.readwrite',
  'https://www.googleapis.com/auth/cloud-platform'
];

/**
 * [Google Cloud DNS](https://cloud.google.com/dns/what-is-cloud-dns) is a high-
 * performance, resilient, global DNS service that provides a cost-effective way
 * to make your applications and services available to your users. This
 * programmable, authoritative DNS service can be used to easily publish and
 * manage DNS records using the same infrastructure relied upon by Google.
 *
 * @constructor
 * @alias module:dns
 *
 * @param {object} options - [Configuration object](#/docs/?method=gcloud).
 *
 * @example
 * var gcloud = require('gcloud')({
 *   keyFilename: '/path/to/keyfile.json',
 *   projectId: 'grape-spaceship-123'
 * });
 *
 * var dns = gcloud.dns();
 */
function DNS(options) {
  if (!(this instanceof DNS)) {
    return new DNS(options);
  }

  options = options || {};

  if (!options.projectId) {
    throw util.missingProjectIdError;
  }

  this.makeAuthorizedRequest_ = util.makeAuthorizedRequestFactory({
    credentials: options.credentials,
    keyFile: options.keyFilename,
    scopes: SCOPES,
    email: options.email
  });

  this.projectId_ = options.projectId;
}

/**
 * Create a managed zone.
 *
 * @resource [ManagedZones: create API Documentation]{@link https://cloud.google.com/dns/api/v1/managedZones/create}
 *
 * @throws {error} If a zone name is not provided.
 * @throws {error} If a zone dnsName is not provided.
 *
 * @param {string} name - Unique name for the zone. E.g. "my-zone"
 * @param {object} config - Configuration object.
 * @param {string} config.dnsName - DNS name for the zone. E.g. "example.com."
 * @param {string=} config.description - Description text for the zone.
 * @param {function} callback - The callback function.
 * @param {?error} callback.err - An API error.
 * @param {?module:dns/zone} callback.zone - A new {module:dns/zone} object.
 * @param {object} callback.apiResponse - Raw API response.
 *
 * @example
 * dns.createZone('my-awesome-zone', {
 *   dnsName: 'example.com.', // note the period at the end of the domain.
 *   description: 'This zone is awesome!'
 * }, function(err, zone, apiResponse) {
 *   if (!err) {
 *     // The zone was created successfully.
 *   }
 * });
 */
DNS.prototype.createZone = function(name, config, callback) {
  var self = this;

  if (!name) {
    throw new Error('A zone name is required.');
  }

  if (!config || !config.dnsName) {
    throw new Error('A zone dnsName is required.');
  }

  config.name = name;

  // Required by the API.
  config.description = config.description || '';

  this.makeReq_('POST', '/managedZones', null, config, function(err, resp) {
    if (err) {
      callback(err, null, resp);
      return;
    }

    var zone = self.zone(resp.name);
    zone.metadata = resp;

    callback(null, zone, resp);
  });
};

/**
 * Gets a list of managed zones for the project.
 *
 * @resource [ManagedZones: list API Documentation]{@link https://cloud.google.com/dns/api/v1/managedZones/list}
 *
 * @param {object=} query - Query object.
 * @param {number} query.maxResults - Maximum number of results to return.
 * @param {string} query.pageToken - Page token.
 * @param {function} callback - The callback function.
 * @param {?error} callback.err - An API error.
 * @param {?module:dns/zone[]} callback.zones - An array of {module:dns/zone}
 *     objects.
 * @param {object} callback.apiResponse - Raw API response.
 *
 * @example
 * dns.getZones(function(err, zones, apiResponse) {});
 */
DNS.prototype.getZones = function(query, callback) {
  var self = this;

  if (is.fn(query)) {
    callback = query;
    query = {};
  }

  this.makeReq_('GET', '/managedZones', query, null, function(err, resp) {
    if (err) {
      callback(err, null, null, resp);
      return;
    }

    var zones = (resp.managedZones || []).map(function(zone) {
      var zoneInstance = self.zone(zone.name);
      zoneInstance.metadata = zone;
      return zoneInstance;
    });

    var nextQuery = null;

    if (resp.nextPageToken) {
      nextQuery = extend({}, query, {
        pageToken: resp.nextPageToken
      });
    }

    callback(null, zones, nextQuery, resp);
  });
};

/**
 * Create a zone object representing an existing managed zone.
 *
 * @throws {error} If a zone name is not provided.
 *
 * @param  {string} name - The unique name of the zone.
 * @return {module:dns/zone}
 *
 * @example
 * var zone = dns.zone('my-zone');
 */
DNS.prototype.zone = function(name) {
  if (!name) {
    throw new Error('A zone name is required.');
  }

  return new Zone(this, name);
};

/**
 * Make a new request object from the provided arguments and wrap the callback
 * to intercept non-successful responses.
 *
 * @private
 *
 * @param {string} method - Action.
 * @param {string} path - Request path.
 * @param {*} query - Request query object.
 * @param {*} body - Request body contents.
 * @param {function} callback - The callback function.
 */
DNS.prototype.makeReq_ = function(method, path, query, body, callback) {
  var reqOpts = {
    method: method,
    qs: query,
    uri:  DNS_BASE_URL + this.projectId_ + path
  };

  if (body) {
    reqOpts.json = body;
  }

  this.makeAuthorizedRequest_(reqOpts, callback);
};

/*! Developer Documentation
 *
 * These methods can be used with either a callback or as a readable object
 * stream. `streamRouter` is used to add this dual behavior.
 */
streamRouter.extend(DNS, 'getZones');

module.exports = DNS;
