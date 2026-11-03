/* Constants recovered from the Grainrad bundle (see REA ledger).
 * CHARSETS and DEFAULTS are byte-faithful to the shipped app. */

export const CHARSETS = {
  standard: ' .:-=+*#%@',
  blocks: ' ░▒▓█',
  binary: ' 01',
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  minimal: ' .:#',
  alphabetic: ' .icotCOXWM',
  numeric: ' 1234567890',
  math: ' .-+×÷=≠<>≤≥∞∑√∫',
  emoji: ' ·•○◎●◐◑◒◓◔◕◖◗',
  custom: ' .:+*#@',
};

/* `Ge` in the bundle: the app's own defaults. Note grain is the only
 * post-effect enabled out of the box and spatialWeight is 0, so the stock
 * look is pure index-mapping — match is opt-in. */
export const DEFAULTS = {
  character: { scale: 2, spacing: 0, set: 'standard', customChars: ' .:+*#@', outputWidth: 0 },
  image: { brightness: 0, contrast: 0, saturation: 0, hue: 0, sharpness: 0, gamma: 1, colorMode: 'color' },
  color: { colorMode: 'original', custom: '#00ff00', useOriginal: true, intensity: 1, backgroundColor: '#000000' },
  advanced: { invert: false, brightnessMapping: 1, edgeEnhance: 0, blur: 0, quantizeColors: 0, spatialWeight: 0, matchQuality: 'fast' },
  postProcessing: {
    bloom: { enabled: false, threshold: 0.3, softThreshold: 0.2, intensity: 1.5, radius: 12 },
    grain: { enabled: true, intensity: 35, size: 2, speed: 50 },
    chromatic: { enabled: false, offset: 2 },
    scanlines: { enabled: false, opacity: 0.1, spacing: 4 },
    vignette: { enabled: false, intensity: 0.5, radius: 0.5 },
    crtCurve: { enabled: false, amount: 0.1 },
    phosphor: { enabled: false, color: 'green', customColor: '#00ff00' },
  },
};

/* Verified against the renderer chunk index-DWlNRnaQ.js (byte 17713):
 *   cellW = scale*8*0.6, cellH = scale*8  -> 9.6 x 16 at the stock scale 2.
 * The font atlas uses a different, integer cell (bold 32px, ceil(32*0.6)=20
 * wide, 16 columns) which is resampled into the fractional output cell. */
export const BASE_FONT = 8;
export const cellSize = (scale) => ({ w: scale * BASE_FONT * 0.6, h: scale * BASE_FONT });

export const SAMPLES_PER_AXIS = { fast: 2, balanced: 3, quality: 4 };

export const clone = (o) => JSON.parse(JSON.stringify(o));
