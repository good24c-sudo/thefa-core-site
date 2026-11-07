-- TEST fixture uses this existing function verbatim.
CREATE FUNCTION public.ceo_core_receipt_current_matches_v2(b jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path='' AS $current$
DECLARE r public.ceo_core_recovery_projection_v1%rowtype;
 l public.ceo_succession_work_lease_v1%rowtype; fence_result jsonb;
BEGIN
  BEGIN
    SELECT * INTO STRICT r FROM public.ceo_core_recovery_projection_v1 p
      WHERE p.project_key=b->>'project_key' AND p.room_family=b->>'room_family'
        AND p.room_instance=b->>'room_instance' AND p.workstream_key=b->>'workstream_key'
        AND p.is_current=true FOR SHARE;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN false;
  END;
  IF NOT (r.repository IS NOT DISTINCT FROM b->>'repository'
    AND r.branch IS NOT DISTINCT FROM b->>'branch'
    AND r.owning_issue IS NOT DISTINCT FROM b->>'owning_issue'
    AND r.current_head_sha IS NOT DISTINCT FROM b->>'head_sha'
    AND r.work_identity_binding_hash IS NOT DISTINCT FROM b->>'work_identity_binding_hash'
    AND r.ownership->>'active_writer' IS NOT DISTINCT FROM b->>'writer_id'
    AND r.ownership->'fencing_generation' IS NOT DISTINCT FROM b->'fencing_generation'
    AND r.ownership->'owned_paths' IS NOT DISTINCT FROM b->'owned_paths'
    AND r.ownership->>'writer_lease_idempotency_key' IS NOT DISTINCT FROM b->>'writer_lease_idempotency_key'
    AND NOT coalesce((r.ownership->>'write_sealed')::boolean,false)) THEN RETURN false; END IF;
  -- Follow the existing Core binding checker order: Current then authoritative
  -- lease. A stale display projection must never authorize a predecessor.
  SELECT * INTO l FROM public.ceo_succession_work_lease_v1
    WHERE idempotency_key=b->>'writer_lease_idempotency_key' FOR SHARE;
  -- Admin supplies the exact canonical lease work key from existing authority;
  -- do not infer legacy aliases or construct a new work key from display IDs.
  IF NOT FOUND OR l.work_key IS DISTINCT FROM b->>'writer_lease_work_key'
    OR l.repository IS DISTINCT FROM b->>'repository'
    OR l.branch IS DISTINCT FROM b->>'branch'
    OR l.head_sha IS DISTINCT FROM b->>'head_sha'
    OR l.active_writer IS DISTINCT FROM b->>'writer_id'
    OR l.fencing_generation IS DISTINCT FROM (b->>'fencing_generation')::bigint
    OR l.bound_identity_fingerprint IS DISTINCT FROM b->>'work_identity_binding_hash' THEN RETURN false; END IF;
  fence_result:=public.ceo_core_validate_succession_writer_fence_v1(
    b->>'writer_lease_idempotency_key',b->>'work_identity_binding_hash',
    b->>'writer_id',(b->>'fencing_generation')::bigint);
  RETURN fence_result->>'decision' IS NOT DISTINCT FROM 'WRITER_FENCE_VERIFIED';
END $current$;