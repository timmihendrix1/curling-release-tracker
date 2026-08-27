-- Stage B0.2e — retire the Team-local Profile creation route.
--
-- `ensure_my_profile()` plus `complete_personal_onboarding(...)` is now the only
-- browser-accessible creation/completion flow. The legacy function remains in the
-- schema so this forward migration is non-destructive and old migration history is
-- reproducible, but no browser or PUBLIC role may execute it.

revoke execute on function public.bootstrap_profile(text) from public, anon, authenticated;
