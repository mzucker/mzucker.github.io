---
layout: post
title: Optimizing L-Systems
date: 2020-03-27 20:02 -0400
---

Socially isolating through obsessive micro-optimization.

Overview
========

This week in class I gave a lecture and live-coding demonstration on L-Systems,
which sent me down an interesting rabbit hole of optimization. My goal
was to produce the absolute fastest L-System renderer possible, in
terms of seconds per line segment computed.

Boundaries are important, so to prevent myself from going too bonkers, I set a few for myself:

 * no explicit SIMD assembly or intrinsics (SSE/AVX/etc.)
 * no messin' around with CUDA, OpenCL, compute shaders, or GPUs
 * no LLVM or generating machine code at runtime

Even working within these very reasonable boundaries, I was
nevertheless able to obtain over 1000X (!) speedup over my initial
Python program.

As usual, code to accompany this blog post is [up on github](https://github.com/mzucker/lsystem_optimization) and you can also 
jump down to the [results section](#results) to see the hard numbers.

Background
==========

{: .info}
**Note:** If you're already familiar with L-Systems you might want to skip ahead to the [Implementation](#implementation) section below.

[L-Systems](https://en.wikipedia.org/wiki/L-system), or Lindenmayer
systems, can generate beautiful organic-looking and fractal patterns
by succesively applying a set of string replacement rules, starting
from an initial *axiom string*. The symbols that comprise these
strings are interpreted as
[turtle graphics](https://en.wikipedia.org/wiki/Turtle_graphics)
commands that draw a line segment along the current rotation angle,
increment or decrement the current rotation angle by a constant,
or save/restore the graphics state.

For example, consider the *Sierpinski arrowhead* L-System with axiom
`A`, angle increment 60&deg;, and replacement rules:

  * `A` → `B-A-B`
  * `B` → `A+B+A`
  
Iteration zero of this L-System consists of the string `A`, which
draws a single line segment. To clearly illustrate the effect of
string replacements, we will give each line drawing symbol its own
color, so `A` gets the color blue:

 ![Sierpinski arrowhead iteration 0](/images/lsystem_optimization/sierpinski_arrowhead_0.png){: .center-half}
 
In iteration one, we invoke the first rule to replace the single `A`
with the string `B-A-B`, which consists of a `B` segment illustrated
in red, a right turn by 60&deg;, an `A` segment (blue), another right
turn, and a final `B` segment (red). It produces the output:

 ![Sierpinski arrowhead iteration 1](/images/lsystem_optimization/sierpinski_arrowhead_1.png){: .center-half}
 
To obtain iteration two, we re-apply the replacement rules to the
iteration one output. The resulting string is `A+B+A-B-A-B-A+B+A`, and it
produces the graphical output:

 ![Sierpinski arrowhead iteration  2](/images/lsystem_optimization/sierpinski_arrowhead_2.png){: .center-half}

Note that each `+` symbol above corresponds to a left turn, as opposed
to the `-` symbols which correspond to right turns. If we let this run
to iteration six, we see a familiar fractal pattern emerge:

 ![Sierpinski arrowhead iteration  6](/images/lsystem_optimization/sierpinski_arrowhead_6.png){: .center-half}

### Pushing and popping

The example above illustrates drawing segments and turning, but
there's one more pair of symbols our L-System renderer needs to
handle.  The stack push symbol
`[` saves the current turtle graphics state (both position and orientation), and the stack pop symbol `]`
restores the last previously saved state.

To illustate this, let's consider the simple tree L-System with axiom
`F`, angle increment 45&deg;, and replacement rules:

  * `F` → `X[+F][-F]`
  * `X` → `XX`
  
Iteration one of this system produces the string `X[+F][-F]`.
Let's interpret it one symbol at a time:

  1. `X`  draw a red segment
  2. `[`  save the current graphics state
  3. `+`  turn left
  4. `F`  draw a blue segment
  5. `]`  restore the graphics state to where it was after step 1
  6. `[`  save the graphics state again
  7. `-`  turn right
  8. `F`  draw a blue segment
  9. `]`  restore the graphics state again
  
Here's the graphical output of iteration one:

 ![tree iteration 1](/images/lsystem_optimization/tutorial_tree_1.png){: .center-half}

Iteration two produces the string `XX[+X[+F][-F]][-X[+F][-F]]`. Each
branch from iteration one is now an entire iteration-one tree. Also,
the "trunk" has grown twice as long. Here's what it looks like:

 ![tree iteration 2](/images/lsystem_optimization/tutorial_tree_2.png){: .center-half}

In iteration three, we again replace each red segment with two red segments,
and replace each blue segment with a "mini-tree":

 ![tree iteration 3](/images/lsystem_optimization/tutorial_tree_3.png){: .center-half}
 
Note that in general, L-System renderers do not color their graphical output by symbol, so most renderers would have produced all of the output above in a single color. For additional examples of L-Systems and replacement rules, see the [appendix](#appendix) below.


Implementation
==============

The job of an L-System renderer is to take a description of an
L-System (axiom, angle increment, and replacement rules) along with an
iteration count, and produce a list of line segments to draw.
I want to be very clear that I'm not at all focused on fast *drawing*
of line segments -- instead, my goal is to *compute* the list of line
segments as quickly as possible for a given L-System and depth. 

Therefore, the figure of merit for comparing programs
is **unit time per line segment** (lower is better).

In fact, drawing is disabled when benchmarking, and is enabled only to
verify line segment output for correctness. To actually produce
graphical output, every program simply hands a list of line segments
to a [matplotlib.collections.LineCollection](https://matplotlib.org/gallery/shapes_and_collections/line_collection.html) object for plotting.


### v0: Initial version

The program
[lsystems_v0.py](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v0.py)
is very close to what I live-coded during my class demonstration. At
its heart are two functions `lsys_build_string` and
`lsys_segments_from_string`. The former is responsible for applying
repeated string replacement to the initial axiom to obtain the final
string of symbols for drawing. The latter is responsible for
converting a long string of symbols into a list of line segments.

Here is the `lsys_build_string` function:

```python
def lsys_build_string(lsys, max_depth):

    lstring = lsys.start

    for i in range(max_depth):

        output = ''

        for symbol in lstring:
            if symbol in lsys.rules:
                output += lsys.rules[symbol]
            else:
                output += symbol

        lstring = output

    return lstring
```

The `lsys_segments_from_string` function is a little more complicated
because it has to implement the entire turtle graphics system:

```python
def lsys_segments_from_string(lsys, lstring):

    cur_pos = np.array([0., 0.])
    cur_angle_deg = 0

    cur_state = ( cur_pos, cur_angle_deg )

    stack = []
    segments = []

    for symbol in lstring:

        if symbol.isalpha():

            if lsys.draw_chars is None or symbol in lsys.draw_chars:

                cur_theta = cur_angle_deg * np.pi / 180
                offset = np.array([np.cos(cur_theta), np.sin(cur_theta)])
                new_pos = cur_pos + offset
                segments.append([cur_pos, new_pos])
                cur_pos = new_pos

        elif symbol == '+':

            cur_angle_deg += lsys.turn_angle_deg

        elif symbol == '-':

            cur_angle_deg -= lsys.turn_angle_deg

        elif symbol == '[':

            stack.append( ( cur_pos, cur_angle_deg ) )

        elif symbol == ']':

            cur_pos, cur_angle_deg = stack.pop()

        else:

            raise RuntimeError('invalid symbol:' + symbol)
        
    return np.array(segments)
```

The rest of the program is boilerplate including command line argument parsing, defining the benchmark L-Systems, and drawing code.

Overall v0 weighs in at 125 lines of code[^1] and clocks 7.615 μs per line segment.

### v1: Recursion instead of iteration

Whereas v0 focuses on iterative string replacement,
[lsystems_v1.py](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v1.py)
uses a recursive approach.

Instead of explicitly constructing the final string of drawing
instruction symbols, it is possible to recursively evaluate the axiom
and replacement rules to implicitly evaluate the string without ever
storing it in memory.

The recursive approach is implemented by two functions in v1,
`lsys_segments_recursive`, and a helper function
`_lsys_segments_r`. The former simply sets up some state variables and calls
the latter, and the latter calls itself recursively.

Here is `lsys_segments_recursive`:

```python
def lsys_segments_recursive(lsys, max_depth):

    cur_pos = np.array([0., 0.])
    cur_angle_deg = 0

    cur_state = (cur_pos, cur_angle_deg)
    state_stack = []

    segments = []

    s = lsys.start

    _lsys_segments_r(lsys, s,
                     max_depth,
                     cur_state,
                     state_stack,
                     segments)

    return np.array(segments)
```

As you can see above, it just initializes the current turtle graphics
state, creates an empty stack for saving/restoring state, and 
hands off the initial axiom string to the helper function.

The helper function calls itself recursively when string replacement
is required, and delegates to another function to execute turtle
graphics commands for each symbol when the maximum recursion depth has
been reached. Here is `_lsys_segments_r`

```python
def _lsys_segments_r(lsys, s,
                     remaining_steps,
                     cur_state,
                     state_stack,
                     segments):

    # for each symbol in input
    for symbol in s:

        # see if we can run a replacement rule for this symbol
        if remaining_steps > 0 and symbol in lsys.rules:

            # get the replacement
            replacement = lsys.rules[symbol]
            
            # recursively call this function with fewer remaining steps
            cur_state = _lsys_segments_r(lsys, replacement, 
                                         remaining_steps-1,
                                         cur_state,
                                         state_stack, segments)

        else: # execute symbol directly

            cur_state = _lsys_execute_symbol(lsys, symbol, cur_state,
                                             state_stack, segments)

    return cur_state
```

Note that the `_lsys_execute_symbol` function above implements the
same turtle graphics functionality originally implemented inside of 
`lsys_segments_from_string` in v0.

My hope in writing v1 was that it would be faster to avoid allocating
and writing to the string memory, but the program ended up being
slower in practice. 

Swapping between iteration and recursion often amounts to a tradeoff
between heap and stack. Instead of storing data explicitly in
heap-allocated strings, the recursive approach stores data implicitly
on the call stack. Whether or not this is faster may depend on the
complexity of performing a recursive function call, both in terms of
space (larger stack frames have more storage overhead) and time (how
many CPU instructions is a function call in a given
language). Unfortunately, interpreted languages like Python often
perform worse on both fronts than compiled languages like C.

So, my best guess for why v1 is slower than v0 is that the savings of
heap allocations is overwhelmed by the additional overhead
from recursive function calls in Python.

In the end, v1 is 172 lines of code and runs at 8.843 μs per segment.

### v2: Porting to C

[lsystems_v2.c](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v2.c)

### v3: Recursive approach in C

[lsystems_v3.c](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v3.c)

### v4: Attempting to cache cos/sin 

[lsystems_v4.c](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v4.c)

### v5: Precomputing all rotations

[lsystems_v5.c](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v5.c)

### v6: Memoizing replacements

[lsystems_v6.c](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v6.c)

Results
=======

See below for a plot of benchmark results. Note the log scale on
the *y*-axis. The error bars denote the full range of observed
timings on each benchmark L-System listed in the [appendix](#appendix)
below, and the central point is computed as the [geometric mean](https://en.wikipedia.org/wiki/Geometric_mean) of
all benchmark L-Systems for each program.

 ![Benchmark results plot](/images/lsystem_optimization/benchmark_results.png){: .center}

The various versions of the program and their notable features are summarized in the table below, with links
to each version of the program in the [github repository](https://github.com/mzucker/lsystem_optimization).

|--
| Version | Language | String | Recursive | Size[^1] | Time/segment | Notes
|:-:|:-:|:-:|:-:|:-:|:-:|:--
| [v0](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v0.py) | Python | ✓ |  | 125 | 7.615 μs | Initial Python version 
| [v1](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v1.py) | Python |   | ✓ | 172 | 8.843 μs | Added recursion
| [v2](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v2.c) | C | ✓ |   | 401 | 68.62 ns | Initial C version
| [v3](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v3.c) | C |   | ✓ | 454 | 63.45 ns | Added recursion
| [v4](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v4.c) | C |   | ✓ | 458 | 64.94 ns | Cache trigonometry
| [v5](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v5.c) | C |   | ✓ | 498 | 29.64 ns | Precompute all rotations
| [v6](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v6.c) | C |   | ✓ | 627 | 9.583 ns | Memoization
| [v7](https://github.com/mzucker/lsystem_optimization/blob/master/lsystems_v7.c) | C |   | ✓ | 659 | 6.073 ns | OpenMP parallelization

Appendix: all L-Systems for benchmark {#appendix}
=====================================

I cherry-picked a few choice examples from the
[wikipedia page](https://en.wikipedia.org/wiki/L-system) linked above
as well as
[Paul Bourke's page on L-Systems](http://paulbourke.net/fractals/lsys/). The
systems listed below were used to benchmark all of the various program
versions described in this post.

**Sierpinski arrowhead** 

 * Axiom: `A`
 * Angle increment: 60&deg;
 * Rules:
   * `A` -> `B-A-B`
   * `B` -> `A+B+A`
   
Iteration 7:

 ![Sierpinski arrowhead iteration 7](/images/lsystem_optimization/sierpinski_arrowhead_7.png){: .center-half}

**Sierpinski triangle** 

 * Axiom: `F-G-G`
 * Angle increment: 120&deg;
 * Rules:
   * `F` -> `F-G+F+G-F`
   * `G` -> `GG`
   
Iteration 6:

 ![Sierpinski triangle iteration 6](/images/lsystem_optimization/sierpinski_triangle_6.png){: .center-half}
 
**Dragon curve**

 * Axiom: `FX`
 * Angle increment: 90&deg;
 * Rules:
   * `X` -> `X+YF+`
   * `Y` -> `-FX-Y`
   
Iteration 12:

 ![dragon curve iteration 12](/images/lsystem_optimization/dragon_curve_12.png){: .center-half}
 
**Barnsley fern**

 * Axiom: `X`
 * Angle increment: 25&deg;
 * Rules:
   * `X` -> `F+[[X]-X]-F[-FX]+X`
   * `F` -> `FF`
   
Iteration 7:

 ![Barnsley fern iteration 7](/images/lsystem_optimization/barnsley_fern_7.png){: .center-half}

**Sticks**

  * Axiom: `X`
  * Angle increment: 20&deg;
  * Rules:
    * `X` -> `F[+X]F[-X]+X`
    * `F` -> `FF`
  * Note: only draw segments for `F`
    
Iteration 9:

 ![sticks iteration 9](/images/lsystem_optimization/sticks_9.png){: .center-half}
 
**Hilbert curve**

  * Axiom: `L`
  * Angle increment: 90&deg;
  * Rules:
    * `L` -> `+RF-LFL-FR+`
    * `R` -> `-LF-RFR-FL-`
  * Note: only draw segments for `F`
  
Iteration 5:

 ![Hilbert curve iteration 5](/images/lsystem_optimization/hilbert_5.png){: .center-half}
 
**Pentaplexity** 

  * Axiom: `F++F++F++F++F`
  * Angle increment: 36&deg;
  * Rules:
    * `F` -> `F++F++F+++++F-F++F`
    
Iteration 4:

 ![pentaplexity iteration 4](/images/lsystem_optimization/pentaplexity_4.png){: .center-half}

[^1]: Program sizes generated using David A. Wheeler's [SLOCCount](https://dwheeler.com/sloccount/).
