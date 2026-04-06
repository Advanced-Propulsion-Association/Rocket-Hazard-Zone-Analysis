import { describe, it, expect } from 'vitest';
import { extractCGFromNose, extractNumFins } from '../src/simulation/orkParser';

describe('extractNumFins', () => {
  it('returns fin count from trapezoidfinset XML', () => {
    const xml = `<rocket><trapezoidfinset><fincount>4</fincount></trapezoidfinset></rocket>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(extractNumFins(doc)).toBe(4);
  });

  it('defaults to 3 when fincount missing', () => {
    const xml = `<rocket><trapezoidfinset></trapezoidfinset></rocket>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(extractNumFins(doc)).toBe(3);
  });
});

describe('extractCGFromNose', () => {
  it('returns undefined when no cg element present', () => {
    const xml = `<rocket></rocket>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(extractCGFromNose(doc)).toBeUndefined();
  });
});
