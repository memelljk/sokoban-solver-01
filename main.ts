// Push-optimal Sokoban solver: room decomposition + A* over pushes per room.
//
// Each level is a hallway row (where the player starts) with rooms off it; a box
// can never leave its room, so the level optimum is the sum of the room optima.
// Rooms are found by cutting the player's row out of the floor graph and taking
// the connected components that hold boxes. Each room is then solved on its own
// with an A* search over pushes (uniform push cost), using an admissible
// heuristic: the minimum bipartite matching between boxes and goals over
// single-box push distances (reverse pull BFS per goal, other boxes ignored).
// States whose boxes sit on a dead square (not live for any goal) or form a
// frozen 2x2 block are pruned. Between pushes the player walks a shortest BFS
// path, so the emitted move string realises exactly the push sequence found.
// All budgets are state counts, never the clock, and every tie is broken by a
// fixed order, so runs are byte-identical. If decomposition ever fails, the
// same push search runs on the whole level as a fallback.
//
// Local run: mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Directions in a fixed order (u, d, l, r) everywhere: determinism.
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const DC = ['u', 'd', 'l', 'r'];
const ROOM_LIMIT = 2_000_000;

interface Level {
  w: number; h: number; n: number;
  wall: Uint8Array; goal: Uint8Array; goalList: number[];
  boxes: number[]; player: number;
  live: Uint8Array;
  distTo: Int32Array[]; // per goal: single-box push distance from each cell, -1 = unreachable
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const n = w * h;
  const wall = new Uint8Array(n).fill(1);
  const goal = new Uint8Array(n);
  const goalList: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') { goal[i] = 1; goalList.push(i); }
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  // Live squares: cells from which a box can still be pushed onto some goal,
  // by reverse pulls from the goals (walls are the only obstacles).
  const live = new Uint8Array(n);
  const queue: number[] = [];
  for (const g of goalList) { live[g] = 1; queue.push(g); }
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi]!;
    const cx = c % w, cy = (c / w) | 0;
    for (let d = 0; d < 4; d++) {
      const bx = cx - DX[d]!, by = cy - DY[d]!;
      const sx = bx - DX[d]!, sy = by - DY[d]!;
      if (bx < 0 || by < 0 || bx >= w || by >= h || sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const b = by * w + bx, s = sy * w + sx;
      if (wall[b] || wall[s] || live[b]) continue;
      live[b] = 1; queue.push(b);
    }
  }
  // Single-box push distance to each goal (reverse BFS in push space).
  const distTo: Int32Array[] = goalList.map((g) => {
    const dist = new Int32Array(n).fill(-1);
    dist[g] = 0;
    const q = [g];
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi]!;
      const cx = c % w, cy = (c / w) | 0;
      for (let d = 0; d < 4; d++) {
        const bx = cx - DX[d]!, by = cy - DY[d]!;
        const sx = bx - DX[d]!, sy = by - DY[d]!;
        if (bx < 0 || by < 0 || bx >= w || by >= h || sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const b = by * w + bx, s = sy * w + sx;
        if (wall[b] || wall[s] || dist[b] >= 0) continue;
        dist[b] = dist[c]! + 1; q.push(b);
      }
    }
    return dist;
  });
  return { w, h, n, wall, goal, goalList, boxes, player, live, distTo };
}

// Cells the player can reach with `blocked` (walls + boxes) as obstacles, from `from`.
function reachable(L: Level, blocked: Uint8Array, from: number): Uint8Array {
  const seen = new Uint8Array(L.n);
  if (from < 0 || blocked[from]) return seen;
  seen[from] = 1;
  const q = [from];
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]!;
    const cx = c % L.w, cy = (c / L.w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]!, ny = cy + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
      const m = ny * L.w + nx;
      if (blocked[m] || seen[m]) continue;
      seen[m] = 1; q.push(m);
    }
  }
  return seen;
}

function canonOf(seen: Uint8Array): number {
  for (let i = 0; i < seen.length; i++) if (seen[i]) return i;
  return -1;
}

// Shortest walk from `from` to `to` avoiding `blocked`; returns move letters or null.
function walkPath(L: Level, blocked: Uint8Array, from: number, to: number): string | null {
  if (from === to) return '';
  const prev = new Int32Array(L.n).fill(-2);
  prev[from] = -1;
  const q = [from];
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]!;
    if (c === to) break;
    const cx = c % L.w, cy = (c / L.w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]!, ny = cy + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
      const m = ny * L.w + nx;
      if (blocked[m] || prev[m] !== -2) continue;
      prev[m] = c; q.push(m);
    }
  }
  if (prev[to] === -2) return null;
  const dirs: number[] = [];
  for (let c = to; prev[c] !== -1; c = prev[c]!) dirs.push(c - prev[c]!);
  dirs.reverse();
  let out = '';
  for (const dd of dirs) out += DC[dd === -L.w ? 0 : dd === L.w ? 1 : dd === -1 ? 2 : 3]!;
  return out;
}

