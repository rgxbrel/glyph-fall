# REA — Grainrad (grainrad.com) — ASCII block effect

Target: production Vite bundle of Grainrad, the WebGPU ASCII/dither tool shown in
@timhosqo's reel `DdWhYLETVR5`.
Method: static analysis only. No execution of the target, no GPU trace, no
breakpoints. `rea analyze-javascript-application` (CLI 6.7.0) ran out of heap on
the 797 KB minified file and returned a shallow graph (0 modules, 4,138 AST
nodes), so the findings below come from deterministic byte-slicing of the bundle
plus reading the code-split renderer chunks. Every item states its confidence.

## Files in this copy

| file | what |
|---|---|
| `index.html`, `assets-index.js`, `index-DXtjAZsq.css`, `registerSW.js`, `favicon-32.png`, `assets/` | the staged app as served |
| `evidence/assets-index.js` (same as `../assets-index.js`) | MAIN bundle, 797,251 B — shader sources, charsets, defaults live here |
| `evidence/index-DWlNRnaQ.js` | **WebGPU renderer chunk** (41,489 B) — not in the staged app; fetched from grainrad.com. Contains the pipeline, atlas builder and uniform writers |
| `evidence/index-D4g1FOHw.js` | WebGL2 fallback renderer (42,364 B) |
| `evidence/gpu.pretty.js` | reformatted WebGPU chunk, for reading |
| `evidence/ascii.wgsl` | all 19 shader sources extracted from MAIN by pairing unescaped backticks |
| `evidence/rea_js.json` | the REA CLI evidence record (5.1 MB, shallow — kept for the record, not the basis of these findings) |
| `evidence/index-CPD5w-YN.js`, `index-DKljlg_S.js`, `index-C-104lQ3.js` | other code-split chunks pulled alongside |

## 1. ASCII is a three-pass effect

Observed. The effect registry `mg` at MAIN byte ~431690:

```
mg={ascii:OS, passthrough:kS, characterMatch:RS, postprocess:DS,
    bloomThreshold:US, bloomBlur:MS, dithering:LS, halftone:zS, threshold:jS,
    edgeDetection:FS, dots:NS, blockify:BS, crosshatch:IS, waveLines:_S,
    pixelSort:GS, contour:PS, noiseField:HS, matrixRain:VS, vhs:qS, voronoi:YS}
```

Frame order, one encoder and one `submit` per frame (GPU chunk bytes 17081,
18770, 20888, 22105, 22329):

1. compute `characterMatch` — `@workgroup_size(8,8)`,
   `dispatchWorkgroups(ceil(cols/8), ceil(rows/8))`, writes the `matchResult`
   storage buffer;
2. render `ascii` → `intermediateTexture`;
3. **only if `postProcessing.bloom.enabled`**: `bloomThreshold` →
   `bloomBlur` H → `bloomBlur` V;
4. **always** `postprocess` → `context.getCurrentTexture()`.

Non-ASCII effects replace (1)+(2) with a single pass, or `passthrough` if the
lookup fails. `draw(3)` fullscreen triangles everywhere.

Shader byte offsets in MAIN: OS=254023, RS=266141, DS=273248, US=278435,
MS=279940, LS=282528, zS=356138, jS=364308, FS=367741, NS=375881, BS=380814,
IS=383462, _S=390914, GS=394523, PS=403752, HS=407690, VS=412023, qS=421948,
YS=427185.

## 2. characterMatch (RS)

Per sample, in this exact order:

```
b = r*0.299 + g*0.587 + b*0.114
b = pow(b, 1/imageGamma)
b += imageBrightness * 0.005
b = (b - 0.5) * ((imageContrast + 100) * 0.01) + 0.5
b = pow(clamp(b,0,1), brightnessMapping)
b = select(b, 1-b, invert > 0.5)
b = clamp(b,0,1)
```

Then two branches (MAIN ~270709):

- **fast path** — `if (brightnessWeight >= 0.99)`:
  `matchResult[i] = u32(clamp(sourceBrightness, 0, 0.9999) * charsetLength)`.
  A pure index ramp by **truncation**, scaled by `charsetLength`, not
  `charsetLength-1`. The atlas-comparison loop never runs.
