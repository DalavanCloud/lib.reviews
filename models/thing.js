'use strict';
const thinky = require('../db');
const r = thinky.r;
const type = thinky.type;

const urlUtils = require('../util/url-utils');
const mlString = require('./helpers/ml-string');
const revision = require('./helpers/revision');
const slugName = require('./helpers/slug-name');
const getSetIDHandler = require('./helpers/set-id');
const File = require('./file');
const ThingSlug = require('./thing-slug');
const isValidLanguage = require('../locales/languages').isValid;
const ReportedError = require('../util/reported-error');

let thingSchema = {

  id: type.string(),

  // First element is primary URL associated with this thing
  urls: [type.string().validator(_isValidURL)],

  label: mlString.getSchema({
    maxLength: 256
  }),
  aliases: mlString.getSchema({
    maxLength: 256,
    array: true
  }),
  description: mlString.getSchema({
    maxLength: 512
  }),

  // Data for fields can be pulled from external sources. For fields that
  // support this, we record whether a sync is currently active (in which
  // case the field is not editable), when the last sync took place,
  // and from where.
  //
  // Note we don't initialize the "active" property -- if (and only if) it is
  // undefined, it may be switched on by the /adapters/sync scripts.
  sync: {
    description: {
      active: type.boolean(),
      lastUpdate: type.date(),
      source: type.string().enum(['wikidata'])
    }
  },

  originalLanguage: type
    .string()
    .max(4)
    .validator(isValidLanguage),

  canonicalSlugName: type.string(),

  urlID: type.virtual().default(function() {
    return this.canonicalSlugName ? encodeURIComponent(this.canonicalSlugName) : this.id;
  }),

  // We can set one or many types which determine which metadata cen be added about this thing
  isA: [type.string()],

  // Information for specific types.
  bookAuthor: type.string().uuid(4), // => human

  // Track original authorship across revisions
  createdOn: type.date().required(true),
  createdBy: type.string().uuid(4).required(true),

  hasInfo: type.virtual().default(_hasInfo), // Helper for determining whether this is more than a single URL

  // These can only be populated from the outside using a user object
  userCanDelete: type.virtual().default(false),
  userCanEdit: type.virtual().default(false),
  userCanUpload: type.virtual().default(false),
  userIsCreator: type.virtual().default(false),

  // Populated asynchronously using the populateReviewMetrics method
  numberOfReviews: type.virtual().default(0),
  averageStarRating: type.virtual().default(0)
};

// Add versioning related fields
Object.assign(thingSchema, revision.getSchema());

let Thing = thinky.createModel("things", thingSchema);

// Define membership and moderator relations; these are managed by the ODM
// as separate tables, e.g. teams_users_membership
Thing.hasAndBelongsToMany(File, "files", "id", "id", {
  type: 'media_usage'
});

File.hasAndBelongsToMany(Thing, "things", "id", "id", {
  type: 'media_usage'
});

Thing.hasOne(ThingSlug, "slug", "id", "thingID");

ThingSlug.belongsTo(Thing, "thing", "thingID", "thing");

Thing.getNotStaleOrDeleted = revision.getNotStaleOrDeletedHandler(Thing);

Thing.lookupByURL = function(url) {
  return Thing
    .filter(thing => thing('urls').contains(url))
    .filter({ _revOf: false }, { default: true })
    .filter({ _revDeleted: false }, { default: true });
};

// There _should_ only be one review per user+thing. But the user of the model
// should be prepared to deal with edge cases where there might be more.
Thing.define("getReviewsByUser", function(user) {
  return new Promise((resolve, reject) => {

    let Review = require('./review');

    if (!user)
      return resolve([]);

    Review
      .filter({
        thingID: this.id,
        createdBy: user.id
      })
      .filter(r.row('_revDeleted').eq(false), { // Exclude deleted rows
        default: true
      })
      .filter(r.row('_revOf').eq(false), { // Exclude old revisions
        default: true
      })
      .getJoin({
        creator: {
          _apply: seq => seq.without('password')
        },
        teams: true
      })
      .then(reviews => {
        reviews.forEach(review => review.populateUserInfo(user));
        resolve(reviews);
      })
      .catch(error => reject(error));

  });
});