// Admissible heuristic: min-cost bipartite matching boxes->goals over push
// distances (permutations for <= 7 boxes, sum of per-box minima beyond that,
// which is also a lower bound). Infinity when some box reaches no goal.
function heuristic(L: Level, goalIdx: number[], boxes: number[]): number {
  const nb = boxes.length;
  const cost: number[][] = boxes.map((b) => goalIdx.map((gi) => {
    const v = L.distTo[gi]![b]!;
    return v < 0 ? Infinity : v;
  }));
  if (nb > 7) {
    let s = 0;
    for (let i = 0; i < nb; i++) {
      const m = Math.min(...cost[i]!);
      if (!isFinite(m)) return Infinity;
      s += m;
    }
    return s;
  }
  // Permute goal assignment for the boxes (goals may outnumber boxes in a
  // whole-level fallback; boxes never outnumber goals in a valid state).
  let best = Infinity;
  const used = new Uint8Array(goalIdx.length);
  const dfs = (i: number, acc: number): void => {
    if (acc >= best) return;
    if (i === nb) { best = acc; return; }
    for (let gi = 0; gi < goalIdx.length; gi++) {
      if (used[gi] || !isFinite(cost[i]![gi]!)) continue;
      used[gi] = 1; dfs(i + 1, acc + cost[i]![gi]!); used[gi] = 0;
    }
  };
  dfs(0, 0);
  return best;
}

interface Push { boxFrom: number; dir: number }

// A* over pushes for one room (or the whole level when goals = all goals).
// `fixed` marks cells blocked forever (walls + other rooms' boxes).
// Returns the push list, or null when no solution exists within `limit` states.
function solvePushes(L: Level, fixed: Uint8Array, startBoxes: number[], goals: number[], startPlayer: number, limit: number): Push[] | null {
  const goalSet = new Set(goals);
  const goalIdx = goals.map((g) => L.goalList.indexOf(g));
  const isGoal = (bs: number[]): boolean => bs.every((b) => goalSet.has(b));
  const blockedWith = (bs: number[]): Uint8Array => {
    const bl = new Uint8Array(fixed);
    for (const b of bs) bl[b] = 1;
    return bl;
  };
  const dead = (bs: number[]): boolean => {
    for (const b of bs) if (!L.live[b] && !goalSet.has(b)) return true;
    // Frozen 2x2: four cells all wall/fixed/box, at least one box off its goal.
    const boxSet = new Set(bs);
    for (let y = 0; y + 1 < L.h; y++) {
      for (let x = 0; x + 1 < L.w; x++) {
        const cells = [y * L.w + x, y * L.w + x + 1, (y + 1) * L.w + x, (y + 1) * L.w + x + 1];
        let allBlocked = true, badBox = false;
        for (const c of cells) {
          if (boxSet.has(c)) { if (!goalSet.has(c)) badBox = true; }
          else if (!fixed[c]) { allBlocked = false; break; }
        }
        if (allBlocked && badBox) return true;
      }
    }
    return false;
  };
  if (dead(startBoxes)) return null;
  const h0 = heuristic(L, goalIdx, startBoxes);
  if (!isFinite(h0)) return null;

  const startRegion = reachable(L, blockedWith(startBoxes), startPlayer);
  const startCanon = canonOf(startRegion);
  if (startCanon < 0) return null;

  // Node store.
  const nBoxes: number[][] = [startBoxes.slice()];
  const nPlayer: number[] = [startCanon];
  const nG: number[] = [0];
  const nParent: number[] = [-1];
  const nPush: Push[] = [{ boxFrom: -1, dir: -1 }];
  const keyOf = (bs: number[], p: number): string => String.fromCharCode(p, ...bs);
  const bestG = new Map<string, number>([[keyOf(startBoxes, startCanon), 0]]);
  // Binary heap on (f, then deeper g, then insertion order).
  const heap: [number, number, number, number][] = [[h0, 0, 0, 0]];
  let counter = 1;
  const less = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  const hpush = (e: [number, number, number, number]): void => {
    let i = heap.length; heap.push(e);
    while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i]!, heap[p]!)) break; [heap[i], heap[p]] = [heap[p]!, heap[i]!]; i = p; }
  };
  const hpop = (): [number, number, number, number] => {
    const top = heap[0]!; const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!]; i = c;
      }
    }
    return top;
  };

  let expanded = 0;
  while (heap.length > 0) {
    const [, , , s] = hpop();
    const bs = nBoxes[s]!;
    if (nG[s]! > (bestG.get(keyOf(bs, nPlayer[s]!)) ?? Infinity)) continue; // stale heap entry
    if (isGoal(bs)) {
      const out: Push[] = [];
      for (let t = s; nParent[t]! >= 0; t = nParent[t]!) out.push(nPush[t]!);
      return out.reverse();
    }
    if (++expanded > limit) return null;
    const blocked = blockedWith(bs);
    const region = reachable(L, blocked, nPlayer[s]!);
    const boxSet = new Set(bs);
    for (const b of bs) {
      const bx = b % L.w, by = (b / L.w) | 0;
      for (let d = 0; d < 4; d++) {
        const sx = bx - DX[d]!, sy = by - DY[d]!; // stand cell
        const tx = bx + DX[d]!, ty = by + DY[d]!; // box target
        if (sx < 0 || sy < 0 || sx >= L.w || sy >= L.h || tx < 0 || ty < 0 || tx >= L.w || ty >= L.h) continue;
        const stand = sy * L.w + sx, target = ty * L.w + tx;
        if (!region[stand]) continue;
        if (fixed[target] || boxSet.has(target)) continue;
        if (!L.live[target] && !goalSet.has(target)) continue;
        const nb = bs.slice();
        nb[nb.indexOf(b)] = target;
        nb.sort((a, b2) => a - b2);
        if (dead(nb)) continue;
        const h = heuristic(L, goalIdx, nb);
        if (!isFinite(h)) continue;
        // Player ends on the box's old cell; canonicalise its new region.
        const nBlocked = blockedWith(nb);
        const nCanon = canonOf(reachable(L, nBlocked, b));
        if (nCanon < 0) continue;
        const g = nG[s]! + 1;
        const k = keyOf(nb, nCanon);
        const seenG = bestG.get(k);
        if (seenG !== undefined && seenG <= g) continue;
        const t = nBoxes.length;
        nBoxes.push(nb); nPlayer.push(nCanon); nG.push(g); nParent.push(s);
        nPush.push({ boxFrom: b, dir: d });
        bestG.set(k, g);
        hpush([g + h, -g, counter++, t]);
      }
    }
  }
  return null;
}

