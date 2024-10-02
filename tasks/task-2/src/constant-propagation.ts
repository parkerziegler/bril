import flow from "lodash.flow";
import isEqual from "lodash.isequal";

import { BasicBlock, createBasicBlocks } from "./blocks.js";
import * as bril from "./bril";
import { createCFG, findBlockByLabel } from "./cfg.js";

type DefinitionsMap = Map<string, bril.Value>;

export function constantPropagationAndFolding(
  program: bril.Program
): bril.Program {
  const fns = program.functions.flatMap((fn) => {
    const blocks = flow(createBasicBlocks, createCFG)(fn);
    const analysis = constantPropagationAnalysis(blocks);

    // Iterate through each block and evaluate any expressions involving con-
    // stant assignments.
    const constantFoldedBlocks = blocks.map((block) => {
      const outSet = analysis.get(block.id)!;
      const instrs = block.instrs.map((instr) => {
        if ("op" in instr) {
          switch (instr.op) {
            case "add": {
              if (areAllArgsNumericAndInOutSet(instr.args, outSet)) {
                const result = instr.args.reduce(
                  (sum, arg) => sum + +outSet.get(arg)!,
                  0
                );

                return {
                  op: "const" as const,
                  dest: instr.dest,
                  type: instr.type,
                  value: result,
                  pos: instr.pos,
                };
              }

              return instr;
            }
            case "sub": {
              if (areAllArgsNumericAndInOutSet(instr.args, outSet)) {
                const result = instr.args
                  .slice(1)
                  .reduce(
                    (diff, arg) => diff - +outSet.get(arg),
                    +outSet.get(instr.args[0])!
                  );

                return {
                  op: "const" as const,
                  dest: instr.dest,
                  type: instr.type,
                  value: result,
                  pos: instr.pos,
                };
              }

              return instr;
            }
            case "mul": {
              if (areAllArgsNumericAndInOutSet(instr.args, outSet)) {
                const result = instr.args.reduce(
                  (product, arg) => product * +outSet.get(arg)!,
                  1
                );

                return {
                  op: "const" as const,
                  dest: instr.dest,
                  type: instr.type,
                  value: result,
                  pos: instr.pos,
                };
              }

              return instr;
            }
            case "div": {
              if (
                areAllArgsNumericAndInOutSet(instr.args, outSet) &&
                instr.args[1] !== "0"
              ) {
                const result = instr.args.reduce(
                  (quotient, arg) => quotient / +outSet.get(arg)!,
                  1
                );

                return {
                  op: "const" as const,
                  dest: instr.dest,
                  type: instr.type,
                  value: result,
                  pos: instr.pos,
                };
              }

              return instr;
            }
            case "and": {
              if (areAllArgsBooleanAndInOutSet(instr.args, outSet)) {
                const result =
                  outSet.get(instr.args[0]) && outSet.get(instr.args[1]);

                return {
                  op: "const" as const,
                  dest: instr.dest,
                  type: instr.type,
                  value: result,
                  pos: instr.pos,
                };
              }

              return instr;
            }
            case "or": {
              if (areAllArgsBooleanAndInOutSet(instr.args, outSet)) {
                const result =
                  outSet.get(instr.args[0]) || outSet.get(instr.args[1]);

                return {
                  op: "const" as const,
                  dest: instr.dest,
                  type: instr.type,
                  value: result,
                  pos: instr.pos,
                };
              }

              return instr;
            }
            case "br": {
              const conditionalValue = outSet.get(instr.args[0]);
              if (typeof conditionalValue !== "undefined") {
                const targetLabel = conditionalValue
                  ? instr.labels[0]
                  : instr.labels[1];
                eliminateBranch(block, blocks, targetLabel);

                return {
                  op: "jmp" as const,
                  labels: [targetLabel],
                  pos: instr.pos,
                };
              }

              return instr;
            }
            default:
              return instr;
          }
        }

        return instr;
      });

      return {
        ...block,
        instrs,
      };
    });

    return {
      ...fn,
      instrs: constantFoldedBlocks
        .filter((block) =>
          block.id === 0 ? true : block.predecessors.size > 0
        )
        .flatMap((block) => block.instrs),
    };
  });

  return {
    ...program,
    functions: fns,
  };
}

