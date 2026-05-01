"""
Lightweight in-memory vector store using TF-IDF + cosine similarity.
Replaces faiss-cpu + sentence-transformers (and therefore torch/transformers).
No heavy dependencies — works within Vercel's 500 MB Lambda limit.
"""

import json
import math
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from collections import defaultdict

from app.config import (
    FAISS_STORE_PATH,
    DEDUP_THRESHOLD,
    TOP_K_RESULTS,
    CHUNK_SIZE,
    CHUNK_OVERLAP,
)


# ─── TF-IDF helpers ──────────────────────────────────────────────────────────

def _tokenize(text: str) -> List[str]:
    """Simple whitespace + lowercase tokenizer."""
    return text.lower().split()


def _tf(tokens: List[str]) -> Dict[str, float]:
    counts: Dict[str, int] = defaultdict(int)
    for t in tokens:
        counts[t] += 1
    total = max(len(tokens), 1)
    return {t: c / total for t, c in counts.items()}


def _idf(corpus_tfs: List[Dict[str, float]]) -> Dict[str, float]:
    n = len(corpus_tfs)
    df: Dict[str, int] = defaultdict(int)
    for tf_doc in corpus_tfs:
        for term in tf_doc:
            df[term] += 1
    return {term: math.log((n + 1) / (count + 1)) + 1 for term, count in df.items()}


def _tfidf_vec(tf: Dict[str, float], idf: Dict[str, float]) -> Dict[str, float]:
    return {term: tf_val * idf.get(term, 1.0) for term, tf_val in tf.items()}


def _norm(vec: Dict[str, float]) -> float:
    return math.sqrt(sum(v * v for v in vec.values())) or 1.0


def _cosine(a: Dict[str, float], b: Dict[str, float]) -> float:
    dot = sum(a.get(t, 0.0) * v for t, v in b.items())
    return dot / (_norm(a) * _norm(b))


# ─── Document index (per session) ────────────────────────────────────────────

class DocumentIndex:
    """Stores chunks for one uploaded document."""

    def __init__(self):
        self.chunks: List[str] = []
        self.meta: List[Dict[str, Any]] = []
        self._tfs: List[Dict[str, float]] = []
        self._idf: Dict[str, float] = {}

    def add_chunks(self, chunks: List[str], source_file: str):
        self.chunks.extend(chunks)
        for i, ch in enumerate(chunks):
            self.meta.append({"source_file": source_file, "chunk_index": i, "text": ch})
            self._tfs.append(_tf(_tokenize(ch)))
        self._idf = _idf(self._tfs)

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        if not self.chunks:
            return []
        q_tf = _tf(_tokenize(query))
        q_vec = _tfidf_vec(q_tf, self._idf)
        scores = []
        for i, tf in enumerate(self._tfs):
            doc_vec = _tfidf_vec(tf, self._idf)
            scores.append((i, _cosine(q_vec, doc_vec)))
        scores.sort(key=lambda x: x[1], reverse=True)
        results = []
        for idx, score in scores[:top_k]:
            r = dict(self.meta[idx])
            r["score"] = score
            results.append(r)
        return results


# ─── Global test-case store ──────────────────────────────────────────────────

