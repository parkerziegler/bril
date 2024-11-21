import { flow } from "lodash-es";

import { createBasicBlocks } from "./blocks.js";
import * as bril from "./bril";
import { createCFG } from "./cfg.js";
import { aliasAnalysis } from "./alias.js";

export function deadStoreElimination(program: bril.Program) {
  const fns = program.functions.flatMap((fn) => {
    const cfg = flow(createBasicBlocks, createCFG)(fn);
    const analysis = aliasAnalysis(cfg, fn.args);

    const liveStores = new Map<number, Set<string>>();

    const dseBlocks = cfg.map((block) => {
      const instrs: (bril.Instruction | bril.Label)[] = [];

      for (let i = block.instrs.length - 1; i >= 0; i--) {
        const instr = block.instrs[i];

        if ("op" in instr && instr.op === "store") {
          const [ptr] = instr.args;

          // Identify all memory locations associated with the pointer.
          const locs = analysis.get(block.id)!.get(ptr) ?? new Set();

          let isDead = true;

          for (const loc of locs) {
            // If we have not yet seen this memory location stored to, mark it
            // as live.
            if (!liveStores.has(loc) || liveStores.get(loc)!.size === 0) {
              isDead = false;
              break;
              // If we have seen this memory location stored to, but the current
              // store is to an alias, mark it as live.
            } else if (liveStores.has(loc) && !liveStores.get(loc)!.has(ptr)) {
              isDead = false;
              break;
            }
          }

          if (!isDead) {
            // Add this store to the live stores.
            for (const loc of locs) {
              if (!liveStores.has(loc)) {
                liveStores.set(loc, new Set());
              }
              liveStores.get(loc)!.add(ptr);
            }
            instrs.unshift(instr);
          }

          // Finally, reset the isDead flag.
          isDead = undefined;
        } else if ("op" in instr && instr.op === "load") {
          const [ptr] = instr.args;

          // Identify all memory locations associated with the pointer.
          const locs = analysis.get(block.id)!.get(ptr) ?? new Set();

          for (const loc of locs) {
            liveStores.delete(loc);
          }

          instrs.unshift(instr);
        } else {
          instrs.unshift(instr);
        }
      }

      return {
        ...block,
        instrs,
      };
    });

    return {
      ...fn,
      instrs: dseBlocks.flatMap((block) => block.instrs),
    };
  });

  return {
    ...program,
    functions: fns,
  };
}
