-- Create a UC managed Volume to stage the raw TSV for robust read_files load.
CREATE VOLUME IF NOT EXISTS workspace.app_state.files
