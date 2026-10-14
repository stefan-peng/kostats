import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('src/styles.css', 'utf8');
function luminance(hex) {
  const c = hex.match(/[a-f\d]{2}/gi).map(value => {
    const s = parseInt(value, 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}
for (const theme of [':root', '.dark']) {
  const block = css.slice(css.indexOf(`${theme} {`)).split('}')[0];
  const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+): (#[a-f\d]{6});/gi)].map(m => [m[1], m[2]]));
  it(`${theme} preserves accessible text and control contrast`, () => {
    for (const surface of ['background', 'card', 'popover', 'panel', 'muted', 'secondary']) {
      expect(contrast(tokens.foreground, tokens[surface])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens['muted-foreground'], tokens[surface])).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(tokens.primary, tokens['primary-foreground'])).toBeGreaterThanOrEqual(4.5);
    for (const surface of ['background', 'panel', 'card', 'popover']) {
      expect(contrast(tokens.input, tokens[surface])).toBeGreaterThanOrEqual(3);
    }
  });
}
