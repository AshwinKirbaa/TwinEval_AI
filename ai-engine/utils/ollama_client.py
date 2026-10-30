"""
Centralized wrapper around the `ollama` Python client.

THE BUG THIS FIXES
-------------------
Every agent in this engine (topic relevance, answer-key generation,
holistic rubric scoring, OCR transcription, question splitting,
answer splitting) called `ollama.chat(...)` / `ollama.pull(...)`
directly. The `ollama` package's HTTP client defaults to NO timeout
at all (`httpx.Client(timeout=None)`) unless one is explicitly passed
in -- so a single call that never gets a response (Ollama still
loading the model into memory on a slow/CPU-only machine, a GPU/driver
hiccup, the Ollama process silently wedged, a dropped connection that
doesn't reset cleanly) blocks that call FOREVER. Since the evaluation
job runs one of these calls per question inside a background thread,
one stuck call freezes the entire job: the "stage"/"message" the
frontend polls for stops changing, the progress bar stops moving, and
it never times out or errors -- it just sits there indefinitely. That
is exactly the "evaluation is static at a particular point" symptom.

THE FIX
-------
`chat()` below bounds every Ollama call with a real timeout
(OLLAMA_TIMEOUT_SECONDS, default 90s), retries a couple of times with
backoff for transient errors, and then raises a clear, specific error
so the calling agent's existing try/except fallback logic (every
agent already has one) fires immediately instead of hanging. The
per-question progress reporting already in paper_evaluation_service.py
means the job keeps moving to the next question instead of stalling
the whole run over one slow/broken call.
"""
import os
import time
import mimetypes
from pathlib import Path

DEFAULT_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "90"))
DEFAULT_RETRIES = int(os.environ.get("OLLAMA_MAX_RETRIES", "1"))

# ollama.Client objects are cheap; cache one per distinct timeout value
# so repeated calls with the default timeout reuse the same underlying
# httpx.Client instead of reconnecting every time.
_clients = {}


def _provider():
    return os.environ.get("AI_PROVIDER", "ollama").strip().lower()


def _gemini_chat(model, messages, options=None, format=None):
    """Call Gemini while preserving the small Ollama response contract used
    by the existing agents. Images supplied as Ollama-style file paths are
    converted to inline Gemini parts."""
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("AI_PROVIDER=gemini requires GEMINI_API_KEY.")

    configured_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    selected_model = configured_model or model
    prompt_sections = []
    image_parts = []
    for message in messages or []:
        role = str(message.get("role", "user")).upper()
        prompt_sections.append(f"{role}: {message.get('content', '')}")
        for image_path in message.get("images", []) or []:
            path = Path(image_path)
            mime_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
            image_parts.append(types.Part.from_bytes(data=path.read_bytes(), mime_type=mime_type))

    opts = options or {}
    config_kwargs = {
        "temperature": float(opts.get("temperature", 0.2)),
        "top_p": float(opts.get("top_p", 0.9)),
        "max_output_tokens": int(opts.get("num_predict", 8192)),
    }
    if format == "json":
        config_kwargs["response_mime_type"] = "application/json"

    response = genai.Client(api_key=api_key).models.generate_content(
        model=selected_model,
        contents=["\n\n".join(prompt_sections), *image_parts],
        config=types.GenerateContentConfig(**config_kwargs),
    )
    content = (response.text or "").strip()
    if not content:
        raise RuntimeError("Gemini returned an empty response.")
    return {"message": {"role": "assistant", "content": content}}


def _client(timeout: float):
    import ollama
    if timeout not in _clients:
        _clients[timeout] = ollama.Client(timeout=timeout)
    return _clients[timeout]


class OllamaTimeoutError(RuntimeError):
    """Raised when Ollama does not respond within the configured
    timeout, after retries. Callers' existing `except Exception`
    fallback paths already handle this like any other failure."""


def chat(model, messages, options=None, timeout=None, retries=None, format=None):
    """
    Drop-in, timeout-bounded replacement for `ollama.chat(...)`.

    - Never blocks longer than `timeout` seconds per attempt (default
      OLLAMA_TIMEOUT_SECONDS env var, or 90s).
    - Retries transient failures (timeouts, connection resets) up to
      `retries` times (default 1) with a short backoff before giving
      up -- a single slow response shouldn't fail a question outright.
    - Raises OllamaTimeoutError with an actionable message if every
      attempt times out, instead of hanging.

    Returns the same response object `ollama.chat()` returns.
    """
    if _provider() == "gemini":
        return _gemini_chat(model, messages, options=options, format=format)

    timeout = DEFAULT_TIMEOUT if timeout is None else timeout
    retries = DEFAULT_RETRIES if retries is None else retries
    client = _client(timeout)

    last_err = None
    for attempt in range(retries + 1):
        try:
            kwargs = {"model": model, "messages": messages, "options": options or {}}
            if format is not None:
                kwargs["format"] = format
            return client.chat(**kwargs)
        except Exception as e:
            last_err = e
            err_name = type(e).__name__.lower()
            err_text = str(e).lower()
            is_timeout = "timeout" in err_name or "timeout" in err_text or "timed out" in err_text
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            if is_timeout:
                raise OllamaTimeoutError(
                    f"The local AI model ('{model}') did not respond within {timeout:.0f} seconds. "
                    "Ollama may be overloaded, still loading the model, or stuck -- check the "
                    "'ollama serve' / Ollama app window, then try again."
                ) from e
            raise
    raise last_err  # pragma: no cover -- loop always returns or raises above


def pull(model, timeout=None):
    """Timeout-bounded replacement for `ollama.pull(...)`. Model pulls
    can legitimately take a while (downloading multiple GB), so this
    uses a much longer default timeout than chat()."""
    if _provider() == "gemini":
        return {"status": "Hosted Gemini models do not require downloading."}
    timeout = timeout if timeout is not None else float(os.environ.get("OLLAMA_PULL_TIMEOUT_SECONDS", "1800"))
    return _client(timeout).pull(model)


def list_models(timeout=None):
    """Timeout-bounded replacement for `ollama.list()`."""
    if _provider() == "gemini":
        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        return {"models": [{"model": model, "name": model}]}
    timeout = timeout if timeout is not None else min(DEFAULT_TIMEOUT, 15.0)
    return _client(timeout).list()
