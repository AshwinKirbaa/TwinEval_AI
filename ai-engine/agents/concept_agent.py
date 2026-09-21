import json
import re
from pathlib import Path

from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

# Full, explicit Hugging Face repo id (https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2).
# Small (22.7M params) and fast, while still giving good sentence-level
# semantic similarity for concept/keyword matching -- a good fit for
# running fully offline on a laptop CPU.
_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# Loading a SentenceTransformer is relatively expensive (reads model
# weights from disk/cache). ConceptAgent() gets instantiated in a few
# different places (AnswerEvaluationAgent, some legacy OCR-evaluation
# call sites) -- without this cache, each one would reload its own full
# copy of the model. Keyed by model name so a future change to
# _MODEL_NAME (or any other caller passing a different model) still
# works correctly, it just gets its own cached entry.
_MODEL_CACHE = {}


def _get_shared_model(model_name: str) -> SentenceTransformer:
    if model_name not in _MODEL_CACHE:
        _MODEL_CACHE[model_name] = SentenceTransformer(model_name)
    return _MODEL_CACHE[model_name]


class ConceptAgent:

    def __init__(self):
        self.model = _get_shared_model(_MODEL_NAME)

        dataset_path = Path(__file__).parent.parent / "dataset" / "concepts.json"
        with open(dataset_path, "r", encoding="utf-8") as file:
            self.data = json.load(file)

    def extract_concepts_from_teacher(self, teacher_answer: str) -> list[str]:
        if not teacher_answer:
            return []

        lines = [line.strip() for line in teacher_answer.splitlines() if line.strip()]
        concepts = []

        ignore_patterns = [
            r"^\s*the\s+four\s+main\s+principles",
            r"^\s*the\s+\w+\s+layers",
            r"\bconsists of\b",
            r"\bincludes\b",
            r"\bcontains\b",
            r"\bthe model\b",
            r"\bexample\b",
            r"\badvantages\b",
            r"\bconclusion\b",
            r"\bsummary\b"
        ]

        for line in lines:
            # Skip generic heading lines like "The four main principles of OOP are:"
            if any(re.search(pattern, line, re.I) for pattern in ignore_patterns) and line.endswith(":"):
                continue

            # Key - Description pattern (e.g. Encapsulation - Wrapping data...)
            if re.search(r"\s+[–—-]\s+", line):
                left, _ = re.split(r"\s+[–—-]\s+", line, maxsplit=1)
                left = left.strip()
                if left and not re.search(r"\b(principles?|advantages?|conclusion|summary|definition|definitions?)\b", left, re.I):
                    concepts.append(left)
                    continue

            # Numbered / Bulleted list item (e.g. 1. Physical Layer: ...)
            if re.match(r"^(?:\d+[\.)]|[-\*\•])\s+", line):
                item = re.sub(r"^(?:\d+[\.)]|[-\*\•])\s+", "", line).strip()
                if ":" in item:
                    item = item.split(":", 1)[0].strip()
                if re.search(r"\s+[–—-]\s+", item):
                    item = re.split(r"\s+[–—-]\s+", item, maxsplit=1)[0].strip()
                if item and not re.search(r"\b(principles?|advantages?|conclusion|summary|definition|definitions?)\b", item, re.I):
                    concepts.append(item)
                continue

            # Key: Value pattern (e.g. Encapsulation: Wrapping...)
            if ":" in line:
                left = line.split(":", 1)[0].strip()
                if len(left.split()) <= 12 and not re.search(r"\b(principles?|advantages?|conclusion|summary|definition|definitions?)\b", left, re.I):
                    concepts.append(left)
                    continue

            # Single key line or short header line
            if len(line.split()) <= 8 and not re.search(r"\b(principles?|advantages?|conclusion|summary|definition|definitions?)\b", line, re.I):
                concepts.append(line)

        cleaned = []
        for concept in concepts:
            normalized = concept.strip()
            if normalized and normalized not in cleaned:
                cleaned.append(normalized)

        return cleaned

    def check_concepts(self, topic, student_answer, teacher_answer=None):
        if not student_answer or not student_answer.strip():
            expected = []
            if teacher_answer:
                expected = self.extract_concepts_from_teacher(teacher_answer)
            elif topic in self.data and topic != "General Evaluation":
                expected = self.data[topic]["concepts"]
            return [], expected

        expected = []
        if teacher_answer:
            expected = self.extract_concepts_from_teacher(teacher_answer)

        if not expected:
            if topic in self.data and topic != "General Evaluation":
                expected = self.data[topic]["concepts"]
            else:
                expected = [w.strip() for w in topic.split() if len(w.strip()) > 3]
                if not expected:
                    expected = ["Key Concepts", "Core Definitions"]

        found = []
        missing = []

        answer_lower = student_answer.lower()

        # Split student answer into sentences
        sentences = [
            s.strip()
            for s in re.split(r"[.!?\n]\s*", student_answer)
            if len(s.strip()) > 3
        ]

        if not sentences:
            return [], expected

        # Precompute sentence embeddings for semantic similarity check
        try:
            sentence_embeddings = self.model.encode(sentences)
        except Exception as e:
            print(f"Embedding encoding error: {e}")
            sentence_embeddings = None

        # First pass: cheap exact/substring keyword matching -- resolves
        # most concepts without touching the model at all, and tells us
        # exactly which concepts actually need a semantic-similarity
        # check (so we only ever batch-encode the ones we truly need).
        needs_semantic_check = []
        core_terms_by_concept = {}

        for concept in expected:
            concept_clean = concept.strip()
            concept_lower = concept_clean.lower()

            # Extract core term from concept if it contains parentheses or punctuation (e.g. "First Normal Form (1NF)" -> ["1nf", "first normal form"])
            core_terms = [concept_lower]
            paren_match = re.search(r"\((.*?)\)", concept_lower)
            if paren_match:
                core_terms.append(paren_match.group(1).strip())
                base_part = re.sub(r"\(.*?\)", "", concept_lower).strip()
                if base_part:
                    core_terms.append(base_part)
            core_terms_by_concept[concept_clean] = core_terms

            is_found = False
            for term in core_terms:
                if len(term) >= 3 and term in answer_lower:
                    found.append(concept_clean)
                    is_found = True
                    break

            if not is_found:
                needs_semantic_check.append(concept_clean)

        # Second pass: ONE batched encode() call for every remaining
        # concept, instead of a separate model call per concept in a
        # loop -- this is the single biggest speed win here, since each
        # individual encode() call carries fixed per-call overhead that
        # batching avoids almost entirely.
        if needs_semantic_check and sentence_embeddings is not None and len(sentence_embeddings) > 0:
            try:
                concept_embeddings = self.model.encode(needs_semantic_check)
            except Exception as e:
                print(f"Batched concept embedding failed: {e}")
                concept_embeddings = None

            for concept_clean, concept_embedding in zip(
                needs_semantic_check,
                concept_embeddings if concept_embeddings is not None else [],
            ):
                try:
                    similarities = cosine_similarity([concept_embedding], sentence_embeddings)[0]
                    best_similarity = float(similarities.max())

                    # Lowered from 0.75/0.70: those thresholds were tuned for
                    # near-identical phrasing and were rejecting genuine,
                    # correctly-explained-but-differently-worded answers
                    # (e.g. a handwritten answer paraphrasing a concept in
                    # its own words). A student explaining the *idea* in
                    # their own language should still get credit -- exact
                    # wording match belongs to "keywords", not "concepts".
                    threshold = 0.58 if len(concept_clean.split()) <= 2 else 0.52

                    if best_similarity >= threshold:
                        found.append(concept_clean)
                    else:
                        missing.append(concept_clean)
                except Exception as e:
                    print(f"Cosine similarity calculation failed for concept '{concept_clean}': {e}")
                    missing.append(concept_clean)
        else:
            missing.extend(needs_semantic_check)

        return found, missing