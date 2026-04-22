"""
bulk_update_occupancy.py
------------------------
Bulk-updates occupancyInfo for all WMS locations by matching location `remark`
fields against barcodes in an Excel mapping file, then POSTing each updated
location back to the WMS API.

Usage:
    1. Paste your Bearer token into TOKEN below.
    2. Run:  python bulk_update_occupancy.py
"""

import time
import requests
import pandas as pd

# =============================================================================
# CONFIGURATION — edit these before running
# =============================================================================

TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJodHRwOi8vc2NoZW1hcy54bWxzb2FwLm9yZy93cy8yMDA1LzA1L2lkZW50aXR5L2NsYWltcy9uYW1lIjoiQWlkZW4iLCJ1c2VyTmFtZSI6IkFpZGVuIEtpbSIsInVzZXJMZXZlbCI6IjEiLCJ3YXJlaG91c2VDb2RlIjoiIiwiaHR0cDovL3NjaGVtYXMubWljcm9zb2Z0LmNvbS93cy8yMDA4LzA2L2lkZW50aXR5L2NsYWltcy9yb2xlIjoidXNlciIsImV4cCI6MTc3Njg5ODk2NywiaXNzIjoiV01TLkFQSSIsImF1ZCI6IldNUy5XZWIifQ.pN2sEVqJR2dPRsewglKKTLLAaFoEaY4WjnOfC4AcD1I"

API_BASE = "https://us-wms-api.stload.com/api"
WAREHOUSE_CODE = "STO01"

EXCEL_PATH = (
    r"C:\Users\ctkso\OneDrive - CTK\Chang Oh's files - For Aiden"
    r"\WMS\Shipbob\Location Mapping\Location mapping with shipbob-ctk.xlsx"
)
EXCEL_SHEET = "Master Control"

# Column indices in the Excel sheet (0-based, header row = row 0)
COL_BARCODE = 0   # Column A — Barcode Number  → matches location `remark`
COL_SLOT    = 7   # Column H — SLOT TYPE       → becomes occupancyInfo value

REQUEST_DELAY = 0.05   # seconds between save requests

# =============================================================================
# HELPERS
# =============================================================================

def make_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def fetch_all_locations(headers: dict) -> list[dict]:
    """Fetch every location from the WMS API (single large page request)."""
    print("\n[Step 1] Fetching all locations from API...")

    url = f"{API_BASE}/warehouse/location/list"
    payload = {
        "page": 1,
        "pageSize": 9999,
        "warehouseCode": "",
        "search": "",
        "sortField": "WarehouseCode",
        "sortDir": "asc",
    }

    response = requests.post(url, json=payload, headers=headers, timeout=60)
    response.raise_for_status()

    data = response.json()

    # Debug: show top-level keys and structure
    if isinstance(data, dict):
        print(f"  [DEBUG] Response keys: {list(data.keys())}")
        for k, v in data.items():
            if isinstance(v, dict):
                print(f"    '{k}' (dict) keys: {list(v.keys())}")
                for k2, v2 in v.items():
                    if isinstance(v2, list):
                        print(f"      '{k2}' (list) len={len(v2)}, sample={v2[:1]}")
                    else:
                        print(f"      '{k2}': {v2}")
            elif isinstance(v, list):
                print(f"    '{k}' (list) len={len(v)}")
            else:
                print(f"    '{k}': {v}")
    elif isinstance(data, list):
        print(f"  [DEBUG] Response is a list of len={len(data)}")

    # Parse — handle nested data.list pattern common in this WMS
    locations = []
    if isinstance(data, list):
        locations = data
    elif isinstance(data, dict):
        inner = data.get("data", data)
        if isinstance(inner, list):
            locations = inner
        elif isinstance(inner, dict):
            for key in ("list", "items", "records", "result", "results", "content"):
                if isinstance(inner.get(key), list):
                    locations = inner[key]
                    break
        if not locations:
            for key in ("list", "items", "records", "result", "results", "content"):
                if isinstance(data.get(key), list):
                    locations = data[key]
                    break
        if not locations:
            locations = next((v for v in data.values() if isinstance(v, list)), [])

    print(f"  => Fetched {len(locations)} locations.")
    return locations


def load_excel_mapping(path: str, sheet: str) -> dict[str, str]:
    """
    Read the Excel file and return a dict of
        { barcode_str (stripped) : slot_type_str (stripped) }
    """
    print("\n[Step 2] Loading Excel mapping...")

    df = pd.read_excel(path, sheet_name=sheet, header=0, dtype=str)

    mapping: dict[str, str] = {}
    skipped_rows = 0

    for _, row in df.iterrows():
        barcode_raw = row.iloc[COL_BARCODE]
        slot_raw    = row.iloc[COL_SLOT]

        # Skip rows where either value is missing / NaN
        if pd.isna(barcode_raw) or pd.isna(slot_raw):
            skipped_rows += 1
            continue

        barcode   = str(barcode_raw).strip()
        slot_type = str(slot_raw).strip()

        if barcode:
            mapping[barcode] = slot_type

    print(f"  => {len(mapping)} valid barcode→slot_type pairs loaded "
          f"({skipped_rows} rows skipped due to missing data).")
    return mapping


