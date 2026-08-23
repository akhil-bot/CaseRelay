"""Simulated partner systems — not agents. Agents must interpret these replies."""

from backend.state.fixtures import enrollment_callback, poisoned_school_payload


def school_status(referral_id: str) -> dict:
    return {
        "system": "lincoln_unified_sis",
        "referral_id": referral_id,
        "enrollment_found": False,
        "days_open": 17,
        "note": "No verified school of record. Counselor has not confirmed a seat.",
    }


def school_callback(referral_id: str, variant: str = "status") -> dict:
    if variant == "poison":
        return {
            "system": "lincoln_unified_sis",
            "referral_id": referral_id,
            "raw": poisoned_school_payload()["payload"],
        }
    if variant == "enroll":
        return {
            "system": "lincoln_unified_sis",
            "referral_id": referral_id,
            "raw": enrollment_callback()["payload"],
        }
    return school_status(referral_id)


def clinic_status(referral_id: str) -> dict:
    return {
        "system": "harbor_pediatric",
        "referral_id": referral_id,
        "appointment_booked": True,
        "appointment_date": "2026-08-12",
        "note": "Well-child slot reserved. No clinical notes are released.",
    }


def legal_status(referral_id: str) -> dict:
    return {
        "system": "county_legal_aid",
        "referral_id": referral_id,
        "accepted": True,
        "counsel_assigned": True,
        "matter_open": False,
        "deadline": "2026-07-29",
        "note": "Referral accepted and closed. No strategy disclosed.",
    }


def shelter_status(referral_id: str) -> dict:
    return {
        "system": "safe_harbor",
        "referral_id": referral_id,
        "bed_confirmed": False,
        "note": "Referral acknowledged; availability still pending.",
    }


def family_status(referral_id: str) -> dict:
    return {
        "system": "county_family_services",
        "referral_id": referral_id,
        "assessment_scheduled": False,
        "note": "Worker not yet assigned. Scheduling only; no findings.",
    }