function areAllArgsNumericAndInOutSet(args: string[], outSet: DefinitionsMap) {
  return args.every(
    (arg) => outSet.has(arg) && !isNaN(Number(outSet.get(arg)))
  );
}

function areAllArgsBooleanAndInOutSet(args: string[], outSet: DefinitionsMap) {
  return args.every(
    (arg) => outSet.has(arg) && typeof outSet.get(arg) === "boolean"
  );
}

function eliminateBranch(
  block: BasicBlock,
  blocks: BasicBlock[],
  targetLabel: string
) {
  // Save off the previous successors.
  const prevSuccessors = block.successors;

  // Find the target block.
  const takenBlock = findBlockByLabel(blocks, targetLabel);

  if (takenBlock) {
    block.successors = new Set([takenBlock.id]);
    takenBlock.predecessors = takenBlock.predecessors.add(block.id);
  }

  // Find the untaken successor.
  const successors = blocks.filter((b) => prevSuccessors.has(b.id));
  const untakenSuccessor = successors.find((s) => s.id !== takenBlock.id);

  // Remove this block as a predecessor of the untaken block.
  if (untakenSuccessor) {
    untakenSuccessor.predecessors.delete(block.id);
  }
}

function constantPropagationAnalysis(
  blocks: BasicBlock[]
): Map<number, DefinitionsMap> {
  const outSets = new Map<number, DefinitionsMap>();

  // Create the worklist to process basic blocks.
  const worklist = [...blocks].reverse();

  while (worklist.length > 0) {
    // Obtain the top of the worklist stack.
    const currBlock = worklist.pop()!;

    // Identify the predecessors of the current block.
    const predecessors = blocks.filter((block) =>
      currBlock.predecessors.has(block.id)
    );

    // Calculate the in map of the current block. This is the meet of the out
    // sets of all predecessors.
    const predecessorOutSets = predecessors.map(
      (block) => outSets.get(block.id) ?? new Map<string, bril.Value>()
    );
    const inSet = meet(predecessorOutSets);

    // Calculate the out set of the current block. This is the transfer func-
    // tion applied to the in set.
    const outSet = transfer(currBlock, inSet);

    // If the out set for the current block has changed, update our outSets
    // Map.
    const prevOutSet = outSets.get(currBlock.id)!;

    if (!isEqual(outSet, prevOutSet)) {
      outSets.set(currBlock.id, outSet);

      // Add the successors of the current block to the worklist.
      const successors = blocks.filter((block) =>
        currBlock.successors.has(block.id)
      );

      worklist.push(...successors);
    }
  }

  return outSets;
}

function transfer(
  block: BasicBlock,
  inMap: Map<string, bril.Value>
): Map<string, bril.Value> {
  // Initialize the out set to the in set.
  const out = new Map(inMap);

  for (const instr of block.instrs) {
    if ("dest" in instr && instr.op === "const") {
      out.set(instr.dest, instr.value);
    } else if ("dest" in instr) {
      out.delete(instr.dest);
    }
  }

  return out;
}

function mapIntersection(
  map1: Map<string, bril.Value>,
  map2: Map<string, bril.Value>
): Map<string, bril.Value> {
  const result = new Map<string, bril.Value>();

  for (const [key, value] of map1) {
    if (map2.has(key) && map2.get(key) === value) {
      result.set(key, value);
    }
  }

  return result;
}

function meet(outs: Map<string, bril.Value>[]): Map<string, bril.Value> {
  if (outs.length === 0) {
    return new Map<string, bril.Value>();
  }

  return outs.slice(1).reduce(mapIntersection, outs[0]);
}
