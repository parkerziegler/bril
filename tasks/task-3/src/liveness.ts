import { isEqual } from "lodash-es";

import * as bril from "./bril";
import { createBasicBlocks, type BasicBlock } from "./blocks.js";
import { createCFG } from "./cfg.js";

export function dce(program: bril.Program): bril.Program {
  const fns = program.functions.flatMap((fn) => {
    const blocks = createBasicBlocks(fn);
    const cfg = createCFG(blocks);
    const analysis = livenessAnalysis(cfg);

    let changed: boolean;

    do {
      changed = false;

      // Identify the initial set of live instructions. This includes all
      // effectful instructions and any instructions that are live out of the
      // block.
      const liveInstrs = identifyInitialLiveInstructions(
        blocks,
        analysis.outSets
      );

      let prevSize: number;

      do {
        prevSize = liveInstrs.size;

        // Expand the live instructions set to include any instructions that
        // introduce new variables that are used in live instructions.
        for (const block of blocks) {
          for (const instr of block.instrs) {
            if (
              "op" in instr &&
              definesLiveVariable(instr, liveInstrs, analysis.outSets, block.id)
            ) {
              liveInstrs.add(instr);
            }
          }
        }
      } while (prevSize < liveInstrs.size);

      // Now, sweep any instructions that are not in liveInstrs.
      for (const block of blocks) {
        const instrs = block.instrs.filter(
          (instr) =>
            ("op" in instr && liveInstrs.has(instr)) || "label" in instr
        );

        if (instrs.length !== block.instrs.length) {
          changed = true;
          block.instrs = instrs;
        }
      }
    } while (changed);

    return {
      ...fn,
      instrs: blocks.flatMap((block) => block.instrs),
    };
  });

  return {
    ...program,
    functions: fns,
  };
}

function identifyInitialLiveInstructions(
  blocks: BasicBlock[],
  outSets: Map<number, Set<string>>
): Set<bril.Instruction> {
  const liveInstrs = new Set<bril.Instruction>();

  for (const block of blocks) {
    for (const instr of block.instrs) {
      const outSet = outSets.get(block.id)!;

      if (
        "op" in instr &&
        (isSideEffectInstruction(instr) || isLiveOutInstruction(instr, outSet))
      ) {
        liveInstrs.add(instr);
      }
    }
  }

  return liveInstrs;
}

function isSideEffectInstruction(instr: bril.Instruction): boolean {
  // These instruction op codes correspond to the EffectOperation type defined
  // in bril.ts.
  const effectOps = [
    "br",
    "jmp",
    "print",
    "ret",
    "call",
    "store",
    "free",
    "speculate",
    "guard",
    "commit",
  ];

  return effectOps.includes(instr.op);
}

function isLiveOutInstruction(
  instr: bril.Instruction,
  outSet: Set<string>
): boolean {
  return "dest" in instr && outSet.has(instr.dest);
}

function definesLiveVariable(
  instr: bril.Instruction,
  liveInstrs: Set<bril.Instruction>,
  outSets: Map<number, Set<string>>,
  blockId: number
): boolean {
  for (const liveInstr of liveInstrs) {
    // If the live instruction uses the variable defined by the current instruc-
    // tion, be sure to keep the current instruction.
    if (
      "args" in liveInstr &&
      "dest" in instr &&
      liveInstr.args.includes(instr.dest)
    ) {
      return true;
    }
  }

  // If the live instruction introduces a new variable that is live out of the
  // current block, be sure to keep the current instruction.
  if ("dest" in instr && outSets.get(blockId)!.has(instr.dest)) {
    return true;
  }

  return false;
}

export function livenessAnalysis(blocks: BasicBlock[]): {
  inSets: Map<number, Set<string>>;
  outSets: Map<number, Set<string>>;
} {
  const inSets = new Map<number, Set<string>>();
  const outSets = new Map<number, Set<string>>();

  // Create the worklist to process basic blocks.
  const worklist = [...blocks].reverse();

  while (worklist.length > 0) {
    // Obtain the top of the worklist stack.
    const currBlock = worklist.pop()!;

    // Identify the successors of the current block.
    const successors = blocks.filter((block) =>
      currBlock.successors.has(block.id)
    );

    // Calculate the out set of the current block. This is the meet of the in
    // sets of all successors.
    const successorInSets = successors.map(
      (block) => inSets.get(block.id) ?? new Set<string>()
    );
    const outSet = meet(successorInSets);
    outSets.set(currBlock.id, outSet);

    // Calculate the in set of the current block. This is the transfer func-
    // tion applied to the out set.
    const inSet = transfer(currBlock, outSet);

    // If the in set for the current block has changed, update our inSets map.
    const prevInSet = inSets.get(currBlock.id)!;

    if (!isEqual(inSet, prevInSet)) {
      inSets.set(currBlock.id, inSet);

      // Add the predecessors of the current block to the worklist.
      const predecessors = blocks.filter((block) =>
        currBlock.predecessors.has(block.id)
      );

      worklist.push(...predecessors);
    }
  }

  return { outSets, inSets };
}

function transfer(block: BasicBlock, outSet: Set<string>) {
  const inSet = new Set(outSet);
  const genSet = new Set<string>();
  const killSet = new Set<string>();
  const defined = new Set<string>();

  for (const instr of block.instrs) {
    // If the instruction introduces a new assignment, add it to the in set.
    if ("dest" in instr) {
      if (!defined.has(instr.dest)) {
        defined.add(instr.dest);
      }

      if (!killSet.has(instr.dest)) {
        killSet.add(instr.dest);
      }
    }

    // If the instruction uses a variable, add it to the gen set.
    if ("args" in instr) {
      for (const arg of instr.args) {
        if (!genSet.has(arg) && !defined.has(arg)) {
          genSet.add(arg);
        }
      }
    }
  }

  return setUnion(genSet, setDifference(inSet, killSet));
}

function setUnion(set1: Set<string>, set2: Set<string>): Set<string> {
  const result = new Set<string>(set1);

  for (const elem of set2) {
    result.add(elem);
  }

  return result;
}

function setDifference(set1: Set<string>, set2: Set<string>): Set<string> {
  const result = new Set<string>(set1);

  for (const elem of set2) {
    result.delete(elem);
  }

  return result;
}

function meet(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) {
    return new Set<string>();
  }

  return sets.slice(1).reduce(setUnion, sets[0]);
}
