![Leela Chess Zero Networks 2024 - How to Choose the Right Lc0 Net](https://chessify.me/media/lczero_nets-_thumbnail.jpg)

# Leela Chess Zero Networks 2024 - How to Choose the Right Lc0 Net

2023-05-03

Leela Chess Zero (LCZero or Lc0) is one of the most revolutionary and strongest [chess engines](https://chessify.me/blog/what-is-chess-engine) in modern chess. Inspired by [DeepMind's AlphaZero](https://www.deepmind.com/blog/alphazero-shedding-new-light-on-chess-shogi-and-go), which shocked the world by winning matches against [Stockfish](https://chessify.me/blog/top-chess-engines#stockfish) with just a few days of training, Lc0 too learned chess from self-play, i.e. by playing millions of games against itself. However, what truly sets LCZero apart is its use of different networks, each with distinct strengths and weaknesses.

**With six networks available on [Chessify](https://chessify.me/analysis) and frequent updates, you may wonder which one best fits your chess training needs.**

In this blog post, we'll explore the characteristics of these networks and provide guidance on how to choose the right one for you, taking into account factors such as speed, accuracy, and training goals. But first, let's briefly discuss what networks are.

![Lc0 neural networks](https://chessify.me/media/uploads/lc_nets.jpg)

## What is a Neural Network in Chess Engines?

A network refers to the artificial neural network (ANN) that powers the engine's decision-making process. ANNs are computing systems inspired by the human brain's neural networks. They consist of interconnected [nodes](https://chessify.me/blog/nps-what-are-the-nodes-per-second-in-chess-engine-analysis) or neurons that work together to process and evaluate input data, in this case, chess positions and moves.

The LCZero networks learn and improve their understanding of the game through self-play and reinforcement learning. As the engine plays more games and goes through more training cycles, it generates new networks with improved knowledge and understanding of the game.

Some networks may have specific strengths, such as being better at tactical positions or endgames, while others might be more balanced. **These networks come in different sizes, with larger ones offering better positional evaluation but slower computational speeds, while smaller ones provide faster analysis at the potential cost of some positional accuracy.**

Networks are often referred to as "nets" or "weights" and are identified by a unique numeric ID. New networks are released regularly, and users with technical proficiency can download from LCZero's [official website](https://lczero.org/) and test to see how they perform.

At [Chessify](https://chessify.me/), we download and add the new LCZero networks for you and allow you to test and choose the one that best suits your needs and preferences. However, since the names of these networks are not self-explanatory, we have created this resource to help you make an educated choice.

## What are the Available Networks?

The following networks are available for use on Chessify's [Analysis Dashboard](https://chessify.me/analysis) as of January 2024. The list is sorted from the smallest net to the largest. Note that the [kN/s speed](https://chessify.me/blog/nps-what-are-the-nodes-per-second-in-chess-engine-analysis) was calculated on the initial position, whereas engine speed tends to be low in the openings and higher in the endgames. All networks run on the same GPU server, which has an average speed of 100 kN/s.

| **Network** | **Description** | **Speed** |
| --- | --- | --- |
| J104.1-30 | The smallest network on Chessify. Provides the highest NPS speed. | Around 220 kN/s |
| Latest-320x24 | Medium-size network with 320 filters and 24 blocks. | Around 30 kN/s |
| Latest-384x30 | Medium-size network with 384 filters and 30 blocks. A bit bigger than Latest-320x24 | Around 30 kN/s |
| Latest-512x20 | The largest network in our list outside of the Big Transformer nets. This net will greach an average speed and depth, so it is a good option for many players. | Around 30 kN/s |
| BT2-3650000 | An older model in the Big Transformer series, BT2 remains a reliable network. However, more advanced versions have since been developed. | Around 7-10 kN/s |
| BT3-768x15 | This updated Big Transformer network with some improvements over the BT2 model. It also served as the foundation for its successor, the BT4 net. | Around 6 kN/s |
| BT4-1024x15 | Currently the largest Lc0 net. Big Transformer 4 was built off of BT3 by adding two types of auxiliary heads - future heads and categorical value heads - to improve its training speed. | Around 4 kN/s |

## How to Choose the Right LCZero Network

When it comes to choosing a network for the Leela engine, you're basically making a choice between quality and quantity. As newer and larger neural networks are developed, they tend to offer better positional evaluation and a deeper understanding of the game. However, these improvements often come at the cost of slower nodes per second ( [NPS](https://chessify.me/blog/nps-what-are-the-nodes-per-second-in-chess-engine-analysis)) speed. This is because larger networks have more parameters, and it takes more time for the GPU (or CPU) to compute them.

So while the newer and larger networks may provide more accurate evaluations and better strategic understanding, they can be slower in terms of NPS. This trade-off between accuracy and speed is an important consideration for users when choosing which network to use for analysis or training. At this point, Chessify recommends the Latest-512x20 for most amateur users and BT4 for professionals. If you want to use LCZero on Chessify's cloud servers, log in to our [Analysis Dashboard](https://chessify.me/analysis).

[![single-blog sidebar](https://chessify.me/dg_static/website/assets/images/light_mode-mobile.webp)](https://chessify.me/auth/signup/?redirect=free-trial-offer&ref=)

[![single-blog sidebar](https://chessify.me/dg_static/website/assets/images/mobile_view_logged_in_user_sidebanner.webp)](https://chessify.me/pricing)

## What people say about us

[Anish Giri](https://twitter.com/anishgiri)

[@anishgiri](https://twitter.com/anishgiri)

You are in Riga. It is just the start and you are still hopeful.


You have been lazy all year long, you have nothing to
play, but you've got 3 hours left before the game.


You
log in to chessbase cloud, but all good engines are taken. You
panic.


Don't panic, try
[@ChessifyMe](https://twitter.com/ChessifyMe?ref_src=twsrc%5Etfw).


[Suren](https://twitter.com/surenaghabek)

[@surenaghabek](https://twitter.com/surenaghabek)

Scanning and analyzing have never been so easy!


[@ChessifyMe](https://twitter.com/ChessifyMe?ref_src=twsrc%5Etfw)
Rocks!


[#chess](https://twitter.com/hashtag/chess?src=hash&ref_src=twsrc%5Etfw) [#chessify](https://twitter.com/hashtag/chessify?src=hash&ref_src=twsrc%5Etfw)

[The Queen’s Gambit](https://twitter.com/NetflixTheQG)

[@NetflixTheQG](https://twitter.com/NetflixTheQG)

White to Play, can you see it?


Full game:
[@lichess](https://twitter.com/lichess?ref_src=twsrc%5Etfw) [https://t.co/ezBWxKcymy](https://t.co/ezBWxKcymy)

Graphics Credit
[@ChessifyMe](https://twitter.com/ChessifyMe?ref_src=twsrc%5Etfw)

[International Chess Federation](https://twitter.com/FIDE_chess)

[@FIDE\_chess](https://twitter.com/FIDE_chess)

FIDE and [@ChessifyMe](https://twitter.com/ChessifyMe?ref_src=twsrc%5Etfw), the No. 1 cloud service
for chess engine analysis, partnered on the 44th
Chess Olympiad to power the chess game analysis
of top games.


[International Chess Federation](https://twitter.com/FIDE_chess)

[@FIDE\_chess](https://twitter.com/FIDE_chess)

Thanks to this partnership, the Chess Olympiad Gold
medallists in the Open and Women’s categories, both
teams and individual boards, will be awarded
GrandMaster packages by Chessify, with the
opportunity of leveraging premium chess game analysis
from the strongest chess engines.


[Oracle for Startups](https://twitter.com/OracleStartup)

[@OracleStartup](https://twitter.com/OracleStartup)

Discover how these startups use #AI and powerful
#cloud analysis to help players take their performance
to the next level.


[https://blogs.oracle.com/startup/post/startups-helping-players](https://blogs.oracle.com/startup/post/startups-helping-players)

[Anish Giri](https://twitter.com/anishgiri)

[@anishgiri](https://twitter.com/anishgiri)

Some would call it an ad, but I see it as a friendly reminder.


When I am not tweeting, playing or streaming, I am working on my game with
[@ChessifyMe](https://twitter.com/ChessifyMe?ref_src=twsrc%5Etfw).


Trustpilot Widget

[Review us on\\
\\
Trustpilot\\
\\
online review community](https://www.trustpilot.com/review/chessify.me?utm_medium=trustbox&utm_source=TrustBoxReviewCollector) Click to view the company's Trustpilot profile

## Train like a Grandmaster

Join 300+ GMs on Chessify Cloud to level up your training. Analyze
securely
with user-dedicated cloud servers at up to 1 BIllion NPS speed


[Pricing](https://chessify.me/pricing)

## Let’s get in touch!

We usually reply in a matter of a few hours. Please send us an
[email](mailto:info@chessify.me) if you
have any questions or visit our [FAQ page](https://chessify.me/faq) for quick help


[Contact Us](https://chessify.me/contact)