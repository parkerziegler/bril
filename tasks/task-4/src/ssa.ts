import { intersection, flow } from "lodash-es";

import { createBasicBlocks, type BasicBlock } from "./blocks.js";
import * as bril from "./bril";
import { createCFG } from "./cfg.js";

/**
 * Represents the dominance relation. Each key is a block ID, and the value is
 * the set of blocks that dominate that block.
 */
export type DomRelation = Map<number, Set<number>>;

/**
 * Compute the dominance relation for a control flow graph.
 *
 * @param cfg – The control flow graph.
 * @returns – The dominance relation.
 */
export function computeDominanceRelation(cfg: BasicBlock[]): DomRelation {
  const doms = new Map<number, Set<number>>();

  // Initialize dominators for each block. We'll start with the assumption that
  // every block dominates every other block and iteratively whittle down this
  // set as we process a block. The only exception is the entry block, which
  // we know only dominates itself.
  cfg.forEach((block, i) => {
    if (i === 0) {
      doms.set(block.id, new Set([block.id]));
    } else {
      doms.set(block.id, new Set(cfg.map((block) => block.id)));
    }
  });

  // Iteratively compute dominators to a fixpoint.
  let changed = true;
  while (changed) {
    changed = false;

    cfg.slice(1).forEach((block) => {
      const updatedDoms = new Set([block.id]);

      // Intersect the dominators of all of this block's predecessors. If a
      // block dominates _all_ of this block's predecessors, then it must
      // dominate this block as well.
      //
      // First, get the dominators of all predecessors, represented as a
      // number[][].
      const allPredecessorDoms = Array.from(block.predecessors).map((pred) =>
        Array.from(doms.get(pred)!)
      );

      // Take the intersection of all predecessor dominators.
      const predecessorDoms = intersection(...allPredecessorDoms);

      // Add these predecessors to the updated dominators.
      predecessorDoms.forEach((dom) => updatedDoms.add(dom));

      // Check if the dominators changed.
      const currentDoms = doms.get(block.id)!;
      if (
        updatedDoms.size !== currentDoms.size ||
        !Array.from(updatedDoms).every((dom) => currentDoms.has(dom))
      ) {
        doms.set(block.id, updatedDoms);
        changed = true;
      }
    });
  }

  return doms;
}

/**
 * Represents a dominance tree. Each key is a block ID, and the value is its
 * immediate dominator.
 */
type DomTree = Map<number, number>;

/**
 * Build the dominance tree from the dominance relation.
 *
 * @param cfg – The control flow graph.
 * @param doms – The dominance relation.
 * @returns – The dominance tree.
 */
export function computeDominanceTree(
  cfg: BasicBlock[],
  doms: DomRelation
): DomTree {
  const immediateDoms = new Map<number, number>();

  cfg.forEach((block) => {
    const blockDoms = doms.get(block.id)!;

    const immediateDom = Array.from(blockDoms)
      .filter((dom) => dom !== block.id) // The immediate dominator cannot be the block itself.
      .find((dom) => {
        // Get the dominators of this dominator.
        const dDoms = doms.get(dom)!;

        // Now, for each of these dominators, check that they dominate all of
        // the block's dominators except for the block itself and the dominator
        // we're considering.
        return Array.from(blockDoms)
          .filter((x) => x !== block.id && x !== dom)
          .every((x) => dDoms.has(x));
      });

    if (immediateDom !== undefined) {
      immediateDoms.set(block.id, immediateDom);
    }
  });

  return immediateDoms;
}

/**
 * Represents a dominance frontier map. Each key is a block ID, and the value is
 * the set of blocks in its dominance frontier.
 */
type DomFrontiers = Map<number, Set<number>>;

/**
 * Compute the dominance frontiers for a control flow graph using the dominance
 * tree.
 *
 * @param cfg – The control flow graph.
 * @param domTree – The dominance tree.
 * @returns – The map of dominance frontiers.
 */
function computeDominanceFrontiers(
  cfg: BasicBlock[],
  domTree: DomTree
): DomFrontiers {
  const frontiers = new Map<number, Set<number>>();

  // Initialize empty frontiers for all blocks.
  cfg.forEach((block) => {
    frontiers.set(block.id, new Set());
  });

  // Compute the dominance frontier for each block. We're primarily interested
  // in instances where a block has multiple predecessors, since these _could_
  // correspond to cases where ɸ-functions need to be placed.
  //
  // Start by walking up the dominance tree for each predecessor of the block
  // until we hit the block's immediate dominator. Along the way, add the block
  // to the dominance frontier of each block we visit.
  cfg.forEach((block) => {
    if (block.predecessors.size >= 2) {
      block.predecessors.forEach((pred) => {
        let runner = pred;

        while (runner !== domTree.get(block.id)!) {
          // Add the block to this node's dominance frontier.
          frontiers.get(runner)!.add(block.id);

          // Set the active node to the immediate dominator of the current node.
          runner = domTree.get(runner)!;
        }
      });
    }
  });

  return frontiers;
}

