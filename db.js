/* SPDX-License-Identifier: MIT
 * Copyright(c) 2019 Darek Stojaczyk
 */

let g_db = {
	type_info: {},

	modified: [],
	commit_cb: []
};

function copy_obj_data(obj, org) {
	for (f in org) {
		if (f === '_db') continue;
		if (typeof(org[f]) === 'object') {
			if (!obj.hasOwnProperty(f)) {
				obj[f] = Array.isArray(org[f]) ? [] : {};
			}
			copy_obj_data(obj[f], org[f]);
		} else {
			obj[f] = org[f];
		}
	}
}

function copy_obj(obj) {
	let copy = {};
	copy_obj_data(copy, obj);
	return copy;
}

function init_obj_data(obj, base) {
	for (f in base) {
		if (f === '_db') continue;
		if (typeof(base[f]) === 'object') {
			obj[f] = Array.isArray(base[f]) ? [] : {};
			init_obj_data(obj[f], base[f]);
		} else {
			if (typeof(base[f]) == 'string') {
				obj[f] = '';
			} else {
				obj[f] = 0;
			}
		}
	}
}

function new_obj(obj) {
	let copy = {};
	init_obj_data(copy, obj);
	return copy;
}

function is_obj_equal(obj, org) {
	for (f in obj) {
		if (obj[f] === obj._db) continue;
		if (typeof(org[f]) === 'object') {
			if (!is_obj_equal(org[f], obj[f])) return false;
		}
		if (obj[f] !== org[f]) return false;
	}

	return true;
}

/**
 * Open a database object for writing and return it to the user.
 * This may create a copy of that object and store it locally.
 * It would be later reused to detect any custom changes made.
 *
 * This function can be called multiple times on the same object,
 * but will always keep only one copy.
 */
function db_open(obj) {
	if (!obj._db) {
		throw new Error('Missing _db field');
		return obj;
	}

	if (obj._db.__orgObj) {
		/* already open */
		return obj;
	}

	let org_obj = copy_obj(obj);
	org_obj._db = { __obj: obj };
	obj._db.__orgObj = org_obj;
	obj._db.__modIdx = g_db.modified.push(obj) - 1;
	return obj;
}

/**
 * Try to save an opened object. If it completely matches the
 * original object (so it wasn't modified in the end), this will
 * free the previously created copy.
 *
 * It doesn't need to be called on every change (as changes are
 * technically saved immediately) but should be always called
 * at least when an open object is no longer being modified (e.g.
 * when the editing window gets closed)
 */
function db_commit(obj) {
	if (!obj._db) {
		throw new Error('Commiting an object without the _db field');
		return obj;
	}
	if (obj._db.__modIdx === undefined) throw new Error(`Missing mod index (${obj})`);
	if (!obj._db.__orgObj) throw new Error(`Missing original handle (${obj})`);

	const is_diff = !is_obj_equal(obj, obj._db.__orgObj);

	/* if this a newly allocated object it will be now appended to the array */
	if (is_diff && obj._db.__is_allocated && obj.id == 0) {
		obj.id = g_db[obj._db.__type].push(obj) - 1;
	}

	for (let i = 0; i < g_db.commit_cb.length; i++) {
		const cb = g_db.commit_cb[i];
		cb.func(obj, cb.ctx);
	}

	if (!is_diff) {
		g_db.modified[obj._db.__modIdx] = null;
		obj._db.__orgObj = null;
		if (obj._db.__is_allocated) {
			/* drop the reference so the object can be garbage-collected */
			g_db[obj._db.__type][obj.id] = null;
			obj.id = 0;
		}
	}

	if (obj._db.__commit_cb) {
		obj._db.__commit_cb(obj, obj._db.__commit_ctx);
	}

	return is_diff;
}

/**
 * Export all changes as a JSON string, which can be later parsed and
 * passed to db_load_mod() in another db instance.
 */
function db_dump() {
	return JSON.stringify(g_db.modified, function(k, v) {
		if (k === '_db') return { __type: v.__type };
		if (v === null) return undefined;
		return v;
	});
}

/**
 * Register a function to be called on each db_commit() call.
 * The function will be called with two parameters: (obj, ctx),
 * where obj is the committed object, and ctx is the ctx argument here.
 */
function db_register_commit_cb(cb, ctx) {
	g_db.commit_cb.push({ func: cb, ctx: ctx });
}

/**
 * Create a new object of given type. The object won't have any id
 * assigned so far (it will be visible as 0), and it will be given
 * a unique id after any changes are made to it and the object is
 * committed. That's when commit_cb will be called. The parameters
 * are same as in db_register_commit_cb(). Those callback fields
 * are completely optional.
 */
