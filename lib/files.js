// Outgoing attachment files: one private directory per user, written atomically, addressed only by random IDs.
var limits = {
	files: 10,
	file: 15 * 1024 * 1024,
	total: 15 * 1024 * 1024
};

var idpattern = /^[a-f0-9]{32}$/;
exports.limits = limits;

exports.create = function(root) {

	var fs = Total.Fs,
		path = Total.Path;
	function folder(userid) {
		if (!idpattern.test(userid))
			throw Error('Authentication required');
		return path.join(root, userid);
	}
	function file(userid, id) {
		if (!idpattern.test(id))
			throw Error('@(Attachment not found.)');
		return path.join(folder(userid), id);
	}
	return {
		async put(userid, content) {

			var id = Total.Crypto.randomBytes(16).toString('hex'),
				target = file(userid, id);
			await fs.promises.mkdir(folder(userid), {
				recursive: true,
				mode: 0o700
			});
			await fs.promises.writeFile(target + '.tmp', content, {
				mode: 0o600
			});
			await fs.promises.rename(target + '.tmp', target);
			return id;
		},
		async get(userid, id) {
			try {
				return await fs.promises.readFile(file(userid, id));
			} catch {
				throw Error('@(Attachment not found.)');
			}
		},
		async remove(userid, id) {
			try {
				await fs.promises.unlink(file(userid, id));
			} catch {}
		}
	};
};
