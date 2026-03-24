/**
 * Transform utilities for MQTT input bindings.
 * Extracted from input-bindings.js for reusability and testability.
 */

export const TRANSFORMS = [
  { value: '', label: 'None (raw)' },
  { value: 'div1000', label: '÷ 1000 (W → kW)' },
  { value: 'div100', label: '÷ 100' },
  { value: 'mul1000', label: '× 1000' },
  { value: 'mul100', label: '× 100' },
  { value: 'round', label: 'Round (int)' },
  { value: 'round1', label: 'Round (1 dec)' },
];

/** Auto-suggest transform based on field name */
export function suggestTransform(fieldName) {
  const f = (fieldName || '').toLowerCase();
  if (f.includes('_w') || f.endsWith('_wh') || f.includes('power_w') || f.includes('energy_w')) return 'div1000';
  return '';
}

/** Format a sample value with a transform applied */
export function previewTransform(value, transform) {
  if (value == null || typeof value !== 'number') return '--';
  switch (transform) {
    case 'div1000': return (value / 1000).toFixed(3);
    case 'div100': return (value / 100).toFixed(2);
    case 'mul1000': return String(value * 1000);
    case 'mul100': return String(value * 100);
    case 'round': return String(Math.round(value));
    case 'round1': return (Math.round(value * 10) / 10).toFixed(1);
    default: return String(value);
  }
}