function db_new_obj(type, commit_cb, commit_ctx) {
	const arr = g_db[type];
	if (!arr) throw new Error(`Unknown db type (${type})`);
	let sample_el = null;
	let sample_el_idx = arr.length - 1;
	while (!sample_el && sample_el_idx >= 0) {
		sample_el = arr[sample_el_idx];
		sample_el_idx--;
	}
	if (!sample_el) throw new Error(`No existing db objects of type (${type})`);

	let obj = new_obj(sample_el);
	db_init_obj(type, obj);
	obj._db.__is_allocated = true;
	obj._db.__commit_cb = commit_cb;
	obj._db.__commit_ctx = commit_ctx;
	return obj;
}

/**
 * Make a copy of an existing DB object. It will appear as a new object,
 * but with same properties as the original.
 */
function db_clone_obj(base) {
	let obj = db_new_obj(base._db.__type);
	db_open(obj);

	copy_obj_data(obj, base);
	/* reset id so db_commit will set a unique one */
	obj.id = 0;
	db_commit(obj);
	return obj;
}

/**
 * Initialize an object that was inserted to the db array.
 * This is required for any object that you want to call
 * db_open() and db_commit() on.
 */
function db_init_obj(type, obj) {
	if (!g_db[type]) throw new Error(`Unknown db type (${type})`);

	obj._db = {};
	obj._db.__type = type;

	const type_info = g_db.type_info[type];
	if (!type_info) throw new Error(`Invalid db type (${type})`);
	if (type_info.obj_init_cb) {
		return type_info.obj_init_cb(obj);
	}
}

/**
 * Mark a new object field as unchanged. This is useful when object
 * has optional fields that are loaded at runtime.
 *
 * field_path param can be either a string if a field is the direct child
 * of the object, or it can be an array of subsequent indices, e.g.:
 *   db_set_unchanged(obj, ['newly','inserted','array','0'], 5);
 *   This sets the original value of obj.newly.inserted.array[0] to 5.
 */
function db_set_org_field(obj, field_path, org_val) {
	if (typeof(field_path) === 'string') {
		/* always make it an array so it's easier to handle it later */
		field_path = [field_path];
	}

	if (!obj._db) {
		throw new Error('Missing _db field');
		return;
	}

	let org = obj._db.__orgObj;
	if (!org) {
		/* the object wasn't opened yet and there's nothing to do.
		 * when it does get opened, the new field will be copied
		 * automatically */
		return;
	}

	/* walk through the path and initialize any objects on the way */
	let i;
	for (i = 0; i < field_path.length - 1; i++) {
		const f = field_path[i];
		if (!obj.hasProperty(f)) {
			throw new Error(`Unreachable obj field [${field_path}]`);
			return;
		}

		if (!org[f]) {
			if (typeof(obj[f]) !== 'object') {
				throw new Error(`Invalid obj field [${field_path}]`);
			}
			/* initialize any parent container */
			org[f] = Array.isArray(obj[f]) ? [] : {};
		}
		obj = obj[f];
		org = org[f];
	}

	const f = field_path[i];
	org[f] = org_val;

	/* commit to trigger the external hooks */
	db_open(obj);
	db_commit(obj);
}

/**
 * Create a new DB array. obj_init_cb will be called on any
 * db_init_obj() for objects of that type. The parameters are
 * just (obj). The callback is entirely optional.
 */
function db_register_type(name, obj_init_cb) {
	if (g_db.type_info[name]) {
		throw new Error(`DB type (${name}) already registered`);
	}

	let type = g_db.type_info[name] = {};
	type.obj_init_cb = obj_init_cb;
	g_db[name] = [];
}

/**
 * Load the specified list of changes. All objects will be immediately
 * committed to set their modified state.
 */
function db_load_mod(mods_table) {
	let promises = [];
	for (let i = 0; i < mods_table.length; i++) {
		const mod = mods_table[i];
		if (!mod) continue;

		let org = g_db[mod._db.__type][mod.id];
		if (!org) {
			org = db_new_obj(mod._db.__type);
		}

		db_open(org);
		copy_obj_data(org, mod);
		if (org.id !== undefined) {
			/* we've copied the id over, now it's time to fill the db entry */
			g_db[org._db.__type][org.id] = org;
		}
		db_commit(org);

		/* call the init_cb again */
		let type = g_db.type_info[mod._db.__type];
		if (type.obj_init_cb) {
			let promise = type.obj_init_cb(org);
			if (promise) promises.push(promise);
		}
	}
	return promises;
}
