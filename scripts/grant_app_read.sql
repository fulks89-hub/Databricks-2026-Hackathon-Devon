SELECT rolname FROM pg_roles WHERE rolname LIKE '7021a56e%';
SELECT nspname FROM pg_namespace WHERE nspname IN ('app','app_read') ORDER BY 1;
SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' ORDER BY 1;
GRANT USAGE ON SCHEMA app_read TO "7021a56e-920b-4d4d-be1a-c1c2c95e3ae9";
GRANT SELECT ON ALL TABLES IN SCHEMA app_read TO "7021a56e-920b-4d4d-be1a-c1c2c95e3ae9";
ALTER DEFAULT PRIVILEGES IN SCHEMA app_read GRANT SELECT ON TABLES TO "7021a56e-920b-4d4d-be1a-c1c2c95e3ae9";
