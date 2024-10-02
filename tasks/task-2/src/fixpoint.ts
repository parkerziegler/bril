import isEqual from "lodash.isequal";

import * as bril from "./bril";
import type { Optimization } from "./types";

/**
 * Run an optimization on a Bril program until a fixpoint is reached.
 *
 * @param program – The input Bril program.
 * @param optimization – The optimization pass to apply.
 * @returns – The Bril program, optimized by the given optimization.
 */
export function toFixpoint(optimization: Optimization) {
  return function applyOptimization(program: bril.Program) {
    let currentProgram = program;
    let prevProgram: bril.Program = { functions: [] };

    while (!isEqual(currentProgram, prevProgram)) {
      prevProgram = currentProgram;
      currentProgram = optimization(currentProgram);
    }

    return currentProgram;
  };
}
