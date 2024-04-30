module.exports = {
  extends: 'airbnb-base',
  plugins: [
    'import',
  ],
  rules: {
    'import/extensions': 0,
    'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
    'max-len': 'off',
    'import/prefer-default-export': 'off',
    'no-use-before-define': 'off',
    'no-return-assign': ['error', 'except-parens'],
    'no-param-reassign': 'off',
  },
};
