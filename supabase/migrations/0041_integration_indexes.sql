-- TALAB Phase 3 integration performance follow-up.
-- Covers sync_jobs.provider_id FK for provider-scoped worker queries/deletes.

create index if not exists sync_jobs_provider_idx
  on public.sync_jobs(provider_id);
