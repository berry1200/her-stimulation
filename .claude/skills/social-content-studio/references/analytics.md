# Analytics: Measuring, Diagnosing, Improving

## Contents
1. The metrics that matter (by funnel stage)
2. Where to find them on each platform
3. Diagnosis tree: why a post underperformed
4. Reading a retention graph
5. Benchmarks (use with care)
6. Running experiments
7. Weekly / monthly review template

---

## 1. The metrics that matter

Vanity metrics (likes, follower count) lag behind. Diagnose with the metrics that match each stage of a viewer's decision:

| Stage | Question | Metric |
|---|---|---|
| **Hook** | Did they stop? | 3-second hold / skip rate (IG), "Viewed vs. swiped away" (Shorts), first-2s retention (TikTok) |
| **Retention** | Did they stay? | Average watch time, average % viewed, the retention curve, rewatches |
| **Distribution** | Did the platform push it? | Reach, % non-followers reached, traffic source (For You / Reels tab / Explore / search / profile) |
| **Resonance** | Did it matter to them? | **Sends/shares per reach**, saves per reach, meaningful comments, likes per reach |
| **Conversion** | Did they act? | Profile visits, follows per reach, link clicks, DMs, sales/code uses |

Always divide by **reach** (per-viewer rates) when comparing posts. A post with 2,000 reach and 60 shares (3%) beat a post with 50,000 reach and 100 shares (0.2%) on resonance, even though it looks smaller.

## 2. Where to find them

- **Instagram:** Professional dashboard → post insights: views, reach, watch time, avg watch time, skip rate, retention graph (on Reels), sends, saves, follows, profile activity; Trial Reels results.
- **TikTok:** Analytics → video: total play time, avg watch time, "watched full video" %, retention curve, traffic source (For You, search, profile), search terms, new followers.
- **YouTube Shorts:** Studio → Analytics: Viewed vs. swiped away, avg % viewed, retention curve, subscribers gained, traffic sources.
- **LinkedIn:** post analytics: impressions, members reached, reactions, comments, reposts, video watch time, follower demographics.

If the user shares screenshots or exports, extract the numbers into a table before diagnosing.

## 3. Diagnosis tree

Work top-down and stop at the first stage that's weak. That's the bottleneck, and fixing later stages won't help until it's fixed.

1. **Low hook metrics** (high skip/swipe-away, low 3s hold)
   → Problem: the first frame, hook line or hook text.
   → Fixes: start mid-action, show the result first, a sharper call-out, a bigger and clearer text hook, cut the intro, test a different hook *type*.
2. **Good hook, steep early drop (3–10s)**
   → Problem: the hook promised something the opening didn't deliver, or the context/setup is too slow.
   → Fixes: cut the context, deliver the first value beat sooner, make sure the opening matches the hook.
3. **Steady mid-video decline / a cliff at a specific second**
   → Problem: pacing, a static visual, or a boring beat at the cliff.
   → Fixes: look at what's on screen at the cliff, add re-hooks and B-roll every few seconds, cut the weakest beat, shorten the video.
4. **Good retention, low reach**
   → Problem: weak topic signals, a niche too narrow for the test audience, or low shares.
   → Fixes: say, show and write the keyword clearly; broaden the angle slightly; add a reason to share.
5. **Good reach, low shares/saves**
   → Problem: entertaining but not valuable or relatable enough to forward or keep.
   → Fixes: make it more specific to an identity ("this is so you"), add a save-worthy takeaway (list, template, steps), add a share CTA.
6. **Good resonance, low follows**
   → Problem: no reason to come back, or the profile doesn't convert.
   → Fixes: make it a series ("part 2"), a clearer "follow for…" promise in the bio, a better pinned posts/highlights path.
7. **Followers, but no leads/sales**
   → Problem: the BOFU content is missing, or the path to buy is unclear.
   → Fixes: add demos, testimonials and offers (~10–20% of output), add a clear link-in-bio path, comment-to-DM flows, Stories with link stickers.

Also check the **context** before blaming the content: posting time, an account-wide reach dip, a copyright-muted sound, a watermark, or a policy flag.

## 4. Reading a retention graph

- **Big drop in the first 1–3s:** a hook problem (some drop is normal, a cliff is not).
- **Flat-ish line above ~60–70%:** excellent; this is how short videos go viral.
- **A sudden cliff mid-video:** something lost people at that exact second (a slow beat, a confusing cut, a visible CTA or "link in bio" too early, the payoff revealed early).
- **A bump (rewatches):** something people rewound for. Make more content like that moment.
- **A drop at the end before the CTA:** the payoff came too early, or the ending drags. End sooner.
- **Retention >100% at the start or overall:** loops/rewatches, a strong positive signal.

## 5. Benchmarks

Benchmarks disagree a lot because methodologies differ (by followers vs. by reach, per post vs. per account). Use them only for rough sanity checks. The real benchmark is the account's own **median** over its last 20–30 posts. Aim to beat the median, and study the top 10%.

Rough reference points (2026 reports; see `platforms.md` for sources):
- Instagram engagement per post: ~0.5% by followers (Socialinsider); Reels ~2.7% by followers (Dash Social); carousels ~6.9% vs. Reels ~3.3% by reach (Buffer).
- TikTok engagement: ~3.7–4.9%.
- LinkedIn: documents ~3.2%, polls ~2.8%, native video ~2.4%, text+image ~1.9%.
- YouTube Shorts: ≥70% viewed (vs. swiped) = strong; ~50% = average; <30–40% = struggling.
- Short-form average % viewed: >70% strong for videos under 30s; longer videos naturally have lower % viewed.

## 6. Running experiments

- **One variable at a time:** the hook, length, format, posting time, cover, or CTA. Keep everything else similar.
- **Enough samples:** judge a pattern over 3–5 posts, not one. Single posts are noisy.
- **Wait for the numbers to settle:** check at ~48–72h for short-form, and again at 7 days (search and long-tail can keep growing, especially on YouTube).
- **Use built-in tools:** Instagram Trial Reels for testing on non-followers; paid A/B tests for ad hooks.
- **Log everything:** date, pillar, format, hook type, length, 3s hold, avg % viewed, shares/reach, saves/reach, follows/reach. After a month the patterns are obvious.

## 7. Review template

```markdown
## Content review — [period]

**Goal this period:** [e.g., follows: 2k → 3k]
**Output:** [X Reels, Y carousels, Z TikToks]  ·  **Account median:** [reach / avg % viewed / shares per 1k reach]

### Top 3 posts (and why they worked)
| Post | Reach | Avg % viewed | Shares/1k reach | Saves/1k reach | Follows | Why it worked |
|---|---|---|---|---|---|---|

### Bottom 3 posts (and the bottleneck stage)
| Post | Bottleneck (hook / retention / distribution / resonance / conversion) | Likely cause | Fix |
|---|---|---|---|

### Patterns
- Hook types that won: …
- Formats/pillars that won: …
- What to stop: …

### Next period
- Double down: [2–3 remakes of winners with new hooks/angles]
- Experiments: [1–2 tests, one variable each]
- Mix change: [pillar/funnel adjustments]
```
