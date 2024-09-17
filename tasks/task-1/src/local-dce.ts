import { createBasicBlocks } from "./blocks.js";
import * as bril from "./bril";

/**
 * Apply local dead code elimination to a Bril program.
 *
 * @param program – The input Bril program.
 * @returns – The Bril program, optimized by local dead code elimination.
 */
export function localDCE(program: bril.Program): bril.Program {
  const fns = program.functions.map((fn) => {
    const blocks = createBasicBlocks(fn);

    const bbs = blocks.flatMap((block) => {
      const unused = new Map<string, number>();
      const toDelete = new Set<number>();

      block.forEach((instr, i) => {
        // If a definition is used, remove it from the unused Map.
        if ("args" in instr) {
          for (const arg of instr.args) {
            unused.delete(arg);
          }
        }

        if ("dest" in instr) {
          // If the definition is used, but we've seen a definition for it before,
          // mark the previous definition for deletion.
          if (unused.has(instr.dest)) {
            toDelete.add(unused.get(instr.dest));
          }

          unused.set(instr.dest, i);
        }
      });

      return block.filter((_, i) => !toDelete.has(i));
    });

    return {
      ...fn,
      instrs: bbs,
    };
  });

  return {
    ...program,
    functions: fns,
  };
}
