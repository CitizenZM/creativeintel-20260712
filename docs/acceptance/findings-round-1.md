IMPROVEMENT: sniff image magic bytes on upload instead of trusting the client MIME (logo.webp was really PNG → 415)
FINDING: research status steps[] show 'Crawl websites:pending' and 'Ad discovery:running' after the job completed — step bookkeeping in job-progress/runner is not finalizing earlier steps (cosmetic but misleading)
FINDING: script hook 'Before and after: crepey skin erased.' overstates vs claimsAllowed — script prompt should hard-enforce claimsForbidden/claimsAllowed and a post-check should flag absolute words (erased/cures/proven)
FINDING: studio storyboard selector (label) did not switch selection on click via JS — compiled the already-selected board; make the selector a real radio/select with agent-addressable inputs
FINDING: Meta playbook uses 'This ad has multiple versions' as the title for multi-version ads — fall back to the ad body text / page name
