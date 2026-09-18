/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hand-drawn explorer face, painted in the character-customization screen and
 * shown on the front of the helmet to the rest of the room.
 *
 * Stored as FACE_SIZE*FACE_SIZE palette indices, one digit per pixel, row by
 * row ("0" = transparent). A 256-char string: small enough to ride along in
 * the join message, trivially validated server-side, and it can only ever
 * become pixels — no images or URLs passed between players.
 */
export const FACE_SIZE = 16;

/** Index 0 is transparent (the helmet shows through). Kept in sync with server.ts. */
export const FACE_PALETTE: (string | null)[] = [
  null,
  "#111111", // black
  "#f2e8cf", // white
  "#e0a98a", // skin
  "#d94f2b", // orange
  "#b0243a", // red
  "#2f6f8f", // teal
  "#deb81d", // yellow
];

export const EMPTY_FACE = "0".repeat(FACE_SIZE * FACE_SIZE);

const FACE_PATTERN = new RegExp(`^[0-${FACE_PALETTE.length - 1}]{${FACE_SIZE * FACE_SIZE}}$`);

/** A well-formed face with at least one painted pixel. */
export function hasFace(face: unknown): face is string {
  return typeof face === "string" && FACE_PATTERN.test(face) && /[^0]/.test(face);
}

/** Paints the face onto a canvas, `pixelSize` canvas pixels per face pixel. */
export function drawFace(ctx: CanvasRenderingContext2D, face: string, pixelSize = 1): void {
  for (let i = 0; i < face.length; i++) {
    const color = FACE_PALETTE[Number(face[i])];
    if (!color) continue;
    ctx.fillStyle = color;
    ctx.fillRect((i % FACE_SIZE) * pixelSize, Math.floor(i / FACE_SIZE) * pixelSize, pixelSize, pixelSize);
  }
}
