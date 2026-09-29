import asyncio
import aiohttp
import logging
import time
from typing import Dict, List
from urllib.parse import quote
from indian_drugs import INDIAN_DRUG_NAMES
from medicine_matcher import medicine_matcher

logger = logging.getLogger(__name__)

# Cache for validation results (process lifetime)
_validation_cache = {}


def _fallback_indian_set_check(name: str) -> bool:
    """Fallback check against static INDIAN_DRUG_NAMES."""
    try:
        normalized_name = name.lower().strip()
        if normalized_name in INDIAN_DRUG_NAMES:
            return True
        for word in normalized_name.split():
            if word in ['tablet', 'capsule', 'syrup', 'injection', 'mg', 'ml', 'gm']:
                continue
            if word in INDIAN_DRUG_NAMES:
                return True
        return False
    except Exception:
        return False


async def validate_medicine_name(name: str) -> Dict[str, any]:
    """
    Check medicine name against two sources in parallel:
    
    1. Indian Medicines Dataset (250,000+ brands) via medicine_matcher:
       Extracts normalized base, calculates fuzzy score with RapidFuzz,
       extracts generic composition (short_composition1 & 2), and manufacturer.
       Returns status: 'matched' | 'confirm' | 'not_found'
    
    2. OpenFDA API:
       GET https://api.fda.gov/drug/label.json?search=openfda.brand_name:"{name}"&limit=1
       Timeout: 2.5 seconds.
    
    Returns: {
        "fda_verified": bool,
        "india_db_verified": bool,
        "status": str,
        "matched_name": Optional[str],
        "generic": Optional[str],
        "manufacturer": Optional[str],
        "candidates": List[str],
        "match_score": float,
        "normalized_name": str
    }
    """
    if not name or not name.strip():
        return {
            "fda_verified": False,
            "india_db_verified": False,
            "status": "not_found",
            "matched_name": None,
            "generic": None,
            "manufacturer": None,
            "candidates": [],
            "match_score": 0.0,
            "normalized_name": ""
        }
    
    normalized_name = name.strip().lower()
    
    # Check cache first
    if normalized_name in _validation_cache:
        logger.debug(f"Cache hit for medicine: {name}")
        return _validation_cache[normalized_name]
    
    start_time = time.time()
    
    # Run FDA check as async task
    fda_task = asyncio.create_task(_validate_fda(name))
    
    # Match against Indian Medicine Dataset
    try:
        match_res = medicine_matcher.match(name)
    except Exception as e:
        logger.error(f"Medicine matcher error for {name}: {e}")
        match_res = {
            "status": "not_found",
            "score": 0.0,
            "candidates": [],
            "matched_name": None,
            "generic": None,
            "manufacturer": None
        }

    status = match_res.get("status", "not_found")
    india_verified = (status == "matched")

    # If not found by fuzzy matcher, check fallback static drug names
    if status == "not_found" and _fallback_indian_set_check(name):
        status = "matched"
        india_verified = True
        match_res["status"] = "matched"
        match_res["matched_name"] = name.strip().title()

    try:
        fda_verified = await fda_task
    except Exception as e:
        logger.warning(f"FDA validation failed for {name}: {e}")
        fda_verified = False

    result = {
        "fda_verified": bool(fda_verified),
        "india_db_verified": india_verified,
        "status": status,
        "matched_name": match_res.get("matched_name"),
        "generic": match_res.get("generic"),
        "manufacturer": match_res.get("manufacturer"),
        "candidates": match_res.get("candidates", []),
        "match_score": match_res.get("score", 0.0),
        "normalized_name": normalized_name
    }

    _validation_cache[normalized_name] = result
    validation_time = time.time() - start_time
    logger.info(
        f"Validated '{name}' in {validation_time:.2f}s - Status: {status} ({result['match_score']}%), "
        f"Generic: {result['generic']}, FDA: {fda_verified}"
    )
    return result


async def _validate_fda(name: str) -> bool:
    """
    Validate medicine name against OpenFDA API.
    Returns True if found, False otherwise (including on errors).
    """
    try:
        encoded_name = quote(name)
        url = f"https://api.fda.gov/drug/label.json?search=openfda.brand_name:\"{encoded_name}\"&limit=1"
        timeout = aiohttp.ClientTimeout(total=2.5)
        
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    results = data.get('results', [])
                    return len(results) > 0
                else:
                    return False
    except asyncio.TimeoutError:
        logger.debug(f"FDA API timeout for {name}")
        return False
    except Exception as e:
        logger.debug(f"FDA API error for {name}: {e}")
        return False


