import readline from "node:readline/promises";

import flow from "lodash.flow";

import * as bril from "./bril";
import { constantPropagationAndFolding } from "./constant-propagation.js";
import { dce } from "./liveness.js";
import { toFixpoint } from "./fixpoint.js";

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
    const optimizationFn = toFixpoint(flow(constantPropagationAndFolding, dce));
    const output = optimizationFn(program);

    process.stdout.write(JSON.stringify(output));
  } catch (err) {
    console.error(err);
  } finally {
    rl.close();
  }
}

main();
