import os
import re
import logging
from typing import Dict, Any, List, Optional
import pandas as pd
from rapidfuzz import process, fuzz

logger = logging.getLogger(__name__)

FORMS = r"\b(tablets?|capsules?|syrup|injection|drops|cream|gel|ointment|powder|suspension|oral solution|sachet|lotion|inhaler)\b"

def base_name(name: str) -> str:
    """Strip dosage forms, metric strengths, numbers, and punctuation to get the base molecule/brand."""
    if not name:
        return ""
    n = str(name).lower()
    n = re.sub(FORMS, " ", n)
    n = re.sub(r"\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|%)\b", " ", n) # strengths
    n = re.sub(r"\b\d+\b", " ", n) # stray numbers
    n = re.sub(r"[^a-z\s-]", " ", n) # symbols
    return re.sub(r"\s+", " ", n).strip()


# Common Indian clinical brands / OTC nutraceuticals often written by doctors
COMMON_SUPPLEMENTS = [
    {"name": "Zincovit Tablet", "short_composition1": "Multivitamins", "short_composition2": "Multiminerals with Zinc", "manufacturer_name": "Apex Laboratories Ltd"},
    {"name": "Zincovit Syrup", "short_composition1": "Multivitamins", "short_composition2": "Zinc", "manufacturer_name": "Apex Laboratories Ltd"},
    {"name": "Rabemar 20 Capsule", "short_composition1": "Rabeprazole (20mg)", "short_composition2": "", "manufacturer_name": "Macleods Pharmaceuticals"},
    {"name": "Becosules Capsule", "short_composition1": "Vitamin B-Complex", "short_composition2": "Vitamin C", "manufacturer_name": "Pfizer Ltd"},
    {"name": "Limcee 500mg Chewable Tablet", "short_composition1": "Vitamin C (500mg)", "short_composition2": "", "manufacturer_name": "Abbott"},
    {"name": "Supradyn Daily Tablet", "short_composition1": "Multivitamins", "short_composition2": "Minerals + Trace Elements", "manufacturer_name": "Bayer Pharmaceuticals"},
    {"name": "Cital Syrup", "short_composition1": "Disodium Hydrogen Citrate (1.37gm/5ml)", "short_composition2": "", "manufacturer_name": "Indoco Remedies Ltd"},
    {"name": "Citalopram 20mg Tablet", "short_composition1": "Citalopram (20mg)", "short_composition2": "", "manufacturer_name": "Torrent Pharmaceuticals"},
    {"name": "Dolo 650 Tablet", "short_composition1": "Paracetamol (650mg)", "short_composition2": "", "manufacturer_name": "Micro Labs Ltd"},
    {"name": "Calpol 500 Tablet", "short_composition1": "Paracetamol (500mg)", "short_composition2": "", "manufacturer_name": "GlaxoSmithKline"},
    {"name": "Crocin 650 Advance Tablet", "short_composition1": "Paracetamol (650mg)", "short_composition2": "", "manufacturer_name": "GlaxoSmithKline"},
    {"name": "Combiflam Tablet", "short_composition1": "Ibuprofen (400mg)", "short_composition2": "Paracetamol (325mg)", "manufacturer_name": "Sanofi India"},
    {"name": "PAN 40 Tablet", "short_composition1": "Pantoprazole (40mg)", "short_composition2": "", "manufacturer_name": "Alkem Laboratories Ltd"},
    {"name": "Pan-D Capsule", "short_composition1": "Pantoprazole (40mg)", "short_composition2": "Domperidone (30mg)", "manufacturer_name": "Alkem Laboratories Ltd"},
    {"name": "Shelcal 500 Tablet", "short_composition1": "Calcium (500mg)", "short_composition2": "Vitamin D3 (250IU)", "manufacturer_name": "Torrent Pharmaceuticals"},
    {"name": "Neurobion Forte Tablet", "short_composition1": "Vitamin B-Complex", "short_composition2": "Vitamin B12", "manufacturer_name": "Procter & Gamble"},
    {"name": "Zenplan 10 Tablet", "short_composition1": "Escitalopram (10mg)", "short_composition2": "Clonazepam (0.5mg)", "manufacturer_name": "Macleods Pharmaceuticals"},
    {"name": "Etilosylate Sachet", "short_composition1": "Ethamsylate (250mg)", "short_composition2": "", "manufacturer_name": "Sun Pharma"}
]


