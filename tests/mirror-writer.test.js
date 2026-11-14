require('total5');
var { test } = require('node:test');
var assert = require('node:assert/strict');
var Mirror = require('../modules/mirror');
test('operations run one after the other, and a failure does not stop the ones behind it', async () => {
	var serial = Mirror.serial(),
		order = [];
	var slow = serial(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
		order.push('slow');
	});
	var broken = serial(async () => {
		order.push('broken');
		throw Error('no');
	});
	var last = serial(async () => order.push('last'));
	await assert.rejects(broken, /no/);
	await slow;
	await last;
	assert.deepEqual(order, ['slow', 'broken', 'last']);
});
function fixture(fail) {
	var saved = [],
		state = { items: [1] };
	var storage = { mirror: { save: async (next) => (fail ? Promise.reject(Error('disk')) : saved.push(structuredClone(next))) } };
	return { saved, storage, get: () => state, set: (next) => (state = next) };
}
test('a change is made on a copy, written, and only then becomes the state', async () => {
	var f = fixture();
	var update = Mirror.writer(f.storage, f.get, f.set);
	var before = f.get();
	var value = await update((next) => {
		next.items.push(2);
		assert.deepEqual(before.items, [1], 'the current state is untouched while the copy changes');
		return next.items;
	});
	assert.deepEqual(f.get().items, [1, 2]);
	assert.deepEqual(f.saved, [{ items: [1, 2] }]);
	value.push(99);
	assert.deepEqual(f.get().items, [1, 2], 'what the caller gets back is a copy');
});
test('a write that fails changes nothing, and the next change still works', async () => {
	var f = fixture(true);
	var update = Mirror.writer(f.storage, f.get, f.set);
	await assert.rejects(update((next) => next.items.push(2)), /disk/);
	assert.deepEqual(f.get().items, [1]);
	f.storage.mirror.save = async (next) => f.saved.push(structuredClone(next));
	await update((next) => next.items.push(3));
	assert.deepEqual(f.get().items, [1, 3]);
});
test('the hooks run before the write, after it and when the state has changed', async () => {
	var f = fixture(),
		log = [];
	f.storage.mirror.save = async () => log.push('save');
	var update = Mirror.writer(f.storage, f.get, (next) => (log.push('swap'), f.set(next)), {
		before: () => log.push('before'),
		after: () => log.push('after'),
		swapped: () => log.push('swapped')
	});
	await update(() => log.push('mutate'));
	assert.deepEqual(log, ['mutate', 'before', 'save', 'after', 'swap', 'swapped']);
});
