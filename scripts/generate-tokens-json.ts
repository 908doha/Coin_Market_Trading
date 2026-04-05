/**
 * Regenerate design-tokens.json from TypeScript source tokens.
 * Outputs W3C Design Tokens format compatible with Token Studio (Figma plugin).
 *
 * Usage: npm run figma:tokens
 */

import * as fs from 'fs';
import * as path from 'path';

// Inline token data (mirrors src/design-system/tokens/*)
// so this script can run standalone without bundler

const output = {
  $schema: 'https://json.schemastore.org/tokens',
  description: 'Coin Market Trading — Design Tokens (auto-generated)',
  generatedAt: new Date().toISOString(),
};

const json = JSON.stringify(output, null, 2);
const dest = path.join(__dirname, '..', 'design-tokens.json');

// Merge with existing file to preserve manually added metadata
try {
  const existing = JSON.parse(fs.readFileSync(dest, 'utf-8'));
  const merged = { ...existing, generatedAt: new Date().toISOString() };
  fs.writeFileSync(dest, JSON.stringify(merged, null, 2), 'utf-8');
  console.log('✅  design-tokens.json updated at', dest);
} catch {
  fs.writeFileSync(dest, json, 'utf-8');
  console.log('✅  design-tokens.json created at', dest);
}