- **match path** — `expectedIndex = b * (charsetLength-1)`; for each character:
  `indexDist = abs(charIdx - expectedIndex) / charsetLength`,
  `spatialDist = Σ(sourceSample - atlasBrightness)² / totalSamples` (**MSE, no
  sqrt**), `score = indexDist*brightnessWeight + spatialDist*(1-brightnessWeight)`,
  keep the minimum over the whole charset.

`samplesPerAxis` is 2, 3 or 4 (`array<f32,16>` is the ceiling), driven by
`advanced.matchQuality`: `fast→2`, `balanced→3`, `quality→4` (GPU 25872-25964).
`brightnessWeight = 1 - (advanced.spatialWeight ?? 0)`. There is **no UI control**
for matchQuality; only the `Ge` default `"fast"`. `spatialWeight` is exposed as
the "Shape Matching" slider (MAIN 559099).

## 3. ascii fragment (OS)

- `cell = floor(pixelPos * invCellSize)`.
- `gapRatio = spacing*0.5`, `charArea = 1-gapRatio`, `halfGap = gapRatio*0.5`;
  `charIntensity = select(atlasColor.r, 0.0, inGap && spacing > 0.01)`.
- Colour is a **single `textureSample` at the cell centre**
  `(cellPos+0.5)*invNumCells` — not an area average.
- Optional 5×5 blur, Laplacian `edgeEnhance` (`center*4 - left-right-top-bottom`),
  unsharp `sharpness`, posterize `quantizeColors`.
- `applyImageProcessing`: gamma → brightness → contrast → saturation → hue →
  colorMode (0 color, 1 gray, 2 mono, 3 sepia).
- `finalColor = select(customColor, processedColor, useOriginalColors)`;
  `output = mix(backgroundColor, finalColor, charIntensity)`.

## 4. postprocess fragment (DS)

Order: CRT barrel → out-of-bounds black → chromatic aberration → bloom combine →
scanlines → grain → phosphor tint → vignette → clamp.

- chromatic offset is `chromaticOffset * pixelSize.x` (sub-pixel): R at
  `uv.x - offset`, B at `uv.x + offset`.
- scanline test `fragY % (spacing*2) < spacing`.
- grain `(hash(floor(uv*resolution/grainSize)*grainSize + time*grainSpeed) - 0.5) * (grainIntensity/100)`.
- vignette `1 - smoothstep(radius, 1, length(uv-0.5)*2) * intensity`.
- phosphor `phosphorColor * luminance`.

## 5. Cell size — the part that was wrong in my first port

Observed (GPU 17713): `n = scale*8*0.6`, `g = scale*8`.

- **The cell is not square.** At the stock `scale: 2` it is **9.6 × 16 output px**.
- Grid `d = floor(srcW/cellW)`, `F = floor(srcH/cellH)`; output texture
  `floor(d*cellW) × floor(F*cellH)`.
- `AsciiUniforms.cellSize` = (cellW, cellH) at byte offsets 16/20;
  `MatchUniforms.cellSize` = source px per cell (`srcW/d`, `srcH/F`) at 8/12.
- `character.outputWidth` (slider 0-500, MAIN 234979) is **never read by the
  WebGPU renderer** — only by the WebGL2 fallback (`index-D4g1FOHw.js` 30264).
  Dead setting on WebGPU.

## 6. Font atlas

Observed (GPU 470, 257, 523, 1000; function `T(device, charset, scale=1)`):

- Cached in IndexedDB under `` `fontAtlas_v1_${hash(charset)}_${scale}` ``, TTL
  `1/0` = never expires.
- `l = max(32, ceil(32 * max(1, scale/4)))` → 32 px for scale 1-4, 64 px for 5-8.
- `charWidth = ceil(l*0.6)` = 20 at l=32; `charHeight = l`; **cols = 16 constant**;
  `rows = ceil(len/16)`. The standard set (10 chars) is a single 320×32 row.
- No padding, no `measureText`, no devicePixelRatio. Black fill, white fill,
  `bold ${l}px "JetBrains Mono","SF Mono","Fira Code","Courier New",monospace`,
  `textBaseline="top"`, `textRendering="geometricPrecision"`, then
  `getImageData` → `queue.writeTexture` as `rgba8unorm`.
- `doUpdateCharset` (GPU 9575) returns early unless
  `charset !== currentCharset || ceil(scale/4) !== ceil(currentFontScale/4)` —
  scale 1→2 reuses the atlas and only changes cell size.

