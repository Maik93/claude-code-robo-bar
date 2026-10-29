// The cache badge: a pixel robot and a rounded chip, as SVG strings the band hands to Svg.
// Adapted from ribbon by Jay E | RoboNuggets (github.com/robonuggets/ribbon), MIT License: see
// third_party/ribbon-LICENSE. Pure: nothing here touches the engine.

import { SANS } from './font'

export type Mode = 'hot' | 'cold'

/** Muted red and blue, as ribbon draws its warm and cold states. */
export const HUE: Record<Mode, string> = { hot: '#cc6363', cold: '#6aaabd' }
/** Text on a filled chip. */
export const INK = '#1c1a16'
export const ROBO_SIZE = 26

const CHIP_SIZE = 13

const svgDoc = (w: number, h: number, body: string, font: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  (font
    ? `<style>@font-face{font-family:RS;font-weight:100 900;src:url(data:font/woff2;base64,${SANS}) format('woff2')}` +
      ` text{font-family:RS,system-ui,'Segoe UI',sans-serif}</style>`
    : '') +
  body +
  '</svg>'

/**
 * A rounded chip holding `text`. An Svg can't measure text, so the width is estimated: about 0.62 em per character
 * in the embedded font, plus letter spacing, plus 0.62 em of padding each side.
 */
export const chipSvg = (text: string, mode: Mode): { source: string; w: number; h: number } => {
  const size = CHIP_SIZE
  const ls = 1
  const w = Math.round(text.length * (size * 0.62 + ls) + size * 1.24)
  const h = Math.round(size * 1.65)
  const body =
    `<rect x="0" y="0" width="${w}" height="${h}" rx="${Math.round(h * 0.32)}" fill="${HUE[mode]}"/>` +
    `<text x="${w / 2}" y="${h / 2 + size * 0.36}" font-size="${size}" font-weight="700" letter-spacing="${ls}"` +
    ` text-anchor="middle" fill="${INK}">${text}</text>`
  return { source: svgDoc(w, h, body, true), w, h }
}

// ---------- Robo: bobbing while hot, frozen in ice when cold ----------
const ROBO_PIX = ['..X..X..', 'XXXXXXXX', 'XXXXXXXX', 'X.XXXX.X', 'XXXXXXXX', 'XXXXXXXX', 'X..XX..X']

const mix = (a: string, b: string, t: number): string =>
  '#' +
  [1, 3, 5]
    .map(i =>
      Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

// One path, not a rect per pixel: separate rects at fractional sizes leave faint seams between them.
const pixels = (u: number, fill: string): string => {
  let d = ''
  ROBO_PIX.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === 'X') d += `M${x * u} ${y * u}h${u}v${u}h${-u}z`
    }),
  )
  return `<path d="${d}" fill="${fill}"/>`
}

/** Robo in a box `size` pixels square. Animated with SMIL only, so the Svg needs isInteractive. */
const roboShapes = (size: number, mode: Mode): string => {
  const ease = 'calcMode="spline" keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"'
  if (mode === 'hot') {
    const fill = HUE.hot
    const u = size / 10
    return (
      `<g transform="translate(${u} ${1.6 * u})" shape-rendering="crispEdges">` +
      `<ellipse cx="${4 * u}" cy="${7.75 * u}" rx="${3 * u}" ry="${0.42 * u}" fill="#000" opacity=".4"` +
      ` shape-rendering="auto"><animate attributeName="rx" values="${3 * u};${2.3 * u};${3 * u}" dur="1.2s"` +
      ` repeatCount="indefinite" ${ease}/></ellipse>` +
      `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${-1.1 * u};0 0" dur="1.2s"` +
      ` repeatCount="indefinite" ${ease}/>` +
      pixels(u, fill) +
      // A blink every few seconds: the eye holes fill for a moment.
      `<g opacity="0"><rect x="${u}" y="${3 * u}" width="${u}" height="${u}" fill="${fill}"/>` +
      `<rect x="${6 * u}" y="${3 * u}" width="${u}" height="${u}" fill="${fill}"/>` +
      `<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.9;0.91;0.95;1" dur="3.4s"` +
      ` repeatCount="indefinite"/></g>` +
      `</g></g>`
    )
  }
  // Cold: still, pale, inside a rounded ice block with icicles and one twinkle.
  const u = size / 12.2
  const ice = mix(HUE.cold, '#ffffff', 0.5)
  const bx = -1.2 * u
  const by = -1.2 * u
  const bw = 10.4 * u
  const bh = 9.4 * u
  let s = `<g transform="translate(${1.6 * u} ${1.6 * u})">`
  s += pixels(u, ice)
  s +=
    `<rect x="${2 * u}" y="0" width="${u}" height="${u * 0.45}" fill="#fff" opacity=".9"/>` +
    `<rect x="${5 * u}" y="0" width="${u}" height="${u * 0.45}" fill="#fff" opacity=".9"/>`
  s +=
    `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${1.5 * u}" fill="${HUE.cold}" fill-opacity=".28"` +
    ` stroke="${ice}" stroke-width="${0.38 * u}"/>`
  s +=
    `<path d="M${bx + 0.9 * u} ${by + 2.6 * u}l${1.6 * u} ${-1.6 * u}M${bx + 0.9 * u} ${by + 4.2 * u}` +
    `l${0.8 * u} ${-0.8 * u}" stroke="#fff" stroke-opacity=".75" stroke-width="${0.32 * u}" stroke-linecap="round"/>`
  for (const ix of [1.4, 4.4, 7.2]) {
    s += `<path d="M${bx + ix * u} ${by + bh}h${0.9 * u}l${-0.45 * u} ${1.5 * u}z" fill="${ice}"/>`
  }
  const sx = bx + bw - 0.2 * u
  const sy = by + 0.2 * u
  const r = 1.1 * u
  s +=
    `<path d="M${sx} ${sy - r}L${sx + 0.25 * r} ${sy - 0.25 * r}L${sx + r} ${sy}L${sx + 0.25 * r} ${sy + 0.25 * r}` +
    `L${sx} ${sy + r}L${sx - 0.25 * r} ${sy + 0.25 * r}L${sx - r} ${sy}L${sx - 0.25 * r} ${sy - 0.25 * r}z"` +
    ` fill="#fff"><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.55;0.7;0.85;1" dur="2.8s"` +
    ` repeatCount="indefinite"/></path>`
  return s + '</g>'
}

export const roboSvg = (mode: Mode): string => svgDoc(ROBO_SIZE, ROBO_SIZE, roboShapes(ROBO_SIZE, mode), false)
