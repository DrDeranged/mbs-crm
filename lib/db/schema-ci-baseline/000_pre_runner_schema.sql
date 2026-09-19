CREATE TABLE "activity_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "lead_id" integer,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "applications" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "type" text NOT NULL,
  "business_name" text NOT NULL,
  "dba" text,
  "ein" text,
  "business_address" text,
  "business_city" text,
  "business_state" text,
  "business_zip" text,
  "industry" text,
  "time_in_business_months" integer,
  "monthly_revenue_stated" integer,
  "requested_amount" integer,
  "use_of_funds" text,
  "equipment_description" text,
  "vendor_name" text,
  "vendor_quote_amount" numeric,
  "equipment_condition" text,
  "owner_first_name" text NOT NULL,
  "owner_last_name" text NOT NULL,
  "owner_ssn_encrypted" text,
  "owner_dob" text,
  "owner_home_address" text,
  "owner_home_city" text,
  "owner_home_state" text,
  "owner_home_zip" text,
  "ownership_pct" integer,
  "consent_credit_pull" boolean DEFAULT false NOT NULL,
  "consent_terms" boolean DEFAULT false NOT NULL,
  "signature_data" text,
  "signature_ip" text,
  "signed_document_key" text,
  "submitted_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "bank_statement_extractions" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "document_id" integer,
  "statement_month" integer,
  "statement_year" integer,
  "total_deposits" numeric,
  "average_daily_balance" numeric,
  "nsf_count" integer DEFAULT 0 NOT NULL,
  "negative_balance_days" integer DEFAULT 0 NOT NULL,
  "existing_positions_json" jsonb,
  "raw_extraction_json" jsonb,
  "extracted_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "communications" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer,
  "user_id" integer,
  "type" text NOT NULL,
  "direction" text NOT NULL,
  "from_number" text,
  "to_number" text,
  "body" text,
  "duration_seconds" integer,
  "recording_url" text,
  "recording_sid" text,
  "status" text DEFAULT 'initiated' NOT NULL,
  "twilio_sid" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "companies" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "name" text,
  "address" text,
  "city" text,
  "state" text,
  "zip" text,
  "industry" text,
  "time_in_business_months" integer,
  "annual_revenue" numeric(15, 2),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "companies_lead_id_unique" UNIQUE("lead_id")
);
CREATE TABLE "company_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_name" text,
  "company_email" text,
  "company_phone" text,
  "company_website" text,
  "company_address" text,
  "company_city" text,
  "company_state" text,
  "company_zip" text,
  "retention_months" integer DEFAULT 36,
  "include_admins_in_round_robin" boolean DEFAULT false NOT NULL,
  "round_robin_cursor" integer DEFAULT 0 NOT NULL,
  "stale_threshold_days" integer DEFAULT 7 NOT NULL,
  "email_sending_enabled" boolean DEFAULT false NOT NULL,
  "bulk_email_per_minute" integer DEFAULT 60 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "credit_compliance_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "credit_pull_id" integer,
  "lead_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "action" text NOT NULL,
  "permissible_purpose" text NOT NULL,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "credit_pulls" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "pulled_by" integer NOT NULL,
  "pull_type" text NOT NULL,
  "consent_captured_at" timestamp,
  "consent_ip" text,
  "credit_score" integer,
  "report_summary" jsonb,
  "request_payload_encrypted" text,
  "response_payload_encrypted" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "user_id" integer,
  "filename" text NOT NULL,
  "file_key" text NOT NULL,
  "file_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "drip_enrollments" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "sequence_id" integer NOT NULL,
  "current_step" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "enrolled_at" timestamp DEFAULT now() NOT NULL,
  "last_step_sent_at" timestamp,
  "completed_at" timestamp,
  "unenrolled_at" timestamp
);
CREATE TABLE "drip_sequences" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "trigger_status" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "drip_sequence_steps" (
  "id" serial PRIMARY KEY NOT NULL,
  "sequence_id" integer NOT NULL,
  "step_order" integer NOT NULL,
  "template_id" integer NOT NULL,
  "delay_hours" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "email_sends" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer,
  "user_id" integer,
  "template_id" integer,
  "subject" text NOT NULL,
  "to_email" text NOT NULL,
  "from_email" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "sendgrid_message_id" text,
  "sent_at" timestamp,
  "opened_at" timestamp,
  "clicked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "email_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "subject" text NOT NULL,
  "body_html" text NOT NULL,
  "program_type" text,
  "sender_mode" text DEFAULT 'default' NOT NULL,
  "created_by" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "flyer_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "program_type" text DEFAULT 'general' NOT NULL,
  "html_template" text NOT NULL,
  "variable_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "generated_flyers" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer,
  "template_id" integer,
  "field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "pdf_storage_key" text,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "error_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL,
  "user_id" text,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "status" integer NOT NULL,
  "message" text NOT NULL,
  "stack" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "idempotency_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "endpoint" text NOT NULL,
  "result_ref" text,
  "result_payload" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "clerk_id" text NOT NULL,
  "name" text,
  "email" text NOT NULL,
  "role" text DEFAULT 'rep' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "mobile_number" text,
  "push_token" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
  CONSTRAINT "users_email_unique" UNIQUE("email")
);
CREATE TABLE "leads" (
  "id" serial PRIMARY KEY NOT NULL,
  "first_name" text,
  "last_name" text,
  "email" text,
  "phone" text,
  "company_name" text,
  "ein" text,
  "application_type" text DEFAULT 'working_capital' NOT NULL,
  "status" text DEFAULT 'new_lead' NOT NULL,
  "assigned_rep_id" integer,
  "lead_source" text DEFAULT 'manual' NOT NULL,
  "is_unsubscribed" boolean DEFAULT false NOT NULL,
  "requested_amount" integer,
  "credit_score" integer,
  "existing_positions" integer,
  "consent_credit_pull_at" timestamp,
  "consent_ip" text,
  "last_activity_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "due_date" date,
  "is_completed" boolean DEFAULT false NOT NULL,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "lead_status_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "changed_by_user_id" integer,
  "from_status" text,
  "to_status" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "lead_assignment_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "changed_by_user_id" integer,
  "from_rep_id" integer,
  "to_rep_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "lender_matches" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "lender_id" integer NOT NULL,
  "match_score" integer NOT NULL,
  "criteria_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "matched_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "lender_submissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL,
  "lender_id" integer NOT NULL,
  "submitted_by" integer,
  "status" text DEFAULT 'submitted' NOT NULL,
  "response_notes" text,
  "submitted_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "lenders" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "program_types" text[] DEFAULT '{}' NOT NULL,
  "min_amount" integer,
  "max_amount" integer,
  "min_credit_score" integer,
  "accepted_industries" text[] DEFAULT '{}' NOT NULL,
  "min_time_in_business_months" integer DEFAULT 0 NOT NULL,
  "accepted_states" text[] DEFAULT '{}' NOT NULL,
  "max_existing_positions" integer DEFAULT 10 NOT NULL,
  "priority_weight" integer DEFAULT 5 NOT NULL,
  "contact_name" text,
  "contact_email" text,
  "notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "workflow_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "trigger_status" text NOT NULL,
  "action_type" text NOT NULL,
  "action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "lead_id" integer,
  "is_read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "job_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "job_name" text NOT NULL,
  "started_at" timestamp NOT NULL,
  "finished_at" timestamp,
  "status" text NOT NULL,
  "items_processed" integer,
  "error_message" text
);
CREATE TABLE "pii_access_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "lead_id" integer,
  "field_category" text NOT NULL,
  "action" text NOT NULL,
  "ip" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "applications" ADD CONSTRAINT "applications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "bank_statement_extractions" ADD CONSTRAINT "bank_statement_extractions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "bank_statement_extractions" ADD CONSTRAINT "bank_statement_extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "communications" ADD CONSTRAINT "communications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "communications" ADD CONSTRAINT "communications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "companies" ADD CONSTRAINT "companies_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "credit_compliance_log" ADD CONSTRAINT "credit_compliance_log_credit_pull_id_credit_pulls_id_fk" FOREIGN KEY ("credit_pull_id") REFERENCES "public"."credit_pulls"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "credit_compliance_log" ADD CONSTRAINT "credit_compliance_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "credit_compliance_log" ADD CONSTRAINT "credit_compliance_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "credit_pulls" ADD CONSTRAINT "credit_pulls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "credit_pulls" ADD CONSTRAINT "credit_pulls_pulled_by_users_id_fk" FOREIGN KEY ("pulled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "documents" ADD CONSTRAINT "documents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "drip_enrollments" ADD CONSTRAINT "drip_enrollments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "drip_enrollments" ADD CONSTRAINT "drip_enrollments_sequence_id_drip_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."drip_sequences"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "drip_sequence_steps" ADD CONSTRAINT "drip_sequence_steps_sequence_id_drip_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."drip_sequences"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "drip_sequence_steps" ADD CONSTRAINT "drip_sequence_steps_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "flyer_templates" ADD CONSTRAINT "flyer_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "generated_flyers" ADD CONSTRAINT "generated_flyers_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "generated_flyers" ADD CONSTRAINT "generated_flyers_template_id_flyer_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."flyer_templates"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "generated_flyers" ADD CONSTRAINT "generated_flyers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_rep_id_users_id_fk" FOREIGN KEY ("assigned_rep_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "notes" ADD CONSTRAINT "notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lead_assignment_history" ADD CONSTRAINT "lead_assignment_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lead_assignment_history" ADD CONSTRAINT "lead_assignment_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lead_assignment_history" ADD CONSTRAINT "lead_assignment_history_from_rep_id_users_id_fk" FOREIGN KEY ("from_rep_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lead_assignment_history" ADD CONSTRAINT "lead_assignment_history_to_rep_id_users_id_fk" FOREIGN KEY ("to_rep_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lender_matches" ADD CONSTRAINT "lender_matches_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lender_matches" ADD CONSTRAINT "lender_matches_lender_id_lenders_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."lenders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lender_submissions" ADD CONSTRAINT "lender_submissions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lender_submissions" ADD CONSTRAINT "lender_submissions_lender_id_lenders_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."lenders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lender_submissions" ADD CONSTRAINT "lender_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "activity_lead_idx" ON "activity_log" USING btree ("lead_id");
CREATE INDEX "activity_user_idx" ON "activity_log" USING btree ("user_id");
CREATE INDEX "activity_created_idx" ON "activity_log" USING btree ("created_at");
CREATE INDEX "applications_lead_idx" ON "applications" USING btree ("lead_id");
CREATE INDEX "bse_lead_idx" ON "bank_statement_extractions" USING btree ("lead_id");
CREATE INDEX "comms_lead_idx" ON "communications" USING btree ("lead_id");
CREATE INDEX "comms_user_idx" ON "communications" USING btree ("user_id");
CREATE INDEX "comms_twilio_sid_idx" ON "communications" USING btree ("twilio_sid");
CREATE INDEX "comms_created_idx" ON "communications" USING btree ("created_at");
CREATE INDEX "credit_compliance_log_lead_idx" ON "credit_compliance_log" USING btree ("lead_id");
CREATE INDEX "credit_compliance_log_user_idx" ON "credit_compliance_log" USING btree ("user_id");
CREATE INDEX "credit_pulls_lead_idx" ON "credit_pulls" USING btree ("lead_id");
CREATE INDEX "documents_lead_idx" ON "documents" USING btree ("lead_id");
CREATE INDEX "email_sends_lead_idx" ON "email_sends" USING btree ("lead_id");
CREATE INDEX "email_sends_sgid_idx" ON "email_sends" USING btree ("sendgrid_message_id");
CREATE INDEX "email_sends_status_idx" ON "email_sends" USING btree ("status");
CREATE INDEX "flyer_templates_active_idx" ON "flyer_templates" USING btree ("is_active");
CREATE INDEX "flyer_templates_program_idx" ON "flyer_templates" USING btree ("program_type");
CREATE INDEX "generated_flyers_lead_idx" ON "generated_flyers" USING btree ("lead_id");
CREATE INDEX "generated_flyers_template_idx" ON "generated_flyers" USING btree ("template_id");
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone");
CREATE INDEX "leads_ein_idx" ON "leads" USING btree ("ein");
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");
CREATE INDEX "leads_rep_idx" ON "leads" USING btree ("assigned_rep_id");
CREATE INDEX "notes_lead_idx" ON "notes" USING btree ("lead_id");
CREATE INDEX "tasks_lead_idx" ON "tasks" USING btree ("lead_id");
CREATE INDEX "tasks_user_idx" ON "tasks" USING btree ("user_id");
CREATE INDEX "tasks_due_date_idx" ON "tasks" USING btree ("due_date");
CREATE INDEX "status_history_lead_idx" ON "lead_status_history" USING btree ("lead_id");
CREATE INDEX "assignment_history_lead_idx" ON "lead_assignment_history" USING btree ("lead_id");
CREATE INDEX "lender_matches_lead_idx" ON "lender_matches" USING btree ("lead_id");
CREATE INDEX "lender_matches_lender_idx" ON "lender_matches" USING btree ("lender_id");
CREATE INDEX "lender_submissions_lead_idx" ON "lender_submissions" USING btree ("lead_id");
CREATE INDEX "lender_submissions_lender_idx" ON "lender_submissions" USING btree ("lender_id");
CREATE INDEX "lenders_active_idx" ON "lenders" USING btree ("is_active");