import readline from "node:readline/promises";

import * as bril from "./bril";
import { deadStoreElimination } from "./dse.js";
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
    const optimizationFn = deadStoreElimination;
    const output = optimizationFn(ssaProgram);

    process.stdout.write(JSON.stringify(output));
  } catch (err) {
    console.error(err);
  } finally {
    rl.close();
  }
}

main();