/**
 * Represents the mapping of definitions to the set of basic blocks in which
 * they are defined.
 */
type Defns = Map<string, Set<number>>;

/**
 * Build a mapping of variable definitions to the set of basic blocks in which
 * they are defined.
 *
 * @param cfg – The control flow graph.
 * @returns – A mapping of variable definitions to the set of basic blocks in
 * which they are defined.
 */
function findVariableDefinitions(cfg: BasicBlock[]): Defns {
  const defns = new Map<string, Set<number>>();

  for (const block of cfg) {
    for (const instr of block.instrs) {
      if ("dest" in instr) {
        if (!defns.has(instr.dest)) {
          defns.set(instr.dest, new Set());
        }
        defns.get(instr.dest)!.add(block.id);
      }
    }
  }

  return defns;
}

/**
 * Represents the mapping of variable definitions to their static types.
 */
type DefnTypes = Map<string, bril.Type>;

/**
 * Build a mapping of variable definitions to their static types.
 *
 * @param cfg - The control flow graph.
 * @returns - A mapping of variable definitions to their static types.
 */
function findVariableDefinitionTypes(cfg: BasicBlock[]): DefnTypes {
  const defnTypes = new Map<string, bril.Type>();

  for (const block of cfg) {
    for (const instr of block.instrs) {
      if ("dest" in instr) {
        if (
          defnTypes.has(instr.dest) &&
          defnTypes.get(instr.dest) !== instr.type
        ) {
          console.warn(
            "Found variable types for dest: ",
            instr.dest,
            ". A previous type was found: ",
            defnTypes.get(instr.dest),
            ". New type: ",
            instr.type
          );
        }

        defnTypes.set(instr.dest, instr.type);
      }
    }
  }

  return defnTypes;
}

/**
 * Place φ-functions in the control flow graph to support conversion to SSA.
 *
 * @param cfg – The control flow graph.
 * @param domFrontiers – The map of dominance frontiers.
 * @param defns – The map of variable definitions to the set of basic blocks in
 * which they are defined.
 * @param defnTypes – The map of variable definitions to static types.
 * @returns – An updated control flow graph with φ-functions inserted.
 */
function placePhiFunctions(
  cfg: BasicBlock[],
  domFrontiers: DomFrontiers,
  defns: Defns,
  defnTypes: DefnTypes
): BasicBlock[] {
  const updatedCfg = [...cfg];

  // If the first block in the CFG does not have a label, insert one. Our SSA
  // form requires defined labels for all phi functions. If a value from the
  // first block is later used in its phi, we need a label for the block.
  if (!("label" in updatedCfg[0].instrs[0])) {
    updatedCfg[0].instrs.unshift({ label: "b1" });
  }

  for (const [defn, defnBlocks] of defns.entries()) {
    const phiBlocks = new Set<number>();
    const worklist = Array.from(defnBlocks);

    // Find the blocks that need φ-functions inserted.
    while (worklist.length > 0) {
      const block = worklist.pop()!;
      const frontier = domFrontiers.get(block)!;

      // For every block in the dominance frontier, insert a φ-function at the
      // start of the block.
      for (const frontierBlockId of frontier) {
        if (!phiBlocks.has(frontierBlockId)) {
          phiBlocks.add(frontierBlockId);

          // Find the frontier block in the CFG.
          const frontierBlock = updatedCfg.find(
            (block) => block.id === frontierBlockId
          );

          // Insert a φ-function at start of block.
          const phiInstr: bril.Instruction = {
            op: "phi",
            dest: defn,
            labels: Array.from(frontierBlock.predecessors).map((id) => {
              const pred = updatedCfg.find((block) => block.id === id)!;
              const firstInstr = pred.instrs[0];

              return "label" in firstInstr ? firstInstr.label : "b1";
            }),
            args: Array.from(frontierBlock.predecessors).map(() => defn),
            type: defnTypes.get(defn) ?? "int",
          };

          // Find position after labels.
          const labelEnd = frontierBlock.instrs.findIndex(
            (i) => !("label" in i)
          );

          frontierBlock.instrs.splice(
            labelEnd === -1 ? 0 : labelEnd,
            0,
            phiInstr
          );

          if (!defnBlocks.has(frontierBlockId)) {
            worklist.push(frontierBlockId);
          }
        }
      }
    }
  }

  return updatedCfg;
}

