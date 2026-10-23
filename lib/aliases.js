// The other addresses an account can send from (aliases): plain, lower-case, no repeats, never the account's own address.
const max = 10,
	valid = /^[^@\s,;<>"()\[\]\\]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/i;

// Text typed by a person -> list, or an error when something in it is not an address.
exports.parse = function(text, own) {

	var list = [];
	for (var part of String(text || '')
		.split(/[,;\s]+/)
		.filter(Boolean)) {
		var address = part.toLowerCase();
		if (!valid.test(address) || address.length > 254)
			return { list: [], error: true };
		if (address !== String(own || '').toLowerCase() && !list.includes(address))
			list.push(address);
	}
	return list.length > max ? { list: [], error: true } : { list, error: false };
};

// The address a message goes out from: the one chosen if the account really has it, otherwise the account's own.
exports.sender = function(account, chosen) {
	var address = String(chosen || '').toLowerCase();
	return address && address !== String(account.email).toLowerCase() && (account.aliases || []).includes(address) ? address : '';
};
