CREATE TABLE design_resource_bindings (
 company_id TEXT NOT NULL,job_id TEXT NOT NULL,task_id TEXT NOT NULL,reservation_id TEXT,
 PRIMARY KEY(company_id,job_id),UNIQUE(company_id,reservation_id),
 FOREIGN KEY(company_id,job_id) REFERENCES generation_jobs(company_id,id),
 FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id),
 FOREIGN KEY(company_id,reservation_id) REFERENCES resource_reservations(company_id,id)
);
CREATE TRIGGER design_resource_binding_retained BEFORE DELETE ON design_resource_bindings BEGIN SELECT RAISE(ABORT,'Billing linkage retained'); END;
CREATE TRIGGER design_resource_binding_immutable BEFORE UPDATE ON design_resource_bindings WHEN OLD.reservation_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Billing linkage is immutable'); END;
