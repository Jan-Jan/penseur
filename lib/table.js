// Load Modules

var RethinkDB = require('rethinkdb');
var Boom = require('boom');


// Declare internals

var internals = {};


exports = module.exports = internals.Table = function (name, db) {

    this._name = name;
    this._db = db;
    this._table = RethinkDB.db(this._db._name).table(name);
};


internals.Table.prototype.get = function (id, callback) {

    this._run(this._table.get(id), 'get', id, callback);
};


internals.Table.prototype.query = function (criteria, callback) {

    this._run(this._table.filter(criteria), 'query', criteria, callback);
};


internals.Table.prototype.single = function (criteria, callback) {

    var self = this;

    this._run(this._table.filter(criteria), 'single', criteria, callback, function (ignore, result) {

        if (result.length === 0) {
            return callback(null, null);
        }

        if (result.length !== 1) {
            return self.error('single', 'Found multiple items', criteria, callback);
        }

        return callback(null, result[0]);
    });
};


internals.Table.prototype.count = function (criteria, type, callback) {

    this._run(this._table[type === 'fields' ? 'hasFields' : 'filter'](criteria).count(), 'count', { criteria: criteria, type: type }, callback);
};


internals.Table.prototype.insert = function (items, callback) {

    this._run(this._table.insert(items), 'insert', items, callback, function (ignore, result) {

        return callback(null, result.generated_keys ? (items instanceof Array ? result.generated_keys : result.generated_keys[0]) : null);
    });
};


internals.Table.prototype.update = function (id, changes, callback) {

    var self = this;

    this._run(this._table.get(id).update(changes), 'update', { id: id, changes: changes }, callback, function (ignore, result) {

        if (!result.replaced &&
            !result.unchanged) {

            return self.error('update', 'No item found to update', { id: id, changes: changes }, callback);
        }

        return callback(null);
    });
};


internals.Table.prototype.increment = function (id, field, value, callback) {

    var self = this;

    var changes = {};
    changes[field] = RethinkDB.row(field).add(value);
    this._run(this._table.get(id).update(changes, { returnChanges: true }), 'increment', { id: id, field: field, value: value }, callback, function (ignore, result) {

        if (!result.replaced) {
            return self.error('increment', 'No item found to update', { id: id, field: field, value: value }, callback);
        }

        var inc = result.changes[0].new_val[field];
        return callback(null, inc);
    });
};


internals.Table.prototype.append = function (id, field, value, callback) {

    var self = this;

    var changes = {};
    changes[field] = RethinkDB.row(field).append(value);
    this._run(this._table.get(id).update(changes), 'append', { id: id, field: field, value: value }, callback, function (ignore, result) {

        if (!result.replaced) {
            return self.error('append', 'No item found to update', { id: id, field: field, value: value }, callback);
        }

        return callback(null);
    });
};


internals.Table.prototype.unset = function (id, fields, callback) {

    var self = this;

    var changes = function (item) {

        return item.without(fields);
    };

    this._run(this._table.get(id).replace(changes), 'unset', { id: id, fields: fields }, callback, function (ignore, result) {

        if (!result.replaced &&
            !result.unchanged) {

            return self.error('unset', 'No item found to update', { id: id, fields: fields }, callback);
        }

        return callback(null);
    });
};


internals.Table.prototype.remove = function (criteria, callback) {

    var self = this;

    var isSingle = (typeof criteria !== 'object');
    var selection = (isSingle ? this._table.get(criteria)
                              : (Array.isArray(criteria) ? this._table.getAll(RethinkDB.args(criteria))
                                                         : this._table.filter(criteria)));

    this._run(selection.delete(), 'remove', criteria, callback, function (ignore, result) {

        if (isSingle &&
            !result.deleted) {

            return self.error('remove', 'No item found to remove', criteria, callback);
        }

        return callback(null);
    });
};


internals.Table.prototype._run = function (request, action, inputs, callback, next) {

    var self = this;

    next = next || callback;                                        // next() must never return an error

    request.run(this._db._connection, function (err, result) {

        if (err) {
            return self.error(action, err, inputs, callback);
        }

        // Single item

        if (!result ||
            typeof result.toArray !== 'function') {

            return next(null, result);
        }

        // Cursor

        var cursor = result;
        cursor.toArray(function (err, results) {

            if (err) {
                return self.error(action, err, inputs, callback);
            }

            cursor.close();
            return next(null, results);
        });
    });
};


internals.Table.prototype.error = function (action, err, inputs, callback) {

    return callback(Boom.internal('Database error', { error: err, table: this._name, action: action, inputs: inputs }));
};
