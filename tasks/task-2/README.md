# Task 2

This directory contains my submission for [Task 2](https://github.com/mwillsey/cs265/blob/2024-fall/lessons/02-dataflow.md#task) of CS 265.

## Source code

The source for my submission lives at [tasks/task-2/src/index.ts](https://github.com/parkerziegler/bril/blob/main/tasks/task-2/src/index.ts). I chose to implement my optimizer in TypeScript. To run the optimizer using `brench`, you'll first have to compile the source to JavaScript. Run the following two commands from the `tasks/task-2` directory:

```sh
$ pnpm install
$ pnpm build
```

Together, these commands will install all necessary dependencies and invoke `tsc`, the TypeScript compiler. The compiled JavaScript will be written to `dist/index.js`.

## Results

To evaluate my optimization passes, I configured `brench` to run against the full set of `bril` benchmarks. The raw results are included in `assets/brenchmarks.csv`. Interestingly, I found that these sets of optimizations—constant propagation and folding paired with global dead code elimination powered by liveness analysis—optimized somewhat less than my optimizations from Task 1. The mean reduction in total dynamic instructions was only 0.65%, with a median (again) of 0% and a max of 10.2% on the `two-sum` benchmark. This felt somewhat surpising given that my constant propagation and folding handles not only constant folding of binary arithmetic and Boolean operators, but also performs conditional constant (CC) propagation to eliminate branches that we statically determine will never execute.

The following figure shows the percent decrease in instructions for optimized programs, relative to a baseline that includes 100% of the original instructions. Using percent decrease helps to show the effect size of the optimizations _relative to the benchmark_ which may have many more or many fewer dynamic instructions compared to its peers. For brevity, we include only the top 15 most optimized benchmarks.

![A grouped bar chart showing percent reduction in total dynamic instructions over the baseline for 15 benchmarks.](https://github.com/parkerziegler/bril/blob/main/tasks/task-2/assets/baseline-vs-opt.png)

### Comparisons Against Task 1 Optimizations

After observing the differences in my Task 1 and Task 2 optimizations' performance, I was curious to investigate the potential sources of the discrepancy. To do this, I started by examining the impacts of _just_ the dead code elimination passes in each task. Given that CSE and constant propagation plus folding won't in and of themselves remove instructions without a subsequent DCE pass, it didn't make sense to compare these optimizations directly.

To start, I tried running _just_ Task 1's trivial global DCE against Task 2's liveness analysis and global DCE. The results showed identical dynamic instruction counts for all benchmarks, suggesting that my Task 2 implementation completely subsumes at least this portion of Task 1. Next, I ran both Task 1's trivial global DCE _and_ its local DCE against Task 2's liveness analysis and global DCE. Again, the results showed identical dynamic instruction counts for all benchmarks. Together, these results give me confidence that my Task 2 DCE completely subsumes my Task 1 DCE in instances where no prior optimizations have been applied.

Next, I tried comparing the effect of Task 1's CSE vs. Task 2's constant propagation and folding while using the _same_ DCE algorithm (Task 2's). The differences here were quite dramatic. While the optimizations produce identical dynamic instruction counts on 34 of 66 benchmarks, the remaining 22 show some marked differences. For example, on the `ray-sphere-intersection` benchmark, CSE results in 45 dynamic instructions while constant propagation and folding yields 142, a 315.56% increase! My hypothesis here is that CSE opens up significantly more opportunities for dead code elimination to make an impact on these benchmarks. Consider a program like `ray-sphere-intersection.bril`, which creates a lot of definitions for the same constant value:

```bril
...

@main {
  rayOriginX: float = const 0.0;
  rayOriginY: float = const 0.0;
  rayOriginZ: float = const 0.0;

  rayDirectionX: float = const 0.33;
  rayDirectionY: float = const 0.33;
  rayDirectionZ: float = const 0.33;

  circleCenterX: float = const 5.0;
  circleCenterY: float = const 5.0;
  circleCenterZ: float = const 5.0;

  ...
}
```

My CSE algorithm reduces this significantly by only using the first of each of these definitions to refer to the constant:

```bril
...

@main {
  rayOriginX: float = const 0.0;

  rayDirectionX: float = const 0.33;

  circleCenterX: float = const 5.0;

  ...
}
```

Conversely, my constant propagation and folding do nothing to eliminate definitions mapped to the same constant value. Additionally, I did not implement evaluation of `id` expressions as part of my constant propagation and folding, so instructions like:

```bril
@DotProduct(a: float, b: float, c: float, x: float, y: float, z: float): float {
  v0: float = id a;
  v1: float = id x;
  v2: float = fmul v0 v1;
  ...
}
```

are left untouched. Conversely, my CSE algorithm "sees through" `id` expressions and will replace them with their values; subsequent DCE passes can then identify variables like `v0` and `v1` as dead stores for function arguments and remove them entirely.

## Comments

While the tangible results of my optimizations felt somewhat disappointing, there are two neat parts of my implementation I want to draw attention to.

1. **Conditional Constant (CC) Propagation**

After implementing constant propagation and constant folding, I wanted to extend my implementation to eliminate branches that we statically determine will never execute. The procedure is loosely based on the algorithm described by Wegman and Zadeck in Section 3.3 of ["Constant Propagation with Conditional Branches"](https://dl.acm.org/doi/pdf/10.1145/103135.103136) and acts as follows:

- When we encounter a Bril `br` instruction during constant folding, check our constant propagation analysis information to determine whether the conditional expression of the branch references a constant value.
- If so, find the label corresponding to the branch that _will_ be taken.
- Execute the subprocedure [`eliminateBranch`](https://github.com/parkerziegler/bril/blob/e520f8f4286087a679774b00ed8845a1822568fd/tasks/task-2/src/constant-propagation.ts#L192-L216).
  - `eliminateBranch` rewrites the successors of the basic block under examination, pointing only to the basic block corresponding to the branch that will be taken.
  - Additionally, `eliminateBranch` removes the basic block under examination from the predecessors of the basic block corresponding to the branch that not will be taken. In effect, this breaks the edge between these blocks in the control flow graph.
- Next, replace the `br` instruction with an unconditional `jmp` to the label of the block that will be taken.
- In a secondary pass, remove all basic blocks that have no predecessors (except for the entry node).

With this optimization in place, a program like [`cond.bril`](https://github.com/parkerziegler/bril/blob/main/examples/test/df/cond.bril):

```bril
@main {
  a: int = const 47;
  b: int = const 42;
  cond: bool = const true;
  br cond .left .right;
.left:
  b: int = const 1;
  c: int = const 5;
  jmp .end;
.right:
  a: int = const 2;
  c: int = const 10;
  jmp .end;
.end:
  d: int = sub a c;
  print d;
}
```

gets optimized to the following program:

```bril
@main {
  a: int = const 47;
  b: int = const 42;
  cond: bool = const true;
  jmp .left;
.left:
  b: int = const 1;
  c: int = const 5;
  jmp .end;
.end:
  d: int = sub a c;
  print d;
}
```

Adding on my other optimization passes—constant folding and dead code elimination powered by liveness analysis—this program is further optimized to:

```bril
@main {
  jmp .left;
.left:
  jmp .end;
.end:
  d: int = const 42;
  print d;
}
```

We could of course remove all unconditional `jmp` instructions and labels in the above program, but I was already quite pleased with this level of optimization; this amounts to a 55.56% reduction in the total dynamic instructions (from 9 down to 4).

2. **Mark-Sweep Dead Code Elimination Algorithm**

I struggled for awhile to figure out how to actually use the information computed in my liveness analysis to perform dead code elimination. I found some insight from Section 10.2.1 of **Engineering a Compiler** by Keith D. Cooper and Linda Torczon, which describes a Mark-Sweep algorithm for marking "useful" instructions in an iterative worklist and subsequently sweeping all unmarked instructions. This analogue to the garbage collection algorithms I'm familiar with helped me find my footing. My implementation works as follows:

- Start by finding the initial set of instructions in a basic block that are guaranteed to be live—this is our "useful" instruction set. For our purposes, these include:
  - Effectful operations like `print`, `ret`, `call`, `store`, etc. I used the `EffectOperation` `interface` defined in Bril's TypeScript definitions to collate the full list of effectful op codes.
  - Instructions that our liveness analysis marked as live upon exit of the basic block.
- Iteratively expand our set of "useful" instructions by identifying those that define live variables.
  - This includes variables that are defined and used _in the same block_ as well as variables that are marked as live upon exiting the block.
  - Cumulatively, this procedure amounts to the mark phase.
- Iteratively remove all instructions that are not marked as "useful" by the analysis above. This is our sweep phase.
- Run the prior two phases (mark and sweep) to fixpoint.

Taking the `cond.bril` program above that has passed through constant propagation and constant folding:

```bril
@main {
  a: int = const 47;
  b: int = const 42;
  cond: bool = const true;
  jmp .left;
.left:
  b: int = const 1;
  c: int = const 5;
  jmp .end;
.end:
  d: int = const 42;
  print d;
}
```

this optimization reduces our code to the following program:

```bril
@main {
  jmp .left;
.left:
  jmp .end;
.end:
  d: int = const 42;
  print d;
}
```
