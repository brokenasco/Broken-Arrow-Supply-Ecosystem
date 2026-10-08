CREATE TABLE execution_receipts (
 company_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 reference_hash TEXT NOT NULL, usage TEXT NOT NULL, received_at TEXT NOT NULL,
 PRIMARY KEY(company_id,operation_id),
 FOREIGN KEY(company_id,operation_id) REFERENCES execution_operations(company_id,id)
);
CREATE TRIGGER execution_receipt_immutable BEFORE UPDATE ON execution_receipts BEGIN SELECT RAISE(ABORT,'Execution receipt immutable'); END;
CREATE TRIGGER execution_receipt_retained BEFORE DELETE ON execution_receipts BEGIN SELECT RAISE(ABORT,'Execution receipt retained'); END;
