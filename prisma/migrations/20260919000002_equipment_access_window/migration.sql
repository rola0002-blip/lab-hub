-- Per-equipment daily booking window. Default 0..1439 = 24 hours, which matches
-- what the API/service-key surface has always permitted (fixes off-band bookings
-- being invisible on calendar surfaces that hardcoded 07:00–23:00).
ALTER TABLE "Equipment" ADD COLUMN IF NOT EXISTS "accessStartMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Equipment" ADD COLUMN IF NOT EXISTS "accessEndMinutes" INTEGER NOT NULL DEFAULT 1439;