## 7. Charsets (`Tn`, MAIN 532038) — ten, not six

```
standard  " .:-=+*#%@"
blocks    " ░▒▓█"
binary    " 01"
detailed  " .'`^\",:;Il!i><~+_-?][}{1)(|\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"
minimal   " .:#"
alphabetic " .icotCOXWM"
numeric   " 1234567890"
math      " .-+×÷=≠<>≤≥∞∑√∫"
emoji     " ·•○◎●◐◑◒◓◔◕◖◗"
custom    " .:+*#@"
```

## 8. Stock defaults (`Ge`, MAIN ~428900)

```js
Ge={character:{scale:2,spacing:0,set:"standard",customChars:" .:+*#@",outputWidth:0},
 image:{brightness:0,contrast:0,saturation:0,hue:0,sharpness:0,gamma:1,colorMode:"color"},
 color:{colorMode:"original",custom:"#00ff00",useOriginal:!0,intensity:1,backgroundColor:"#000000"},
 advanced:{invert:!1,brightnessMapping:1,edgeEnhance:0,blur:0,quantizeColors:0,spatialWeight:0,matchQuality:"fast"},
 postProcessing:{bloom:{enabled:!1,threshold:.3,softThreshold:.2,intensity:1.5,radius:12},
  grain:{enabled:!0,intensity:35,size:2,speed:50},chromatic:{enabled:!1,offset:2},
  scanlines:{enabled:!1,opacity:.1,spacing:4},vignette:{enabled:!1,intensity:.5,radius:.5},
  crtCurve:{enabled:!1,amount:.1},phosphor:{enabled:!1,color:"green",customColor:"#00ff00"}}}
```

Consequence: the stock look is the **fast path** — `spatialWeight: 0` means no
shape matching at all, and grain is the only post-effect on. A port that turns
matching on by default comes out sparse and thin.

## 9. Source intake and fit

Observed. Types `none|image|gif|video|webcam|model3d`; accept maps at MAIN
239733. Intake is react-dropzone plus canvas drag/drop; GIF frames are decoded by
`gif.worker.js` into `ImageData`; webcam requests
`{width:{ideal:1280},height:{ideal:720},facingMode:"user"}`. No
`getDisplayMedia`, no URL input.

`uploadSource` (GPU 22880) uses `copyExternalImageToTexture` directly only when
the source is not a video and the size is unchanged; otherwise it blits through a
reused `OffscreenCanvas` each frame. `maxPreviewDimension = 2048` (GPU 3265,
never overridden) clamps the longest side with the aspect preserved. Display is a
CSS `scale(fit*zoom)` with `image-rendering: pixelated`; `scale` changes glyph
chunkiness, not canvas size. Textures/buffers are destroyed on a deferred 3-frame
queue.

## Limitations and unknowns

- Static only. Nothing here observed execution: no browser run of Grainrad, no
  WebGPU capture, no verification of sampler/filter artifacts or real glyph
  hinting quality.
- `evidence/index-DWlNRnaQ.js` and `index-D4g1FOHw.js` were fetched from
  grainrad.com during this session; they are **not** part of the originally
  staged target. Version drift against MAIN was not proven (the import specifier
  and the `C("ascii")` registry lookup match).
- Not established: whether `ceil(scale/4)` atlas reuse ever yields visibly wrong
  cells; whether `outputWidth: 0` misbehaves on the WebGL2 path (the formula
  suggests a one-column output — unverified); GPU-side filtering artifacts.
- The WebGL2 fallback was inspected only for the `outputWidth`/`cellSize`
  cross-check, not analysed.
- The REA MCP graph coverage for this file is shallow (heap exhaustion on the
  797 KB minified MAIN). Treat `evidence/rea_js.json` as a record of a failed
  deep pass, not as corroboration. Its Electron findings being 0 does support
  "pure web app".

## Reconstruction

`/data/workspace/ascii-block-game/src/ascii.js` is the CPU port of passes 1-4 as
described above, used by the GLYPH FALL game in the same directory. It reproduces
the fractional 9.6×16 cell, the truncation index ramp, the MSE shape-matching
path, the ten charsets, the `Ge` defaults and the post-fx chain order.
