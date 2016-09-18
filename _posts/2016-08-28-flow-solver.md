---
layout: post
title: Flow Free solver
---

Fast automated solver for Flow Free puzzles written in C.

GIF of the final program in action (see below if you're unfamiliar with Flow Free):

![oooh pretty output](/images/flow_solver/example_animation.gif){:
 .center-threequarters }
 
Standard admonishments apply: feel free to skip ahead to
[the end](#theend); also, don't hesitate to try out the code, which is
[up on github][repo] as always.

[repo]: https://github.com/mzucker/flow_solver


Overview
========

I like puzzles. Well, more precisely, I enjoy problem solving, and
puzzles present nice, neat, self-contained problems to solve from time
to time. But one thing I like even better than solving a puzzle is
writing programs to automatically solve *a whole lot* of puzzles,
*fast*.

Here's a couple of screenshots from the mobile game
[Flow Free][ffree], in case you're unfamiliar:

[ffree]: https://itunes.apple.com/us/app/flow-free/id526641427?mt=8

![real game](/images/flow_solver/real_game_before_after.png){: .center-threequarters }

The game takes place on a grid which starts out empty, except for a
number of pairs of colored dots (as shown on the left).  The objective
is to draw paths or *flows* such that all pairs are connected and all
of the empty cells are filled (as shown on the right). Puzzles range
from 5x5 all the way up to 14x14, and they may have anywhere from 5 to
16 colors of flows.

I've had Flow Free on my iPhone for years, and it's saved me from
boredom on many a subway or airplane. From time to time I've
wondered how hard it would be to write a good automated solver for it,
but I never took on the project until this summer, when I found myself
with a few dozen hours of flights on which to occupy myself.

I developed the bulk of my solver over about a week of travel through
Indonesia, Singapore, and Malaysia; when I got back home, I added
about an order of magnitude's worth of speed optimizations and some
ANSI cursor commands to produce animated solutions like the one shown
above. The program also outputs [SVG][SVG] images, which became the
basis for many of the figures in this post.

[SVG]: https://en.wikipedia.org/wiki/Scalable_Vector_Graphics

By the way, I did dig up some prior work on the subject, but I only
started looking for it once I had finished my solver. If you're
curious, there's a [list of related efforts](#priorwork) at the very
end of this post. As far as I can tell, my solver is the only one I'm
aware of that can tackle large puzzles (e.g. 12x12 and up) in a
reasonable amount of time.


Framing the problem
===================

From an AI perspective, there are at least two substantially different
ways to frame the Flow Free puzzle: the first is as a
[constraint satisfaction problem (CSP)][csp], and the second is as a
[shortest path problem][spp].  The former is the domain of
[SAT solvers][sat] and [Knuth's DLX][dlx], whereas the latter is the
domain of [Dijkstra's algorithm][dijkstras] and [A\* search][astar].

[csp]: https://en.wikipedia.org/wiki/Constraint_satisfaction_problem
[spp]: https://en.wikipedia.org/wiki/Shortest_path_problem
[sat]: https://en.wikipedia.org/wiki/Boolean_satisfiability_problem
[dlx]: https://en.wikipedia.org/wiki/Dancing_Links
[dijkstras]: https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm
[astar]: https://en.wikipedia.org/wiki/A*_search_algorithm

At first blush, considering Flow Free as a CSP seems like a simpler
formulation, because the constraints are so simple to state:

  * Each free space must be filled in by a color.
  * Each filled-in cell must be adjacent to exactly two cells of the same color.
  * Each dot must be adjacent to exactly one filled-in cell of the same color.
  
In contrast, shortest path algorithms like Dijkstra's and A\* seem
ill-suited for this problem because the zig-zaggy flows found in
puzzle solutions rarely resemble short, direct paths:

![a couple of solutions](/images/flow_solver/solutions.svg){: .center-image }

Despite this apparently poor fit, I decided to take the "A\*-like"
approach for two main reasons:

  1. I spent years in grad school coding up [search-based planners][littledog] with A\*.
  2. When you have a hammer, the whole world looks like a nail.
  
[littledog]: https://www.youtube.com/watch?v=KpqFebvRLeQ




Searching puzzle trees
======================

Although finding shortest paths is a general
[graph search][graphsearch] problem, my solver operates on a
[tree][wikitree] rooted at the initial puzzle state. Each node in the
tree not only stores a puzzle state, but also the *current position*
of each flow. We can generate a successor for a state -- i.e. its
"child" in the tree -- by extending one of the flows into an
empty cell adjacent to its current position.

[graphsearch]: https://en.wikipedia.org/wiki/Graph_traversal
[wikitree]: https://en.wikipedia.org/wiki/Tree_(graph_theory)

It's vitally important to reduce the [branching factor][bfactor] -- the average
number of children per node -- as much as possible, because a larger
branching factor means searching exponentially more nodes. For
example, a tree of branching factor 2 fully built out to depth of 10
has a modest 1,023 nodes, but doubling the branching factor to 4 would
increase the tree size to 349,525!

[bfactor]: https://en.wikipedia.org/wiki/Branching_factor

So to keep our branching factor small, for any state we will designate
a single *active color* which is permitted to move. Say we are solving
a puzzle with 6 colors. If we allow moves from any flow's current
position, a node might have as many as 24 children (6 colors times 4
directions of motion per color); however, imposing an active color
reduces the maximum number of children to 4.

Which color should we choose to be active? Probably the most
constrained one -- that is, the color with the fewest possible
moves. For example, consider the puzzle below, with the colored cell
backgrounds indicating the initial position for each flow. Both blue
and cyan have only one valid move available, but green has four:

![easy puzzle](/images/flow_solver/constrained.svg){: .center-image }

Hence, we should choose blue or cyan as the active color now, and
postpone moving green until later, in hopes that the board has gotten
more crowded by then. In the board above, we would say that the cyan
and blue flows have *forced moves* because there is only a single free
space next to the current position of each one.

Restricting moves to a deterministically-chosen active color has
another important side benefit: it prevents duplicate states from
arising in the tree. Otherwise, we could imagine arriving at the same
state via two different "routes" which differ only in the order the
flows are created (say moving red-then-green vs. moving
green-then-red).

Heuristic search
================

Although we could use [breadth-first search][bfs] to solve the puzzle,
I found that it's significantly faster to go with
[best-first search][bestfirst] instead. The method I ended up
using is kind of a poor man's [A\* search][astar] in that it computes
two quantities for each state $$x$$:

  * a cost-to-come $$g(x)$$ that considers all of the moves made to
    get to this state; and
  * a cost-to-go estimate $$h(x)$$ that estimates the remaining
    "distance" to a goal state.
    
My program defines the cost-to-come $$g(x)$$ by counting up the
"action cost" of each move. Each move incurs one unit of cost, with
two zero-cost exceptions: completing a flow, and forced moves.

[bfs]: https://en.wikipedia.org/wiki/Breadth-first_search
[bestfirst]: https://en.wikipedia.org/wiki/Best-first_search

The heuristic cost-to-go $$h(x)$$ is simply the number of empty spaces
remaining to be filled. In terms of A\* search, this is an
[inadmissible heuristic][astar-admissible] for my cost function
because it disregards the possibility of future zero-cost moves;
nevertheless, it works pretty well in practice.

[astar-admissible]: https://en.wikipedia.org/wiki/A*_search_algorithm#Admissibility_and_optimality

For best-first search, I put the nodes in a [heap][binheap]-based
[priority queue][pqueue] which is keyed on the total cost $$f(x) =
g(x) + h(x)$$ for each node $$x$$. As new moves are generated, they
are placed onto the queue; the next one to be dequeued will always be
the one with the minimum $$f(x)$$ value.

[binheap]: https://en.wikipedia.org/wiki/Binary_heap
[pqueue]: https://en.wikipedia.org/wiki/Priority_queue

As a concrete illustration, consider the tiny puzzle below:

![easy puzzle](/images/flow_solver/trivial_4x4.svg){: .center-image }

Red has made two moves, but the first was forced, so the total
cost-to-come $$g(x)$$ is 1. There are 8 empty squares remaining, so
the cost-to-go $$h(x)$$ is 8. Hence we see the total cost $$f(x) = 8 +
1 = 9$$.

Other forced moves
==================

Consider this puzzle state:

![a forced move situation](/images/flow_solver/forced.svg){: .center-image }

Given the moves made by blue, the *only* way that the free space to the
right of the orange flow could get occupied is if orange moves into
it. From this example, we can now say a move is forced:

  * ...if a flow has only one possible free cell to move into (the
    original definition); or, 

  * ...if an empty space is adjacent to a single flow's current
    position, and it has only one free neighbor.

Recognizing the second situation is a bit more code-intensive than the
first, but it's worth it, because we are always looking for ways to
reduce the branching factor. Without considering this type of forced
move, it might seem like orange has three possible moves, but two of
them are guaranteed to result in an awkwardly leftover empty square.

Dead-end checks
===============

Sometimes, advancing a flow may leave behind a square that has a way
into it, but no way out -- for instance, the one marked with an "X"
below:

![dead end!](/images/flow_solver/deadend.svg){: .center-image }

After any move -- e.g. completing the red flow above -- we can
recognize nearby "dead-end" cells by looking for a free cell that is
surrounded by three completed path segments or walls (the current
position or goal position of an in-progress flow don't count). Any
state containing such a dead-end is *unsolvable*, and we need not
continue searching any of its successors.

Detecting unsolvable states early can prevent a lot of unnecessary
work. The search might still eventually find a solution if we didn't
recognize and discard these, it might just take a lot more time and
memory, exploring all possible successors of an unsolvable state.

Stranded colors and stranded regions
====================================

It's possible that extending one flow can totally block off another
one, preventing its completion. This can be as simple as surrounding
a flow's current position so it has nowhere to go, like the poor
yellow flow in this state:

![yellow is surrounded](/images/flow_solver/surrounded_color.svg){: .center-image }

In a more subtle case, one flow can divide up the free space so
that it is impossible to connect another flow's current position to
its eventual goal, like blue depriving red in the image below:

![red is stranded](/images/flow_solver/stranded_color.svg){: .center-image }

Finally, a move may create a bubble of freespace that is impossible to
fill later, like the top-left 4x2 free area here:

![a region is stranded](/images/flow_solver/stranded_region.svg){: .center-image }

Although red, cyan, and orange can all enter the 4x2 area, it would be
useless for them to do so because they must terminate outside of it,
which would be impossible.

The former two illustrations are examples of *stranded colors* and the latter
is an example of a *stranded region*. We can detect both using
[connected component labeling][ccanalysis]. We start by assigning each
continuous region of free space a unique identifier, which can be done
efficiently via a [disjoint-set data structure][dsds]. Here are the
results for the two states above (color hatching corresponds
to region labels):

[ccanalysis]: https://en.wikipedia.org/wiki/Connected-component_labeling
[dsds]: https://en.wikipedia.org/wiki/Disjoint-set_data_structure

![regions labeled](/images/flow_solver/regions.svg){: .center-image }

To see which colors and regions might be stranded, we keep track of
which current positions and which goal dots are horizontally or
vertically adjacent to each region. Then the logic is:

 * For each non-completed color, there must exist a region which touches
   both its current position and goal position, otherwise the color is
   stranded.
   
 * For each distinct region, there must exist some color whose current
   position and goal position touch it, otherwise the region is
   stranded.

It's important to consider the space/time tradeoff presented by
validity checks like these. Even though connected component analysis
is pretty fast, it's many orders of magnitude slower than just
checking if a move is permitted; hence, adding a validity check will
only provide an overall program speedup if performing it is faster on
average than expanding all successors of a given node. On the other
hand, these types of validity checks pretty much always reduce the
space needed for search, because successors of states found to be
unsolvable will never be allocated.

Chokepoint detection
====================

Let us define a *bottleneck* as a narrow region of freespace of a
given width $$W$$. If closing the bottleneck renders more than $$W$$
colors unsolvable (by separating their current and goal positions into
distinct regions of freespace), then the bottleneck has become a
*chokepoint*, and the puzzle can not be solved. Here's a example to
help explain:

![chokepoint](/images/flow_solver/chokepoint.svg){: .center-image }

The cells cross-hatched in gray constitute a bottleneck separating the
current and goal positions of red, blue, yellow, cyan, and magenta. No
matter where any of those five flows go, they will have to pass through the
shaded cells in order to reach their goals; however, since the
bottleneck is just three cells wide, we have a chokepoint and the
puzzle is unsolvable from this state.

Fast-forwarding
===============

For this project, I chose to use a [stack-based allocator][salloc] to
create nodes. Basically, a stack allocator is lovely when you want to
be able to "undo" one or more memory allocations, and it dovetails
perfectly with this search problem when it comes to handling forced moves.

[salloc]:https://blog.molecular-matters.com/2012/08/27/memory-allocation-strategies-a-stack-like-lifo-allocator/

Let's say we discover, upon entering a particular state, that there is
a forced move.  Suppose the state resulting from the forced move
passes all validity checks. If we enqueue this successor, we know it
will be dequeued *immediately*. Why?  Since forced moves cost zero,
the cost-to-come has not increased, but the cost-to-go has decreased
by one. Why go through all of the trouble to enqueue and dequeue it?
Why not just skip the queue entirely?

Conversely, imagine that making the forced move leads to an unsolvable
state. In this case, we might wish to "undo" the allocation of the
successor node -- after all, memory is limited, and we might want to
use that slot of memory for a potentially-valid node later on!

But this approach doesn't just work for a single forced move. What if
one forced move leads to another and another, starting a *chain* of
forced moves? Once again, we should skip the queue for all of the
intermediate states, only enqueuing the final result state which has
no forced moves, and which passes all of the validity checks. On the
other hand, if at any point we fail a validity check after a forced
move, then we can de-allocate the entire chain, saving lots of
memory. Here's an example of such a chain:

![let's fast forward](/images/flow_solver/fast_forward.svg){: .center-image }

On the left, orange has just moved into the square adjacent to the
cyan flow. Cyan must now follow the single-cell-wide passage until the
flow is completed, creating a 2x1 stranded region that invalidates the
entire chain; hence, we can de-allocate these two states along with
all of the intermediate ones as well. For the purposes of memory
usage, its as if none of these nodes ever existed.

Other whistles and bells
========================

If a node is invalid, we would like it to fail a validity check as
quickly as possible. Tests costs time, and we will often see a program
speedup if we run the cheap ones first. Accordingly, my solver
orders validity checks from fastest to slowest, starting with dead
ends, then stranded regions/colors, and finally bottlenecks.

Viewed in this light, we can consider the dead-end check not just a
way of verifying a node's potential validity, but also as a test of
whether we should allow the considerably more expensive connected
component analysis code to execute at all. As a wise programmer
observed, [the fastest code is the code that never runs][fastest]. Or
by analogy to medicine, don't schedule an MRI until after you've
completed the physical examination!

[fastest]: http://www.ilikebigbits.com/blog/2015/12/6/the-fastest-code-is-the-code-that-never-runs

There were a few other features which sped up puzzle solution, but
which I won't discuss in depth here. There is code to choose which dot
of a pair should be a flow's initial position and which one its goal;
and other code to decide when to switch the active color. These little
details can have a big impact on both runtime and memory use.

There's also a way to load hints into the solver, which helped during
development when I came across a puzzle that was taking too much space
and time to solve. The `jumbo_14x14_19.txt` puzzle was the bane of my
existence for a few days, but finally became tractable after I added a
few more features. [This site][slns] was helpful to check my work, too.

[slns]: https://flowfreesolutions.com/

As I discovered in grad school, a good way to devise validity
checks is to visualize intermediate states after a search has failed
-- if I can figure out how express in code the reasons why some of
them are in fact invalid, I can prevent them from ever clogging up
the tree in the first place.

Wrapping up {#theend}
===========

In the end, the program I wrote turned out a bit long and a
bit complicated.[^1] The good news is it that exposes just about every
one of the features described above as a command-line switch -- just
run `flow_solver --help` to see them all.

[^1]: Please consult blog title if surprised.

Also, as I was preparing to write up this post, this happened on Facebook:

![oooh pretty output](/images/flow_solver/facebook.png){:
 .center-threequarters .border }

I want to say I was half-correct in my reply there -- since I posted
that last comment, I've gotten plenty of "replay value" out of
trying to get the program to solve puzzles faster and better.  So as a
comparison, here's a "scoreboard" of sorts showing the difference
between the performance of the final program, and performance on
August 21 -- the day after this Facebook exchange -- for all of the
puzzles in the repository (lower is better in the "% of init"
columns):

|--
| Puzzle | Init time | Final time | % of init  | Init nodes | Final nodes | % of init
| :-- | --: | --: | --: | --: | --: | --: |
| [regular_5x5_01.txt](/images/flow_solver/regular_5x5_01.svg) | 0.001 | 0.001 | 100% | 16 | 16 | 100%
| [regular_6x6_01.txt](/images/flow_solver/regular_6x6_01.svg) | 0.001 | 0.001 | 100% | 26 | 25 | 96%
| [regular_7x7_01.txt](/images/flow_solver/regular_7x7_01.svg) | 0.001 | 0.001 | 100% | 42 | 40 | 95%
| [regular_8x8_01.txt](/images/flow_solver/regular_8x8_01.svg) | 0.001 | 0.001 | 100% | 64 | 55 | 86%
| [regular_9x9_01.txt](/images/flow_solver/regular_9x9_01.svg) | 0.001 | 0.001 | 100% | 206 | 166 | 81%
| [extreme_8x8_01.txt](/images/flow_solver/extreme_8x8_01.svg) | 0.001 | 0.001 | 100% | 289 | 76 | 26%
| [extreme_9x9_01.txt](/images/flow_solver/extreme_9x9_01.svg) | 0.001 | 0.001 | 100% | 178 | 111 | 62%
| [extreme_9x9_30.txt](/images/flow_solver/extreme_9x9_30.svg) | 0.002 | 0.001 | 100% | 565 | 146 | 26%
| [extreme_10x10_01.txt](/images/flow_solver/extreme_10x10_01.svg) | 0.037 | 0.034 | 92% | 7,003 | 4,625 | 66%
| [extreme_10x10_30.txt](/images/flow_solver/extreme_10x10_30.svg) | 0.024 | 0.008 | 33% | 3,659 | 1,069 | 29%
| [extreme_11x11_07.txt](/images/flow_solver/extreme_11x11_07.svg) | 1.290 | 0.021 | 2% | 197,173 | 2,645 | 1%
| [extreme_11x11_15.txt](/images/flow_solver/extreme_11x11_15.svg) | 0.103 | 0.004 | 4% | 13,289 | 502 | 4%
| [extreme_11x11_20.txt](/images/flow_solver/extreme_11x11_20.svg) | 0.731 | 0.001 | < 1% | 102,535 | 227 | < 1%
| [extreme_11x11_30.txt](/images/flow_solver/extreme_11x11_30.svg) | 0.167 | 0.003 | 2% | 21,792 | 442 | 2%
| [extreme_12x12_01.txt](/images/flow_solver/extreme_12x12_01.svg) | 2.664 | 0.211 | 8% | 315,600 | 20,440 | 6%
| [extreme_12x12_02.txt](/images/flow_solver/extreme_12x12_02.svg) | 0.052 | 0.013 | 25% | 6,106 | 1,408 | 23%
| [extreme_12x12_28.txt](/images/flow_solver/extreme_12x12_28.svg) | 2.142 | 0.823 | 38% | 283,589 | 84,276 | 30%
| [extreme_12x12_29.txt](/images/flow_solver/extreme_12x12_29.svg) | 0.657 | 0.107 | 16% | 85,906 | 12,417 | 14%
| [extreme_12x12_30.txt](/images/flow_solver/extreme_12x12_30.svg) | 8.977 | 0.002 | < 1% | 1,116,520 | 330 | < 1%
| [jumbo_10x10_01.txt](/images/flow_solver/jumbo_10x10_01.svg) | 0.001 | 0.001 | 100% | 235 | 167 | 71%
| [jumbo_11x11_01.txt](/images/flow_solver/jumbo_11x11_01.svg) | 0.014 | 0.001 | 7% | 1,627 | 210 | 13%
| [jumbo_12x12_30.txt](/images/flow_solver/jumbo_12x12_30.svg) | 0.052 | 0.002 | 4% | 6,646 | 345 | 5%
| [jumbo_13x13_26.txt](/images/flow_solver/jumbo_13x13_26.svg) | 0.385 | 0.149 | 39% | 38,924 | 16,897 | 43%
| [jumbo_14x14_01.txt](/images/flow_solver/jumbo_14x14_01.svg) | 0.015 | 0.003 | 20% | 1,399 | 389 | 28%
| [jumbo_14x14_02.txt](/images/flow_solver/jumbo_14x14_02.svg) | 254.903 | 0.886 | < 1% | 20,146,761 | 61,444 | < 1%
| [jumbo_14x14_19.txt](/images/flow_solver/jumbo_14x14_19.svg) | *300.415* | 1.238 | *< 1%* | *29,826,161* | 97,066 | *< 1%*
| [jumbo_14x14_21.txt](/images/flow_solver/jumbo_14x14_21.svg) | 16.184 | 0.018 | < 1% | 1,431,364 | 1,380 | < 1%
| [jumbo_14x14_30.txt](/images/flow_solver/jumbo_14x14_30.svg) | 50.818 | 1.558 | 3% | 4,577,817 | 130,734 | 3%
|=== 
{: .bigtable }

Note that I allowed the initial version of the program to use up to 8
GB of RAM, and still ran out of memory solving `jumbo_14x14_19.txt`
(as mentioned above, it was a thorny one). Other fun 
observations:

  * The final version is always at least as efficient as the initial,
    in terms of both time and space.
    
  * The average improvement (speedup/reduction in storage) from
    initial to final was over 10x!
    
  * The final version solves each puzzle in under 1.6 seconds, using
    less than 140K nodes.
    
Am I happy with the final results? Definitely. Did I waste waaay too
much time on this project? For sure. Did my fiancée start
binge-watching [Stranger Things][sthings] on Netflix without me while I was
obsessing over Flow Free? Sadly, yes.

[sthings]:https://en.wikipedia.org/wiki/Stranger_Things_(TV_series)

As usual, download the code yourself from [github][repo] and give it a spin!

Appendix: Prior work {#priorwork}
====================

It turns out that I am unwittingly following in a long line of
would-be Flow Free automators. Since I was in the air above southeast
Asia when I started this project, I didn't Google any of this, but now
that I'm in documentation mode, here's a chronological listing of what
I could dig up:

 * Jun 2011: just a [video][2011_06_11_sln] of a solver proceeding at a leisurely pace, couldn't find source.
 * Nov 2011: [solver in C++][2011_11_11_sln] for a
   [related puzzle][nlink], looks like a standard
   [recursive backtracker][btrack].
 * Aug 2012: [solver in Perl][2012_08_10_sln], mothballed, doesn't
   work, but README has a link to an [interesting paper][waset].
 * Oct 2012: [solver in C#][2012_10_23_sln], appears not to work based
   upon final commit message.
 * Feb 2013: chatting about designing solvers in a [C++ forum][2013_02_22_cns].
 * Jul 2013: [solver in R][2013_07_03_sln], framed as
   [integer programming][iprog].[^2]
 * Sep 2013: [two][2013_09_19_sln] [solvers][2013_09_23_sln] from the
   same programmer, both in C#, both use [DLX][dlx]; author notes 
   long solve times for large grids.
 * Feb 2014: solver as [coding assignment][2014_02_05_cns] in a C++
   class, yikes.
 * Mar 2014: [StackOverflow chat][2014_05_13_cns] on designing a
   solver, top answer suggests reducing to [SAT][SAT].[^3]
 * Feb 2016: [solver in MATLAB][2016_04_15_sln] using backtracking;
   very slow on puzzles >10x10 but it does live image capture and
   there's a cool [YouTube demo][demovid].
 
Without running the solvers listed here, it's difficult to compare my
performance to theirs, but I'd be willing to hazard an educated guess
that mine is pretty speedy compared to the others, especially on large
puzzles.
 
[^2]: In my limited experience, if you have to solve a problem and the best way you can express it is as an integer program, you have made poor life choices.

[^3]: Same. If your best choice for a problem is "reduce to SAT", maybe find a new problem?
 
[btrack]: https://en.wikipedia.org/wiki/Backtracking
[nlink]: https://en.wikipedia.org/wiki/Numberlink
[waset]: http://www.waset.org/Publications/recursive-path-finding-in-a-dynamic-maze-with-modified-tremaux-s-algorithm/11300
[iprog]: https://en.wikipedia.org/wiki/Integer_programming
[demovid]: https://www.youtube.com/watch?v=kfxZCnNZfTU

[2011_06_11_sln]: https://www.youtube.com/watch?v=ghEK_79owaU
[2011_11_11_sln]: https://github.com/imos/Puzzle/tree/master/NumberLink
[2012_08_10_sln]: https://github.com/DeeNewcum/FlowFree
[2012_10_23_sln]: https://github.com/JamesDunne/freeflow-solver
[2013_02_22_cns]: http://www.cplusplus.com/forum/general/93467/
[2013_07_03_sln]: https://www.r-bloggers.com/using-r-and-integer-programming-to-find-solutions-to-flowfree-game-boards/
[2013_09_19_sln]: https://github.com/taylorjg/FlowFreeDlx
[2013_09_23_sln]: https://github.com/taylorjg/FlowFreeSolverWpf
[2014_02_05_cns]: http://cs.mwsu.edu/~terry/?route=/courses/3013/content/assignments/page/Program1.md
[2014_05_13_cns]: http://stackoverflow.com/questions/23622068/algorithm-for-solving-flow-free-game
[2016_04_15_sln]: https://github.com/GameAutomators/Flow-Free


    
    
