// The rules of https://github.com/totaljs-es/guidelines that a tool can check or fix.
module.exports = [
	{ ignores: ['private/vendor/**', 'public/**', 'node_modules/**', 'tools/**', 'docker/**'] },
	{
		files: ['**/*.js'],
		languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: {} },
		linterOptions: { reportUnusedDisableDirectives: false },
		rules: {
			indent: ['error', 'tab', { SwitchCase: 1, ignoredNodes: ['TemplateLiteral *'] }],
			semi: ['error', 'always'],
			quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
			curly: ['error', 'multi'],
			'nonblock-statement-body-position': ['error', 'below'],
			'no-trailing-spaces': 'error',
			'space-before-function-paren': ['error', { anonymous: 'never', named: 'never', asyncArrow: 'always' }],
			'keyword-spacing': 'error',
			'no-multiple-empty-lines': ['error', { max: 2 }],
			'no-restricted-syntax': [
				'error',
				{
					selector: 'VariableDeclaration[kind="const"]',
					message: 'No const: use var (Total.js conventions).'
				},
				{ selector: 'CallExpression[callee.property.name="forEach"]', message: 'Prefer a classic loop over forEach().' }
			]
		}
	},
	{
		files: ['modules/**/*.js', 'definitions/**/*.js', 'controllers/**/*.js', 'plugins/*/*.js', 'plugins/**/actions/**/*.js'],
		rules: {
			'no-restricted-modules': ['error', {
				patterns: ['node:*', 'fs', 'path', 'crypto', 'http', 'https', 'dns', 'net', 'tls', 'os', 'util', 'child_process']
			}]
		}
	}
];