function solveLevel(text: string): string {
  const L = parseLevel(text);
  if (L.player < 0 || L.boxes.length === 0) return '';
  const { w } = L;
  const playerRow = (L.player / w) | 0;

  // Room decomposition: cut the hallway (player) row's dead cells, in fact the
  // whole row, out of the floor graph; components holding boxes are rooms.
  const comp = new Int32Array(L.n).fill(-1);
  const comps: number[][] = [];
  for (let i = 0; i < L.n; i++) {
    if (L.wall[i] || ((i / w) | 0) === playerRow || comp[i] >= 0) continue;
    const id = comps.length;
    const cells: number[] = [];
    const q = [i]; comp[i] = id;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi]!; cells.push(c);
      const cx = c % w, cy = (c / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d]!, ny = cy + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= L.h) continue;
        const m = ny * w + nx;
        if (L.wall[m] || ny === playerRow || comp[m] >= 0) continue;
        comp[m] = id; q.push(m);
      }
    }
    comps.push(cells);
  }
  interface Room { cells: Set<number>; boxes: number[]; goals: number[]; min: number }
  const rooms: Room[] = [];
  let decomposed = true;
  const boxComp = new Map<number, number>();
  for (let id = 0; id < comps.length; id++) {
    const cells = comps[id]!;
    const bs = L.boxes.filter((b) => comp[b] === id);
    if (bs.length === 0) continue;
    const gs = L.goalList.filter((g) => comp[g] === id);
    if (bs.length !== gs.length) { decomposed = false; break; }
    for (const b of bs) boxComp.set(b, id);
    rooms.push({ cells: new Set(cells), boxes: bs, goals: gs, min: Math.min(...cells) });
  }
  if (rooms.length === 0 || boxComp.size !== L.boxes.length) decomposed = false;
  rooms.sort((a, b) => a.min - b.min);

  // Global simulation state for stitching the rooms' move strings together.
  const curBoxes = new Set(L.boxes);
  let player = L.player;
  let moves = '';
  const applyPushes = (pushes: Push[]): boolean => {
    for (const p of pushes) {
      const blocked = new Uint8Array(L.n);
      for (let i = 0; i < L.n; i++) blocked[i] = L.wall[i]!;
      for (const b of curBoxes) blocked[b] = 1;
      const stand = p.boxFrom - (DY[p.dir]! * w + DX[p.dir]!);
      const walk = walkPath(L, blocked, player, stand);
      if (walk === null) return false;
      moves += walk + DC[p.dir]!;
      curBoxes.delete(p.boxFrom);
      curBoxes.add(p.boxFrom + (DY[p.dir]! * w + DX[p.dir]!));
      player = p.boxFrom;
    }
    return true;
  };

  if (decomposed) {
    let ok = true;
    for (const room of rooms) {
      const fixed = new Uint8Array(L.wall);
      for (const b of curBoxes) if (!room.boxes.includes(b)) fixed[b] = 1;
      const pushes = solvePushes(L, fixed, room.boxes.slice().sort((a, b) => a - b), room.goals, player, ROOM_LIMIT);
      if (pushes === null || !applyPushes(pushes)) { ok = false; break; }
    }
    if (ok && [...curBoxes].every((b) => L.goal[b])) return moves;
  }
  // Fallback: one push search over the whole level.
  const pushes = solvePushes(L, new Uint8Array(L.wall), L.boxes.slice(), L.goalList, L.player, ROOM_LIMIT);
  if (pushes === null) return '';
  curBoxes.clear();
  for (const b of L.boxes) curBoxes.add(b);
  player = L.player; moves = '';
  return applyPushes(pushes) ? moves : '';
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
