#!/usr/bin/env python3
"""Parse GOVMAN XML → data/raw/usgm/entities.json"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
USGM = ROOT / "data" / "raw" / "usgm"
OUT = USGM / "entities.json"


def clean(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def paragraphs(parent, tag: str) -> list[str] | None:
    import xml.etree.ElementTree as ET

    block = parent.find(tag)
    if block is None:
        return None
    out = []
    for p in block.findall(".//Paragraph"):
        t = clean("".join(p.itertext()))
        if t:
            out.append(t)
    return out or None


def leadership(parent) -> list[dict]:
    people = []
    for table in parent.findall(".//LeaderShipTable"):
        header = clean("".join((table.findtext("Header") or "")))
        names = table.findall(".//NameColumnValue")
        titles = table.findall(".//TitleColumnValue")
        for i, n in enumerate(names):
            name = clean("".join(n.itertext()))
            title = clean("".join(titles[i].itertext())) if i < len(titles) else ""
            if name or title:
                people.append(
                    {
                        "name": name or None,
                        "title": title or None,
                        "section": header or None,
                    }
                )
    return people


def first_web(parent) -> str | None:
    for w in parent.findall(".//WebAddress"):
        t = clean("".join(w.itertext()))
        if t:
            return t
    return None


def first_phone(parent) -> str | None:
    for p in parent.findall(".//Phone"):
        t = clean("".join(p.itertext()))
        if t:
            return t
    return None


def record(el, level: str) -> dict:
    return {
        "entityId": el.get("EntityId"),
        "parentId": el.get("ParentId"),
        "level": level,
        "category": clean(el.findtext("Category")) or None,
        "entityType": clean(el.findtext("EntityType")) or None,
        "name": clean(el.findtext("AgencyName")),
        "mission": paragraphs(el, "MissionStatement"),
        "organization": paragraphs(el, "OrganizationStatement"),
        "legalAuthority": paragraphs(el, "LegalAuthority"),
        "leadership": leadership(el)[:50],
        "web": first_web(el),
        "phone": first_phone(el),
    }


def find_xml() -> Path:
    manifest = USGM / "manifest.json"
    if manifest.exists():
        year = json.loads(manifest.read_text()).get("year")
        if year:
            matches = sorted((USGM / str(year)).glob("GOVMAN-*.xml"))
            if matches:
                return matches[-1]
    matches = sorted(USGM.glob("**/GOVMAN-*.xml"))
    if not matches:
        raise SystemExit("No GOVMAN-*.xml found. Run: npm run fetch:usgm")
    return matches[-1]


def main() -> None:
    import xml.etree.ElementTree as ET

    xml_path = find_xml()
    root = ET.parse(xml_path).getroot()
    entities: list[dict] = []

    for ent in root.findall("Entity"):
        entities.append(record(ent, "entity"))
        for tag, level in (
            ("SubEntityLevelOne", "sub1"),
            ("SubEntityLevelTwo", "sub2"),
            ("SubEntityLevelThree", "sub3"),
        ):
            for sub in ent.findall(f".//{tag}"):
                rec = record(sub, level)
                if rec["name"]:
                    entities.append(rec)

    # drop empties
    entities = [e for e in entities if e["name"]]

    edition = xml_path.stem  # GOVMAN-2025-12-31
    payload = {
        "parsedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "sourceFile": str(xml_path.relative_to(ROOT)),
        "edition": edition,
        "count": len(entities),
        "entities": entities,
    }
    OUT.write_text(json.dumps(payload, indent=2))
    with_mission = sum(1 for e in entities if e["mission"])
    with_lead = sum(1 for e in entities if e["leadership"])
    print(f"Parsed {len(entities)} entities from {xml_path.name}")
    print(f"  with mission:    {with_mission}")
    print(f"  with leadership: {with_lead}")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
