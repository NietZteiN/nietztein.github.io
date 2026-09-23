---
title: Benchmarks We Actually Need
date: 2026-09-23
summary: Absurd benchmarks that would convince me LLMs are intelligent, and the closest existing work for each.
tags: [llm, benchmarks, evaluation]
---

# Benchmarks We Actually Need

In the spirit of Yann LeCun's [challenge](https://x.com/ylecun/status/1760053273074016602) to put ChatGPT in a robot and make it do simple tasks, here are some ideas for absurd benchmarks that would convince me of the intelligence of LLMs.

Metrics exist for a decent chunk of these, but I think they can go further.

## Ideas

- **Psychological maturity / Discord debate referee.** Drop the model into a long, messy multi-party Discord argument and see if it can tell who is actually right (and who is just loudest). This requires real theory of mind: not just holding each person's perspective, but weighing them against each other and against the facts.
  - Closest existing: debate judging ([Debatrix / PanelBench](https://arxiv.org/abs/2403.08010)); emotional understanding ([EQ-Bench](https://arxiv.org/abs/2312.06281), Paech 2023; EQ-Bench 3 does relationship/workplace-conflict role-plays); mediation ([ProMediConv](https://arxiv.org/abs/2609.11101)).
  - Gap: nothing I found on chaotic, sarcastic, many-speaker group chats. People disagree about who won these too, so even the ground truth is contested.

- **Actually giving therapy.** This is entangled with sycophancy. Models follow the human down rabbit holes, which is a running joke about bad therapy as well. A good therapist interjects, redirects, and contradicts, and does it from something like intuition rather than a hard-coded rule.
  - [CBT-Bench](https://arxiv.org/abs/2410.13218) (Zhang et al., NAACL 2025): good at reciting CBT knowledge, bad at generating therapeutic responses.
  - [Expressing stigma and inappropriate responses prevents LLMs from safely replacing mental health providers](https://arxiv.org/abs/2504.18412) (Moore et al., FAccT 2025): models encourage delusions, likely from sycophancy.
  - [Randomized Trial of a Generative AI Chatbot for Mental Health Treatment](https://ai.nejm.org/doi/full/10.1056/AIoa2400802) (Heinz et al., NEJM AI 2025): Therabot RCT, N=210, real symptom reductions vs. waitlist.

- **AITA score (anti-sycophancy).** "Am I a bully?" Does the model ever say yes? The purest test of whether a model will tell you something you do not want to hear.
  - [ELEPHANT: Measuring and understanding social sycophancy in LLMs](https://arxiv.org/abs/2505.13995) (Cheng et al., 2025): literally uses r/AmITheAsshole; models tell *both* sides they're not wrong 48% of the time.
  - [Scruples](https://arxiv.org/abs/2008.09094) (Lourie, Le Bras & Choi, AAAI 2021): 32k AITA anecdotes with community verdicts.
<!-- 
- **Rating sexual technique.** Funny framing, but real subtext: can a model give frank, useful, non-prudish, non-creepy advice?
  - Only found sexual *health* evals, e.g. [Beyond the Rubric: Cultural Misalignment in LLM Benchmarks for Sexual and Reproductive Health](https://arxiv.org/abs/2511.17554); [The Role of LLM Chatbots in Sexual Education: An Unmet Need of Research](https://journals.sagepub.com/doi/10.1177/26318318251323714) (Mondal & Mondal, 2025).
  - Gap: no technique/intimacy-advice benchmark (unsurprisingly). -->

- **Making a genuinely funny joke.** Jokes are creativity plus connecting distant ideas. LLMs aren't funny, so a model that makes you actually laugh would mean something. This is the benchmark version of my post [Research, Humor, and the Play Drive](https://nietztein.github.io/#/post/untitled): a joke is an empirical experiment, and the leap that lands a punchline is the same leap that lands a hypothesis.
  - [ChatGPT is fun, but it is not funny!](https://arxiv.org/abs/2306.04563) (Jentzsch & Kersting, WASSA 2023): 90%+ of 1,008 generated jokes were the same 25 jokes.
  - [Do Androids Laugh at Electric Sheep?](https://arxiv.org/abs/2209.06293) (Hessel et al., ACL 2023 best paper): New Yorker caption contest benchmark.
  - [A Robot Walks into a Bar](https://arxiv.org/abs/2405.20956) (Mirowski et al., FAccT 2024): 20 pro comedians say LLM comedy is bland and trope-y.
  - [Let's Think Outside the Box](https://arxiv.org/abs/2312.02439) (Zhong et al., CVPR 2024): Japanese Oogiri (大喜利) as a "leap-of-thought" creativity test. Oogiri rewards the answer that is unexpected and yet fits, which is close to what I mean by a real joke.
  - *On associative creativity* — the literature behind the "connecting distant ideas" claim:
    - [The associative basis of the creative process](https://pubmed.ncbi.nlm.nih.gov/14472013/) (Mednick, *Psychological Review* 1962): creativity is forming remote associative elements into useful combinations. Creative people have *flatter* associative hierarchies, so they reach the distant association sooner. This paper is where the Remote Associates Test comes from.
    - [The Act of Creation](https://en.wikipedia.org/wiki/The_Act_of_Creation) (Koestler 1964): "bisociation," one situation held in two self-consistent but habitually incompatible frames. Koestler's claim is that the joke, the discovery and the metaphor run the same mechanism and differ only in emotional payoff.
    - [Naming unrelated words predicts creativity](https://www.pnas.org/doi/10.1073/pnas.2022340118) (Olson et al., PNAS 2021): the Divergent Association Task. Name 10 words as different from each other as possible; mean semantic distance across 8,914 people correlates with standard creativity measures. A creativity test that takes four minutes and needs no judging.
    - [CREATE: Testing LLMs for Associative Creativity](https://arxiv.org/abs/2603.09970) (Wadhwa et al., 2026): the closest thing to a direct benchmark. Models must generate diverse, meaningful connections between concepts. Reasoning models are not reliably better even at high token budgets, and creative prompting barely moves it.
    - [Assessing the Effect of Cross-Domain Mapping on Creativity in Humans and LLMs](https://arxiv.org/abs/2603.19087) (Liu et al., 2026): humans reliably benefit from random cross-domain inspiration; LLMs out-originate humans but get no benefit from it at all. Which suggests the models are not making the associative leap, just starting further out.

- **Speech delivery / rhetoric.** Not what the speech says but how it lands: pacing, pauses, emphasis, the room. Voice models finally make this testable. It is the part of persuasion that sits outside the language substrate.
  - Content persuasion is measured: [Measuring the Persuasiveness of Language Models](https://www.anthropic.com/research/measuring-model-persuasiveness) (Durmus et al., Anthropic 2024).
  - Delivery pieces only: [EmphAssess](https://arxiv.org/abs/2312.14069) (emphasis in speech-to-speech, EMNLP 2024); [PSST](https://arxiv.org/abs/2311.08389) (public-speaking *style* transfer, text only).
  - Gap: no end-to-end "give a speech that moves a crowd" benchmark.
<!-- 
- **Cooking / daily chores for robots.**
  - [BEHAVIOR-1K](https://arxiv.org/abs/2403.09227) (Li et al., CoRL 2022): 1,000 everyday activities picked by surveying what people want robots to do.
  - [RoboCasa](https://arxiv.org/abs/2406.02523) (Nasiriany et al., RSS 2024) and [RoboCasa365](https://arxiv.org/abs/2603.04356) (2026): kitchen simulation, 365 tasks.
  - Also: Wozniak's "coffee test": walk into a random house and make coffee. -->

- **Flirting.** RizzGPT-style toys exist, but a benchmark?
  - [It's Not You, it's Me: Detecting Flirting and its Misperception in Speed-Dates](https://aclanthology.org/D09-1035/) (Ranganath, Jurafsky & McFarland, EMNLP 2009): the classifier detected flirting intent better than the people on the date.
  - [Large language models can detect verbal indicators of romantic attraction](https://www.nature.com/articles/s41598-026-52308-x) (Scientific Reports, 2026): ChatGPT predicts speed-date matches as well as human judges.
  - Gap: all *detection*, no *generation*. Nobody benchmarks whether the model can flirt.

## Extra ideas (maybe)

- **Reading the room / knowing when to shut up.** Group chat benchmark: does the model know when *not* to reply? More interesting cross-culturally, since the threshold sits somewhere very different in Japan.
- **Haggling at a flea market.** Negotiation work exists ([NegotiationArena](https://arxiv.org/abs/2402.05863), Bianchi et al., ICML 2024); a fun spin: can it get the vintage jacket for $5?
- **Lying well at party games.** Werewolf / Avalon / Diplomacy ([CICERO](https://www.science.org/doi/10.1126/science.ade9097), Meta, Science 2022).
- **Gift-giving.** Given a friend's group-chat history, pick a gift they'd actually like. In my experience models are bad at this.
<!-- - **Texting your mom back.** Tone-matching across generations.  -->
- **Apology quality.** Rate apologies on non-apology-ness ("sorry you feel that way").
<!-- - **Explain it to grandma.** ELI5 exists ([Fan et al., ACL 2019](https://arxiv.org/abs/1907.09190)), but judged by actual grandmas? -->
- **IKEA furniture assembly** from the pictogram manual only.
