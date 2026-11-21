# Sokoban Solver — Push-Optimal, Room by Room

A Sokoban solver for make.fun's `sokoban-solver-01` that finds **push-optimal**
solutions: on the kit's practice set it solves all 5 instances in exactly P*
pushes (13 / 16 / 29 / 47 / 60), scoring 1,000 points per instance, in about
0.3 s total for the whole set — far inside the 60 s budget. Two fresh sets
drawn with the kit's own generator from unseen seeds also score a perfect
1,000,000.

## How it works

- **Room decomposition.** A box can never leave its room, so a level's optimum
  is the sum of its rooms' optima. The solver cuts the player's hallway row out
  of the floor graph; the connected components that hold boxes are the rooms
  (verified: boxes == goals per room, otherwise it falls back to one search
  over the whole level).
- **A\* over pushes, per room.** States are the sorted box cells plus the
  canonical player position (lowest cell of the player's reachable region).
  Push cost is uniform, and the heuristic is admissible: the minimum bipartite
  matching between boxes and goals over single-box push distances, precomputed
  per goal by reverse pull BFS (other boxes ignored).
- **Deadlock pruning.** States are dropped when a box rests on a dead square
  (not live for any goal, via reverse-pull BFS from the goals) or when a frozen
  2x2 block of walls/boxes contains a box off its goal.
- **Move reconstruction.** Between pushes the player walks a shortest BFS path
  (fixed u, d, l, r order), so the emitted string realises exactly the optimal
  push sequence.
- **Deterministic.** All budgets are state counts (2,000,000 per room), never
  the clock; every tie is broken by a fixed order, so two runs are
  byte-identical.

## Run locally

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` is a single dependency-free file (Node 22, TypeScript stripped
natively). It reads `MAKEFUN_INPUT_DIR` (default `/input`), where each
`<id>/level.txt` holds a level in XSB, and writes
`MAKEFUN_OUTPUT_DIR/<id>/solution.txt` (default `/output`) with the move
string (`u`/`d`/`l`/`r`, one letter per player step).
