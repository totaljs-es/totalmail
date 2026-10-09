// Internal onboarding message, localized at delivery; never submitted to SMTP.
exports.decorate = function(message, language) {
	if (!message.welcome)
		return message;
	return {
		...message,
		sender: 'TotalMail',
		subject: TRANSLATE(language, '@(Welcome to TotalMail)'),
		label: TRANSLATE(language, '@(Message)'),
		body:
			TRANSLATE(language, '@(Your inbox is connected and ready to use.)') +
			'\n\n' +
			TRANSLATE(language, '@(Use Sync to check for new mail, open your messages and reply when you are ready.)') +
			'\n\n' +
			TRANSLATE(language, '@(This welcome message lives only in TotalMail. It has not been sent by email or added to your server.)')
	};
};
