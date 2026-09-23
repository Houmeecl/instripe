/**
 * QR Code model 2, version 1, error correction L, byte mode, mask 0.
 * Enough for the short promotion code shown on a virtual gift.
 */
export function qrMatrix(text: string): boolean[][] {
  const data = dataCodewords(text);
  const ecc = reedSolomon(data, 7);
  const bits = [...data, ...ecc].flatMap((byte) => {
    const row: number[] = [];
    for (let shift = 7; shift >= 0; shift -= 1) row.push((byte >> shift) & 1);
    return row;
  });
  const size = 21;
  const matrix: Array<Array<boolean | null>> = Array.from({ length: size }, () => Array(size).fill(null));
  paintFunctionPatterns(matrix);
  let bit = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    const rows = upward
      ? Array.from({ length: size }, (_, index) => size - 1 - index)
      : Array.from({ length: size }, (_, index) => index);
    for (const row of rows) {
      for (const dx of [0, -1]) {
        const x = col + dx;
        if (matrix[row][x] !== null) continue;
        const on = bit < bits.length ? bits[bit] === 1 : false;
        matrix[row][x] = on;
        bit += 1;
      }
    }
    upward = !upward;
  }
  applyMask0(matrix);
  paintFormat(matrix);
  return matrix.map((row) => row.map((cell) => cell === true));
}

function dataCodewords(text: string): number[] {
  const bytes = [...Buffer.from(text, "utf8")];
  if (bytes.length > 17) throw new Error("El código del regalo no cabe en el QR");
  const bits: number[] = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, 8);
  for (const byte of bytes) pushBits(bits, byte, 8);
  const capacity = 19 * 8;
  const terminator = Math.min(4, capacity - bits.length);
  pushBits(bits, 0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);
  const bytesOut: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    bytesOut.push(bits.slice(index, index + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  const pads = [0xec, 0x11];
  let pad = 0;
  while (bytesOut.length < 19) {
    bytesOut.push(pads[pad % 2]);
    pad += 1;
  }
  return bytesOut;
}

function pushBits(target: number[], value: number, length: number): void {
  for (let shift = length - 1; shift >= 0; shift -= 1) target.push((value >> shift) & 1);
}

function reedSolomon(data: number[], eccCount: number): number[] {
  const generator = rsGenerator(eccCount);
  const result = Array(eccCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    if (factor === 0) continue;
    for (let index = 0; index < generator.length; index += 1) {
      result[index] ^= gfMul(generator[index], factor);
    }
  }
  return result;
}

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], gfPow(2, index));
    }
    poly = next;
  }
  return poly.slice(1);
}

function gfMul(a: number, b: number): number {
  let result = 0;
  while (b > 0) {
    if (b & 1) result ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
    b >>= 1;
  }
  return result;
}

function gfPow(base: number, exp: number): number {
  let result = 1;
  for (let index = 0; index < exp; index += 1) result = gfMul(result, base);
  return result;
}

function paintFunctionPatterns(matrix: Array<Array<boolean | null>>): void {
  finder(matrix, 0, 0);
  finder(matrix, 14, 0);
  finder(matrix, 0, 14);
  for (let index = 0; index < 21; index += 1) {
    if (matrix[6][index] === null) matrix[6][index] = index % 2 === 0;
    if (matrix[index][6] === null) matrix[index][6] = index % 2 === 0;
  }
  matrix[13][8] = true;
}

function finder(matrix: Array<Array<boolean | null>>, row: number, col: number): void {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const yy = row + y;
      const xx = col + x;
      if (yy < 0 || xx < 0 || yy >= 21 || xx >= 21) continue;
      const edge = y < 0 || x < 0 || y > 6 || x > 6;
      const border = y === 0 || x === 0 || y === 6 || x === 6;
      const core = y >= 2 && y <= 4 && x >= 2 && x <= 4;
      matrix[yy][xx] = !edge && (border || core);
    }
  }
}

function applyMask0(matrix: Array<Array<boolean | null>>): void {
  for (let row = 0; row < 21; row += 1) {
    for (let col = 0; col < 21; col += 1) {
      if (isFunction(row, col)) continue;
      if ((row + col) % 2 === 0) matrix[row][col] = !matrix[row][col];
    }
  }
}

function isFunction(row: number, col: number): boolean {
  if (row < 9 && col < 9) return true;
  if (row < 9 && col > 11) return true;
  if (row > 11 && col < 9) return true;
  if (row === 6 || col === 6) return true;
  if (row === 13 && col === 8) return true;
  return false;
}

function paintFormat(matrix: Array<Array<boolean | null>>): void {
  const format = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];
  const positionsA: Array<[number, number]> = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  const positionsB: Array<[number, number]> = [
    [20, 8], [19, 8], [18, 8], [17, 8], [16, 8], [15, 8], [14, 8],
    [8, 13], [8, 14], [8, 15], [8, 16], [8, 17], [8, 18], [8, 19], [8, 20],
  ];
  format.forEach((bit, index) => {
    const [rowA, colA] = positionsA[index];
    const [rowB, colB] = positionsB[index];
    matrix[rowA][colA] = bit === 1;
    matrix[rowB][colB] = bit === 1;
  });
}
