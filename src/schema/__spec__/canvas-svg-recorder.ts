/**
 * A stand-in `CanvasRenderingContext2D` that records path calls as SVG, so
 * the vocabulary page can draw each shape with the canvas track's own
 * drawers (`nightingale-track-canvas`'s `draw-shapes.ts`) rather than an
 * approximation of them.
 *
 * Only the calls those drawers make are implemented: `beginPath`, `moveTo`,
 * `lineTo`, `bezierCurveTo`, `arc`, `ellipse`, `closePath`, `fill`,
 * `stroke`, `fillRect` and `strokeRect`. Style setters are accepted and
 * ignored; the page paints every shape in `currentColor`. Coordinates are
 * rounded to two decimals so the output is deterministic.
 */

const TAU = 2 * Math.PI;

function num(value: number): string {
  // `+ 0` folds -0 into 0.
  return String(Number(value.toFixed(2)) + 0);
}

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

/**
 * The signed angle an arc from `start` to `end` sweeps, as the canvas spec
 * resolves it: a full turn when the span reaches 2π in the drawing
 * direction, otherwise the span reduced into that direction's half-open
 * range.
 */
function sweepAngle(start: number, end: number, anticlockwise: boolean) {
  if (!anticlockwise && end - start >= TAU) return TAU;
  if (anticlockwise && start - end >= TAU) return -TAU;
  return anticlockwise ? -mod(start - end, TAU) : mod(end - start, TAU);
}

export class CanvasSvgRecorder {
  fillStyle: unknown;
  strokeStyle: unknown;
  globalAlpha = 1;
  lineWidth = 1;

  readonly #elements: string[] = [];
  #path: string[] = [];
  #filled = false;
  #stroked = false;
  #current: [number, number] | null = null;
  #subpathStart: [number, number] | null = null;

  /** The recorded drawing, as SVG elements. */
  toSvg(): string {
    this.#flush();
    return this.#elements.join('');
  }

  beginPath(): void {
    this.#flush();
  }

  moveTo(x: number, y: number): void {
    this.#path.push(`M${num(x)} ${num(y)}`);
    this.#current = [x, y];
    this.#subpathStart = [x, y];
  }

  lineTo(x: number, y: number): void {
    if (!this.#current) return this.moveTo(x, y);
    this.#path.push(`L${num(x)} ${num(y)}`);
    this.#current = [x, y];
  }

  bezierCurveTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number
  ): void {
    if (!this.#current) this.moveTo(c1x, c1y);
    this.#path.push(`C${[c1x, c1y, c2x, c2y, x, y].map(num).join(' ')}`);
    this.#current = [x, y];
  }

  arc(
    cx: number,
    cy: number,
    r: number,
    start: number,
    end: number,
    anticlockwise = false
  ): void {
    this.ellipse(cx, cy, r, r, 0, start, end, anticlockwise);
  }

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    anticlockwise = false
  ): void {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const at = (angle: number): [number, number] => {
      const ex = rx * Math.cos(angle);
      const ey = ry * Math.sin(angle);
      return [cx + ex * cos - ey * sin, cy + ex * sin + ey * cos];
    };

    // Like the canvas, join the current point to the arc's start with a
    // straight line, or start a new subpath there.
    const [sx, sy] = at(start);
    if (this.#current) this.lineTo(sx, sy);
    else this.moveTo(sx, sy);

    const sweep = sweepAngle(start, end, anticlockwise);
    if (sweep === 0) return;

    const arcTo = (from: number, delta: number) => {
      const [x, y] = at(from + delta);
      const large = Math.abs(delta) > Math.PI ? 1 : 0;
      const clockwise = delta > 0 ? 1 : 0;
      this.#path.push(
        `A${num(rx)} ${num(ry)} ${num((rotation * 180) / Math.PI)} ${large} ${clockwise} ${num(x)} ${num(y)}`
      );
      this.#current = [x, y];
    };
    // An SVG arc cannot end where it starts, so a full turn is two halves.
    if (Math.abs(sweep) === TAU) {
      arcTo(start, sweep / 2);
      arcTo(start + sweep / 2, sweep / 2);
    } else {
      arcTo(start, sweep);
    }
  }

  closePath(): void {
    if (!this.#current) return;
    this.#path.push('Z');
    this.#current = this.#subpathStart;
  }

  fill(): void {
    this.#filled = true;
  }

  stroke(): void {
    this.#stroked = true;
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.#elements.push(
      `<path d="${rect(x, y, width, height)}" stroke="none"/>`
    );
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.#elements.push(`<path d="${rect(x, y, width, height)}" fill="none"/>`);
  }

  /** Emit the current path if it was painted, and start a fresh one. */
  #flush(): void {
    if (this.#path.length > 0 && (this.#filled || this.#stroked)) {
      const paint =
        (this.#filled ? '' : ' fill="none"') +
        (this.#stroked ? '' : ' stroke="none"');
      this.#elements.push(`<path d="${this.#path.join('')}"${paint}/>`);
    }
    this.#path = [];
    this.#filled = false;
    this.#stroked = false;
    this.#current = null;
    this.#subpathStart = null;
  }
}

function rect(x: number, y: number, width: number, height: number): string {
  return `M${num(x)} ${num(y)}h${num(width)}v${num(height)}h${num(-width)}Z`;
}
