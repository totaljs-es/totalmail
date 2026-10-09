const { test } = require('node:test'),
	Assert = require('node:assert/strict');
const Create = require('../plugins/reception/public/reception');
test('reception pauses when not ready, throttles focus events and never overlaps requests', async () => {
	let now = 0,
		ready = false,
		count = 0,
		release;
	let scheduler = Create({
		now: () => now,
		ready: () => ready,
		run: () => {
			count++;
			return new Promise((r) => (release = r));
		}
	});
	await scheduler.tick();
	Assert.equal(count, 0);
	ready = true;
	let pending = scheduler.tick();
	await scheduler.tick();
	Assert.equal(count, 1);
	release();
	await pending;
	now = 59999;
	await scheduler.tick();
	Assert.equal(count, 1);
	now = 60000;
	let next = scheduler.tick();
	Assert.equal(count, 2);
	release();
	await next;
	scheduler.stop();
	now = 120000;
	await scheduler.tick();
	Assert.equal(count, 2);
});
test('failed reception releases its lock and observes the interval before retrying', async () => {
	let now = 0,
		count = 0;
	let scheduler = Create({
		now: () => now,
		ready: () => true,
		run: async () => {
			count++;
			throw Error('offline');
		}
	});
	await Assert.rejects(scheduler.tick());
	await scheduler.tick();
	Assert.equal(count, 1);
	now = 60000;
	await Assert.rejects(scheduler.tick());
	Assert.equal(count, 2);
});
test('server notifications wake reception past the throttle, but never past its readiness conditions', async () => {
	let now = 0,
		ready = true,
		count = 0;
	let scheduler = Create({
		now: () => now,
		ready: () => ready,
		run: async () => {
			count++;
		}
	});
	await scheduler.tick();
	Assert.equal(count, 1);
	now = 1000;
	await scheduler.tick();
	Assert.equal(count, 1);
	await scheduler.wake();
	Assert.equal(count, 2);
	ready = false;
	await scheduler.wake();
	Assert.equal(count, 2);
});
test('the change listener long-polls with its last version, wakes on changes, backs off on errors and stops when signed out', async () => {
	let sleeps = [],
		woken = [],
		since = [];
	let step = 0,
		ready = true;
	let results = [{ version: 1, changed: [] }, { version: 2, changed: ['a'] }, new Error('offline'), { version: 2, changed: [] }, null];
	await new Promise((resolve) => {
		Create.listen({
			ready: () => ready,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			wake: (changed) => woken.push(changed),
			poll: async (s) => {
				since.push(s);
				let r = results[step++];
				if (r instanceof Error)
					throw r;
				if (r === null)
					resolve();
				return r;
			}
		});
	});
	Assert.deepEqual(since, [0, 1, 2, 2, 2]);
	Assert.deepEqual(woken, [['a']]);
	Assert.deepEqual(sleeps, [5000]);
});
