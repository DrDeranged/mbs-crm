-- Migration: Enforce append-only constraint on credit_compliance_log
-- This table is a compliance audit trail and must never be modified or deleted.
-- These triggers fire BEFORE any UPDATE or DELETE, raising an exception.

CREATE OR REPLACE FUNCTION prevent_credit_compliance_log_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credit_compliance_log is append-only: % operations are not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS credit_compliance_log_no_update ON credit_compliance_log;
CREATE TRIGGER credit_compliance_log_no_update
  BEFORE UPDATE ON credit_compliance_log
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_compliance_log_mutation();

DROP TRIGGER IF EXISTS credit_compliance_log_no_delete ON credit_compliance_log;
CREATE TRIGGER credit_compliance_log_no_delete
  BEFORE DELETE ON credit_compliance_log
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_compliance_log_mutation();
