import type { HiveBoardCell, HivePosition } from "./types";

const HEX_DIRS = [
    { q: 1, r: -1, s: 0 },
    { q: 1, r: 0, s: -1 },
    { q: 0, r: 1, s: -1 },
    { q: -1, r: 1, s: 0 },
    { q: -1, r: 0, s: 1 },
    { q: 0, r: -1, s: 1 },
  ];

export function hexToPixel(pos: HivePosition, size: number) {
    const x = size * (Math.sqrt(3) * pos.q + (Math.sqrt(3) / 2) * pos.r);
    const y = size * (3 / 2) * pos.r;
    return { x, y };
}

export function generateHexGrid(radius: number): HivePosition[] {
    const results: HivePosition[] = [];
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            const s = -q - r;
            if (Math.abs(s) <= radius) results.push({ q, r, s });
        }
    }
    return results;
}

export function computeBoardCells(cells: HiveBoardCell[]): HivePosition[] {
    const set = new Map<string, HivePosition>();
    const key = (p: HivePosition) => `${p.q},${p.r},${p.s}`;

    if (cells.length === 0) {
        // Turn 1: just return origin
        set.set(key({ q: 0, r: 0, s: 0 }), { q: 0, r: 0, s: 0 });
        return [...set.values()];
    }

    // add all occupied cells
    for (const cell of cells) {
        set.set(key(cell.position), cell.position);
    }

    // add neighbors (outer ring)
    for (const cell of cells) {
        const { q, r, s } = cell.position;

        for (const d of HEX_DIRS) {
            const n = {
                q: q + d.q,
                r: r + d.r,
                s: s + d.s,
            };
            set.set(key(n), n);
        }
    }

    return [...set.values()];
}

export function computeBoardRadius(cells: HiveBoardCell[]): number {
    if (!cells.length) return 1;
    let maxDist = 0;
    for (const cell of cells) {
        const { q, r, s } = cell.position;
        const dist = (Math.abs(q) + Math.abs(r) + Math.abs(s)) / 2;
        maxDist = Math.max(maxDist, dist);
    }
    return Math.max(1, maxDist + 1);
}

export function nodeCenterRelativeToBoard(
    board: HTMLElement,
    node: HTMLElement
) {
    const boardRect = board.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();

    const centerX = nodeRect.left + nodeRect.width / 2;
    const centerY = nodeRect.top + nodeRect.height / 2;

    return {
        x: centerX - boardRect.left - boardRect.width / 2,
        y: centerY - boardRect.top - boardRect.height / 2,
    };
}

export function findClosestHex(
    x: number,
    y: number,
    hexes: HivePosition[],
    size: number
): HivePosition | null {
    let closest: HivePosition | null = null;
    let minDist = Infinity;

    for (const pos of hexes) {
        const { x: hx, y: hy } = hexToPixel(pos, size);
        const dist = Math.hypot(hx - x, hy - y);
        if (dist < minDist) {
            minDist = dist;
            closest = pos;
        }
    }

    return closest;
}
export function isNodeOverBoard(
    board: HTMLElement,
    node: HTMLElement
): boolean {
    const b = board.getBoundingClientRect();
    const n = node.getBoundingClientRect();

    return !(
        n.right < b.left ||
        n.left > b.right ||
        n.bottom < b.top ||
        n.top > b.bottom
    );
}
