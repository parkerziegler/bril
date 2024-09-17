import { createBasicBlocks } from "./blocks.js";
import * as bril from "./bril";
import { lvn } from "./lvn.js";

export function cse(program: bril.Program) {
  const fns = program.functions.map((fn) => {
    const blocks = createBasicBlocks(fn);

    const bbs = blocks.flatMap((block) => {
      const lvnBlock = lvn(block);

      const replaceMap = new Map<string, string>();

      const cseBlock = lvnBlock.map((instr) => {
        // If the instruction is an id operation, add it to the replaceMap.
        // replaceMap maps the destination variable to the argument of the id // operation.
        if ("op" in instr && instr.op === "id") {
          const arg = instr.args?.[0] ?? "";

          if (arg) {
            replaceMap.set(instr.dest, arg);
          }
        }

        // Replace any uses of the destination variable with the argument of the
        // id operation.
        if ("args" in instr) {
          instr.args = instr.args.map((arg) => {
            return replaceMap.get(arg) ?? arg;
          });
        }

        return instr;
      });

      return cseBlock;
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
