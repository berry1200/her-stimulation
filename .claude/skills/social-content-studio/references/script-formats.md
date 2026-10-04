# Script Formats, Carousels and Captions

## Contents
1. Universal structure (Hook → Retain → Reward)
2. Timing and word budgets
3. Video formats (15 beat sheets)
4. Ad and UGC formats
5. Copywriting frameworks
6. Carousels
7. Captions
8. Series

---

## 1. Universal structure

Almost every short-form video that holds attention follows the same structure:

| Part | Share of runtime | Job |
|---|---|---|
| **Hook** | 0–3s | Stop the scroll and open a loop (see `hooks.md`) |
| **Context** | ≤5s, often 0 | Only what's needed to understand the payoff: who, what, why it matters. Cut it if the hook already did this. |
| **Value beats** | Most of the runtime | Deliver in small payoffs. Each beat answers part of the loop and opens the next one (a re-hook every ~5–8s). |
| **Payoff** | 3–8s | The best moment: the result, reveal, punchline or "aha". It must match the hook's promise. |
| **CTA / loop** | 1–4s | One ask, matched to the goal, or a last line that flows back into the first line for replays |

Two rules sit underneath it. **Retain:** something new should happen every few seconds, whether information, a visual or a turn. **Reward:** the viewer should feel the time was worth it, so they finish, rewatch, share or follow.

---

## 2. Timing and word budgets

Short-form delivery runs faster than normal speech: about **2.5–3 words per second** (150–180 wpm).

| Target length | Spoken words (approx.) | Typical beats |
|---|---|---|
| 7–10s | 15–30 | Hook + payoff (loop or visual-led) |
| 15s | 35–45 | Hook + 1–2 beats + payoff |
| 30s | 75–90 | Hook + 3 beats + payoff + CTA |
| 45s | 110–130 | Hook + context + 4–5 beats + payoff + CTA |
| 60s | 150–175 | Hook + context + 5–6 beats + payoff + CTA |
| 90s | 220–260 | Story or tutorial with 2–3 re-hooks |

On-screen text needs time to be read: roughly **3–4 words per second**, plus about 0.5s to notice it. A 12-word text card needs ~3.5–4s on screen.

Check a script's timing with `python scripts/script_tools.py time script.md`.

---

## 3. Video formats

Each format below gives a beat sheet, when to use it, and a mini example. Pick the format that serves the idea. Don't force an idea into a format.

### 3.1 Quick tutorial / how-to
**Use for:** education pillar, search traffic, saves.
**Beats:** Hook (result or problem) → Step 1 → Step 2 → Step 3 → Result shown → CTA ("save this for later").
**Tips:** Show the finished result first. Number the steps on screen. Cut every non-essential step, or mention it in the caption.
> "Your Excel sheet can do this in one click." [result] → "Select the data, Ctrl+T." → "Now Insert → PivotTable." → "Drag Region to rows, Sales to values." → [finished report] → "Save this. You'll need it Monday."

### 3.2 Listicle (3–5 items)
**Use for:** education, reach, saves.
**Beats:** Hook with number → Item 1 (strong) → Item 2 → Item 3 (best, teased earlier) → CTA.
**Tips:** Put the item number on screen as a progress bar ("2/3"). Open with a strong item, not the weakest. Tease the last one ("number 3 surprised me") only if it's true. Three is usually better than five.

### 3.3 Myth vs. fact / mistake → fix
**Use for:** authority, comments (people love to argue), shares.
**Beats:** Hook (the myth or mistake, stated confidently) → Why people believe it (5s) → What's actually true + proof → What to do instead → CTA.
> "Stop rinsing your chicken." → "Your grandma did it, I get it." → "It splashes bacteria up to 3 feet around your sink. Cooking kills it anyway." → "Pat it dry instead. Crispier skin too."

### 3.4 Story (personal, customer, or brand)
**Use for:** trust, connection, follows. Founder-led and personal stories are among the strongest-retaining formats.
**Beats:** Hook (moment of tension) → Setup (who, where, the stakes) → Conflict / what went wrong → Turn (decision, discovery) → Outcome → Lesson (one line, said plainly) → CTA (follow for more).
**Tips:** Start late in the story and fill in context only as needed. Use specific sensory details. Keep the lesson to one line, because a story told well already makes the point.

