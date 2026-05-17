- [Play](https://lczero.org/play/quickstart)
- [Watch](https://lczero.org/watch)
- [Contribute](https://lczero.org/contribute)
- [Development](https://lczero.org/dev)
- [About](https://lczero.org/about)
- [Blog](https://lczero.org/blog)

[Edit on wiki](https://github.com/LeelaChessZero/lc0/wiki/Lc0-options/_edit)

# Lc0 options

# Lc0 options

| _Flag_ | _UCI option_ | Description |
| --- | --- | --- |
| **–help**, **-h** |  | Show help and exit. |
| **–weights**, **-w** | **WeightsFile** | Path from which to load network weights.Setting it to <autodiscover> makes it search in ./ and ./weights/ subdirectories for the latest (by file date) file which looks like weights. _Default value:_` <autodiscover>` |
| **–backend**, **-b** | **Backend** | Neural network computational backend to use. _Default value:_`cudnn` _Allowed values:_` cudnn`, `cudnn-fp16`, `opencl`, `blas`, `check`, `random`, `roundrobin`, `multiplexing`, `demux` |
| **–backend-opts**, **-o** | **BackendOptions** | Parameters of neural network backend. Exact parameters differ per backend. |
| **–threads**, **-t** | **Threads** | Number of (CPU) worker threads to use. _Default value:_`2` _Minimum value:_`1` _Maximum value:_` 128` |
| **–nncache** | **NNCacheSize** | Number of positions to store in a memory cache. A large cache can speed up searching, but takes memory. _Default value:_`200000` _Minimum value:_`0` _Maximum value:_` 999999999` |

## Search options

| _Flag_ | _UCI option_ | Description |
| --- | --- | --- |
| **–minibatch-size** | **MinibatchSize** | How many positions the engine tries to batch together for parallel NN computation. Larger batches may reduce strength a bit, especially with a small number of playouts. _Default value:_`256` _Minimum value:_`1` _Maximum value:_` 1024` |
| **–max-prefetch** | **MaxPrefetch** | When the engine cannot gather a large enough batch for immediate use, try to prefetch up to X positions which are likely to be useful soon, and put them into cache. _Default value:_`32` _Minimum value:_`0` _Maximum value:_` 1024` |
| **–cpuct** | **CPuct** | cpuct\_init constant from “UCT search” algorithm. Higher values promote more exploration/wider search, lower values promote more confidence/deeper search. _Default value:_`3.00` _Minimum value:_`0.00` _Maximum value:_` 100.00` |
| **–cpuct-base** | **CPuctBase** | cpuct\_base constant from “UCT search” algorithm. Lower value means higher growth of Cpuct as number of node visits grows. _Default value:_`19652.00` _Minimum value:_`1.00` _Maximum value:_` 1000000000.00` |
| **–cpuct-factor** | **CPuctFactor** | Multiplier for the cpuct growth formula. _Default value:_`2.00` _Minimum value:_`0.00` _Maximum value:_` 1000.00` |
| **–temperature** | **Temperature** | Tau value from softmax formula for the first move. If equal to 0, the engine picks the best move to make. Larger values increase randomness while making the move. _Default value:_`0.00` _Minimum value:_`0.00` _Maximum value:_` 100.00` |
| **–tempdecay-moves** | **TempDecayMoves** | Reduce temperature for every move from the game start to this number of moves, decreasing linearly from initial temperature to 0. A value of 0 disables tempdecay. _Default value:_`0` _Minimum value:_`0` _Maximum value:_` 100` |
| **–temp-cutoff-move** | **TempCutoffMove** | Move number, starting from which endgame temperature is used rather than initial temperature. Setting it to 0 disables cutoff. _Default value:_`0` _Minimum value:_`0` _Maximum value:_` 1000` |
| **–temp-endgame** | **TempEndgame** | Temperature used during endgame (starting from cutoff move). Endgame temperature doesn’t decay. _Default value:_`0.00` _Minimum value:_`0.00` _Maximum value:_` 100.00` |
| **–temp-value-cutoff** | **TempValueCutoff** | When move is selected using temperature, bad moves (with win probability less than X than the best move) are not considered at all. _Default value:_`100.00` _Minimum value:_`0.00` _Maximum value:_` 100.00` |
| **–temp-visit-offset** | **TempVisitOffset** | Reduces visits by this value when picking a move with a temperature. When the offset is less than number of visits for a particular move, that move is not picked at all. _Default value:_`0.00` _Minimum value:_`-1.00` _Maximum value:_` 1000.00` |
| **–noise**, **-n** | **DirichletNoise** | Add Dirichlet noise to root node prior probabilities. This allows the engine to discover new ideas during training by exploring moves which are known to be bad. Not normally used during play. _Default value:_` false` |
| **–verbose-move-stats** | **VerboseMoveStats** | Display Q, V, N, U and P values of every move candidate after each move. _Default value:_` false` |
| **–smart-pruning-factor** | **SmartPruningFactor** | Do not spend time on the moves which cannot become bestmove given the remaining time to search. When no other move can overtake the current best, the search stops, saving the time. Values greater than 1 stop less promising moves from being considered even earlier. Values less than 1 causes hopeless moves to still have some attention. When set to 0, smart pruning is deactivated. _Default value:_`1.33` _Minimum value:_`0.00` _Maximum value:_` 10.00` |
| **–fpu-strategy** | **FpuStrategy** | How is an eval of unvisited node determined. “reduction” subtracts --fpu-reduction value from the parent eval. “absolute” sets eval of unvisited nodes to the value specified in --fpu-value. _Default value:_`reduction` _Allowed values:_` reduction`, `absolute` |
| **–fpu-reduction** | **FpuReduction** | “First Play Urgency” reduction (used when FPU strategy is “reduction”). Normally when a move has no visits, it’s eval is assumed to be equal to parent’s eval. With non-zero FPU reduction, eval of unvisited move is decreased by that value, discouraging visits of unvisited moves, and saving those visits for (hopefully) more promising moves. _Default value:_`1.20` _Minimum value:_`-100.00` _Maximum value:_` 100.00` |
| **–fpu-value** | **FpuValue** | “First Play Urgency” value. When FPU strategy is “absolute”, value of unvisited node is assumed to be equal to this value, and does not depend on parent eval. _Default value:_`-1.00` _Minimum value:_`-1.00` _Maximum value:_` 1.00` |
| **–cache-history-length** | **CacheHistoryLength** | Length of history, in half-moves, to include into the cache key. When this value is less than history that NN uses to eval a position, it’s possble that the search will use eval of the same position with different history taken from cache. _Default value:_`0` _Minimum value:_`0` _Maximum value:_` 7` |
| **–policy-softmax-temp** | **PolicyTemperature** | Policy softmax temperature. Higher values make priors of move candidates closer to each other, widening the search. _Default value:_`2.20` _Minimum value:_`0.10` _Maximum value:_` 10.00` |
| **–max-collision-events** | **MaxCollisionEvents** | Allowed node collision events, per batch. _Default value:_`32` _Minimum value:_`1` _Maximum value:_` 1024` |
| **–max-collision-visits** | **MaxCollisionVisits** | Total allowed node collision visits, per batch. _Default value:_`9999` _Minimum value:_`1` _Maximum value:_` 1000000` |
| **–out-of-order-eval** | **OutOfOrderEval** | During the gathering of a batch for NN to eval, if position happens to be in the cache or is terminal, evaluate it right away without sending the batch to the NN. When off, this may only happen with the very first node of a batch; when on, this can happen with any node. _Default value:_` true` |
| **–syzygy-fast-play** | **SyzygyFastPlay** | With DTZ tablebase files, only allow the network pick from winning moves that have shortest DTZ to play faster (but not necessarily optimally). _Default value:_` true` |
| **–multipv** | **MultiPV** | Number of game play lines (principal variations) to show in UCI info output. _Default value:_`1` _Minimum value:_`1` _Maximum value:_` 500` |
| **–score-type** | **ScoreType** | What to display as score. Either centipawns (the UCI default), win percentage or Q (the actual internal score) multiplied by 100. _Default value:_`centipawn` _Allowed values:_` centipawn`, `win_percentage`, `Q` |
| **–history-fill** | **HistoryFill** | Neural network uses 7 previous board positions in addition to the current one. During the first moves of the game such historical positions don’t exist, but they can be synthesized. This parameter defines when to synthesize them (always, never, or only at non-standard fen position). _Default value:_`fen_only` _Allowed values:_` no`, `fen_only`, `always` |
| **–kldgain-average-interval** | **KLDGainAverageInterval** | Used to decide how frequently to evaluate the average KLDGainPerNode to check the MinimumKLDGainPerNode, if specified. _Default value:_`100` _Minimum value:_`1` _Maximum value:_` 10000000` |
| **–minimum-kldgain-per-node** | **MinimumKLDGainPerNode** | If greater than 0 search will abort unless the last KLDGainAverageInterval nodes have an average gain per node of at least this much. _Default value:_`0.00` _Minimum value:_`0.00` _Maximum value:_` 1.00` |

## Engine options

| _Flag_ | _UCI option_ | Description |
| --- | --- | --- |
| **–slowmover** | **Slowmover** | Budgeted time for a move is multiplied by this value, causing the engine to spend more time (if value is greater than 1) or less time (if the value is less than 1). _Default value:_`1.00` _Minimum value:_`0.00` _Maximum value:_` 100.00` |
| **–move-overhead** | **MoveOverheadMs** | Amount of time, in milliseconds, that the engine subtracts from it’s total available time (to compensate for slow connection, interprocess communication, etc). _Default value:_`200` _Minimum value:_`0` _Maximum value:_` 100000000` |
| **–time-midpoint-move** | **TimeMidpointMove** | The move where the time budgeting algorithm guesses half of all games to be completed by. Half of the time allocated for the first move is allocated at approximately this move. _Default value:_`51.50` _Minimum value:_`1.00` _Maximum value:_` 100.00` |
| **–time-steepness** | **TimeSteepness** | “Steepness” of the function the time budgeting algorithm uses to consider when games are completed. Lower values leave more time for the endgame, higher values use more time for each move before the midpoint. _Default value:_`7.00` _Minimum value:_`1.00` _Maximum value:_` 100.00` |
| **–syzygy-paths**, **-s** | **SyzygyPath** | List of Syzygy tablebase directories, list entries separated by system separator (";" for Windows, “:” for Linux). |
| **–ponder** | **Ponder** | This option is ignored. Here to please chess GUIs. _Default value:_` true` |
| **–immediate-time-use** | **ImmediateTimeUse** | Fraction of time saved by smart pruning, which is added to the budget to the next move rather than to the entire game. When 1, all saved time is added to the next move’s budget; when 0, saved time is distributed among all future moves. _Default value:_`1.00` _Minimum value:_`0.00` _Maximum value:_` 1.00` |
| **–ramlimit-mb** | **RamLimitMb** | Maximum memory usage for the engine, in megabytes. The estimation is very rough, and can be off by a lot. For example, multiple visits to a terminal node counted several times, and the estimation assumes that all positions have 30 possible moves. When set to 0, no RAM limit is enforced. _Default value:_`0` _Minimum value:_`0` _Maximum value:_` 100000000` |
| **–config**, **-c** | **ConfigFile** | Path to a configuration file. The format of the file is one command line parameter per line, e.g.:--weights=/path/to/weights _Default value:_` lc0.config` |
| **–logfile**, **-l** | **LogFile** | Write log to that file. Special value <stderr> to output the log to the console. |

## Selfplay options

| _Flag_ | _UCI option_ | Description |
| --- | --- | --- |
| **–share-trees** | **ShareTrees** | When on, game tree is shared for two players; when off, each side has a separate tree. _Default value:_` true` |
| **–games** | **Games** | Number of games to play. _Default value:_`-1` _Minimum value:_`-1` _Maximum value:_` 999999` |
| **–parallelism** | **Parallelism** | Number of games to play in parallel. _Default value:_`8` _Minimum value:_`1` _Maximum value:_` 256` |
| **–playouts** | **Playouts** | Number of playouts per move to search. _Default value:_`-1` _Minimum value:_`-1` _Maximum value:_` 999999999` |
| **–visits** | **Visits** | Number of visits per move to search. _Default value:_`-1` _Minimum value:_`-1` _Maximum value:_` 999999999` |
| **–movetime** | **MoveTime** | Time per move, in milliseconds. _Default value:_`-1` _Minimum value:_`-1` _Maximum value:_` 999999999` |
| **–training** | **Training** | Enables writing training data. The training data is stored into a temporary subdirectory that the engine creates. _Default value:_` false` |
| **–verbose-thinking** | **VerboseThinking** | Show verbose thinking messages. _Default value:_` false` |
| **–resign-playthrough** | **ResignPlaythrough** | The percentage of games which ignore resign. _Default value:_`0.00` _Minimum value:_`0.00` _Maximum value:_` 100.00` |
| **–reuse-tree** | **ReuseTree** | Reuse the search tree between moves. _Default value:_` false` |
| **–resign-wdlstyle** | **ResignWDLStyle** | If set, resign percentage applies to any output state being above 100% minus the percentage instead of winrate being below. _Default value:_` false` |
| **–resign-percentage** | **ResignPercentage** | Resign when win percentage drops below specified value. _Default value:_`0.00` _Minimum value:_`0.00` _Maximum value:_` 100.00` |
| **–resign-earliest-move** | **ResignEarliestMove** | Earliest move that resign is allowed. _Default value:_`0` _Minimum value:_`0` _Maximum value:_` 1000` |
| **–interactive** |  | Run in interactive mode with UCI-like interface. _Default value:_` false` |

## Benchmark options

| _Flag_ | _UCI option_ | Description |
| --- | --- | --- |
| **–nodes** |  | Number of nodes to run as a benchmark. _Default value:_`-1` _Minimum value:_`-1` _Maximum value:_` 999999999` |
| **–movetime** |  | Benchmark time allocation, in milliseconds. _Default value:_`10000` _Minimum value:_`-1` _Maximum value:_` 999999999` |
| **–fen** |  | Benchmark initial position FEN. _Default value:_` rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1` |

Last Updated: 2019-12-08

- [GitHub](https://github.com/LeelaChessZero/)
- [Discord](https://discord.gg/pKujYxD)
- [Forum](https://groups.google.com/forum/#!forum/lczero)
- [x.com](https://x.com/leelachesszero)