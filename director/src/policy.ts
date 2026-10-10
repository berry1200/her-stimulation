// A first, cheap line of defence for requests the platform will not fulfil.
// The director model applies the full judgement (see the system prompt); this
// catches the unambiguous cases before any tokens are spent.

// Patterns are deliberately narrow: words like "nude" (a colour) or "naked eye" are
// common in ordinary briefs, so only phrasings that clearly ask for nudity match.
const BLOCKED: Array<[RegExp, string]> = [
  [/\b(nudity|nudes|nsfw|porn\w*|hentai|explicit sex|sex (scenes?|tape)|undress\w*|strip ?tease|topless|in the nude)\b/i, "sexual or nude content"],
  [/\bnude (photo\w*|pics?|images?|scenes?|videos?|clips?|shots?|models?|wom[ae]n|m[ae]n|girls?|boys?|bod(y|ies)|selfies?)\b/i, "sexual or nude content"],
  [/\b(get|gets|got|getting|is|are|be|being|fully|completely|totally) naked\b|\bnaked (wom[ae]n|m[ae]n|girls?|boys?|bod(y|ies)|people|person|models?)\b/i, "sexual or nude content"],
  [/\b(show|reveal|expose|flash)\w*\s+(her|his|their)\s+(boobs?|breasts?|nipples?|genitals?|penis|vagina|butt|ass)\b/i, "sexual or nude content"],
  [/\b(deep ?fake|face ?swap)\b.*\b(celebrity|politician|real person|my (ex|boss|neighbou?r|classmate))\b/i, "deceptive use of a real person's likeness"],
];

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

export function screenRequest(text: string): PolicyResult {
  for (const [re, what] of BLOCKED) {
    if (re.test(text)) {
      return {
        allowed: false,
        reason: `Director doesn't create ${what}. Ask for something else and it will help.`,
      };
    }
  }
  return { allowed: true };
}
