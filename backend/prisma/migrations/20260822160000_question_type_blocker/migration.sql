-- Pulse: add BLOCKER question type for type-driven Slack blocker flow.
-- Reuses existing PulseBlocker / modal / memory outbox architecture.

ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'BLOCKER';