class MedicineMatcher:
    """
    High-performance fuzzy matching index over 250,000+ Indian medicines.
    Loaded once at application startup.
    """
    _instance = None
    _initialized = False

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(MedicineMatcher, cls).__new__(cls)
        return cls._instance

    def __init__(self, csv_path: Optional[str] = None):
        if MedicineMatcher._initialized:
            return

        if csv_path is None:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            csv_path = os.path.join(base_dir, "data", "medicines.csv")

        self.groups: Dict[str, List[Dict[str, Any]]] = {}
        self.choices: List[str] = []

        try:
            logger.info(f"Loading Indian Medicines Dataset from {csv_path}...")
            cols = ["name", "short_composition1", "short_composition2", "manufacturer_name"]
            
            if os.path.exists(csv_path):
                df = pd.read_csv(csv_path, usecols=cols)
                df = pd.concat([df, pd.DataFrame(COMMON_SUPPLEMENTS)], ignore_index=True)
            else:
                logger.warning(f"medicines.csv not found at {csv_path}, falling back to built-in supplements database.")
                df = pd.DataFrame(COMMON_SUPPLEMENTS)

            df["base"] = df["name"].map(base_name)
            # Filter valid base names (at least 2 chars)
            df = df[df["base"].str.len() >= 2]

            # Index records grouped by base name
            for row in df.drop_duplicates(subset=["name"]).to_dict("records"):
                b = row["base"]
                self.groups.setdefault(b, []).append(row)

            self.choices = list(self.groups.keys())
            MedicineMatcher._initialized = True
            logger.info(f"MedicineMatcher successfully indexed {len(self.choices)} unique Indian medicine bases.")

        except Exception as e:
            logger.error(f"Failed to load medicine dataset: {e}")
            self.choices = []

    def _info(self, base: str) -> Dict[str, Any]:
        """Extract matched name, composition, and manufacturer for a base name."""
        records = self.groups.get(base, [])
        if not records:
            return {"matched_name": base.title(), "generic": "", "manufacturer": None}
        r = records[0]
        parts = [r.get("short_composition1"), r.get("short_composition2")]
        generic = " + ".join(p.strip() for p in parts if isinstance(p, str) and p.strip())
        return {
            "matched_name": r.get("name"),
            "generic": generic,
            "manufacturer": r.get("manufacturer_name")
        }

    def match(self, raw_name: str, accept: float = 85.0, confirm: float = 70.0) -> Dict[str, Any]:
        """
        Fuzzy match handwriting/OCR read against 250,000+ Indian medicines.
        
        Returns:
            {
                "status": "matched" | "confirm" | "not_found",
                "score": float,
                "candidates": List[str],
                "matched_name": Optional[str],
                "generic": Optional[str],
                "manufacturer": Optional[str]
            }
        """
        q = base_name(raw_name)
        if not q or not self.choices:
            return {
                "status": "not_found",
                "score": 0.0,
                "candidates": [],
                "matched_name": None,
                "generic": None,
                "manufacturer": None
            }

        # Composite scorer with substring penalty to prevent short substrings matching long words
        def scorer(s1, s2, **kwargs):
            l1, l2 = len(s1), len(s2)
            ratio = fuzz.ratio(s1, s2)
            w = fuzz.WRatio(s1, s2)
            if min(l1, l2) < max(l1, l2) * 0.65:
                return (w + ratio) / 2
            return max(w, ratio)

        hits = process.extract(q, self.choices, scorer=scorer, limit=3, score_cutoff=55)
        if not hits:
            return {
                "status": "not_found",
                "score": 0.0,
                "candidates": [],
                "matched_name": None,
                "generic": None,
                "manufacturer": None
            }

        best, score, _ = hits[0]
        # Ambiguous if top two hits are very close
        ambiguous = len(hits) > 1 and (hits[0][1] - hits[1][1] < 3.0) and score < 95.0
        
        status = "matched" if score >= accept and not ambiguous else "confirm" if score >= confirm else "not_found"

        out = {
            "status": status,
            "score": round(float(score), 1),
            "candidates": [h[0].title() for h in hits]
        }

        if status != "not_found":
            out.update(self._info(best))
        else:
            out.update({"matched_name": None, "generic": None, "manufacturer": None})

        return out


# Global singleton instance
medicine_matcher = MedicineMatcher()