Thing.define("getAverageStarRating", function() {
  return new Promise((resolve, reject) => {
    r.table('reviews')
      .filter({
        thingID: this.id,
      })
      .filter({ _revOf: false }, { default: true })
      .filter({ _revDeleted: false }, { default: true })
      .avg('starRating')
      .then(resolve)
      .catch(reject);
  });
});

Thing.define("getReviewCount", function() {
  return new Promise((resolve, reject) => {
    r.table('reviews')
      .filter({
        thingID: this.id,
      })
      .filter({ _revOf: false }, { default: true })
      .filter({ _revDeleted: false }, { default: true })
      .count()
      .then(resolve)
      .catch(reject);
  });

});

Thing.define("populateReviewMetrics", function() {
  return new Promise((resolve, reject) => {
    Promise
      .all([this.getAverageStarRating(), this.getReviewCount()])
      .then(metrics => {
        this.averageStarRating = metrics[0];
        this.numberOfReviews = metrics[1];
        resolve(this);
      })
      .catch(reject);
  });
});

// Helper function to deal with array initialization
Thing.define("addFile", function(filename) {
  if (this.files === undefined)
    this.files = [];

  this.files.push(filename);

});
Thing.define("newRevision", revision.getNewRevisionHandler(Thing));
Thing.define("deleteAllRevisions", revision.getDeleteAllRevisionsHandler(Thing));

// Update the slug if an update is needed. Modifies the team object but does
// not save it.
Thing.define("updateSlug", slugName.getUpdateSlugHandler({
  SlugModel: ThingSlug,
  slugForeignKey: 'thingID',
  slugSourceField: 'label'
}));

Thing.define("setID", getSetIDHandler());


Thing.define("populateUserInfo", function(user) {
  if (!user)
    return; // Permissions will be at their default value (false)

  // For now, we don't let users delete things they've created,
  // since things are collaborative in nature
  this.userCanDelete = user.isSuperUser || user.isSiteModerator || false;
  this.userCanEdit = user.isSuperUser || user.isTrusted || user.id === this.createdBy;
  this.userCanUpload = user.isSuperUser || user.isTrusted;
  this.userIsCreator = user.id === this.createdBy;

});

Thing.getWithData = function(id, options) {

  options = Object.assign({ // Default: all first-level joins
    withFiles: true,
    withReviewMetrics: true
  }, options);

  return new Promise((resolve, reject) => {

    let join = {};
    if (options.withFiles)
      join.files = {
        _apply: seq => seq.filter({ completed: true }) // We don't show unfinished uploads
      };

    Thing
      .get(id)
      .getJoin(join)
      .then(thing => {
        if (thing._revDeleted)
          return reject(revision.deletedError);

        if (thing._revOf)
          return reject(revision.staleError);

        if (options.withReviewMetrics)
          thing
          .populateReviewMetrics()
          .then(resolve)
          .catch(reject);
        else
          resolve(thing);

      })
      .catch(reject);
  });

};

// Get label for a given thing, fallback to prettified URL if none available
Thing.getLabel = function(thing, language) {

  if (!thing || !thing.id)
    return undefined;

  let str;
  if (thing.label)
    str = mlString.resolve(language, thing.label).str;

  if (str)
    return str;

  // If we have no proper label, we can at least show the URL
  if (thing.urls && thing.urls.length)
    return urlUtils.prettify(thing.urls[0]);

  return undefined;

};


// Internal helper functions

function _isValidURL(url) {
  if (urlUtils.validate(url))
    return true;
  else
    throw new ReportedError({
      message: 'Thing URL %s is not a valid URL.',
      messageParams: [url],
      userMessage: 'invalid url',
      userMessageParams: []
    });
}

function _hasInfo() {
  if ((!this.urls || this.urls.length == 1) &&
    !this.aliases && !this.description && !this.slugs && !this.isA)
    return false;
  else
    return true;
}

module.exports = Thing;
