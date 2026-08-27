#!/usr/bin/env python
"""Ticket Board desktop plugin backend — FastAPI routes.

Serves the AgencyOS ticket pipeline to the Hermes desktop plugin:
  - ticket list (filter by status / needs-human)
  - ticket detail (messages, drafts, tasks, plan)
  - status changes, draft approve/queue, priority set
  - insured + policy resolution

Mounted at /api/plugins/ticket-board/* by the Hermes plugin loader.
Reads Firestore (rmi-web) via cli/firestore_hlp.py.
"""
import json, os, sys, uuid, datetime

from fastapi import APIRouter, Query, Body

sys.path.insert(0, "/opt/data/agencyos/cli")
import firestore_hlp as fs

router = APIRouter()

TICKET_FIELDS = [
    "id", "clientId", "clientName", "clientEmail", "subject", "snippet",
    "status", "priority", "channel", "visibility",
    "linkedInsuredId", "linkedPolicyIds", "linkedContactIds",
    "sourceEmailId", "sourceEmailDate", "messages", "aiTasks", "actionItems",
    "tasks", "drafts", "timeline", "plan", "privateNotes",
    "createdAt", "updatedAt", "preppedAt",
]

PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3, "": 4, None: 4}


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ticket(t):
    return {k: t.get(k) for k in TICKET_FIELDS if k in t}


@router.get("/tickets")
def tickets(status: str = Query(None), needs_human: bool = Query(False),
            priority: str = Query(None), q: str = Query(None)):
    """List tickets. needs_human=true returns the owner queue (BLOCKED /
    WAITING_ON_CLIENT with drafts pending / high priority needing eyes)."""
    try:
        docs = fs.query("tickets", limit=500)
    except Exception as e:
        return {"tickets": [], "error": str(e)}
    out = []
    for t in docs:
        s = t.get("status") or ""
        if status and s != status:
            continue
        p = t.get("priority") or ""
        if priority and p != priority:
            continue
        if needs_human:
            # the "needs me" queue: blocked, or waiting-on-client with a draft
            # pending approval, or high priority and not closed
            if s == "BLOCKED":
                pass
            elif s in ("WAITING_ON_CLIENT", "WAITING_ON_CARRIER") and t.get("drafts"):
                pass
            elif p == "P0" and s not in ("CLOSED", "ARCHIVED"):
                pass
            else:
                continue
        if q:
            ql = q.lower()
            hay = f"{t.get('clientName')} {t.get('subject')} {t.get('policyNumber','')}".lower()
            if ql not in hay:
                continue
        out.append(_ticket(t))
    out.sort(key=lambda t: (PRIORITY_ORDER.get(t.get("priority")), t.get("updatedAt") or ""))
    return {"tickets": out}


@router.get("/tickets/{tid}")
def ticket_detail(tid: str):
    t = fs.get(tid, "tickets")
    if not t:
        return {"error": "not found"}
    # events subcollection
    try:
        events = fs.query(f"tickets/{tid}/events", limit=100)
    except Exception:
        events = []
    t["events"] = events
    return _ticket(t)


@router.patch("/tickets/{tid}")
def ticket_update(tid: str, body: dict = Body(...)):
    t = fs.get(tid, "tickets")
    if not t:
        return {"error": "not found"}
    allowed = {"status", "priority", "aiTasks", "actionItems", "tasks", "drafts",
               "privateNotes", "messages", "plan", "snippet", "clientName"}
    changed = False
    for k, v in body.items():
        if k in allowed:
            t[k] = v
            changed = True
    if changed:
        t["updatedAt"] = _now()
        fs.set(tid, t, "tickets")
    return _ticket(t)


@router.post("/tickets/{tid}/events")
def ticket_event(tid: str, body: dict = Body(...)):
    """Append a timeline event (e.g. status change, draft queued)."""
    ev = {
        "id": uuid.uuid4().hex[:12],
        "type": body.get("type", "note"),
        "text": body.get("text", ""),
        "visibleToClient": body.get("visibleToClient", True),
        "createdAt": _now(),
    }
    fs.set(f"{tid}/events/{ev['id']}", ev, "tickets")
    t = fs.get(tid, "tickets")
    if t:
        tl = t.get("timeline") or []
        tl.append({"id": ev["id"], "type": ev["type"], "text": ev["text"],
                   "visibleToClient": ev["visibleToClient"], "createdAt": ev["createdAt"]})
        t["timeline"] = tl
        t["updatedAt"] = _now()
        fs.set(tid, t, "tickets")
    return ev


@router.get("/insureds")
def insureds(q: str = Query(None), limit: int = Query(20)):
    try:
        docs = fs.query("insureds", limit=3000)
    except Exception as e:
        return {"insureds": [], "error": str(e)}
    if q:
        ql = q.lower()
        docs = [i for i in docs if ql in (i.get("name") or "").lower()
                or ql in (i.get("commercialName") or "").lower()
                or ql in (i.get("email") or "").lower()]
    return {"insureds": docs[:limit]}


@router.get("/stats")
def stats():
    try:
        docs = fs.query("tickets", limit=500)
    except Exception as e:
        return {"error": str(e)}
    counts = {}
    for t in docs:
        s = t.get("status") or "UNKNOWN"
        counts[s] = counts.get(s, 0) + 1
    needs_human = 0
    for t in docs:
        s = t.get("status") or ""
        p = t.get("priority") or ""
        if s == "BLOCKED" or (s in ("WAITING_ON_CLIENT", "WAITING_ON_CARRIER") and t.get("drafts")) or (p == "P0" and s not in ("CLOSED", "ARCHIVED")):
            needs_human += 1
    return {"counts": counts, "total": len(docs), "needsHuman": needs_human}
