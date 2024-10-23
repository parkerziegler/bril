# Task 3

This directory contains my submission for [Task 3](https://github.com/mwillsey/cs265/blob/2024-fall/lessons/04-loops.md#task) of CS 265.

## Source code

The source for my submission lives at [tasks/task-3/src/index.ts](https://github.com/parkerziegler/bril/blob/main/tasks/task-3/src/index.ts). I chose to implement my optimizer in TypeScript. To run the optimizer using `brench`, you'll first have to compile the source to JavaScript. Run the following two commands from the `tasks/task-3` directory:

```sh
$ pnpm install
$ pnpm build
```

Together, these commands will install all necessary dependencies and invoke `tsc`, the TypeScript compiler. The compiled JavaScript will be written to `dist/index.js`.

## SSA Conversion

I implemented the conversion to SSA as part of this assignment. My implementation lives at [tasks/task-3/src/ssa.ts](https://github.com/parkerziegler/bril/blob/main/tasks/task-3/src/ssa.ts). My algorithm is more or less a direct translation of Cytron's algorithm. I did hit a few edge cases during implementation that I'll comment on below:

1. **`phi` instructions and labels.** One hiccup I initially hit occurred when an operand of a `phi` instruction came from an _unlabeled_ entry block. In this instance, the instruction would look something like `phi a.0 a.1 . .some-label`, which resulted in an error at runtime. In previous tasks, I never concerned myself with unlabeled basic blocks because I used block indices as their identifiers. To address this, I applied some preprocessing to my control flow graph to give every unlabeled basic block a label; typically this is just the first block.
2. **`phi` instructions and function arguments.** An additional hiccup I hit occurred when an operand of a `phi` instruction was an argument to the function. Initially, I was not tracking arguments on the stack during my `rename` procedure. This could result in instances where we'd grab the incorrect SSA'd name off the stack (if one existed) or erroneously inject `__undefined` when renaming `phi` arguments. I got around this by initializing the stack with function arguments during the `rename` procedure.

In general, my SSA conversion—even followed by my global DCE pass from Task 2—resulted in larger counts for total dynamic instructions.

## Loop Invariant Code Motion (LICM)

After implementing SSA, I moved on to implementing a conservative form of loop invariant code motion (LICM). Because SSA had taken me so long to sort out, I decided to take a very conservative—though sound—approach to this optimization. Specifically, I decided to avoid any loop normalization passes that involved altering the control flow graph. The data structure I'm using for the control flow graph (an `Array` of `Object`s implementing a `BasicBlock` `interface`) uses array indices as the initial block ids. As I started to embark down the path of control flow graph modifications, I quickly ran into cases where I needed to alter block ids in a way that no longer lined up with array indices. Heck! I was able to ameliorate this by _never_ identifying blocks by indexing into the `Array`, but the tangle of rewriting block predecessors and successors using numerical ids just got too tedious. By the time I realized I had a poor data structure in place, it felt too late.

So, I hard pivoted to another solution—just don't modify the control flow graph! While this meant I couldn't do things like insert a `latch` node or insert a new `preheader` node, it did not prohibit me from identifying existing nodes to use as loop preheaders. The function `findLoopPreheader` in [tasks/task-3/src/licm.ts](https://github.com/parkerziegler/bril/blob/main/tasks/task-3/src/licm.ts) shows how I identify existing nodes to use as preheader targets for loop invariant code. In addition to prohibiting insertion of new nodes, my decision to restrict control flow graph modification made conversion of `while` loops to `do-while` loops impossible. As a countermeasure to preserve correctness, I restrict my loop invariant code motion optimization from moving _any_ code that could have side effects. In the worst case, we may move side-effect-free code that technically _should never run_ to the loop preheader, but the observable behavior of the program remains unchanged.

## Results

To evaluate my optimization passes, I configured `brench` to run against the full set of `bril` benchmarks. For this task, I decided to use the SSA'd version of the program as the baseline and the SSA'd + dead code eliminated + loop invariant code motion-ed version of the program as the optimization. Given that the SSA'd version blows up the `total_dyn_inst` count, I wanted to really focus in on the speedups created by my DCE and LICM passes.

The results here were quite impressive! The mean reduction in total dynamic instructions was 22.5%, with a median reduction of 22.1% and a max reduction of 54.2% on the `dead-branch` benchmark. This made a fair bit of sense—this benchmark iterates a loop 100x and has four `const` instructions in the loop, all of which get moved into the first block (which we label as `.b1`); additionally, one instruction whose arguments are determined to be loop invariant also gets moved. Here's what the program looks like after our SSA, DCE, and LICM passes.

```
@main {
.b1:
  v1.0: int = const 1;
  v2.0: int = const 0;
  counter.0: int = const 0;
  v4.2: int = const 50; // Moved by LICM.
  v11.1: int = const 1; // Moved by LICM.
  v8.1: int = const 99; // Moved by LICM.
  v3.1: bool = eq v1.0 v2.0; // Moved by LICM.
  v4.3: int = const 100; // Moved by LICM.
  jmp .loop_start;
.loop_start:
  v4.0: int = phi __undefined v4.2 .b1 .else;
  counter.1: int = phi counter.0 counter.2 .b1 .else;
  v7.1: int = id counter.1;
  v9.1: bool = lt v7.1 v8.1;
  br v9.1 .loop_body .loop_end;
.loop_body:
  br v3.1 .then .else;
.then:
  print v4.3;
  jmp .else;
.else:
  v10.1: int = id counter.1;
  v12.1: int = add v10.1 v11.1;
  counter.2: int = id v12.1;
  jmp .loop_start;
.loop_end:
  print v4.0;
  ret;
}
```

The following figure shows the percent decrease in instructions for optimized programs, relative to a baseline that includes 100% of the original instructions from the SSA'd program. Using percent decrease helps to show the effect size of the optimizations _relative to the benchmark_ which may have many more or many fewer dynamic instructions compared to its peers. For brevity, we include only the top 15 most optimized benchmarks.

![A grouped bar chart showing percent reduction in total dynamic instructions over the baseline for 15 benchmarks.](https://github.com/parkerziegler/bril/blob/main/tasks/task-3/assets/baseline-vs-opt.png)
