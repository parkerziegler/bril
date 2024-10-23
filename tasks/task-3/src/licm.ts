import { flow } from "lodash-es";

import { createBasicBlocks, type BasicBlock } from "./blocks.js";
import type * as bril from "./bril";
import { createCFG } from "./cfg.js";
import { computeDominanceRelation, type DomRelation } from "./ssa.js";

/**
 * Find back edges in a control flow graph. A backedge is defined as an edge B →
 * A where A dominates B.
 *
 * @param cfg – The control flow graph.
 * @param domRelation – The dominance relation.
 * @returns – The array of identified back edges.
 */
function findBackEdges(
  cfg: BasicBlock[],
  domRelation: DomRelation
): [number, number][] {
  const backEdges = cfg.reduce((acc, block) => {
    block.successors.forEach((successor) => {
      if (domRelation.get(block.id)?.has(successor)) {
        acc.push([block.id, successor]);
      }
    });
    return acc;
  }, []);

  return backEdges;
}

/**
 * Represents a natural loop in a control flow graph.
 */
interface NaturalLoop {
  header: number;
  blocks: Set<number>;
}

/**
 * Find the natural loops in a control flow graph.
 *
 * @param cfg – The control flow graph.
 * @param backEdges – The back edges to find natural loop for.
 * @returns – The natural loops in the control flow graph.
 */
function findNaturalLoops(
  cfg: BasicBlock[],
  backEdges: [number, number][]
): NaturalLoop[] {
  const naturalLoops: NaturalLoop[] = backEdges.map((backEdge) => {
    const [from, to] = backEdge;
    const loop: NaturalLoop = {
      header: to,
      blocks: new Set([from, to]),
    };

    const worklist: number[] = [from];
    while (worklist.length > 0) {
      const node = worklist.pop()!;
      const predecessors = cfg.find((block) => block.id === node)!.predecessors;

      for (const predecessor of predecessors) {
        if (!loop.blocks.has(predecessor)) {
          loop.blocks.add(predecessor);
          worklist.push(predecessor);
        }
      }
    }

    return loop;
  });

  return naturalLoops;
}

/**
 * Find the preheader for a given natural loop in a control flow graph.
 *
 * @param cfg – The control flow graph.
 * @param loop – The natural loop to find the preheader for.
 * @returns – The id of the preheader block and the updated control flow graph.
 */
function findLoopPreheader(
  cfg: BasicBlock[],
  loop: NaturalLoop
): number | null {
  // Find the header block for the loop.
  const header = cfg.find((block) => block.id === loop.header)!;

  const externalPreds = Array.from(header.predecessors).filter(
    (pred) => !loop.blocks.has(pred)
  );

  // If the header has exactly one predecessor that is not in the loop, we can
  // potentially use it as a preheader.
  if (externalPreds.length === 1) {
    const potentialPreheader = cfg.find(
      (block) => block.id === externalPreds[0]
    )!;

    // Now, check that the preheader has only one successor and that it is the
    // loop header. If it has multiple successors, it may not be safe to move
    // code in here.
    if (
      potentialPreheader.successors.size === 1 &&
      potentialPreheader.successors.has(loop.header)
    ) {
      return potentialPreheader.id;
    }
  }

  // If we cannot identify an existing block as a preheader, just nope out.
  return null;
}

/**
 * Check if a given instruction is effectful.
 *
 * @param instr – The instruction to test.
 * @returns — A Boolean flag indicating whether or not the given instruction is
 * effectful.
 */
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

/**
 * Check if an instruction is loop invariant.
 *
 * @param instr – The instruction to test.
 * @param loopBlocks – The blocks in the loop.
 * @param cfg – The control flow graph.
 * @returns – A Boolean flag indicating whether or not the instruction is loop
 * invariant.
 */
function isLoopInvariant(
  instr: bril.Instruction,
  loopBlocks: Set<number>,
  cfg: BasicBlock[]
): boolean {
  // If the instruction has side effects, it is not loop invariant. While this
  // is not _strictly_ true, we're taking a sound approach rather than opting
  // for a more sensitive analysis with loop peeling.
  if (isSideEffectInstruction(instr)) {
    return false;
  }

  // Do not move phi-functions.
  if (instr.op === "phi") {
    return false;
  }

  // Move constants.
  if (instr.op === "const") {
    return true;
  }

  // For all instructions with arguments, check if they are either:
  //  1. Defined outside the loop.
  //  2. Defined inside the loop but are themselves loop invariant.
  if ("args" in instr) {
    return instr.args.every((arg) =>
      isOperandLoopInvariant(arg, loopBlocks, cfg)
    );
  }

  return false;
}

