LOCALIZE(function($) {
	var user = MODS.security.session($.controller || $);
	return MODS.localization.resolve($.query.lang || $.query.language, user?.language || $.cookie('totalmail-language'));
});