### 3.5 Before / after transformation
**Use for:** proof, services, products, satisfying content.
**Beats:** Hook (the after, or the before with "wait for it") → Before → Fast process montage (with 1–2 spoken insights) → After reveal (hold it 1–2s) → CTA / how to get it.
**Tips:** Shoot before and after from the same angle and in the same light. In regulated categories (health, beauty, finance) results claims need substantiation (see `compliance.md`).

### 3.6 POV / skit (relatable)
**Use for:** reach and shares ("this is so me"), community, personality.
**Beats:** Text hook "POV: [situation]" → Escalating relatable moments (2–4) → Twist or punchline → (optional) loop.
**Tips:** Base it on a real insider frustration that only the niche gets, which is what makes people send it. Minimal or no voice-over; acted, with text overlays. Playing several characters works well (change hat, angle, lighting).

### 3.7 Behind the scenes / process
**Use for:** trust, the brand's human side, products made by hand, services.
**Beats:** Hook (a surprising or satisfying moment from the process) → Process steps (fast cuts, natural sound) → The finished thing → One line of meaning ("every order is packed by Maya").
**Tips:** Natural sound (ASMR) carries this format. Lo-fi is fine and often better.

### 3.8 Green-screen / commentary / reaction
**Use for:** timely topics, news in the niche, authority, low production effort.
**Beats:** Hook (show the headline/post/claim behind you) → Your take → Why it matters to the viewer → What to do → CTA.
**Tips:** Add real analysis. Reaction without perspective counts as unoriginal content on Instagram.

### 3.9 Comparison / test / experiment
**Use for:** product content, reach, decision-stage viewers.
**Beats:** Hook ("$5 vs $500") → Criteria (fast) → Test 1 → Test 2 → Verdict (a clear winner, with nuance) → CTA.
**Tips:** Make it a fair test. Give a clear verdict, because hedging kills the payoff.

### 3.10 Talking-head opinion / hot take
**Use for:** authority, comments, personal brand, LinkedIn.
**Beats:** Hook (the contrarian claim) → Why the common view is wrong → Your evidence or experience → What to do instead → Question CTA ("agree?").
**Tips:** Punch-in zooms and text cards are the pattern breaks. Keep it short, because opinions without B-roll fatigue fast.

### 3.11 Faceless (B-roll + voice-over or text-on-screen)
**Use for:** brands without an on-camera person, explainers, product showcases.
**Beats:** Visual hook + text hook → VO beats over matching B-roll (a new shot every 1.5–3s) → Payoff visual → CTA.
**Tips:** The VO script carries the retention, so write it like a story and not a brochure. Use a consistent VO voice and caption style as a brand signature. If the voice or visuals are AI-generated and realistic, label them. With no footage at all, render the visuals as code-drawn motion graphics (`motion-design.md`).

### 3.12 Reply to a comment / FAQ
**Use for:** community, MOFU education, an endless supply of ideas.
**Beats:** The comment shown on screen (native reply feature) → Direct answer in the first sentence → Explanation/demo → "Drop your questions below."
**Tips:** This makes commenters feel seen and invites more comments, which feeds your next ideas.

### 3.13 Day-in-the-life / vlog
**Use for:** personal brand, culture, recruiting, BTS.
**Beats:** Hook (the most interesting moment of the day, or a "this is what $X/day looks like" frame) → Time-stamped moments (fast) → A reflection or surprise → CTA.
**Tips:** It needs a thread that ties it together (a question, a goal, a number), otherwise it's just footage.

### 3.14 "What I'd do if…" / framework
**Use for:** authority, saves, LinkedIn, coaches and consultants.
**Beats:** Hook ("If I had to get my first 10 clients again, I'd do this") → Step 1–3 with a specific action each → Why it works → CTA.

### 3.15 Trend adaptation
**Use for:** reach, showing personality. Use it sparingly and only where it fits.
**Beats:** Follow the trend's structure (audio, edit pattern, text format) → Swap in a niche-specific insight → Keep it under the trend's typical length.
**Tips:** Jump on trends within days, not weeks. Adapt the *format* to the niche: a trend that has nothing to do with the brand earns views and no fans. Business accounts must use licensed/commercial audio (see `compliance.md`).

---

## 4. Ad and UGC formats

For paid ads, Spark/partnership ads, and creator/UGC briefs. Organic and paid content increasingly look the same, so the best ads look like good posts.

