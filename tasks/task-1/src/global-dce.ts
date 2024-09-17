import * as bril from "./bril";

/**
 * Run a single pass of dead code elimination on a Bril program.
 *
 * @param program – The input Bril program.
 * @returns – The Bril program, optimized by dead code elimination.
 */
export function globalDCE(program: bril.Program): bril.Program {
  const fns: bril.Function[] = program.functions.map((fn) => {
    const used = new Set<string>();
    const instrs: (bril.Instruction | bril.Label)[] = [];

    for (const instr of fn.instrs) {
      if ("args" in instr) {
        for (const arg of instr.args) {
          used.add(arg);
        }
      }
    }

    for (const instr of fn.instrs) {
      if ("dest" in instr && !used.has(instr.dest)) {
        used.delete(instr.dest);
      } else {
        instrs.push(instr);
      }
    }

    return {
      ...fn,
      instrs: Array.from(instrs),
    };
  });

  return {
    functions: fns,
  };
}
