# Task 1

This directory contains my submission for [Task 1](https://github.com/mwillsey/cs265/blob/2024-fall/lessons/01-local-opt.md#task) of CS 265.

## Source code

The source for my submission lives at [tasks/task-1/src/index.ts](https://github.com/parkerziegler/bril/blob/main/tasks/task-1/src/index.ts). I chose to implement my optimizer in TypeScript. To run the optimizer using `brench`, you'll first have to compile the source to JavaScript. Run the following two commands from the `tasks/task-1` directory:

```sh
$ pnpm install
$ pnpm build
```

Together, these commands will install all necessary dependencies and invoke `tsc`, the TypeScript compiler. The compiled JavaScript will be written to `dist/index.js`.

## Results

To evaluate my optimization passes, I first configured `brench` to run against the set of dedicated test cases for `tdce` and `lvn` and recorded the results, omitting cases where `brench` reported a missing result. Rather than use Vega-Lite to generate the plot for these results, I opted to use [Observable Plot](https://observablehq.com/plot/). The results are shown below.

![A grouped bar chart showing reduction in total dynamic instructions over the baseline for 13 test cases.](https://github.com/parkerziegler/bril/blob/main/tasks/task-1/assets/baseline-vs-opt.png)

In addition, I ran my optimizer against the full set of `bril` benchmarks. The results are included in the `assets/benchmarks.csv` file. Some light statistical computations over this data show that my optimizer reduces the total number of dynamic instructions by an average of 10.29% over the baseline, but with a median reduction of 0.00%. The maximum reduction achieved was 47.89% on the `ray-sphere-intersection` benchmark.

## Commentary

1. **Clobbering strategy.**

I chose to implement the conservative strategy for clobbering variables in my LVN implmentation; that is, clobbered variables cannot be reused by later instructions. L63-82 of [src/lvn.ts](https://github.com/parkerziegler/bril/blob/main/tasks/task-1/src/lvn.ts) shows this in action. The algorithm finds the currently associated value number and value associated with a destination that is being written to, and removes that value and value number from all four `Map`s before linking a new value and value number with the destination.

2. **Provide a program that you can optimize very well with your passes. Show the unoptimized and optimized versions.**

I was quite pleased to see the combination of CSE, local DCE, and global DCE all functioning together on certain programs. For example, consider this unoptimized Bril program, which has a total of 10 dynamic instructions:

```bril
@main {
  zero: int = const 0;
  one: int = const 1;

  x: int = add zero one;
  y: int = add zero one;
  cond: bool = eq x y;
  z: int = const 4;
  z: int = add y y;

  br cond .L1 .L2;
  .L1:
    z: int = const 2;
    ret x;
  .L2:
    z: int = const 3;
    ret zero;
}
```

With my passes, the optimized version of this program has only 6 dynamic instructions:

```bril
@main {
  zero: int = const 0;
  one: int = const 1;

  x: int = add zero one;
  cond: bool = eq x x;

  br cond .L1 .L2;
  .L1:
    ret x;
  .L2:
    ret zero;
}
```

A few observations about this optimization:

- I was able to eliminate `y` entirely, first by recognizing it as a common subexpression with `x` and subsequently by replacing all uses of `y` with `x`. Specifically, my CSE pass applies local value numbering to initially rewrite this instruction to:

```bril
y: int = id x;
```

Subsequently, we apply a secondary pass to identify all `id` instructions in the program and rewrite any expressions using their _destinations_ to instead user their _arguments_.

For example, after our first pass, the relevant section of the program appears as follows:

```bril
x: int = add zero one;
y: int = id x;
cond: bool = eq x y;
```

When we apply the above transformation, we rewrite the `cond` instruction to:

```bril
cond: bool = eq x x;
```

This then allows our local and global DCE passes to eliminate the `y` instruction entirely.

- I was also able to eliminate `z` entirely, despite its uses of `y`, the dead store in the first basic block, and its redefinition in the second and third basic blocks.

3. **Provide a program that you can't optimize with your passes, but you can in your head. What's the issue? What would you need to do to optimize it?**

With a slight modification to the above program, we can create a situation where my passes fail to optimize the program. Consider the diff to the original program above:

```diff
@main {
  zero: int = const 0;
  one: int = const 1;

  x: int = add zero one;
  y: int = add zero one;
  cond: bool = eq x y;
  z: int = const 4;
  z: int = add y y;

  br cond .L1 .L2;
  .L1:
    z: int = const 2;
-   ret x;
+   ret y;
  .L2:
    z: int = const 3;
-   ret zero;
+   ret z;
}
```

With these two changes, we end up with the following program after optimization:

```bril
@main {
  zero: int = const 0;
  one: int = const 1;
  x: int = add zero one;
  y: int = id x;
  cond: bool = eq x x;
  z: int = add x x;
  br cond .L1 .L2;
.L1:
  z: int = const 2;
  ret y;
.L2:
  z: int = const 3;
  ret z;
}
```

This represents a reduction of only 1 dynamic instruction—the dead store to `z`.
Notice a few issues here:

1. Because `y` is used in the `ret` instruction in the second basic block, we
don't eliminate `y` **even though** it could be relpaced with `x`. This is because my CSE pass only performs common subexpression _replacement_ within a basic block.
2. Because `z` is used in the `ret` instruction in the third basic block, we
preserve all of its uses across the basic blocks, save for the elimination of the dead store in the first basic block. Again, this is because my local DCE pass only eliminates dead stores within a basic block, and my global DCE pass is quite conservative—any use of a variable in the program will prevent eliminations of its assignment.

In both cases, we could improve the optimization by extending the scope of our CSE and local DCE passes to operate across extended basic blocks. Passing in an initial state value for `y → x` into the second basic block would allow us to replace `y` with `x`, which would subsequently allow global DCE to elimiate `y`. Similarly, we could eliminate all `z` assignments except for the one in `.L2`, since this is the only label using `z` and it is reassigned at the top of the block.