/**
 * Determine if an operand of an instruction is loop invariant.
 *
 * @param operand – The operand to test.
 * @param loopBlocks – The set of basic blocks within the loop.
 * @param cfg – The control flow graph.
 * @returns – A Boolean flag indicating whether or not the operand is loop in-
 * variant.
 */
function isOperandLoopInvariant(
  operand: string,
  loopBlocks: Set<number>,
  cfg: BasicBlock[]
): boolean {
  // Check if the operand is defined outside the loop.
  for (const block of cfg) {
    if (!loopBlocks.has(block.id)) {
      for (const instr of block.instrs) {
        if ("dest" in instr && instr.dest === operand) {
          return true;
        }
      }
    }
  }

  // If the operand is defined inside the loop, check if its defining
  // instruction is loop-invariant.
  for (const block of cfg) {
    if (loopBlocks.has(block.id)) {
      for (const instr of block.instrs) {
        if ("dest" in instr && instr.dest === operand && instr.op !== "phi") {
          return isLoopInvariant(instr, loopBlocks, cfg);
        }
      }
    }
  }

  // If we can't find the definition, assume it's not loop-invariant.
  return false;
}

/**
 * Move loop invariant code into the preheader basic block.
 *
 * @param instr – The loop invariant instruction to move.
 * @param blockId – The id of the basic block _from which_ to move loop in-
 * variant instructions.
 * @param preheaderId – The id of the preheader basic block _to which_ we'll
 * move invariant instructions.
 * @param cfg – The control flow graph.
 * @returns – The control flow graph with loop invariant code moved.
 */
function moveInvariantComputation(
  instr: bril.Instruction,
  blockId: number,
  preheaderId: number,
  cfg: BasicBlock[]
): BasicBlock[] {
  // Remove the instruction from the original block.
  const block = cfg.find((block) => block.id === blockId)!;
  block.instrs = block.instrs.filter((i) => i !== instr);

  // Locate the preheader block.
  const preheaderBlock = cfg.find((block) => block.id === preheaderId)!;

  // Add the instruction to the end of the preheader block directly before the
  // terminating instruction.
  const loc = preheaderBlock.instrs.findLastIndex(
    (i) => "op" in i && ["jmp", "ret", "br"].includes(i.op)
  );
  preheaderBlock.instrs.splice(loc === -1 ? 0 : loc, 0, instr);

  return cfg;
}

/**
 * Perform loop invariant code motion on a Bril program. This function assumes
 * that the input program is in SSA form.
 *
 * @param program – The input Bril program, in SSA form.
 * @returns – The optimized Bril program.
 */
export function licm(program: bril.Program): bril.Program {
  const fns = program.functions.flatMap((fn) => {
    let cfg = flow(createBasicBlocks, createCFG)(fn);

    // Compute the dominance relation for the control flow graph.
    const domRelation = computeDominanceRelation(cfg);

    // Identify back edges in the control flow graph.
    const backEdges = findBackEdges(cfg, domRelation);

    // Find natural loops in the control flow graph.
    const naturalLoops = findNaturalLoops(cfg, backEdges);

    naturalLoops.forEach((loop) => {
      // For each natural loop, find its preheader block—this will become the
      // target location for moving invariant code.
      const preheaderId = findLoopPreheader(cfg, loop);

      if (preheaderId === null) {
        return;
      }

      // Collect all instructions in the loop.
      let changed = true;

      while (changed) {
        changed = false;

        loop.blocks.forEach((blockId) => {
          const block = cfg.find((block) => block.id === blockId)!;

          block.instrs.forEach((instr) => {
            if ("op" in instr && isLoopInvariant(instr, loop.blocks, cfg)) {
              changed = true;
              cfg = moveInvariantComputation(instr, blockId, preheaderId, cfg);
            }
          });
        });
      }
    });

    return {
      ...fn,
      instrs: cfg.flatMap((block) => block.instrs),
    };
  });

  return {
    ...program,
    functions: fns,
  };
}
