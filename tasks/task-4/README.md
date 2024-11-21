# Task 4

This directory contains my submission for [Task 4](https://github.com/mwillsey/cs265/blob/2024-fall/lessons/05-memory.md#task) of CS 265.

## Source code

The source for my submission lives at [tasks/task-4/src/index.ts](https://github.com/parkerziegler/bril/blob/main/tasks/task-4/src/index.ts). I chose to implement my optimizer in TypeScript. To run the optimizer using `brench`, you'll first have to compile the source to JavaScript. Run the following two commands from the `tasks/task-4` directory:

```sh
$ pnpm install
$ pnpm build
```

Together, these commands will install all necessary dependencies and invoke `tsc`, the TypeScript compiler. The compiled JavaScript will be written to `dist/index.js`.

## Alias Analysis for Dead Store Elimination

I chose to implement the relatively conservative dataflow analysis presented in the course notes to power a dead store elimination pass.

### Design Considerations for the Dataflow Analysis

My implementation followed a fairly standard forward-may dataflow analysis setup using a worklist algorithm to iterate to fixpoint. Perhaps the only interesting element of my implementation is how we model memory locations in the implementation. The TypeScript definitions gave me a glimmer of hope that each `bril` `Instruction` would include a `pos.row` property that I could use for this purpose; however, I soon discovered that this property doesn't reliably exist at runtime. Thus, I introduced some preprocessing to add this property after my SSA pass, using the index of each `instr` in the program as its memory location. With this preprocessing in place, I could also compute the `Set` of all possible memory locations before commencing the analysis. This helped in two ways:

1. I could assign function arguments to the `Set` of all memory locations during initialization of the analysis state. In essence, this means the analysis treats function arguments as potentially pointing to all memory locations.
2. I could assign the destinations of `load` instructions to the `Set` of all memory locations during the analysis. Again, this means treating all destinations that load from a pointer as potentially pointing to all memory locations.

### Design Considerations for the Dead Store Elimination Pass

I found this pass somewhat tricky to implement. While the contrived examples I developed for testing worked well with my initial implementation, I hit some issues when scaling up to the benchmarks. In particular, my implemetation was too aggressive at eliminating `store`s for programs containing `ptradd` instructions. Consider an example like the following:

```
@main {
  zero: int = const 0;
  one: int = const 1;
  five: int = const 5;
  six: int = const 6;
  ten: int = const 10;
  x: ptr<int> = alloc ten; // Memory location 5.
  store x five;
  y: ptr<int> = ptradd x one; // Also points to memory location 5, but writes to an offset.
  store y six;
  z: ptr<int> = ptradd x zero; // Also points to memory location 5, but later reads from the first "cell".
  a: int = load z;
}
```

Initially, my implementation worked as follows:

1. Initialize a `Map`, `liveStores`, mapping memory locations to `Set`s of pointers associated with that memory location.
2. Iterate backwards through instructions.
3. When we hit a `store` instruction, find all memory locations associated with the pointer being stored to.
4. Check to see if we've already seen a `store` to any of these locations without an interving `load`. If so, mark this `store` as dead. If not, keep this `store` and add its memory location and pointer to `liveStores`.
5. When we hit a `load` instruction, remove the memory location associated with the loaded pointer from `liveStores`.

However, there's a subtle problem here if we look at our example above. With `ptradd`, our alias analysis determines only that `x` and `y` _may_ point to the same memory location, but provides no evidence that they in fact do. And indeed, we can see that `x` and `y` point to _disjoint_ cells in the same memory region. However, my initial algorithm looked at these two `store`s and determined that (1) they store to the same memory location, 5, and (2) there are no intervening `load`s from memory location 5, so (3) it is safe to eliminate the first store (`store x five;`). This, of course, is not safe—doing so results in an error indicating that "Pointer `z` points to unitialized data", since we never stored `five` into the first cell of our 10-cell allocation.

Having distilled this problematic case, I modified my dead store elimination pass to be a bit more conservative. Specifically, when we encounter a `store` to a memory location that we've determined is _later_ stored to, we also check to see if that later `store` is the _exact same pointer_. If it is and there's no intervening `load`s, then we'll eliminate it. This would correspond to a case like:

```
ten: int = const 10;
rng: ptr<int> = alloc ten;
store rng five;
... // No intervening loads from rng
store rng six;
```

However, if the latter `store` is to an alias of the former `store`, then we preserve the initial store. This would be a case like:

```
zero: int = const 0;
ten: int = const 10;
rng: ptr<int> = ten;
store rng five;
... // No intervening loads
rng_2: ptr<int> = ptradd rng zero;
store rng_2 six;
```

While this means that we do not eliminate some `store`s that we could if we reasoned about offsets (completeness), it is still a sound analysis.

## Results

To evaluate my optimization passes, I configured `brench` to run against the full set of `bril` benchmarks. For this task, I again decided to use the SSA'd version of the program as the baseline and the SSA'd + dead store eliminated version of the program as the optimization.

Unfortunately, my dead store elimination optimization did not seem to have much of an effect on the benchmarks. Across the memory benchmarks (those located in `benchmarks/mem`), I only saw a reduction of one dynamic instruction on one of the benchmarks, `vsmul`. I can't quite tell whether the benchmarks just don't have many opportunities for true dead store elimination or whether my optimization is just too conservative to make much of an impact.

In any case, here is an example for which my pass does work.

```
@main {
  one: int = const 1;
  five: int = const 5;
  rng: ptr<int> = alloc five;
  rng_1: ptr<int> = alloc five;
  ten: int = const 10;
  twenty: int = const 20;
  store rng ten;
  store rng_1 twenty;
  rng_2: ptr<int> = ptradd rng_1 one;
  thirty: int = const 30;
  a: int = load rng_1;
  b: int = add a thirty;
  store rng b;
  print b;
  free rng;
  free rng_1;
  ret;
}
```

After dead store elimination, we successfully eliminate the `store rng ten` instruction, even though we have:

1. An intervening `load` instruction (i.e., `a: int = load rng_1`)
2. An intervening creation of a pointer that aliases in our analysis (i.e., `rng_2: ptr<int> = ptradd rng_1 one;` makes `rng_2` an alias for `rng_1` from our analysis' perspective)

The resulting optimized program looks like this:

```
@main {
  one: int = const 1;
  five: int = const 5;
  rng: ptr<int> = alloc five;
  rng_1: ptr<int> = alloc five;
  ten: int = const 10;
  twenty: int = const 20;
  store rng_1 twenty;
  rng_2: ptr<int> = ptradd rng_1 one;
  thirty: int = const 30;
  a: int = load rng_1;
  b: int = add a thirty;
  store rng b;
  print b;
  free rng;
  free rng_1;
  ret;
}
```
