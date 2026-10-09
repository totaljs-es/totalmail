require('total5');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Mirror = require('../lib/mirror');
function folder(t) {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totalmail-mirror-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}
let spec = (dir, over = {}) => ({
	table: (name) => NOSQL(path.join(dir, name)),
	prefix: 'people',
	lists: ['users'],
	values: ['settings'],
	...over
});
let rows = async (dir, name) =>
	(
		await NOSQL(path.join(dir, 'people_' + name))
			.find()
			.promise()
	).map(({ _i, ...rest }) => rest);
test('records are inserted, modified, replaced and removed in the database, and come back after a restart', async (t) => {
	let dir = folder(t),
		first = await Mirror.open(spec(dir), { seed: { users: [], settings: { theme: 'light' } } });
	assert.deepEqual(first.state, { users: [], settings: { theme: 'light' } });
	let state = structuredClone(first.state);
	state.users.push({ id: 'a', name: 'Ana', tags: ['x'] }, { id: 'b', name: 'Bea' });
	state.settings = { theme: 'dark' };
	await first.mirror.save(state);
	assert.deepEqual((await rows(dir, 'users')).map((r) => r.id).sort(), ['a', 'b']);
	assert.deepEqual(
		(await rows(dir, 'values')).map((r) => [r.id, r.value]),
		[['settings', { theme: 'dark' }]]
	);
	let next = structuredClone(state);
	next.users[0].name = 'Anna';
	next.users[1] = { id: 'b' };
	await first.mirror.save(next);
	let byid = Object.fromEntries((await rows(dir, 'users')).map((r) => [r.id, r]));
	assert.equal(byid.a.name, 'Anna');
	assert.deepEqual(byid.b, { id: 'b' }, 'a field that is gone from a record is gone from the database');
	next.users = next.users.filter((u) => u.id !== 'a');
	await first.mirror.save(next);
	assert.deepEqual(
		(await rows(dir, 'users')).map((r) => r.id),
		['b']
	);
	let again = await Mirror.open(spec(dir), { seed: { users: [], settings: { theme: 'light' } } });
	assert.deepEqual(again.state.users, [{ id: 'b' }]);
	assert.deepEqual(again.state.settings, { theme: 'dark' });
});
test('only what changed is written', async (t) => {
	let dir = folder(t),
		opened = await Mirror.open(spec(dir));
	let state = {
		users: [
			{ id: 'a', n: 1 },
			{ id: 'b', n: 1 }
		],
		settings: { k: 1 }
	};
	await opened.mirror.save(state);
	let calls = [],
		original = spec(dir).table;
	let counting = Mirror.create(
		{
			...spec(dir),
			table: (name) => {
				let table = original(name);
				return new Proxy(table, {
					get: (target, key) =>
						['insert', 'modify', 'remove'].includes(key)
							? (...args) => (calls.push(key + ':' + (args[0]?.id || '')), target[key](...args))
							: target[key]
				});
			}
		},
		state
	);
	await counting.save(state);
	assert.deepEqual(calls, [], 'nothing changed, nothing written');
	let next = structuredClone(state);
	next.users[1].n = 2;
	await counting.save(next);
	assert.deepEqual(calls, ['modify:b']);
});
test('the first time, what an earlier version kept in a JSON file is imported and the file is set aside, not deleted', async (t) => {
	let dir = folder(t),
		file = path.join(dir, 'users.json');
	fs.writeFileSync(file, JSON.stringify({ users: [{ id: 'old', name: 'Old' }], settings: { theme: 'sepia' } }));
	let opened = await Mirror.open(spec(dir), { legacy: { file }, seed: { users: [] } });
	assert.deepEqual(opened.state.users, [{ id: 'old', name: 'Old' }]);
	assert.ok(!fs.existsSync(file) && fs.existsSync(file + '.migrated'), 'kept as .migrated');
	assert.deepEqual(
		(await rows(dir, 'users')).map((r) => r.id),
		['old'],
		'it is in the database now'
	);
	fs.writeFileSync(file, JSON.stringify({ users: [{ id: 'other' }] }));
	let second = await Mirror.open(spec(dir), { legacy: { file } });
	assert.deepEqual(second.state.users, [{ id: 'old', name: 'Old' }], 'a database that has data is never overwritten by an old file');
	assert.ok(fs.existsSync(file), 'and that file is left alone');
});
test('a damaged old file is ignored and a record without an id is refused', async (t) => {
	let dir = folder(t),
		file = path.join(dir, 'users.json');
	fs.writeFileSync(file, '{ not json');
	let opened = await Mirror.open(spec(dir), { legacy: { file }, seed: { users: [] } });
	assert.deepEqual(opened.state.users, []);
	await assert.rejects(opened.mirror.save({ users: [{ name: 'no id' }], settings: {} }), /text id/);
	await assert.rejects(opened.mirror.save({ users: [{ id: 'x' }, { id: 'x' }], settings: {} }), /text id/);
});
test('a seed that was never changed is not written, and a store made from a seed writes everything the first time', async (t) => {
	let dir = folder(t),
		seeded = Mirror.create(spec(dir), { users: [{ id: 'seed' }], settings: { a: 1 } }, false);
	await seeded.save({ users: [{ id: 'seed' }], settings: { a: 1 } });
	assert.deepEqual(
		(await rows(dir, 'users')).map((r) => r.id),
		['seed']
	);
});
test('a list comes back in the order it was created, however often its records change', async (t) => {
	let dir = folder(t),
		opened = await Mirror.open(spec(dir)),
		state = { users: [] };
	for (let id of ['a', 'b', 'c', 'd'])
		state.users.push({ id, n: 1 });
	await opened.mirror.save(state);
	state = structuredClone(state);
	state.users[0].n = 2;
	state.users[2] = { id: 'c' };
	state.users.splice(1, 1);
	state.users.push({ id: 'e' });
	await opened.mirror.save(state);
	let again = await Mirror.open(spec(dir));
	assert.deepEqual(
		again.state.users.map((u) => u.id),
		['a', 'c', 'd', 'e']
	);
	assert.ok(
		again.state.users.every((u) => !('_i' in u)),
		'the counter never reaches the store'
	);
	again.state.users.push({ id: 'f' });
	await again.mirror.save(again.state);
	assert.deepEqual(
		(await Mirror.open(spec(dir))).state.users.map((u) => u.id),
		['a', 'c', 'd', 'e', 'f']
	);
	let sorted = await Mirror.open(spec(dir, { sort: { users: (x, y) => (x.id < y.id ? 1 : -1) } }));
	assert.deepEqual(
		sorted.state.users.map((u) => u.id),
		['f', 'e', 'd', 'c', 'a']
	);
});
test('with clean, a changed or removed record leaves no trace in the file', async (t) => {
	let dir = folder(t),
		opened = await Mirror.open(spec(dir, { clean: true })),
		state = {
			users: [
				{ id: 'a', secret: 'old-secret' },
				{ id: 'b', secret: 'gone-secret' }
			]
		};
	await opened.mirror.save(state);
	state = structuredClone(state);
	state.users[0].secret = 'new-secret';
	state.users.pop();
	await opened.mirror.save(state);
	let file = fs.readFileSync(path.join(dir, 'people_users'), 'utf8');
	assert.ok(file.includes('new-secret') && !file.includes('old-secret') && !file.includes('gone-secret'));
	let kept = await Mirror.open(spec(dir)),
		plain = structuredClone(kept.state);
	plain.users[0].secret = 'later-secret';
	await kept.mirror.save(plain);
	assert.ok(
		fs.readFileSync(path.join(dir, 'people_users'), 'utf8').includes('new-secret'),
		'without clean the old line stays until clean() is called'
	);
	await kept.mirror.clean();
	assert.ok(!fs.readFileSync(path.join(dir, 'people_users'), 'utf8').includes('new-secret'));
});
