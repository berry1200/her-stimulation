#!/usr/bin/env python3
"""Timing checks and caption files for short-form video scripts.

Reads a script written in the skill's template (a Markdown table with Time,
Voice-over and On-screen text columns) or plain text, and:

  time  - estimates spoken duration per beat and flags long hooks, voice-over
          that overflows its time slot, and on-screen text too dense to read.
  srt   - writes an approximate .srt caption file from the voice-over column.

Usage:
  python script_tools.py time script.md [--wps 2.7] [--json]
  python script_tools.py srt script.md --out captions.srt [--max-words 4] [--wps 2.7]

Speaking pace defaults to 2.7 words/second (~160 wpm), typical for social
video. Use --wps 2.3 for calm delivery, 3.0+ for fast-talking creators.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_WPS = 2.7
READ_WPS = 3.5          # on-screen reading speed, words per second
READ_LEAD_IN = 0.5      # seconds to notice a new text card
HOOK_MAX_SECONDS = 3.5
TEXT_MAX_WORDS = 12
OVERFLOW_TOLERANCE = 1.2

WORD_RE = re.compile(r"\w+(?:['’\-]\w+)*", re.UNICODE)
DIRECTION_RE = re.compile(r"\[[^\]]*\]|\([^)]*\)")
ABBREVIATION_RE = re.compile(r"^(a\.m\.|p\.m\.|e\.g\.|i\.e\.|vs\.|etc\.|dr\.|mr\.|mrs\.|ms\.|st\.|no\.)$",
                             re.IGNORECASE)
THROAT_CLEARING_RE = re.compile(
    r"^\W*(hey|hi|hello|what'?s up|welcome( back)?|so,? today|today (i|we)|in this (video|reel)|"
    r"my name is|let'?s talk about|quick (video|one))\b",
    re.IGNORECASE)
EMPTY_CELL_RE = re.compile(r"^\s*(?:[-–—]+|n/?a|none|silence|no vo|—)?\s*$", re.IGNORECASE)

COLUMN_PATTERNS = {
    "time": re.compile(r"\b(time|timing|timestamp|secs?|seconds)\b", re.IGNORECASE),
    "vo": re.compile(r"\b(vo|v/o|voice|voice-?over|voiceover|audio|spoken|dialogue|narration|says|script)\b",
                     re.IGNORECASE),
    "text": re.compile(r"(on-?screen|overlay|\btext\b|caption)", re.IGNORECASE),
    "beat": re.compile(r"\b(beat|section|part|scene|segment)\b", re.IGNORECASE),
}


@dataclass
class Row:
    index: int
    beat: str = ""
    time_raw: str = ""
    start: float | None = None
    end: float | None = None
    vo: str = ""
    text: str = ""
    vo_words: int = 0
    text_words: int = 0
    est_seconds: float = 0.0
    flags: list[str] = field(default_factory=list)


def split_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    cells = re.split(r"(?<!\\)\|", line)
    return [c.replace("\\|", "|").strip() for c in cells]


def find_tables(lines: list[str]) -> list[list[list[str]]]:
    """Return markdown tables as lists of rows (header first, separator removed)."""
    tables, current = [], []
    for line in lines:
        if line.strip().startswith("|"):
            current.append(line)
        else:
            if current:
                tables.append(current)
            current = []
    if current:
        tables.append(current)

    parsed = []
    for block in tables:
        rows = [split_row(l) for l in block]
        if len(rows) >= 2 and all(re.fullmatch(r":?-{2,}:?", c.replace(" ", "")) for c in rows[1] if c):
            rows = [rows[0]] + rows[2:]
        parsed.append(rows)
    return parsed


def map_columns(header: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for key in ("time", "vo", "beat", "text"):
        for i, name in enumerate(header):
            if i in mapping.values():
                continue
            if COLUMN_PATTERNS[key].search(name):
                mapping[key] = i
                break
    return mapping


def choose_script_table(tables):
    best, best_score = None, -1
    for rows in tables:
        if not rows:
            continue
        cols = map_columns(rows[0])
        if "vo" not in cols:
            continue
        score = (2 if "time" in cols else 0) + len(rows)
        if score > best_score:
            best, best_score = (rows, cols), score
    return best


def to_seconds(token: str) -> float:
    if ":" in token:
        parts = [float(p) for p in token.split(":")]
        total = 0.0
        for p in parts:
            total = total * 60 + p
        return total
    return float(token)


def parse_time_range(raw: str) -> tuple[float | None, float | None]:
    tokens = re.findall(r"\d+(?::\d{1,2})+(?:\.\d+)?|\d+(?:\.\d+)?", raw or "")
    if not tokens:
        return None, None
    if len(tokens) == 1:
        return to_seconds(tokens[0]), None
    return to_seconds(tokens[0]), to_seconds(tokens[1])


def clean_spoken(cell: str) -> str:
    text = re.sub(r"[*_`]", "", cell or "")
    text = DIRECTION_RE.sub(" ", text)
    text = text.replace("<br>", " ").replace("<br/>", " ")
    text = text.strip().strip('"“”').strip()
    if EMPTY_CELL_RE.match(text):
        return ""
    return re.sub(r"\s+", " ", text)


def count_words(text: str) -> int:
    return len(WORD_RE.findall(text or ""))


def parse_script(path: Path, wps: float) -> tuple[list[Row], bool]:
    content = path.read_text(encoding="utf-8")
    lines = content.splitlines()
    chosen = choose_script_table(find_tables(lines))

    rows: list[Row] = []
    if chosen is None:
        # Plain-text script: every non-heading line is voice-over; the first sentence is the hook.
        body = clean_spoken(" ".join(l for l in lines if l.strip() and not l.lstrip().startswith("#")))
        parts = re.split(r"(?<=[.!?])\s+", body, maxsplit=1)
        for i, (beat, vo) in enumerate(zip(("Hook (1st sentence)", "Rest of script"), parts), start=1):
            row = Row(index=i, beat=beat, vo=vo, vo_words=count_words(vo))
            row.est_seconds = row.vo_words / wps
            rows.append(row)
        return rows, False

    table, cols = chosen
    for i, cells in enumerate(table[1:], start=1):
        def cell(key: str) -> str:
            idx = cols.get(key)
            return cells[idx] if idx is not None and idx < len(cells) else ""

        row = Row(index=i, beat=cell("beat"), time_raw=cell("time"))
        row.start, row.end = parse_time_range(row.time_raw)
        row.vo = clean_spoken(cell("vo"))
        row.text = clean_spoken(cell("text"))
        row.vo_words = count_words(row.vo)
        row.text_words = count_words(row.text)
        row.est_seconds = row.vo_words / wps
        rows.append(row)
    return rows, True


def analyse(rows: list[Row], wps: float) -> dict:
    for pos, row in enumerate(rows):
        slot = (row.end - row.start) if row.start is not None and row.end is not None else None

        if pos == 0 and row.est_seconds > HOOK_MAX_SECONDS:
            row.flags.append(
                f"Hook runs ~{row.est_seconds:.1f}s spoken ({row.vo_words} words); "
                f"aim for <= {int(HOOK_MAX_SECONDS * wps)} words so it lands in ~3s")
        if pos == 0 and THROAT_CLEARING_RE.match(row.vo):
            row.flags.append("Hook opens with throat-clearing (greeting/intro); start with the most "
                             "interesting line instead")
        if slot is not None and slot > 0 and row.est_seconds > slot * OVERFLOW_TOLERANCE:
            row.flags.append(
                f"Voice-over needs ~{row.est_seconds:.1f}s but slot is {slot:.1f}s; "
                "cut words or widen the slot")
        if row.text_words > TEXT_MAX_WORDS:
            row.flags.append(f"On-screen text has {row.text_words} words; keep cards <= {TEXT_MAX_WORDS}")
        if slot is not None and row.text_words:
            read_time = row.text_words / READ_WPS + READ_LEAD_IN
            if read_time > slot * OVERFLOW_TOLERANCE:
                row.flags.append(
                    f"On-screen text needs ~{read_time:.1f}s to read but is up for {slot:.1f}s")

    spoken_total = sum(r.est_seconds for r in rows)
    scripted_end = max((r.end for r in rows if r.end is not None), default=None)
    total_words = sum(r.vo_words for r in rows)
    return {
        "words_per_second": wps,
        "spoken_words": total_words,
        "estimated_spoken_seconds": round(spoken_total, 1),
        "scripted_runtime_seconds": scripted_end,
        "rows": [
            {
                "row": r.index,
                "beat": r.beat,
                "time": r.time_raw,
                "vo_words": r.vo_words,
                "est_seconds": round(r.est_seconds, 1),
                "text_words": r.text_words,
                "flags": r.flags,
            }
            for r in rows
        ],
        "flag_count": sum(len(r.flags) for r in rows),
    }


def print_report(report: dict, path: Path, from_table: bool) -> None:
    print(f"Script: {path}")
    if not from_table:
        print("No script table found - treated the whole file as voice-over.")
    print(f"Pace: {report['words_per_second']} words/sec\n")
    print(f"{'#':>2}  {'Beat':<18} {'Time':<10} {'VO words':>8} {'~sec':>6} {'Text words':>10}")
    print("-" * 60)
    for r in report["rows"]:
        print(f"{r['row']:>2}  {r['beat'][:18]:<18} {r['time'][:10]:<10} {r['vo_words']:>8} "
              f"{r['est_seconds']:>6} {r['text_words']:>10}")
    print("-" * 60)
    print(f"Spoken words: {report['spoken_words']}  ->  ~{report['estimated_spoken_seconds']}s of voice-over")
    if report["scripted_runtime_seconds"] is not None:
        print(f"Scripted runtime (last timestamp): {report['scripted_runtime_seconds']:g}s")

    flagged = [r for r in report["rows"] if r["flags"]]
    if flagged:
        print("\nFlags:")
        for r in flagged:
            for f in r["flags"]:
                print(f"  - row {r['row']} ({r['beat'] or 'untitled'}): {f}")
    else:
        print("\nNo timing flags.")


def chunk_words(text: str, max_words: int) -> list[str]:
    """Split text into caption chunks of <= max_words.

    Breaks at clause punctuation first, then splits each clause into evenly sized
    chunks so captions never end with a stranded single word.
    """
    clauses, current = [], []
    for w in text.split():
        current.append(w)
        if ABBREVIATION_RE.match(w):
            continue
        ends_sentence = re.search(r"[.!?;:]['\"”’)]?$", w)
        ends_phrase = re.search(r",['\"”’)]?$", w) and len(current) >= 2
        if ends_sentence or ends_phrase:
            clauses.append(current)
            current = []
    if current:
        clauses.append(current)

    chunks = []
    for words in clauses:
        n = -(-len(words) // max_words)  # ceil
        base, extra = divmod(len(words), n)
        i = 0
        for k in range(n):
            size = base + (1 if k < extra else 0)
            chunk = " ".join(words[i:i + size]).strip("'\"“”‘’")
            chunks.append(chunk)
            i += size
    return [c for c in chunks if c]


def chunk_weight(chunk: str) -> float:
    return sum(max(1.0, len(w) / 5.0) for w in WORD_RE.findall(chunk)) or 1.0


def srt_timestamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(rows: list[Row], wps: float, max_words: int) -> str:
    cues = []
    cursor = 0.0
    for row in rows:
        if not row.vo:
            if row.end is not None:
                cursor = max(cursor, row.end)
            continue
        start = max(cursor, row.start) if row.start is not None else cursor
        duration = row.vo_words / wps
        chunks = chunk_words(row.vo, max_words)
        weights = [chunk_weight(c) for c in chunks]
        total_w = sum(weights)
        t = start
        for chunk, w in zip(chunks, weights):
            d = duration * w / total_w
            cues.append((t, t + d, chunk.strip('"“”')))
            t += d
        cursor = t

    out = []
    for n, (a, b, text) in enumerate(cues, start=1):
        out.append(f"{n}\n{srt_timestamp(a)} --> {srt_timestamp(b)}\n{text}\n")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_time = sub.add_parser("time", help="estimate timing and flag problems")
    p_time.add_argument("script", type=Path)
    p_time.add_argument("--wps", type=float, default=DEFAULT_WPS, help="spoken words per second")
    p_time.add_argument("--json", action="store_true", help="print machine-readable JSON")

    p_srt = sub.add_parser("srt", help="write an approximate .srt from the voice-over column")
    p_srt.add_argument("script", type=Path)
    p_srt.add_argument("--out", type=Path, required=True)
    p_srt.add_argument("--wps", type=float, default=DEFAULT_WPS)
    p_srt.add_argument("--max-words", type=int, default=4, help="max words per caption chunk")

    args = parser.parse_args(argv)
    if not args.script.exists():
        print(f"error: {args.script} not found", file=sys.stderr)
        return 2

    rows, from_table = parse_script(args.script, args.wps)

    if args.command == "time":
        report = analyse(rows, args.wps)
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print_report(report, args.script, from_table)
        return 0

    srt = build_srt(rows, args.wps, args.max_words)
    if not srt.strip():
        print("error: no voice-over text found to caption", file=sys.stderr)
        return 1
    args.out.write_text(srt, encoding="utf-8")
    print(f"Wrote {srt.count(' --> ')} captions to {args.out} "
          "(timings estimated from pace; re-time against the real audio if a transcription tool is available)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
