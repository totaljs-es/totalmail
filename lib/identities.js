// Single-process identity store. A change is published only after it is written to the database.
const Totp = require('./totp');
const Mirror = require('./mirror');
exports.spec = (table) => ({ table, prefix: 'users', clean: true, lists: ['users'] });
// The store, opened on a database: options = { table, directory, legacy: { file } }. `directory` is where
// the key that seals the passwords of the mail accounts lives: a file, never in the database.
exports.open = async function(options) {
	return exports.create(
		options.directory,
		await Mirror.open(exports.spec(options.table), { seed: { users: [] }, legacy: options.legacy })
	);
};
// storage = { state, mirror } as Mirror.open() returns it.
exports.create = function(directory, storage) {
	var fs = Total.Fs,
		path = Total.Path,
		crypto = Total.Crypto;
	fs.mkdirSync(directory, {
		recursive: true,
		mode: 0o700
	});
	var keyfile = path.join(directory, 'credentials.key');
	if (!fs.existsSync(keyfile))
		fs.writeFileSync(keyfile, crypto.randomBytes(32), {
			mode: 0o600,
			flag: 'wx'
		});
	var key = fs.readFileSync(keyfile);
	let state = structuredClone(storage.state),
		queue = Promise.resolve();
	var publicuser = (u) =>
		u
			? {
				id: u.id,
				name: u.name,
				email: u.email,
				role: u.role,
				color: u.color || '#4285F4',
				language: u.language || '',
				disabled: !!u.disabled,
				totp: !!u.totp
			}
			: null;
	function seal(password) {
		var iv = crypto.randomBytes(12),
			cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
		var data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
		return {
			iv: iv.toString('base64'),
			tag: cipher.getAuthTag().toString('base64'),
			data: data.toString('base64')
		};
	}
	function unseal(value) {
		var cipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
		cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
		return Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]).toString('utf8');
	}
	var normalize = (email) =>
		String(email || '')
			.trim()
			.toLowerCase();
	async function hash(password, salt) {
		return new Promise((resolve, reject) =>
			crypto.scrypt(password, salt, 64, (err, value) => (err ? reject(err) : resolve(value.toString('hex'))))
		);
	}
	async function createuser(model, first) {
		if (typeof model.password !== 'string' || model.password.length < 12 || model.password.length > 128)
			throw Error('@(Use a password of 12 to 128 characters.)');
		var salt = crypto.randomBytes(32).toString('hex'),
			password = await hash(model.password, salt);
		var operation = queue.then(async () => {
			if (first && state.users.length)
				throw Error('@(Setup has already been completed.)');
			var email = normalize(model.email);
			if (state.users.some((u) => u.email === email))
				throw Error('@(A user with this email already exists.)');
			var user = {
				id: crypto.randomBytes(16).toString('hex'),
				name: model.name.trim(),
				email,
				role: first ? 'admin' : 'member',
				salt,
				password
			};
			var next = {
				users: [...state.users, user]
			};
			await storage.mirror.save(next);
			state = next;
			return publicuser(user);
		});
		queue = operation.catch(() => {});
		return operation;
	}
	// Applies one change to a copy of the users and publishes it only after the atomic write.
	function change(mutate) {
		var operation = queue.then(async () => {
			var next = structuredClone(state);
			var result = await mutate(next);
			await storage.mirror.save(next);
			state = next;
			return result;
		});
		queue = operation.catch(() => {});
		return operation;
	}
	// An installation always keeps someone who can administer it.
	function activeadmin(next) {
		if (!next.users.some((u) => u.role === 'admin' && !u.disabled))
			throw Error('@(There must be at least one active administrator.)');
	}
	async function updateprofile(id, model) {
		var operation = queue.then(async () => {
			var previous = state.users.find((u) => u.id === id);
			if (!previous)
				throw Error('@(User not found.)');
			var email = normalize(model.email);
			var changed = email !== previous.email || !!model.newPassword;
			if (changed) {
				if (typeof model.currentPassword !== 'string' || !model.currentPassword || model.currentPassword.length > 128)
					throw Error('@(Enter your current password to change your login details.)');
				var candidate = await hash(model.currentPassword, previous.salt);
				if (!crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(previous.password, 'hex')))
					throw Error('@(Your current password is incorrect.)');
			}
			if (state.users.some((u) => u.id !== id && u.email === email))
				throw Error('@(A user with this email already exists.)');
			if (typeof model.name !== 'string' || !model.name.trim() || model.name.length > 80)
				throw Error('@(Enter your name.)');
			if (!email.isEmail())
				throw Error('@(Enter a valid login email.)');
			if (!/^#[a-f0-9]{6}$/i.test(model.color || ''))
				throw Error('@(Choose a valid base color.)');
			if (model.newPassword && (model.newPassword.length < 12 || model.newPassword.length > 128))
				throw Error('@(Use a password of 12 to 128 characters.)');
			var next = structuredClone(state);
			var user = next.users.find((u) => u.id === id);
			user.name = model.name.trim();
			user.email = email;
			user.color = model.color.toUpperCase();
			user.language = model.language;
			if (model.newPassword) {
				user.salt = crypto.randomBytes(32).toString('hex');
				user.password = await hash(model.newPassword, user.salt);
			}
			await storage.mirror.save(next);
			state = next;
			return { user: publicuser(user), credentialsChanged: changed };
		});
		queue = operation.catch(() => {});
		return operation;
	}
	return {
		configured: () => !!state.users.length,
		first: () => publicuser(state.users[0]),
		// A disabled user has no identity: any open session stops working.
		get: (id) => publicuser(state.users.find((u) => u.id === id && !u.disabled)),
		list: () => state.users.map(publicuser),
		createUser: createuser,
		updateProfile: updateprofile,
		setPassword: (id, password) =>
			change(async (next) => {
				if (typeof password !== 'string' || password.length < 12 || password.length > 128)
					throw Error('@(Use a password of 12 to 128 characters.)');
				var user = next.users.find((u) => u.id === id);
				if (!user)
					throw Error('@(User not found.)');
				user.salt = crypto.randomBytes(32).toString('hex');
				user.password = await hash(password, user.salt);
				return publicuser(user);
			}),
		setRole: (id, role) =>
			change((next) => {
				if (!['admin', 'member'].includes(role))
					throw Error('@(Invalid role.)');
				var user = next.users.find((u) => u.id === id);
				if (!user)
					throw Error('@(User not found.)');
				user.role = role;
				activeadmin(next);
				return publicuser(user);
			}),
		setDisabled: (id, disabled) =>
			change((next) => {
				var user = next.users.find((u) => u.id === id);
				if (!user)
					throw Error('@(User not found.)');
				user.disabled = disabled === true;
				activeadmin(next);
				return publicuser(user);
			}),
		remove: (id) =>
			change((next) => {
				var user = next.users.find((u) => u.id === id);
				if (!user)
					throw Error('@(User not found.)');
				next.users = next.users.filter((u) => u.id !== id);
				activeadmin(next);
				return publicuser(user);
			}),
		// Confirms the password of a signed-in person before a sensitive operation.
		async verify(id, password) {
			var user = state.users.find((u) => u.id === id && !u.disabled);
			if (typeof password !== 'string' || !password || password.length > 128)
				return false;
			var candidate = await hash(password, user ? user.salt : '0'.repeat(64));
			return !!user && crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(user.password, 'hex'));
		},
		async login(email, password) {
			var user = state.users.find((u) => u.email === normalize(email) && !u.disabled);
			var candidate = await hash(password, user ? user.salt : '0'.repeat(64));
			return user && crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(user.password, 'hex'))
				? publicuser(user)
				: null;
		},
		encrypt: seal,
		decrypt: unseal,
		// Two-step verification. The secret is kept encrypted like the mail passwords; recovery codes only as hashes.
		totpRecovery: (id) => state.users.find((u) => u.id === id)?.totp?.recovery.length ?? null,
		enableTotp: (id, secret, code, time = Date.now()) =>
			change((next) => {
				var user = next.users.find((u) => u.id === id && !u.disabled);
				if (!user)
					throw Error('@(User not found.)');
				if (user.totp)
					throw Error('@(Two-step verification is already on.)');
				var step = Totp.verify(secret, code, time);
				if (!step)
					throw Error('@(That code is not right. Check the time on your phone and try the next code.)');
				var codes = Totp.recoveryCodes(8);
				user.totp = { secret: seal(secret), last: step, recovery: codes.map(Totp.hashRecovery) };
				return { user: publicuser(user), recovery: codes };
			}),
		disableTotp: (id) =>
			change((next) => {
				var user = next.users.find((u) => u.id === id);
				if (!user)
					throw Error('@(User not found.)');
				delete user.totp;
				return publicuser(user);
			}),
		newRecovery: (id) =>
			change((next) => {
				var user = next.users.find((u) => u.id === id);
				if (!user?.totp)
					throw Error('@(Two-step verification is not on.)');
				var codes = Totp.recoveryCodes(8);
				user.totp.recovery = codes.map(Totp.hashRecovery);
				return codes;
			}),
		// The second step: a code from the app (each one works once) or a recovery code (each one works once, then it is gone).
		checkSecond: (id, code, time = Date.now()) =>
			change((next) => {
				var user = next.users.find((u) => u.id === id && !u.disabled);
				if (!user?.totp)
					return { ok: false };
				var step = Totp.verify(unseal(user.totp.secret), code, time, user.totp.last || 0);
				if (step) {
					user.totp.last = step;
					return { ok: true, via: 'totp' };
				}
				var hashed = Totp.hashRecovery(code),
					index = Totp.normalizeRecovery(code).length === 10 ? user.totp.recovery.indexOf(hashed) : -1;
				if (index >= 0) {
					user.totp.recovery.splice(index, 1);
					return { ok: true, via: 'recovery', left: user.totp.recovery.length };
				}
				return { ok: false };
			})
	};
};
