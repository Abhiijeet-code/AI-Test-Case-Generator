import os
import json
import faiss
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from sentence_transformers import SentenceTransformer
from app.config import (
    FAISS_STORE_PATH,
    DEDUP_THRESHOLD,
    TOP_K_RESULTS,
    CHUNK_SIZE,
    CHUNK_OVERLAP,
    EMBEDDING_PROVIDER,
    EMBEDDING_MODEL,
    OPENAI_API_KEY
)

class FaissStore:
    def __init__(self):
        self.store_path = Path(FAISS_STORE_PATH)
        self.docs_path = self.store_path / "documents"
        self.testcases_path = self.store_path / "testcases"
        self.docs_path.mkdir(parents=True, exist_ok=True)
        self.testcases_path.mkdir(parents=True, exist_ok=True)
        
        self.dimension = 384
        if "ada" in EMBEDDING_MODEL or "text-embedding-3" in EMBEDDING_MODEL:
            self.dimension = 1536
        elif "mpnet" in EMBEDDING_MODEL:
            self.dimension = 768

        self.global_index_file = self.testcases_path / "global.index"
        self.global_meta_file = self.testcases_path / "global.meta.json"
        
        self._init_global_index()
        self._load_model()

    def _load_model(self):
        if EMBEDDING_PROVIDER == "sentence_transformers":
            self.model = SentenceTransformer(EMBEDDING_MODEL)
        else:
            import openai
            openai.api_key = OPENAI_API_KEY
            self.model = None # Handled in _embed

    def _embed(self, texts: List[str]) -> np.ndarray:
        if EMBEDDING_PROVIDER == "sentence_transformers":
            embeddings = self.model.encode(texts, normalize_embeddings=True)
            return embeddings.astype('float32')
        else:
            import openai
            res = openai.embeddings.create(input=texts, model=EMBEDDING_MODEL)
            embs = [d.embedding for d in res.data]
            embs_np = np.array(embs, dtype='float32')
            faiss.normalize_L2(embs_np)
            return embs_np

    def _init_global_index(self):
        if self.global_index_file.exists():
            self.global_index = faiss.read_index(str(self.global_index_file))
            with open(self.global_meta_file, 'r') as f:
                self.global_meta = json.load(f)
        else:
            self.global_index = faiss.IndexFlatIP(self.dimension)
            self.global_meta = []
            self._save_global()

    def _save_global(self):
        faiss.write_index(self.global_index, str(self.global_index_file))
        with open(self.global_meta_file, 'w') as f:
            json.dump(self.global_meta, f)

    def chunk_text(self, text: str) -> List[str]:
        words = text.split()
        chunks = []
        i = 0
        while i < len(words):
            chunk = " ".join(words[i:i + CHUNK_SIZE])
            chunks.append(chunk)
            i += CHUNK_SIZE - CHUNK_OVERLAP
        return chunks

    def index_document(self, session_id: str, text: str, metadata: Dict[str, Any]) -> int:
        chunks = self.chunk_text(text)
        if not chunks:
            return 0
        embeddings = self._embed(chunks)
        index = faiss.IndexFlatIP(self.dimension)
        index.add(embeddings)
        
        session_idx_path = self.docs_path / f"{session_id}.index"
        session_meta_path = self.docs_path / f"{session_id}.meta.json"
        
        faiss.write_index(index, str(session_idx_path))
        
        meta = [{"source_file": metadata.get("name", "Unknown"), "chunk_index": i, "text": chunk} for i, chunk in enumerate(chunks)]
        with open(session_meta_path, 'w') as f:
            json.dump(meta, f)
            
        return len(chunks)

    def search_document(self, session_id: str, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        session_idx_path = self.docs_path / f"{session_id}.index"
        session_meta_path = self.docs_path / f"{session_id}.meta.json"
        
        if not session_idx_path.exists() or not session_meta_path.exists():
            return []
            
        index = faiss.read_index(str(session_idx_path))
        with open(session_meta_path, 'r') as f:
            meta = json.load(f)
            
        q_emb = self._embed([query])
        D, I = index.search(q_emb, min(top_k, index.ntotal))
        
        results = []
        for dist, idx in zip(D[0], I[0]):
            if idx != -1:
                res = dict(meta[idx])
                res["score"] = float(dist)
                results.append(res)
        return results

    def add_testcase(self, testcase: Dict[str, Any]) -> Tuple[bool, Optional[Dict[str, Any]]]:
        text_rep = f"{testcase.get('title', '')}\n{testcase.get('steps', '')}"
        emb = self._embed([text_rep])
        
        # Check deduplication
        if self.global_index.ntotal > 0:
            D, I = self.global_index.search(emb, 1)
            if D[0][0] > DEDUP_THRESHOLD and I[0][0] != -1:
                return True, self.global_meta[I[0][0]]
        
        self.global_index.add(emb)
        self.global_meta.append(testcase)
        self._save_global()
        return False, None

    def search_testcases(self, query: str, top_k: int = TOP_K_RESULTS) -> List[Dict[str, Any]]:
        if self.global_index.ntotal == 0:
            return []
            
        q_emb = self._embed([query])
        D, I = self.global_index.search(q_emb, min(top_k, self.global_index.ntotal))
        
        results = []
        for dist, idx in zip(D[0], I[0]):
            if idx != -1:
                res = dict(self.global_meta[idx])
                res["score"] = float(dist)
                results.append(res)
        return results

    def clear_session(self, session_id: str):
        idx_path = self.docs_path / f"{session_id}.index"
        meta_path = self.docs_path / f"{session_id}.meta.json"
        if idx_path.exists(): idx_path.unlink()
        if meta_path.exists(): meta_path.unlink()

    def clear_global(self):
        self.global_index = faiss.IndexFlatIP(self.dimension)
        self.global_meta = []
        self._save_global()

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_vectors": self.global_index.ntotal,
            "dimension": self.dimension,
            "embedding_model": EMBEDDING_MODEL,
            "provider": EMBEDDING_PROVIDER
        }

faiss_store = FaissStore()