async def validate_all_medicines(medicines: List[Dict]) -> List[Dict]:
    """
    Run validation for all medicines concurrently using asyncio.gather.
    
    Args:
        medicines: List of medicine dictionaries from LLM extraction
        
    Returns:
        List of medicine dictionaries with verification and matching fields populated
    """
    if not medicines:
        return []
    
    start_time = time.time()
    
    try:
        # Create validation tasks for all medicines
        validation_tasks = []
        for medicine in medicines:
            medicine_name = medicine.get('name', '')
            if medicine_name:
                task = validate_medicine_name(medicine_name)
                validation_tasks.append(task)
            else:
                async def dummy_validation():
                    return {
                        "fda_verified": False,
                        "india_db_verified": False,
                        "status": "not_found",
                        "matched_name": None,
                        "generic": None,
                        "manufacturer": None,
                        "candidates": [],
                        "match_score": 0.0,
                        "normalized_name": ""
                    }
                validation_tasks.append(dummy_validation())
        
        # Run all validations concurrently
        validation_results = await asyncio.gather(*validation_tasks, return_exceptions=True)
        
        # Merge validation results with medicine data
        validated_medicines = []
        for i, medicine in enumerate(medicines):
            validated_medicine = medicine.copy()
            
            if i < len(validation_results):
                vr = validation_results[i]
                
                if isinstance(vr, Exception):
                    logger.warning(f"Validation failed for medicine {i}: {vr}")
                    validated_medicine['fda_verified'] = False
                    validated_medicine['india_db_verified'] = False
                    validated_medicine['status'] = "not_found"
                    validated_medicine['matched_name'] = None
                    validated_medicine['generic'] = None
                    validated_medicine['manufacturer'] = None
                    validated_medicine['candidates'] = []
                    validated_medicine['match_score'] = 0.0
                else:
                    validated_medicine['fda_verified'] = vr.get('fda_verified', False)
                    validated_medicine['india_db_verified'] = vr.get('india_db_verified', False)
                    validated_medicine['status'] = vr.get('status', 'not_found')
                    validated_medicine['matched_name'] = vr.get('matched_name')
                    validated_medicine['generic'] = vr.get('generic')
                    validated_medicine['manufacturer'] = vr.get('manufacturer')
                    validated_medicine['candidates'] = vr.get('candidates', [])
                    validated_medicine['match_score'] = vr.get('match_score', 0.0)
            else:
                validated_medicine['fda_verified'] = False
                validated_medicine['india_db_verified'] = False
                validated_medicine['status'] = "not_found"
                validated_medicine['matched_name'] = None
                validated_medicine['generic'] = None
                validated_medicine['manufacturer'] = None
                validated_medicine['candidates'] = []
                validated_medicine['match_score'] = 0.0
            
            validated_medicines.append(validated_medicine)
        
        total_time = time.time() - start_time
        verified_count = sum(1 for m in validated_medicines 
                           if m.get('india_db_verified') or m.get('fda_verified') or m.get('status') == 'matched')
        
        logger.info(f"Validated {len(medicines)} medicines in {total_time:.2f}s - {verified_count} verified")
        return validated_medicines
        
    except Exception as e:
        logger.error(f"Batch medicine validation failed: {e}")
        fallback_medicines = []
        for medicine in medicines:
            fallback_medicine = medicine.copy()
            fallback_medicine['fda_verified'] = False
            fallback_medicine['india_db_verified'] = False
            fallback_medicine['status'] = "not_found"
            fallback_medicine['matched_name'] = None
            fallback_medicine['generic'] = None
            fallback_medicine['manufacturer'] = None
            fallback_medicine['candidates'] = []
            fallback_medicine['match_score'] = 0.0
            fallback_medicines.append(fallback_medicine)
        return fallback_medicines


def get_validation_stats() -> Dict[str, any]:
    """
    Get statistics about validation cache and performance.
    """
    return {
        "cached_medicines": len(_validation_cache),
        "fda_verified_count": sum(1 for result in _validation_cache.values() 
                                 if result.get('fda_verified')),
        "india_verified_count": sum(1 for result in _validation_cache.values() 
                                   if result.get('india_db_verified')),
        "total_indian_drugs": len(INDIAN_DRUG_NAMES)
    }


def clear_validation_cache():
    """Clear the validation cache (useful for testing)"""
    global _validation_cache
    _validation_cache = {}
    logger.info("Validation cache cleared")