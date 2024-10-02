import * as bril from "./bril";

export type Optimization = (program: bril.Program) => bril.Program;
