CREATE TRIGGER approval_content_immutable
BEFORE UPDATE OF id,company_id,agent_id,tool,payload,payload_hash,risk,requested_by,created_at ON approvals
BEGIN SELECT RAISE(ABORT,'Approval proposal content is immutable'); END;
CREATE TRIGGER approval_no_delete BEFORE DELETE ON approvals
BEGIN SELECT RAISE(ABORT,'Approval history is immutable'); END;
