# Things the loop cannot do

Four items. None takes long, two of them are pass/fail for the submission, and the harness will not
attempt any of them.

## Before the loop runs

- [ ] **Make the repository visible.** `github.com/akhil-bot/CaseRelay` currently returns HTTP 404
      to an unauthenticated visitor, so there is no repo for a judge to open. Either make it public,
      or share it with **both** `testing@devpost.com` and `cloudhackathons@google.com`.
      *This is pass/fail, not scoring — nothing else in the plan matters if it stays private.*

- [ ] **Confirm gcloud is authenticated to the right project**, or the cloud tasks (`t11.5`,
      `t12.2`) will fail on their first attempt:

      gcloud auth login
      gcloud auth application-default login
      gcloud config set project caserelay

- [ ] **Install the portal's node modules** if you have not already, or `t2.3`'s typecheck cannot
      run: `cd portal && npm install`

## While the loop runs (do it any time)

- [ ] **Post the social update** with `#AllThingsAgenticHackathon`. Twenty minutes for 0.2 bonus
      points on a 6.0 scale.

## After the loop finishes

- [ ] **Review the branch.** The driver commits one task per commit on `harness/portal-ready`, so
      `git log --oneline main..harness/portal-ready` reads as the plan's step list. Skim the diffs
      before merging — the gates prove behaviour, not taste.

- [ ] **Read `harness/NOTES.md`.** Anything the agent found and could not fix is under
      *Observed, out of scope*; anything it disagreed with is under *Gate disputes*. Both are worth
      five minutes.

- [ ] **Hand your teammate three things:** the URL in `infra/control_plane_url.txt`,
      `contracts/openapi.json`, and `docs/admin-page-spec.md`.