### 4.1 UGC product ad (problem → product → proof)
| Beat | Time | Content |
|---|---|---|
| Hook | 0–3s | The problem in the viewer's words, or the result shown ("I stopped waking up with back pain") |
| Problem | 3–8s | Make the pain specific and relatable |
| Discovery | 8–12s | "Then I found [product]", shown in hand or in use |
| Demo | 12–22s | 2–3 features shown solving the problem, not described |
| Proof | 22–27s | A result, before/after, reviews or a number |
| Offer + CTA | 27–30s | "Link's in my bio, use code X for 15% off". One action. |

Write 3–5 hook variants per ad, since the hook is what you test in paid. Keep it native: phone-shot, natural light, a real person and real words.

### 4.2 Founder-led ad
Hook (a founder fact or a bold claim) → why we built it (the problem, personally) → what makes it different (one thing) → proof → offer. Founders speaking to camera tend to beat brand-voice VO for trust.

### 4.3 Testimonial / customer story
Hook (the customer's result in their words) → their situation before → what changed → a specific outcome → CTA. Use real customers with consent. Show typical results honestly.

### 4.4 Creator brief (when hiring creators)
Include: objective, audience, the single key message, 2–3 must-show product moments, claims that are allowed and not allowed, disclosure requirement ("Paid partnership" tag + verbal or on-screen "ad"), deliverables (length, ratio, number of hook variants, raw files), usage rights (organic only or ads, and for how long), music rules, and the review process. Leave room for the creator's own voice, since that's what you're paying for.

---

## 5. Copywriting frameworks

Use these for captions, ad copy, carousels, LinkedIn posts and VO scripts:
- **PAS (Problem → Agitate → Solve):** name the problem, make its cost felt, present the fix. Best for pain-driven products.
- **BAB (Before → After → Bridge):** current state, desired state, how to get there. Best for transformations.
- **AIDA (Attention → Interest → Desire → Action):** the classic ad flow. Use it when the viewer needs to be walked to a purchase.
- **Hook → Story → Offer:** a story-led sale for founder and creator content.
- **"I / You / We" lesson post (LinkedIn):** what happened to me → what it means for you → what we can do.

---

## 6. Carousels

Carousels earn saves and deep engagement. People swipe at their own pace, so they hold longer explanations than video can.

**Structure**
1. **Slide 1, the hook:** a bold title (≤10 words) + a visual. It must stand alone in the feed and as a 3:4 grid tile.
2. **Slide 2, the promise/context:** why this matters, or the "before". Instagram may show slide 2 to people who skipped slide 1, so make it a second hook.
3. **Slides 3–(n-1), one idea per slide:** a headline + 1–3 short lines or a visual. Number them. Keep to ≤25–30 words per slide.
4. **Last slide, recap + CTA:** "Save this for your next…" / "Send this to a friend who…" / "Follow for part 2".

**Design:** 1080×1350 (4:5) or 1080×1440 (3:4). Use a consistent brand template (fonts, colors, margins, handle on each slide), large readable type, and an arrow or "swipe →" cue on slide 1. 5–10 slides is typical (Instagram allows up to 20).

**On LinkedIn:** upload as a PDF document post. The same structure works, with a slightly more professional voice.

---

## 7. Captions

**Structure**
1. **First line = second hook.** It's what shows before "…more". Restate or extend the video's promise. Don't open with emojis or the brand name.
2. **Body:** context the video couldn't fit, the steps written out (good for saves and search), or a short story. Use line breaks.
3. **Keywords:** naturally include the 2–3 phrases people would search.
4. **One CTA:** question, save, send, follow, or link in bio, matching the video's CTA.
5. **Hashtags:** Instagram allows max 5 (pick 3–5 specific ones). TikTok 3–5. YouTube: 1–3 in the title/description. LinkedIn: 0–3.
6. **Disclosure** (if sponsored) in the **first line**, not buried.

**Length:** short (1–3 lines) for entertainment; long (100–300 words) for educational posts, where the caption itself delivers value. On LinkedIn the text often *is* the post.

---

## 8. Series

Recurring series turn one-time viewers into followers, because a series gives them a reason to come back.
- **Named format + numbering:** "Fixing your résumé, part 4", "Rating gas-station snacks #12", "Ask a pharmacist Fridays".
- **Same opening frame/text style** every episode, so it's recognisable in the feed.
- **End with a forward hook:** "Tomorrow: the one I'd never buy."
- Build 2–3 series per brand, mapped to pillars. Kill series that stop performing and double down on the ones that grow.
