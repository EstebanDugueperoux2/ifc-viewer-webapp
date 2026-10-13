import { IfcCreator } from '@ifc-lite/create';

export interface BuildingSpec {
  name: string;
  /** Building footprint, metres (X) */
  width: number;
  /** Building footprint, metres (Y) */
  depth: number;
  /** Floor-to-floor height, metres */
  storeyHeight: number;
  storeys: number;
}

const WALL_THICKNESS = 0.2;
const SLAB_THICKNESS = 0.2;

function inRange(label: string, value: number, min: number, max: number, integer = false): void {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${integer ? 'a whole number ' : 'a number '}between ${min} and ${max}.`);
  }
}

export function validateSpec(spec: BuildingSpec): void {
  if (!spec.name.trim()) throw new Error('Name is required.');
  inRange('Width', spec.width, 2, 100);
  inRange('Depth', spec.depth, 2, 100);
  inRange('Storey height', spec.storeyHeight, 2, 6);
  inRange('Storeys', spec.storeys, 1, 20, true);
}

/**
 * STEP files (ISO 10303-21) are ASCII-only: non-ASCII characters in strings must be
 * written as \X2\hhhh\X0\ (BMP) or \X4\hhhhhhhh\X0\ (beyond the BMP).
 */
export function toStepAscii(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) out += char;
    else if (code <= 0xffff) out += `\\X2\\${code.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
    else out += `\\X4\\${code.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`;
  }
  return out;
}

/** Builds a simple rectangular building (4 walls + floor slab per storey, roof slab on top). */
export function createBuilding(spec: BuildingSpec): { content: string; fileName: string } {
  validateSpec(spec);
  const { width, depth, storeyHeight, storeys } = spec;
  const creator = new IfcCreator({ Name: spec.name.trim() });

  for (let level = 0; level < storeys; level += 1) {
    const storey = creator.addIfcBuildingStorey({
      Name: level === 0 ? 'Ground Floor' : `Level ${level}`,
      Elevation: level * storeyHeight,
    });

    const corners: [number, number, number][] = [
      [0, 0, 0],
      [width, 0, 0],
      [width, depth, 0],
      [0, depth, 0],
    ];
    corners.forEach((start, i) => {
      creator.addIfcWall(storey, {
        Start: start,
        End: corners[(i + 1) % corners.length],
        Thickness: WALL_THICKNESS,
        Height: storeyHeight,
      });
    });

    creator.addIfcSlab(storey, {
      Position: [-WALL_THICKNESS / 2, -WALL_THICKNESS / 2, -SLAB_THICKNESS],
      Width: width + WALL_THICKNESS,
      Depth: depth + WALL_THICKNESS,
      Thickness: SLAB_THICKNESS,
    });

    if (level === storeys - 1) {
      creator.addIfcSlab(storey, {
        Position: [-WALL_THICKNESS / 2, -WALL_THICKNESS / 2, storeyHeight],
        Width: width + WALL_THICKNESS,
        Depth: depth + WALL_THICKNESS,
        Thickness: SLAB_THICKNESS,
      });
    }
  }

  const slug =
    spec.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'model';
  return { content: toStepAscii(creator.toIfc().content), fileName: `${slug}.ifc` };
}
