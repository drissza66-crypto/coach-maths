CREATE TABLE "activity_days" (
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"secondes" integer DEFAULT 0 NOT NULL,
	"last_ping_at" timestamp with time zone NOT NULL,
	CONSTRAINT "activity_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "activity_days" ADD CONSTRAINT "activity_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;