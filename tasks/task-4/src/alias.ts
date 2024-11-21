import { isEqual } from "lodash-es";

import type { BasicBlock } from "./blocks";
import * as bril from "./bril";

type MemoryLocation = number;
type AliasMap = Map<string, Set<MemoryLocation>>;

export function aliasAnalysis(
  cfg: BasicBlock[],
  args: bril.Argument[] = []
): Map<number, AliasMap> {
  // First, decorate every instruction with a unique position.
  cfg
    .flatMap((block) => block.instrs)
    .forEach((instr, i) => {
      instr.pos = { row: i, col: 0 };
    });

  // Derive the full set of memory locations ahead of time. We will pass this to
  // the transfer function such that it can assign destinations that load from
  // a pointer to _all_ memory locations.
  const memoryLocations = cfg.reduce<Set<MemoryLocation>>((acc, block) => {
    block.instrs.forEach((instr) => {
      acc.add(instr.pos!.row);
    });

    return acc;
  }, new Set());

  // Create the initial mapping of function arguments, which will conservatively
  // alias all memory locations.
  const argsMap = args.reduce((map, arg) => {
    map.set(arg.name, memoryLocations);

    return map;
  }, new Map<string, Set<MemoryLocation>>());

  const outSets = new Map<number, AliasMap>();

  const worklist = [...cfg];

  while (worklist.length > 0) {
    const currBlock = worklist.pop()!;

    // Identify the predecessors of the current block.
    const predecessors = cfg.filter((block) =>
      currBlock.predecessors.has(block.id)
    );

    // Calculate the in map of the current block. This is the meet of the out
    // sets of all predecessors.
    const predecessorOutSets =
      currBlock.id === 0
        ? [argsMap]
        : predecessors.map(
            (block) =>
              outSets.get(block.id) ?? new Map<string, Set<MemoryLocation>>()
          );
    const inSet = meet(predecessorOutSets);

    const outSet = transfer(currBlock, inSet, memoryLocations);

    const prevOutSet = outSets.get(currBlock.id)!;

    if (!isEqual(outSet, prevOutSet)) {
      outSets.set(currBlock.id, outSet);

      const successors = cfg.filter((block) =>
        currBlock.successors.has(block.id)
      );

      worklist.push(...successors);
    }
  }

  return outSets;
}

/**
 * The meet operator for the alias analysis.
 *
 * @param outs – The out sets of the predecessors of a basic block.
 * @returns — The meet of the out sets, which is the union of all the out sets.
 */
function meet(outs: AliasMap[]): AliasMap {
  if (outs.length === 0) {
    return new Map<string, Set<MemoryLocation>>();
  }

  // Take the union of all the out sets.
  return outs.slice(1).reduce(mapUnion, outs[0]);
}

/**
 * Take the union of two alias maps.
 *
 * @param map1 – The first alias map.
 * @param map2 – The second alias map.
 * @returns – The union of the two alias maps.
 */
function mapUnion(map1: AliasMap, map2: AliasMap): AliasMap {
  // Initialize the result to a copy of the first map.
  const result = new Map<string, Set<MemoryLocation>>(map1);

  // Iterate through elements of the second map.
  for (const [defn, locs] of map2) {
    // If the defn is not in the first map, add its Set of memory locations to
    // the result.
    if (!result.has(defn)) {
      result.set(defn, new Set(locs));
    } else {
      // Otherwise, add each memory location to the Set of existing memory loc-
      // ations for that defn.
      for (const loc of locs) {
        result.get(defn)!.add(loc);
      }
    }
  }

  return result;
}

/**
 * The transfer function for the alias analysis.
 *
 * 1. For "alloc" instructions, we add the position of the instruction to the set
 *    of memory locations for the destination variable.
 * 2. For "id" and "ptradd" instructions, we take the union of existing the mem-
 *    ory locations for the destination variable and the operand.
 * 3. For "load" instructions, we set the memory locations for the destination
 *    to the set of all possible memory locations.
 *
 * @param block – The basic block to analyze.
 * @param inMap – The in set for the block.
 * @param memoryLocations – The set of all possible memory locations.
 * @returns – The out set for the block.
 */
function transfer(
  block: BasicBlock,
  inMap: AliasMap,
  memoryLocations: Set<MemoryLocation>
): AliasMap {
  // Initialize the out set to the in set.
  const out = new Map(inMap);

  for (const instr of block.instrs) {
    if ("dest" in instr) {
      switch (instr.op) {
        case "alloc":
          out.set(
            instr.dest,
            out.get(instr.dest)?.add(instr.pos?.row) ??
              new Set<MemoryLocation>([instr.pos?.row])
          );
          break;
        case "id":
        case "ptradd": {
          const operand = instr.args[0];
          const operandLocs = out.get(operand) ?? new Set<MemoryLocation>();
          const currentLocs = out.get(instr.dest) ?? new Set<MemoryLocation>();

          out.set(instr.dest, new Set([...operandLocs, ...currentLocs]));
          break;
        }
        case "load":
          out.set(instr.dest, new Set(memoryLocations));
          break;
        default:
          break;
      }
    }
  }

  return out;
}
