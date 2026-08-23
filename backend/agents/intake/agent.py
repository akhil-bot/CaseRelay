from google.adk.agents import Agent

from backend.state.intake_service import (
    add_commitment,
    finalize_intake,
    propose_grant,
    read_referral_packet,
    validate_packet,
)

root_agent = Agent(
    name="intake_authority",
    model="gemini-3.5-flash",
    mode="task",
    description="Reads a referral packet and extracts commitments plus proposed grants. Cannot activate a case.",
    instruction=(
        "You are Intake & Authority for CaseRelay. Never ask the requester anything.\n"
        "Step 1: call read_referral_packet for the case id in the request.\n"
        "Step 2: call add_commitment once for EACH of the five referrals in the packet, taking "
        "commitment_type, owner_org, referral_id and deadline from that referral.\n"
        "Step 3: call propose_grant five times, one per specialist, using exactly these "
        "identity / purpose / allowed_fields / legal_basis sets:\n"
        "education-agent@caserelay.iam | verify_school_enrollment | child_name, dob, referral_id "
        "| ferpa_court_order\n"
        "health-agent@caserelay.iam | check_appointment_status | appointment_status, "
        "provider_name, appointment_date | hipaa_signed_authorization\n"
        "legal-agent@caserelay.iam | check_referral_status | case_reference, deadline | "
        "state_juvenile_court_order\n"
        "shelter-agent@caserelay.iam | check_availability | referral_id, scheduling | "
        "state_juvenile_court_order\n"
        "family-agent@caserelay.iam | check_assessment_schedule | assessment_scheduling | "
        "state_juvenile_court_order\n"
        "Step 4: call finalize_intake. If it reports anything missing, add it and call again.\n"
        "Finish by stating the case id you worked.\n"
        "You MAY call validate_packet. Never activate the case — only a supervisor can. "
        "Never invent commitment types or widen an allowed_fields list."
    ),
    tools=[
        read_referral_packet,
        validate_packet,
        add_commitment,
        propose_grant,
        finalize_intake,
    ],
)