class TestCaseStore:
    """Stores all generated test cases with deduplication."""

    def __init__(self, persist_path: Path):
        self.persist_path = persist_path
        self.persist_path.mkdir(parents=True, exist_ok=True)
        self._meta_file = persist_path / "global.meta.json"
        self.testcases: List[Dict[str, Any]] = []
        self._tfs: List[Dict[str, float]] = []
        self._idf: Dict[str, float] = {}
        self._load()

    def _load(self):
        if self._meta_file.exists():
            with open(self._meta_file, "r") as f:
                self.testcases = json.load(f)
            self._rebuild_index()

    def _save(self):
        with open(self._meta_file, "w") as f:
            json.dump(self.testcases, f)

    def _rebuild_index(self):
        self._tfs = []
        for tc in self.testcases:
            text = f"{tc.get('title', '')} {tc.get('steps', '')}"
            self._tfs.append(_tf(_tokenize(text)))
        if self._tfs:
            self._idf = _idf(self._tfs)

    def _text_of(self, tc: Dict[str, Any]) -> str:
        return f"{tc.get('title', '')} {tc.get('steps', '')}"

    def add(self, tc: Dict[str, Any]) -> Tuple[bool, Optional[Dict[str, Any]]]:
        """Returns (is_duplicate, existing_tc_or_None)."""
        if self.testcases:
            q_tf = _tf(_tokenize(self._text_of(tc)))
            q_vec = _tfidf_vec(q_tf, self._idf)
            for i, tf in enumerate(self._tfs):
                doc_vec = _tfidf_vec(tf, self._idf)
                sim = _cosine(q_vec, doc_vec)
                if sim >= DEDUP_THRESHOLD:
                    return True, self.testcases[i]

        self.testcases.append(tc)
        tf = _tf(_tokenize(self._text_of(tc)))
        self._tfs.append(tf)
        self._idf = _idf(self._tfs)
        self._save()
        return False, None

    def search(self, query: str, top_k: int = TOP_K_RESULTS) -> List[Dict[str, Any]]:
        if not self.testcases:
            return []
        q_tf = _tf(_tokenize(query))
        q_vec = _tfidf_vec(q_tf, self._idf)
        scores = []
        for i, tf in enumerate(self._tfs):
            doc_vec = _tfidf_vec(tf, self._idf)
            scores.append((i, _cosine(q_vec, doc_vec)))
        scores.sort(key=lambda x: x[1], reverse=True)
        results = []
        for idx, score in scores[:top_k]:
            r = dict(self.testcases[idx])
            r["score"] = score
            results.append(r)
        return results

    def clear(self):
        self.testcases = []
        self._tfs = []
        self._idf = {}
        self._save()

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_vectors": len(self.testcases),
            "dimension": "tfidf",
            "embedding_model": "tfidf-cosine",
            "provider": "builtin",
        }


# ─── Unified VectorStore (drop-in replacement for FaissStore) ─────────────────

class VectorStore:
    def __init__(self):
        store_path = Path(FAISS_STORE_PATH)
        self._doc_sessions: Dict[str, DocumentIndex] = {}
        self._tc_store = TestCaseStore(store_path / "testcases")

        # Expose paths so main.py export route still works gracefully
        self.global_index_file = store_path / "testcases" / "global.index"
        self.global_meta_file = store_path / "testcases" / "global.meta.json"

    # ── text chunking ──────────────────────────────────────────────────────

    def chunk_text(self, text: str) -> List[str]:
        words = text.split()
        chunks, i = [], 0
        while i < len(words):
            chunks.append(" ".join(words[i: i + CHUNK_SIZE]))
            i += CHUNK_SIZE - CHUNK_OVERLAP
        return chunks

    # ── document API ───────────────────────────────────────────────────────

    def index_document(self, session_id: str, text: str, metadata: Dict[str, Any]) -> int:
        chunks = self.chunk_text(text)
        if not chunks:
            return 0
        idx = DocumentIndex()
        idx.add_chunks(chunks, metadata.get("name", "Unknown"))
        self._doc_sessions[session_id] = idx
        return len(chunks)

    def search_document(self, session_id: str, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        idx = self._doc_sessions.get(session_id)
        if not idx:
            return []
        return idx.search(query, top_k)

    def clear_session(self, session_id: str):
        self._doc_sessions.pop(session_id, None)

    # ── test-case API ──────────────────────────────────────────────────────

    def add_testcase(self, tc: Dict[str, Any]) -> Tuple[bool, Optional[Dict[str, Any]]]:
        return self._tc_store.add(tc)

    def search_testcases(self, query: str, top_k: int = TOP_K_RESULTS) -> List[Dict[str, Any]]:
        return self._tc_store.search(query, top_k)

    def clear_global(self):
        self._tc_store.clear()

    def get_stats(self) -> Dict[str, Any]:
        return self._tc_store.get_stats()


# Singleton — imported by main.py as `faiss_store`
faiss_store = VectorStore()
