-- AI usage records: what every AI call cost, appended once (ADR 0031). No foreign keys, so records outlive what they name.
CREATE TABLE `ai_usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`organization_id` text,
	`project_id` integer,
	`draft_id` text,
	`thread_id` text,
	`member_id` text,
	`initiator` text NOT NULL,
	`patroller` text,
	`purpose` text NOT NULL,
	`turn_id` text,
	`step` integer,
	`tool_calls` text,
	`tool_kind` text,
	`tool_result_bytes` text,
	`model` text,
	`provider` text,
	`generation_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`reasoning_tokens` integer,
	`cost_micro_usd` integer,
	`cost_source` text,
	`status` text NOT NULL,
	`latency_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_records_key_idx` ON `ai_usage_records` (`key`);--> statement-breakpoint
CREATE INDEX `ai_usage_records_organization_idx` ON `ai_usage_records` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_records_project_idx` ON `ai_usage_records` (`project_id`,`created_at`);