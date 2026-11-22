CREATE TABLE IF NOT EXISTS "movimenti" (
	"id" text PRIMARY KEY,
	"dati" jsonb NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "impostazioni" (
	"chiave" text PRIMARY KEY,
	"valore" jsonb NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
