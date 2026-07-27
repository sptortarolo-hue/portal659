import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextEslint from 'eslint-config-next';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  nextEslint.configs.recommended,
);