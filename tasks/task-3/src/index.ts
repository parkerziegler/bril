import readline from "node:readline/promises";

import { flow } from "lodash-es";

import * as bril from "./bril";
import { toFixpoint } from "./fixpoint.js";
import { licm } from "./licm.js";
import { dce } from "./liveness.js";
import { toSSA } from "./ssa.js";

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let json = "";

  try {
    for await (const line of rl) {
      json += line;
    }

    const program = JSON.parse(json) as bril.Program;
    const ssaProgram = toSSA(program);
    const optimizationFn = flow(toFixpoint(dce), licm);
    const output = optimizationFn(ssaProgram);

    process.stdout.write(JSON.stringify(output));
  } catch (err) {
    console.error(err);
  } finally {
    rl.close();
  }
}

main();
