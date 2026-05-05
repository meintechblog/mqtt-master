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

/**
 * Display-only unit catalogue. The unit is stored on the binding alongside
 * the field path and rendered next to the transmitted value, but it does NOT
 * influence what we forward to Loxone — the unit is for human readability,
 * not for conversion. Add new entries with `{ value, label }` where `value`
 * is the literal string we render and `label` describes the use case.
 */
export const UNITS = [
  { value: '',     label: '— (none)' },
  { value: '°C',   label: '°C  Temperature' },
  { value: '°F',   label: '°F  Temperature (Fahrenheit)' },
  { value: 'K',    label: 'K   Temperature (Kelvin)' },
  { value: '%',    label: '%   Percent / humidity / battery' },
  { value: 'W',    label: 'W   Power (watts)' },
  { value: 'kW',   label: 'kW  Power (kilowatts)' },
  { value: 'Wh',   label: 'Wh  Energy' },
  { value: 'kWh',  label: 'kWh Energy (kilowatt-hour)' },
  { value: 'V',    label: 'V   Voltage' },
  { value: 'A',    label: 'A   Current' },
  { value: 'Hz',   label: 'Hz  Frequency' },
  { value: 'Pa',   label: 'Pa  Pressure' },
  { value: 'hPa',  label: 'hPa Pressure (atmospheric)' },
  { value: 'bar',  label: 'bar Pressure' },
  { value: 'l',    label: 'l   Volume (litres)' },
  { value: 'l/h',  label: 'l/h Flow rate' },
  { value: 'l/min',label: 'l/min Flow rate' },
  { value: 'm³',   label: 'm³  Volume (cubic metres)' },
  { value: 'm³/h', label: 'm³/h Flow rate' },
  { value: 'm',    label: 'm   Length' },
  { value: 'cm',   label: 'cm  Length' },
  { value: 'mm',   label: 'mm  Length' },
  { value: 'km',   label: 'km  Length' },
  { value: 'm/s',  label: 'm/s Speed' },
  { value: 'km/h', label: 'km/h Speed' },
  { value: 'lx',   label: 'lx  Illuminance' },
  { value: 'ppm',  label: 'ppm Concentration' },
  { value: 's',    label: 's   Seconds' },
  { value: 'min',  label: 'min Minutes' },
  { value: 'h',    label: 'h   Hours' },
  { value: 'dBm',  label: 'dBm Signal strength' },
];

/** Auto-suggest a unit string based on the field name. Best-effort. */
export function suggestUnit(fieldName) {
  const f = (fieldName || '').toLowerCase();
  if (/temp(erature)?|tmp\b/.test(f)) return '°C';
  if (/humidity|feuchte/.test(f)) return '%';
  if (/battery|soc\b|charge_level/.test(f)) return '%';
  if (/_kw\b|power_kw|kilowatt/.test(f)) return 'kW';
  if (/_wh\b|energy_wh/.test(f)) return 'Wh';
  if (/_kwh\b|energy_kwh|consumed_kwh/.test(f)) return 'kWh';
  if (/_w\b|watt|power_w|ac_power/.test(f)) return 'W';
  if (/voltage|_v\b|volt/.test(f)) return 'V';
  if (/current|_a\b|ampere/.test(f)) return 'A';
  if (/frequency|_hz\b/.test(f)) return 'Hz';
  if (/pressure_hpa|hpa\b/.test(f)) return 'hPa';
  if (/pressure_bar|_bar\b/.test(f)) return 'bar';
  if (/pressure_pa|_pa\b/.test(f)) return 'Pa';
  if (/rssi|signal_strength|dbm\b/.test(f)) return 'dBm';
  if (/illuminance|lux|_lx\b/.test(f)) return 'lx';
  if (/co2|ppm\b/.test(f)) return 'ppm';
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
