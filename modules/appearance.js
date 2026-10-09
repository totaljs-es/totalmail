exports.resolve = function(value) {
	var color = /^#[a-f0-9]{6}$/i.test(value || '') ? value.toUpperCase() : '#4285F4';
	var rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
	var linear = rgb.map((value) => (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)));
	var luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
	return { color, foreground: luminance > 0.179 ? '#000000' : '#FFFFFF' };
};
