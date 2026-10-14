# Creative batch queue

Script and storyboard background batches publish a `creativeintel-creative-batch` message after creating a `Job` row. The Queue callback holds a shared `SharedLease` for that job, reconstructs inputs from the row, and checkpoints each completed item in `Job.steps`. A duplicate delivery skips steps already marked `done`. If the function's start window expires, unstarted steps remain `queued` and a delayed message resumes them. The five-minute `poll-video-jobs` cron republishes unfinished rows if a send or callback is lost.

Deploy the `SharedLease` migration before enabling this consumer. Verify that the `creativeintel-creative-batch` trigger is registered, create a batch with more items than fit one delivery, close the browser tab, and confirm it completes without creating a second version for already checkpointed items. Test a duplicate callback and a failed send in the preview environment before production rollout.

Queue delivery is at least once. A process crash after an AI provider completes but before its item checkpoint is saved can repeat that item; the queue cannot guarantee exactly-once provider billing. Do not use this mechanism as a substitute for provider-side idempotency or invoice reconciliation.