/**
 * Perform renaming of variables in the control flow graph to convert it to SSA.
 *
 * @param cfg – The control flow graph.
 * @param domTree — The dominance tree.
 * @param args — Arguments to the top-level bril Function.
 * @returns — The control flow graph in SSA form.
 */
function renameVariables(
  cfg: BasicBlock[],
  domTree: DomTree,
  args: bril.Argument[] = []
): BasicBlock[] {
  const updatedCfg = [...cfg];
  const stacks = new Map<string, string[]>();
  const counter = new Map<string, number>();

  // Add function arguments to the stack.
  for (const arg of args) {
    stacks.set(arg.name, [arg.name]);
  }

  // Define a function for generating new subscripted names for variables.
  function generateNewName(base: string): string {
    const count = (counter.get(base) ?? -1) + 1;
    counter.set(base, count);
    return `${base}.${count}`;
  }

  function rename(blockId: number) {
    const block = updatedCfg.find((block) => block.id === blockId)!;

    // Process remaining instructions.
    for (const instr of block.instrs) {
      // Update uses of a variable. If a use corresponds to a renamed var-
      // iable, grab the most recent name from the stack.
      if ("args" in instr) {
        instr.args = instr.args.map((arg) => {
          const stack = stacks.get(arg);
          return stack?.length > 0 ? stack[stack.length - 1] : arg;
        });
      }

      // Update definitions of variables in the same way as we update
      // φ-functions.
      if ("dest" in instr) {
        const newName = generateNewName(instr.dest);
        if (!stacks.has(instr.dest)) {
          stacks.set(instr.dest, []);
        }
        stacks.get(instr.dest)!.push(newName);
        instr.dest = newName;
      }
    }

    // Process successors' φ-functions.
    for (const succ of block.successors) {
      const succBlock = updatedCfg.find((block) => block.id === succ)!;

      // Find φ-functions in the successor block.
      const phiInstructions = succBlock.instrs.filter(
        (i) => "op" in i && i.op === "phi"
      ) as bril.Operation[];

      for (const phi of phiInstructions) {
        const predIndex = Array.from(succBlock.predecessors).indexOf(blockId);

        if (predIndex !== -1 && phi.args) {
          const base = phi.args[predIndex].includes(".")
            ? phi.args[predIndex].substring(
                0,
                phi.args[predIndex].lastIndexOf(".")
              )
            : phi.args[predIndex];
          const stack = stacks.get(base);
          if (stack && stack.length > 0) {
            phi.args[predIndex] = stack[stack.length - 1];
          } else {
            phi.args[predIndex] = "__undefined";
          }
        }
      }
    }

    // Recursively process dominated blocks.
    for (const [node, idom] of domTree.entries()) {
      if (idom === blockId) {
        rename(node);
      }
    }

    // Pop stacks for variables defined in this block.
    for (const instr of block.instrs) {
      if ("dest" in instr) {
        const base = instr.dest.includes(".")
          ? instr.dest.substring(0, instr.dest.lastIndexOf("."))
          : instr.dest;
        const stack = stacks.get(base);

        if (stack) {
          stack.pop();
        }
      }
    }
  }

  // Start renaming from entry block
  rename(0);

  return updatedCfg;
}

/**
 * Transform a Bril IR into SSA form.
 *
 * @param program – The Bril IR in non-SSA form.
 * @returns – The Bril IR in SSA form.
 */
export function toSSA(program: bril.Program): bril.Program {
  const fns = program.functions.flatMap((fn) => {
    // First, create basic blocks and the control flow graph.
    const cfg = flow(createBasicBlocks, createCFG)(fn);

    // Compute the dominance relation.
    const doms = computeDominanceRelation(cfg);

    // Compute the dominance tree.
    const domTree = computeDominanceTree(cfg, doms);

    // Compute dominance frontiers.
    const frontiers = computeDominanceFrontiers(cfg, domTree);

    // Find variable definitions and their static types.
    const defns = findVariableDefinitions(cfg);
    const defnTypes = findVariableDefinitionTypes(cfg);

    // Place φ-functions in the control flow graph.
    const phiCfg = placePhiFunctions(cfg, frontiers, defns, defnTypes);

    // Rename variables in the control flow graph.
    const ssaCfg = renameVariables(phiCfg, domTree, fn.args);

    return {
      ...fn,
      instrs: ssaCfg.flatMap((block) => block.instrs),
    };
  });

  return {
    ...program,
    functions: fns,
  };
}