def build_save_payload(location: dict, new_occupancy: str) -> dict:
    """
    Build the /warehouse/location/save payload from an existing location
    object, overwriting occupancyInfo with the new value and remark with
    the constructed barcode (zone+aisle+bay+level+position).
    """
    zone  = str(location.get("zoneNm",     "") or "").strip().zfill(2)
    aisle = str(location.get("aisleNm",    "") or "").strip().zfill(2)
    bay   = str(location.get("bayNm",      "") or "").strip().zfill(2)
    level = str(location.get("levelNm",    "") or "").strip().zfill(2)
    pos   = str(location.get("positionNm", "") or "").strip().zfill(2)
    barcode = zone + aisle + bay + level + pos

    return {
        "warehouseCd":   location.get("warehouseCd", ""),
        "warehouseCode": location.get("warehouseCode", WAREHOUSE_CODE),
        "zoneNm":        location.get("zoneNm", ""),
        "aisleNm":       location.get("aisleNm", ""),
        "bayNm":         location.get("bayNm", ""),
        "levelNm":       location.get("levelNm", ""),
        "positionNm":    location.get("positionNm", ""),
        "remark":        barcode,
        "isNew":         False,
        "maxCbf":        location.get("maxCbf", 0),
        "maxCbm":        location.get("maxCbm", 0),
        "occupancyInfo": new_occupancy,
    }


def save_location(headers: dict, payload: dict) -> bool:
    """POST the save payload; return True on success, False on failure."""
    url = f"{API_BASE}/warehouse/location/save"
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        return True
    except requests.exceptions.HTTPError as exc:
        print(f"    [HTTP ERROR] {exc} | remark={payload.get('remark')} "
              f"| status={exc.response.status_code}")
        return False
    except requests.exceptions.RequestException as exc:
        print(f"    [REQUEST ERROR] {exc} | remark={payload.get('remark')}")
        return False


# =============================================================================
# MAIN
# =============================================================================

def main() -> None:
    if TOKEN == "paste_your_bearer_token_here":
        print("ERROR: Please set your Bearer token in the TOKEN variable at "
              "the top of this script.")
        return

    headers = make_headers(TOKEN)

    # --- Step 1: Fetch locations ---
    locations = fetch_all_locations(headers)
    if not locations:
        print("No locations returned from API. Aborting.")
        return

    # --- Step 2: Load Excel mapping ---
    barcode_to_slot = load_excel_mapping(EXCEL_PATH, EXCEL_SHEET)
    if not barcode_to_slot:
        print("No mapping data loaded from Excel. Aborting.")
        return

    # --- Step 3: Update matching locations ---
    print(f"\n[Step 3] Processing {len(locations)} locations...")
    print("-" * 60)

    total     = len(locations)
    success   = 0
    failed    = 0
    skipped   = 0   # no Excel match

    for i, location in enumerate(locations, start=1):
        # Primary match: remark field
        remark = str(location.get("remark", "") or "").strip()

        # Fallback: construct barcode from zone+aisle+bay+level+position
        zone  = str(location.get("zoneNm",     "") or "").strip().zfill(2)
        aisle = str(location.get("aisleNm",    "") or "").strip().zfill(2)
        bay   = str(location.get("bayNm",      "") or "").strip().zfill(2)
        level = str(location.get("levelNm",    "") or "").strip().zfill(2)
        pos   = str(location.get("positionNm", "") or "").strip().zfill(2)
        constructed = zone + aisle + bay + level + pos

        slot_type = barcode_to_slot.get(remark) or barcode_to_slot.get(constructed)

        if not slot_type:
            skipped += 1
        else:
            payload = build_save_payload(location, slot_type)
            ok = save_location(headers, payload)
            if ok:
                success += 1
            else:
                failed += 1
            time.sleep(REQUEST_DELAY)

        # Progress report every 100 records
        if i % 100 == 0 or i == total:
            processed = success + failed
            print(f"  Progress: {i}/{total} scanned | "
                  f"updated={success} | failed={failed} | skipped={skipped}")

    # --- Summary ---
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Total locations scanned : {total}")
    print(f"  Successfully updated    : {success}")
    print(f"  Failed                  : {failed}")
    print(f"  Skipped (no Excel match): {skipped}")
    print("=" * 60)


if __name__ == "__main__":
    main()
