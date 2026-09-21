"""
Offline calibration harness -- run this periodically (e.g. after every
batch of ~20-50 resolved review-queue flags) to check whether the AI
grader's scores agree with real teacher-corrected marks, and if not,
in which direction/where it's biased.

This is intentionally a standalone script, not part of the Streamlit
app: calibration checks are a "run occasionally, read the report"
workflow for a teacher/admin, not a live user-facing feature.

Usage:
    python tools/calibration_harness.py
        Uses resolved flags from the review queue (agents/database).

    python tools/calibration_harness.py --csv my_scored_answers.csv
        Uses an external CSV instead/in addition -- useful for a
        larger, deliberately-curated calibration run before relying on
        the system for real grading. Expected columns (header row
        required): question,answer,ai_marks,teacher_marks,max_marks

Metrics reported:
    - Quadratic Weighted Kappa (QWK): the standard agreement metric
      for ordinal scoring tasks (e.g. the ASAP-AES benchmark). Scores
      are normalized to a 0-10 decile band (independent of each
      question's max_marks) before computing kappa, so questions worth
      different amounts of marks can be pooled together.
    - Mean Absolute Error (MAE): both in raw marks and as a
      percentage-of-max, since a 1-mark error means very different
      things on a 0.5-mark question vs a 14-mark question.
    - Pearson correlation: rank/linear agreement.
    - Bias by score band: mean (AI - teacher) percentage, grouped into
      quartiles of the teacher's score -- this is what tells you
      *where* the model is mis-calibrated (e.g. "harsh specifically on
      partial-credit answers" rather than uniformly off).

Interpretation guide (rule of thumb, not a strict standard):
    QWK >= 0.8   excellent agreement
    QWK 0.6-0.8  good agreement, usable with spot-checks
    QWK 0.4-0.6  moderate -- keep the review queue active, consider
                 adding more calibration exemplars for the weak bands
    QWK <  0.4   poor -- do not rely on scores without review; add
                 more calibration exemplars and re-run this harness
"""
import argparse
import csv
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.database import database  # noqa: E402


def load_resolved_flags() -> list:
    """Each item: (ai_marks, teacher_marks, max_marks, question_text)."""
    rows = []
    for key in database.list_keys("flag:"):
        flag = database.load(key)
        if not flag or flag.get("status") != "resolved":
            continue
        ai_marks = flag.get("ai_marks")
        teacher_marks = flag.get("teacher_marks")
        max_marks = flag.get("max_marks")
        if ai_marks is None or teacher_marks is None or not max_marks:
            continue
        rows.append((float(ai_marks), float(teacher_marks), float(max_marks), flag.get("question_text", "")))
    return rows


def load_csv(path: str) -> list:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                ai_marks = float(row["ai_marks"])
                teacher_marks = float(row["teacher_marks"])
                max_marks = float(row["max_marks"])
            except (KeyError, ValueError):
                continue
            rows.append((ai_marks, teacher_marks, max_marks, row.get("question", "")))
    return rows


def quadratic_weighted_kappa(a: np.ndarray, b: np.ndarray, n_bins: int = 11) -> float:
    """
    Standard QWK, computed via sklearn's cohen_kappa_score with
    weights='quadratic' on scores bucketed into n_bins (0..n_bins-1)
    ordinal bins -- avoids needing an external scipy dependency and
    lets questions of different max_marks be pooled on a common scale.
    """
    from sklearn.metrics import cohen_kappa_score

    a_bins = np.clip((a * (n_bins - 1)).round().astype(int), 0, n_bins - 1)
    b_bins = np.clip((b * (n_bins - 1)).round().astype(int), 0, n_bins - 1)
    if len(set(a_bins.tolist()) | set(b_bins.tolist())) < 2:
        return float("nan")  # kappa undefined with only one class present
    return float(cohen_kappa_score(a_bins, b_bins, weights="quadratic"))


def run_report(rows: list):
    if len(rows) < 5:
        print(f"Only {len(rows)} scored example(s) available -- need at least 5 for a meaningful report.")
        print("Resolve more flags in the Review Queue (or supply --csv) and re-run.")
        return

    ai = np.array([r[0] for r in rows])
    teacher = np.array([r[1] for r in rows])
    max_marks = np.array([r[2] for r in rows])

    ai_pct = ai / max_marks
    teacher_pct = teacher / max_marks

    mae_marks = float(np.mean(np.abs(ai - teacher)))
    mae_pct = float(np.mean(np.abs(ai_pct - teacher_pct)) * 100)
    qwk = quadratic_weighted_kappa(ai_pct, teacher_pct)
    pearson_r = float(np.corrcoef(ai_pct, teacher_pct)[0, 1]) if len(rows) > 1 else float("nan")
    bias_pct = float(np.mean((ai_pct - teacher_pct) * 100))  # positive = AI over-scores, negative = under-scores

    print(f"\n{'=' * 60}\nCALIBRATION REPORT  ({len(rows)} scored answers)\n{'=' * 60}")
    print(f"Quadratic Weighted Kappa (QWK): {qwk:.3f}")
    print(f"Pearson correlation (r):        {pearson_r:.3f}")
    print(f"Mean Absolute Error (marks):    {mae_marks:.2f}")
    print(f"Mean Absolute Error (% of max): {mae_pct:.1f}%")
    print(f"Overall bias (AI - teacher):    {bias_pct:+.1f}% "
          f"({'AI over-scores' if bias_pct > 1 else 'AI under-scores' if bias_pct < -1 else 'no strong bias'})")

    print("\nBias by teacher score band (this shows WHERE miscalibration is):")
    bands = [(0, 25), (25, 50), (50, 75), (75, 100)]
    for lo, hi in bands:
        mask = (teacher_pct * 100 >= lo) & (teacher_pct * 100 < hi if hi < 100 else teacher_pct * 100 <= hi)
        n = int(mask.sum())
        if n == 0:
            print(f"  {lo:>3}-{hi:<3}%: (no examples in this band)")
            continue
        band_bias = float(np.mean((ai_pct[mask] - teacher_pct[mask]) * 100))
        print(f"  {lo:>3}-{hi:<3}%: n={n:<3}  bias={band_bias:+.1f}%")

    print(f"\n{'-' * 60}")
    if np.isnan(qwk):
        print("QWK undefined (not enough score variety in this sample yet).")
    elif qwk >= 0.8:
        print("=> Excellent agreement with teacher grading.")
    elif qwk >= 0.6:
        print("=> Good agreement -- usable with periodic spot-checks.")
    elif qwk >= 0.4:
        print("=> Moderate agreement -- keep the review queue active; add more")
        print("   calibration exemplars, especially for the worst-biased band above.")
    else:
        print("=> Poor agreement -- do not rely on AI scores without review yet.")
        print("   Resolve more flags (esp. in the worst-biased band above) to build")
        print("   up dataset/calibration_exemplars.json, then re-run this report.")
    print(f"{'=' * 60}\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", help="Path to an external CSV of teacher-scored answers to include.")
    args = parser.parse_args()

    rows = load_resolved_flags()
    source_desc = f"{len(rows)} resolved review-queue flag(s)"
    if args.csv:
        csv_rows = load_csv(args.csv)
        rows.extend(csv_rows)
        source_desc += f" + {len(csv_rows)} row(s) from {args.csv}"

    print(f"Loaded: {source_desc}")
    run_report(rows)


if __name__ == "__main__":
    main()
