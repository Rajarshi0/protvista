import { describe, it, expect } from 'vitest';

import { CanvasSvgRecorder } from './canvas-svg-recorder.js';

function record(draw: (ctx: CanvasSvgRecorder) => void): string {
  const ctx = new CanvasSvgRecorder();
  draw(ctx);
  return ctx.toSvg();
}

describe('CanvasSvgRecorder', () => {
  it('records fillRect and strokeRect as separate filled and stroked paths', () => {
    expect(
      record((ctx) => {
        ctx.fillRect(1, 2, 10, 5);
        ctx.strokeRect(1, 2, 10, 5);
      })
    ).toBe(
      '<path d="M1 2h10v5h-10Z" stroke="none"/><path d="M1 2h10v5h-10Z" fill="none"/>'
    );
  });

  it('records a filled and stroked polygon as one path', () => {
    expect(
      record((ctx) => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(4, 0);
        ctx.lineTo(2, 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      })
    ).toBe('<path d="M0 0L4 0L2 3Z"/>');
  });

  it('marks a stroke-only path as unfilled, and drops an unpainted one', () => {
    expect(
      record((ctx) => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(9, 9);
        ctx.beginPath();
        ctx.moveTo(1, 5);
        ctx.lineTo(9, 5);
        ctx.stroke();
      })
    ).toBe('<path d="M1 5L9 5" fill="none"/>');
  });

  it('splits a full circle into two half arcs', () => {
    expect(
      record((ctx) => {
        ctx.beginPath();
        ctx.arc(5, 5, 2, 0, 2 * Math.PI);
        ctx.fill();
      })
    ).toBe('<path d="M7 5A2 2 0 0 1 3 5A2 2 0 0 1 7 5" stroke="none"/>');
  });

  it('sweeps the short way clockwise and the long way anticlockwise', () => {
    const quarter = (anticlockwise: boolean) =>
      record((ctx) => {
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, 0.5 * Math.PI, anticlockwise);
        ctx.stroke();
      });
    expect(quarter(false)).toBe('<path d="M1 0A1 1 0 0 1 0 1" fill="none"/>');
    expect(quarter(true)).toBe('<path d="M1 0A1 1 0 1 0 0 1" fill="none"/>');
  });

  it('joins the current point to the start of an arc with a line', () => {
    expect(
      record((ctx) => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.ellipse(5, 0, 1, 2, 0, Math.PI, 0, false);
        ctx.stroke();
      })
    ).toBe('<path d="M0 0L4 0A1 2 0 0 1 6 0" fill="none"/>');
  });
});
