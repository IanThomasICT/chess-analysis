[Skip to last reply](https://forums.developer.nvidia.com/t/stockfish-cuda-gpu-accelerated-chess-engine-for-dgx-spark/359551/3) [Skip to top](https://forums.developer.nvidia.com/t/stockfish-cuda-gpu-accelerated-chess-engine-for-dgx-spark/359551/1)

[Skip to main content](https://forums.developer.nvidia.com/t/stockfish-cuda-gpu-accelerated-chess-engine-for-dgx-spark/359551#main-container)

# [Stockfish CUDA - GPU-Accelerated Chess Engine for DGX SPARK](https://forums.developer.nvidia.com/t/stockfish-cuda-gpu-accelerated-chess-engine-for-dgx-spark/359551)

[Accelerated Computing](https://forums.developer.nvidia.com/c/accelerated-computing/5) [DGX Spark / GB10 User Forum](https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10/719) [DGX Spark / GB10 Projects](https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10/dgx-spark-gb10-projects/723)

- [cuda](https://forums.developer.nvidia.com/tag/cuda/31),
- [jetson](https://forums.developer.nvidia.com/tag/jetson/587),
- [gpu](https://forums.developer.nvidia.com/tag/gpu/264),
- [llama](https://forums.developer.nvidia.com/tag/llama/1043),
- [gaming](https://forums.developer.nvidia.com/tag/gaming/590)

[Home](https://forums.developer.nvidia.com/categories "All Categories")

You have selected **0** posts.

[select all](https://forums.developer.nvidia.com/t/stockfish-cuda-gpu-accelerated-chess-engine-for-dgx-spark/359551)

[cancel selecting](https://forums.developer.nvidia.com/t/stockfish-cuda-gpu-accelerated-chess-engine-for-dgx-spark/359551)

[Feb 3](https://forums.developer.nvidia.com/t/stockfish-cuda-gpu-accelerated-chess-engine-for-dgx-spark/359551/1 "Jump to the first post")

1 / 3


Feb 3


[May 2](https://forums.developer.nvidia.com/t/stockfish-cuda-gpu-accelerated-chess-engine-for-dgx-spark/359551/3)

## post by marcosabait on Feb 3

![](https://sea2.discourse-cdn.com/nvidia/user_avatar/forums.developer.nvidia.com/marcosabait/96/460383_2.png)


marcosabait

[Feb 3](https://forums.developer.nvidia.com/t/stockfish-cuda-gpu-accelerated-chess-engine-for-dgx-spark/359551 "Post date")

Stockfish chess engine accelerated with CUDA on DGX SPARK, leveraging 128GB unified memory.

This project accelerates Stockfish 18, the world’s strongest open-source chess engine, using

NVIDIA CUDA on DGX SPARK. It leverages the Blackwell GPU architecture and 128GB unified memory to achieve 3.3x speedup over CPU baseline. Key innovations include GPU-accelerated NNUE neural network evaluation using Tensor Cores, unified memory transposition tables up to 96GB, and batch evaluation of 256 positions. The implementation uses cudaMallocManaged for seamless CPU/GPU memory sharing and WMMA for int8 matrix operations.

Technologies Used:

- CUDA 12.0+
- Unified Memory (cudaMallocManaged)
- Tensor Cores (WMMA)
- Blackwell Architecture (SM 12.x)
- DGX SPARK Platform

Industry/Application:

Artificial Intelligence, Gaming, High Performance Computing, Game Tree Search

Performance Metrics:

- 400M+ nodes/second with 64 threads
- 3.3x speedup vs CPU-only
- 96GB unified memory utilization
- 119GB total memory available

Links:

GitHub: [Release stockfish-cuda-full (109MB) ⭐ Versione completa · EquaCoin/stockfish-dgx-spark · GitHub](https://github.com/EquaCoin/stockfish-dgx-spark/releases/tag/v1.0)

502
views
1
link


![](https://developer.download.nvidia.com/images/forums/profile-default-devtalk-84.png)2

![](https://sea2.discourse-cdn.com/nvidia/user_avatar/forums.developer.nvidia.com/marcosabait/48/460383_2.png)

2 months later


## post by Curefab on Apr 16

16 days later


## post by Curefab on May 2

Reply

### Related topics

| Topic | Replies | Views | Activity |
| --- | --- | --- | --- |
| [Beaten by GPU in chess Chess engine running entirely on GPU](https://forums.developer.nvidia.com/t/beaten-by-gpu-in-chess-chess-engine-running-entirely-on-gpu/4200)<br>[CUDA Programming and Performance](https://forums.developer.nvidia.com/c/accelerated-computing/cuda/cuda-programming-and-performance/7) | [16](https://forums.developer.nvidia.com/t/beaten-by-gpu-in-chess-chess-engine-running-entirely-on-gpu/4200/1) | 46.3k | [Dec 14 '16](https://forums.developer.nvidia.com/t/beaten-by-gpu-in-chess-chess-engine-running-entirely-on-gpu/4200/17) |
| [Chess on GPU fun](https://forums.developer.nvidia.com/t/chess-on-gpu-fun/3044)<br>[CUDA Programming and Performance](https://forums.developer.nvidia.com/c/accelerated-computing/cuda/cuda-programming-and-performance/7) | [6](https://forums.developer.nvidia.com/t/chess-on-gpu-fun/3044/1) | 15.5k | [Apr 25 '08](https://forums.developer.nvidia.com/t/chess-on-gpu-fun/3044/7) |
| [(Board)Game engines on GPU](https://forums.developer.nvidia.com/t/board-game-engines-on-gpu/13561)<br>[CUDA Programming and Performance](https://forums.developer.nvidia.com/c/accelerated-computing/cuda/cuda-programming-and-performance/7) | [4](https://forums.developer.nvidia.com/t/board-game-engines-on-gpu/13561/1) | 6.5k | [Dec 02 '09](https://forums.developer.nvidia.com/t/board-game-engines-on-gpu/13561/5) |
| [Why is this problem not well suited to GPU compute? Brute-forcing chess magic](https://forums.developer.nvidia.com/t/why-is-this-problem-not-well-suited-to-gpu-compute-brute-forcing-chess-magic/318877)<br>[CUDA Programming and Performance](https://forums.developer.nvidia.com/c/accelerated-computing/cuda/cuda-programming-and-performance/7) <br>- [cuda](https://forums.developer.nvidia.com/tag/cuda/31) | [9](https://forums.developer.nvidia.com/t/why-is-this-problem-not-well-suited-to-gpu-compute-brute-forcing-chess-magic/318877/1) | 333 | [Jan 07 '25](https://forums.developer.nvidia.com/t/why-is-this-problem-not-well-suited-to-gpu-compute-brute-forcing-chess-magic/318877/10) |
| [NVIDIA folks – where is this promised nvfp4 speedup?](https://forums.developer.nvidia.com/t/nvidia-folks-where-is-this-promised-nvfp4-speedup/357113)<br>[DGX Spark / GB10](https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10/dgx-spark-gb10/721) | [27](https://forums.developer.nvidia.com/t/nvidia-folks-where-is-this-promised-nvfp4-speedup/357113/1) | 2.7k | [Mar 26](https://forums.developer.nvidia.com/t/nvidia-folks-where-is-this-promised-nvfp4-speedup/357113/29) |
| [FP4 on DGX Spark — Why It Doesn’t Scale Like You’d Expect](https://forums.developer.nvidia.com/t/fp4-on-dgx-spark-why-it-doesnt-scale-like-youd-expect/360142)<br>[DGX Spark / GB10](https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10/dgx-spark-gb10/721) | [214](https://forums.developer.nvidia.com/t/fp4-on-dgx-spark-why-it-doesnt-scale-like-youd-expect/360142/1) | 5.8k | [Mar 13](https://forums.developer.nvidia.com/t/fp4-on-dgx-spark-why-it-doesnt-scale-like-youd-expect/360142/220) |
| [Is GPU worth it? GPU currently too slow.](https://forums.developer.nvidia.com/t/is-gpu-worth-it-gpu-currently-too-slow/6690)<br>[CUDA Programming and Performance](https://forums.developer.nvidia.com/c/accelerated-computing/cuda/cuda-programming-and-performance/7) | [16](https://forums.developer.nvidia.com/t/is-gpu-worth-it-gpu-currently-too-slow/6690/1) | 6.2k | [Dec 08 '08](https://forums.developer.nvidia.com/t/is-gpu-worth-it-gpu-currently-too-slow/6690/17) |
| [NeuralForge GPU Native Knowledge Intelligence Platform Built on DGX Spark GB10](https://forums.developer.nvidia.com/t/neuralforge-gpu-native-knowledge-intelligence-platform-built-on-dgx-spark-gb10/365954)<br>[DGX Spark / GB10 Projects](https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10/dgx-spark-gb10-projects/723) <br>- [cuda](https://forums.developer.nvidia.com/tag/cuda/31),<br>- [nim](https://forums.developer.nvidia.com/tag/nim/947),<br>- [performance](https://forums.developer.nvidia.com/tag/performance/57),<br>- [agentic-ai](https://forums.developer.nvidia.com/tag/agentic-ai/1079) | [4](https://forums.developer.nvidia.com/t/neuralforge-gpu-native-knowledge-intelligence-platform-built-on-dgx-spark-gb10/365954/1) | 301 | [Apr 17](https://forums.developer.nvidia.com/t/neuralforge-gpu-native-knowledge-intelligence-platform-built-on-dgx-spark-gb10/365954/5) |
| [CUDA 8 Features Revealed](https://forums.developer.nvidia.com/t/cuda-8-features-revealed/148542)<br>[Technical Blog](https://forums.developer.nvidia.com/c/blogs-events/technical-blog/318) | [51](https://forums.developer.nvidia.com/t/cuda-8-features-revealed/148542/1) | 1.5k | [Nov 07 '18](https://forums.developer.nvidia.com/t/cuda-8-features-revealed/148542/52) |
| [Why 273 GB/s? Less Is More, Until It Isn’t](https://forums.developer.nvidia.com/t/why-273-gb-s-less-is-more-until-it-isn-t/359555)<br>[DGX Spark / GB10](https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10/dgx-spark-gb10/721) | [67](https://forums.developer.nvidia.com/t/why-273-gb-s-less-is-more-until-it-isn-t/359555/1) | 2.4k | [Mar 27](https://forums.developer.nvidia.com/t/why-273-gb-s-less-is-more-until-it-isn-t/359555/69) |

Topic list, column headers with buttons are sortable.

Invalid date

Invalid date