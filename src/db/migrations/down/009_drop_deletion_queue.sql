-- Reverse Migration: 009_drop_deletion_queue
DROP TABLE IF EXISTS deletion_queue CASCADE;
